# ⚙️ Arya Dock — Configuration & Environment Reference

Arya Dock is configurable via environment variables and CLI arguments.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Server bind IP address. Set to `127.0.0.1` for local-only workstation access. |
| `PORT` | `3333` | HTTP and WebSocket listening port. |
| `CONFIG_PATH` | `./config/profiles.json` | Path to the profiles JSON configuration file. |
| `AUTH_PATH` | `./config/auth.json` | Path to the authentication credentials JSON file. |
| `TERMINAL` | Auto-detected | Custom terminal emulator command or path to override auto-detection (e.g. `ptyxis`, `gnome-terminal`, `konsole`, `alacritty`, `kitty`, `xterm`). |
| `ARYA_PAIRING_TOKEN` | Generated | Static pairing token override instead of generating a random 32-character token. |
| `ARYA_EDITOR_KEY` | Generated | Static editor key override instead of generating a random 32-character key. |
| `ARYA_PLATFORM` | `linux` (auto-detected) | Target OS platform adapter override (`linux`, `darwin`, `fake`). |

---

## CLI Flags

| Flag | Description |
|---|---|
| `--rotate-credentials` | Generates a new random pairing token and editor key, saves them to `auth.json`, prints them to stdout, and exits. **Note:** A restart of any running server instance is required for rotated credentials to take effect. |
| `--start` | When combined with `--rotate-credentials` (`node server.js --rotate-credentials --start`), rotates credentials on disk and boots the server immediately with the new credentials in a single command. |

---

## Config Location Flexibility

By default, profiles and authentication credentials live in `./config/profiles.json` and `./config/auth.json`.

If you prefer to store configurations in a standard user configuration directory (e.g. `~/.config/arya-dock/`), specify `CONFIG_PATH` and `AUTH_PATH`:

```bash
CONFIG_PATH=~/.config/arya-dock/profiles.json AUTH_PATH=~/.config/arya-dock/auth.json node server.js
```
