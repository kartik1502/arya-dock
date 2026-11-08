# 🛠️ Arya Dock — Configuration Architecture & Persistence Design

This document details the ownership model, filesystem storage locations, migration strategy, and persistence hardening mechanisms implemented in Arya Dock (Epic E2-1 and Epic E2-3).

---

## 1. Ownership Model: Single-User Workstation Architecture

### The Local Workstation Operator
Arya Dock is designed as a single-user workstation companion service. It operates under the identity and permissions of the local operating system account that launches the Node.js server process (`UID` / `$USER`).
- **Workstation Isolation:** All terminal sessions, application launches, and command executions spawned by Arya Dock run with the privileges of this workstation user.
- **Single-User Config Boundary:** Configuration profiles and cryptographic credentials belong exclusively to this workstation user. Multi-user operating systems isolate configurations per user account.

### Companion Role Separation
Remote devices (smartphones, tablets, auxiliary screens) connecting over Wi-Fi, USB tethering, or local network operate within strict role boundaries:
- **Operator Role (Viewer / Trigger):** Default unprivileged role. Operators can trigger buttons, change active pages, and maintain WebSocket heartbeats. Operators cannot view or modify filesystem paths, shell commands, or button definitions.
- **Editor Role:** Privileged administrative role. Available automatically to local loopback sessions (`127.0.0.1`, `::1`) or unlocked remotely using the shared Editor Secret Key. Editors can customize buttons, resize grids, switch profiles, and browse host application shortcuts.

---

## 2. Configuration Filesystem Layout

### Why Config Lives Outside the Repository
In legacy versions, configuration files lived inside the repository `./config/` directory. This posed two significant problems:
1. **Repository Dirtying:** Editing buttons or rearranging tiles in the web interface dirty `git status`, creating accidental merge conflicts and uncommitted changes.
2. **Privacy & Security Leakage:** Personal configurations often contain workstation-specific absolute paths (e.g. `/home/username/projects/...`), custom scripts, and personal workflows that should never be accidentally committed to a public git repository.

### Default Standard Locations
Arya Dock conforms to the **XDG Base Directory Specification** on Linux and Unix systems:

| Platform | Default Directory | Profiles File | Credentials File |
|---|---|---|---|
| **Linux / BSD** | `~/.config/arya-dock/` | `~/.config/arya-dock/profiles.json` | `~/.config/arya-dock/auth.json` |
| **macOS** | `~/.config/arya-dock/` | `~/.config/arya-dock/profiles.json` | `~/.config/arya-dock/auth.json` |
| **Windows** | `%APPDATA%\arya-dock\` | `%APPDATA%\arya-dock\profiles.json` | `%APPDATA%\arya-dock\auth.json` |

*Note on Read-Only Environments:* If the user home directory is mounted read-only (such as in restricted test sandboxes or immutable container images), Arya Dock detects non-writable paths and falls back gracefully to the local repository `./config/` directory.

### Credential Separation & Strict Permissions
Credentials (`auth.json`) are kept strictly separated from tile configurations (`profiles.json`):
- `auth.json` contains only `pairingToken` and `editorKey`. It is created and maintained with strict `0600` permissions (`-rw-------`), ensuring only the workstation user can read or write authentication tokens.
- `profiles.json` contains button layouts, action definitions, icons, colors, and profile pages. It contains zero credentials.

---

## 3. Environment Overrides & Path Resolution Precedence

Arya Dock supports granular environment variables and CLI flags. Paths resolve in the following order of precedence:

```text
[Highest Priority]
  1. CLI Flags: --config <path> and --auth <path>
  2. File Environment Variables: CONFIG_PATH and AUTH_PATH
  3. Directory Environment Variable: ARYA_HOME (e.g. $ARYA_HOME/profiles.json)
  4. XDG Specification: XDG_CONFIG_HOME (e.g. $XDG_CONFIG_HOME/arya-dock/)
  5. Default User Home: ~/.config/arya-dock/
[Lowest Priority]
```

### Path Resolution Rules
- Home directory shortcuts (`~` and `$HOME`) are expanded safely.
- Control characters and null bytes are rejected.
- Working directory paths for button commands reject shell metacharacters (`;&|`<>^"'`).

---

## 4. First-Boot Automatic Legacy Migration

When upgrading from an older Arya Dock installation where `./config/profiles.json` and `./config/auth.json` exist in the repository root:
1. **Automatic Discovery:** On startup, if the user directory config (`~/.config/arya-dock/profiles.json`) does not exist but legacy `./config/profiles.json` is present, Arya Dock automatically copies the legacy configuration to the user directory.
2. **Zero Data Loss:** Existing profiles, buttons, and custom commands are preserved completely.
3. **Credentials Migration:** Legacy `./config/auth.json` is likewise migrated to the user directory with permissions set to `0600`.
4. **Clean Git Status:** Future UI modifications are written exclusively to `~/.config/arya-dock/profiles.json`, keeping git working trees pristine.
5. **Fresh Installation Fallback:** On a fresh clone without legacy files, Arya Dock copies `config/profiles.example.json` to seed default developer, media, and system profiles, and generates cryptographically secure random 32-character tokens.

---

## 5. Persistence Hardening (E2-3)

### Debounced Writes
Rapid user actions in the web interface (such as fast typing in tile configuration fields, adjusting grid tile counts, or moving keys) trigger frequent save requests.
- **Batching:** Save requests are debounced across a configurable window (default 250ms). Bursts of multiple rapid mutations collapse into a single disk write.
- **Thread Safety & Race Prevention:** Synchronous atomic file substitution ensures no concurrent write collisions.

### Shutdown Flushing (`SIGINT` / `SIGTERM`)
To prevent data loss when stopping the server daemon:
- Arya Dock captures `SIGINT` (Ctrl+C) and `SIGTERM` signals.
- If a debounced write is pending in memory, it is immediately and synchronously flushed to disk before process exit.
- Calling `instance.close()` similarly flushes pending writes and cleans up signal listeners.

### Atomic File Writes
Direct file overwrites risk data corruption if the system crashes or loses power mid-write.
- Arya Dock writes serialized configuration data to a hidden temporary file in the target directory: `.profiles.<timestamp>.<rand>.tmp`.
- Once write and sync complete, the temporary file is renamed onto the target file via `fs.renameSync`. On POSIX filesystems, rename is atomic.

### Timestamped Backup Rotation
Before replacing an existing valid configuration file, Arya Dock creates a timestamped backup snapshot:
- **Format:** `profiles.json.bak.<timestamp>-<counter>`
- **Rotation:** Keeps the newest $N$ backups (default 5). Older backups beyond the retention limit are automatically pruned.
- **Migration Backup:** When upgrading legacy v0 configurations, a baseline `profiles.json.bak` snapshot is created on first save.

### Auto-Recovery from Corrupted or Truncated Files
If `profiles.json` is truncated (e.g. power failure during non-atomic manual edit) or malformed:
1. `loadConfig()` attempts to parse `profiles.json`.
2. If parsing fails, Arya Dock searches the configuration directory for timestamped backups (`profiles.json.bak.*`).
3. Backups are evaluated newest-first to find the latest valid snapshot containing healthy profiles.
4. If a valid backup is found:
   - Arya Dock logs a prominent warning: `[Arya Dock] WARNING: Configuration file at ... is corrupted or truncated (...). Auto-recovering from newest valid backup: ...`.
   - The corrupted file is preserved as `profiles.json.corrupted.<timestamp>` for forensics.
   - The valid backup is restored to `profiles.json`.
   - Server boots seamlessly with zero downtime.
5. If no valid backups exist, startup throws a descriptive error rather than silently continuing with an empty state.
