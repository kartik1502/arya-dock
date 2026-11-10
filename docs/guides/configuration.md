# ⚙️ Arya Dock — Configuration & Environment Reference

Arya Dock is configurable via environment variables and CLI arguments. Detailed architectural decisions and persistence specifications are documented in [`docs/architecture/config-design.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/architecture/config-design.md).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Server bind IP address. Set to `127.0.0.1` for local-only workstation access. |
| `PORT` | `3333` | HTTP and WebSocket listening port. |
| `ARYA_HOME` | `~/.config/arya-dock` | Base directory for user profiles and credentials. |
| `CONFIG_PATH` | `~/.config/arya-dock/profiles.json` | Path to the profiles JSON configuration file. |
| `AUTH_PATH` | `~/.config/arya-dock/auth.json` | Path to the authentication credentials JSON file (mode 0600). |
| `TERMINAL` | Auto-detected | Custom terminal emulator command or path to override auto-detection (e.g. `ptyxis`, `gnome-terminal`, `konsole`, `alacritty`, `kitty`, `xterm`). |
| `ARYA_PAIRING_TOKEN` | Generated | Static pairing token override instead of generating a random 32-character token. |
| `ARYA_EDITOR_KEY` | Generated | Static editor key override instead of generating a random 32-character key. |
| `ARYA_PLATFORM` | `linux` (auto-detected) | Target OS platform adapter override (`linux`, `darwin`, `fake`). |

---

## CLI Flags

| Flag | Description |
|---|---|
| `--config <path>` | Path override for profiles configuration file. |
| `--auth <path>` | Path override for authentication credentials file. |
| `--rotate-credentials` | Generates a new random pairing token and editor key, saves them to `auth.json`, prints them to stdout, and exits. **Note:** A restart of any running server instance is required for rotated credentials to take effect. |
| `--start` | When combined with `--rotate-credentials` (`node server.js --rotate-credentials --start`), rotates credentials on disk and boots the server immediately with the new credentials in a single command. |

---

## Config Location & Automatic Migration

By default, profiles and authentication credentials live outside the repository in your standard user configuration directory:
- Profiles: `~/.config/arya-dock/profiles.json`
- Credentials: `~/.config/arya-dock/auth.json` (strictly protected with `0600` permissions)

### Automatic First-Boot Migration
When upgrading from an older installation where config lived in `./config/profiles.json` and `./config/auth.json`:
- Arya Dock automatically discovers existing repository configuration and migrates it to `~/.config/arya-dock/` on first startup without data loss.
- Your git repository working tree remains pristine when editing buttons in the interface.

### Persistence Hardening
- **Debounced Writes:** UI edits are debounced into batches (default 250ms) to prevent I/O thrashing.
- **Shutdown Flush:** In-flight pending saves are synchronously flushed to disk on `SIGINT` (Ctrl+C) and `SIGTERM`.
- **Timestamped Backup Rotation:** Timestamped backups (`.bak.<timestamp>`) are automatically maintained, retaining the 5 newest snapshots.
- **Auto-Recovery:** If `profiles.json` is corrupted or truncated, Arya Dock automatically recovers from the newest valid backup.
