# 🏁 ARYA DOCK — Virtual Macro Keypad & Cockpit Controller

[![CI](https://github.com/kartik1502/arya-dock/actions/workflows/ci.yml/badge.svg)](https://github.com/kartik1502/arya-dock/actions/workflows/ci.yml)
[![Security Scan](https://github.com/kartik1502/arya-dock/actions/workflows/security.yml/badge.svg)](https://github.com/kartik1502/arya-dock/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

> A responsive, dark-cockpit digital macro keypad and companion deck that transforms your phone, tablet, or secondary display into a tactile, programmable hardware-free control deck.

---

## 🏎️ What is Arya Dock?

**Arya Dock** is a web-based companion deck that eliminates the need for expensive physical macro keypads or hardware consoles. It runs as a local web service on your PC and streams an interactive, responsive control deck to any connected device (mobile browser, tablet, or desktop window).

Whether you are writing code, monitoring cloud infrastructure, compiling microservices, running tests, or controlling media playback, Arya Dock gives you instant physical command over your workstation directly from your desk phone stand.

---

## 🔒 Security Model & Architecture

Arya Dock implements strict defense-in-depth boundaries to protect your workstation from unauthorized command execution, cross-site hijacking, and network eavesdropping:

### 1. Cryptographic Pairing Token (`ARYA_PAIRING_TOKEN`)
- All WebSocket upgrade handshakes and `/api/*` endpoints require a secure 32-character hexadecimal token.
- Tokens can be supplied via the `Authorization: Bearer <token>` header, `X-Pairing-Token` header, or URL query parameter (`?token=<token>`).
- The pairing token is cryptographically generated on first launch (`crypto.randomBytes(16).toString('hex')`) and persisted in `config/auth.json` with strict `0600` permissions.
- Evaluated on upgrade and API requests using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

### 2. Origin Header Verification
- Browser WebSocket upgrades verify the HTTP `Origin` header against localhost, loopback (`127.0.0.1`, `::1`), and detected host network interface IPs.
- Requests originating from external browser tabs or malicious websites are rejected with `403 Forbidden`, neutralizing Cross-Site WebSocket Hijacking (CSWSH).
- Wildcard CORS (`Access-Control-Allow-Origin: *`) is completely removed from all HTTP endpoints.

### 3. Role Separation: Operator vs. Editor
- **Operator Role (Viewer / Trigger):** Default role for remote phone and tablet connections. Operators are permitted to trigger buttons (`BUTTON_CLICK`), switch active pages (`PAGE_PREV`, `PAGE_NEXT`), and respond to heartbeats (`PING`/`PONG`). Operators **cannot** mutate button definitions, add or remove tiles, switch active profiles, or inspect workstation directories.
- **Editor Role:** Full workstation configuration privilege. Editors can modify button actions (`UPDATE_BUTTON`), add/delete tiles (`ADD_BUTTON`, `DELETE_BUTTON`), resize the grid (`SET_BUTTONS_COUNT`), change active profiles (`SET_PROFILE`), and browse workstation directories (`/api/directories`).

### 4. Localhost Automatic Editor Privilege & SSH Tunnel / Proxy Considerations
- Connections originating directly from localhost (`127.0.0.1`, `::1`, `localhost`) automatically receive the **Editor** role without needing an editor key.
- ⚠️ **Key Security Behavior:** If you expose Arya Dock via an SSH port forward (e.g. `ssh -L 3333:localhost:3333 user@server`) or behind a reverse proxy (e.g. Nginx, Caddy) that forwards connections from `127.0.0.1` without preserving remote client IPs, **every incoming connection through that tunnel or proxy will appear as localhost and receive full Editor privileges**. When exposing Arya Dock remotely across shared networks, bind directly to your LAN IP or configure reverse proxies so that client IPs are not masked as `127.0.0.1`.

### 5. Remote Editor Elevation & Query-String Elimination
- Remote devices connect as Operators by default. To unlock Editor privileges, tap the unlock button in the web interface and enter the Editor Key into the in-app modal (transmitting an `AUTH_EDIT` WebSocket message) or provide the `X-Editor-Key` HTTP header.
- Query-string `editKey` (`?editKey=...`) is **intentionally rejected and ignored** across both HTTP and WebSocket connections to prevent editor keys from leaking into browser history, server access logs, or HTTP Referer headers.

### 6. Unauthenticated Static Assets
- Static web assets (`/`, `/index.html`, `/style.css`, `/app.js`, `/manifest.json`, `/icon.svg`) are served without requiring an authentication token.
- This allows browsers and Progressive Web App (PWA) client shells to load the application frontend and service worker offline before pairing. All dynamic data endpoints (`/api/*`) and WebSocket control channels require authentication.

### 7. Credential Rotation Lifecycle
- Credentials (`pairingToken` and `editorKey`) are stored in `config/auth.json`.
- Rotate credentials on disk at any time via CLI:
  ```bash
  node server.js --rotate-credentials
  ```
- **Restart Required:** Credentials are loaded into server memory at boot time, and active WebSocket connections stay connected. Rotating credentials on disk does not terminate active sessions until the server process is restarted.
- To rotate credentials and immediately launch the server with the new credentials in a single command, run:
  ```bash
  node server.js --rotate-credentials --start
  ```

### 8. Content Security Policy (CSP) & Defense-in-Depth
- Strict security headers: `default-src 'self'`, `connect-src 'self' ws: wss:`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`.
- Dynamic user-controlled strings and application metadata are rendered via safe DOM `textContent` APIs.

---

## ⚙️ Configuration & Environment Variables

Arya Dock is configurable via environment variables and CLI arguments:

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Server bind IP address. Set to `127.0.0.1` for local-only workstation access. |
| `PORT` | `3333` | HTTP and WebSocket listening port. |
| `CONFIG_PATH` | `./config/profiles.json` | Path to the profiles JSON configuration file. |
| `AUTH_PATH` | `./config/auth.json` | Path to the authentication credentials JSON file. |
| `TERMINAL` | Auto-detected | Custom terminal emulator command or path to override auto-detection (e.g. `ptyxis`, `gnome-terminal`, `konsole`, `alacritty`, `kitty`, `xterm`). |
| `ARYA_PAIRING_TOKEN` | Generated | Static pairing token override instead of generating a random 32-character token. |
| `ARYA_EDITOR_KEY` | Generated | Static editor key override instead of generating a random 32-character key. |

### CLI Flags

| Flag | Description |
|---|---|
| `--rotate-credentials` | Generates a new random pairing token and editor key, saves them to `auth.json`, prints them to stdout, and exits. |
| `--start` | When combined with `--rotate-credentials` (`node server.js --rotate-credentials --start`), rotates credentials on disk and boots the server immediately. |

### Config Location Flexibility
By default, profiles and authentication credentials live in `./config/profiles.json` and `./config/auth.json`. If you prefer to store configurations in a standard user configuration directory (e.g. `~/.config/arya-dock/`), specify `CONFIG_PATH` and `AUTH_PATH`:
```bash
CONFIG_PATH=~/.config/arya-dock/profiles.json AUTH_PATH=~/.config/arya-dock/auth.json node server.js
```

---

## 🎨 Design Philosophy & UI Architecture

Arya Dock is built using the **Motorsport Cockpit Design System** (`DESIGN.md`), reflecting precision engineering, dark cockpit aesthetics, and motorsport ergonomics:

* **Pure Pitch Black Canvas (`#000000`):** Designed for OLED mobile screens to achieve infinite contrast, zero backlight bleed, and low battery consumption.
* **Iconic Tricolor Signature Accents:**
  - **Light Blue (`#0066b1`):** Precision telemetry, focus indicators, and active mode highlights.
  - **Dark Blue (`#1c69d4`):** Secondary controls, action keys, and terminal execution badges.
  - **Red (`#e22718`):** Danger actions, deletion buttons, and high-impact execution alerts.
* **Fluid Dynamic Bezel & Container Queries:**
  - Uses CSS Container Queries (`container-type: inline-size`) and viewport math to adaptively resize keycap tiles from **1 up to 24 buttons**.
  - Dynamic aspect ratio reflow automatically computes the best column/row matrix (e.g. 1 tile, 4 tiles = 2×2, 6 tiles = 3×2, 9 tiles = 3×3, 12 tiles = 4×3, 16 tiles = 4×4) for both portrait and landscape screen orientations.
  - Zero text clipping: Labels scale dynamically with CSS `clamp(...)` to prevent awkward word chopping.
* **Cockpit Ergonomics & Steering Shift Paddles:**
  - Dual steering shift paddles at the bottom of the bezel (`PAGE PREV` / `PAGE NEXT`) for rapid multi-page navigation.
  - Drive Mode switches (`M1 Dev Cockpit` and `M2 Media & Telemetry`).

---

## 🛠️ Supported Platforms & Requirements

* **Operating System:** Linux (systemd-based distributions such as Fedora, Ubuntu, Arch, Debian)
* **Runtime:** Node.js v18.0.0 or higher
* **Default Shells:** Zsh (`/usr/bin/zsh`) or Bash (`/bin/bash`)
* **Terminal Emulators (auto-detected):** Ptyxis, GNOME Terminal, Konsole, Alacritty, Kitty, Xfce Terminal, xterm
* **Optional System Utilities:**
  - `playerctl` — media play/pause, next, and previous track actions
  - `wpctl` (WirePlumber / PipeWire) or `pactl` (PulseAudio) — volume up, down, and mute toggles
  - `xdg-open` — default web browser and file manager dispatching

---

## ⚡ Connection Modes

```text
 📱 Phone / Tablet (PWA or Browser)
       │
       ├── [OPTION A: USB Cable] ────────► Low-latency via USB Tethering
       │                                         │
       └── [OPTION B: Wi-Fi / LAN] ──────► Instant LAN connection via QR Code
                                                 │
                                                 ▼
                                    🖥️ Workstation (server.js :3333)
                                        ├─ Auth & Origin Guard (lib/auth.js)
                                        ├─ Atomic Config Manager (lib/config.js)
                                        ├─ Terminal Dispatcher (lib/terminal.js)
                                        └─ FreeDesktop App Parser (lib/apps.js)
```

### Option A: USB Cable (Recommended for Lowest Latency)
1. Connect your phone to your PC using a USB cable.
2. Turn on **USB Tethering** in your phone's network settings.
3. The server terminal detects the USB interface and prints the paired USB link (e.g. `http://10.91.187.251:3333/?token=...`).
4. Open the URL in your phone browser for instant, jitter-free physical response.

### Option B: Wi-Fi / LAN
1. Ensure your phone and PC are connected to the same Wi-Fi network.
2. Scan the **QR Code** generated in your terminal at server startup.

---

## 🚀 Getting Started

### 1. Installation
```bash
# Clone the repository
git clone https://github.com/kartik1502/arya-dock.git
cd arya-dock

# Install dependencies
npm install

# Run the test suite
npm test

# Start the service
npm start
```

### 2. Startup Banner Output
```text
========================================================
         🚀 ARYA DOCK — VIRTUAL KEYPAD CONSOLE          
========================================================

  🖥️  PC Web App:            http://localhost:3333/?token=...
  🐚  System Shell:          /usr/bin/zsh (zsh)
  ⚡  Terminal Emulator:     /usr/bin/ptyxis (ptyxis)
  🔌  USB Cable Tethering:   http://10.91.187.251:3333/?token=...
  📱  Wi-Fi (wlo1):          http://192.168.1.24:3333/?token=...

--- SECURITY & ROLES ---
• Pairing Token:   <random_32_char_hex>
• Editor Key:      <random_32_char_hex>
• Role Privileges: Localhost sessions have editor privileges. Remote sessions connect as operators.
                   To unlock editing remotely, use the in-app unlock modal or pass the X-Editor-Key header.
```

---

## 🎛️ How to Use & Configure

### 1. Navigation & Modes
* **M1 (Dev Cockpit):** Development workflows, AI coding agents, Docker, test runners, and text editors.
* **M2 (Media & Telemetry):** Volume up/down, mute, audio playback controls, screenshot, and workstation lock.
* **Shift Paddles:** Tap **`◀ PREV PAGE`** or **`NEXT PAGE ▶`** at the bottom of the bezel to switch pages.

### 2. Dynamic Tile Count (+ / −)
* Use the **`+`** and **`−`** buttons in the header to add or remove shortcuts.
* **Data-loss Protection:** If a configured tile with commands or custom labels is about to be deleted via `−`, a confirmation dialog prevents accidental mis-taps. Placeholder keys can be removed freely.

### 3. Drag & Drop Application Catalog
1. Click **`⚡ APPS`** to open the side drawer (available to Editors).
2. Browse or search through your installed system applications.
3. **Desktop:** Drag any application card directly onto any key.
4. **Mobile (Touch):** Tap any application card to open the quick-assign popup, then tap the target keycap.

### 4. Customizing Keys & Execution Modes
1. Click **`✏️`** in the header to enter edit mode.
2. Tap the keycap you want to edit to open the configuration dialog:
   * **Label & Icon:** Customize emoji icon and primary label.
   * **Accent Color:** Choose from Light Blue, Dark Blue, Red, or Graphite.
   * **Action Type:** Shell script (`shell`), Media (`media`), or Web URL (`url`).
   * **Terminal Mode:**
     - ⚡ **New Tab in Terminal:** Opens in an existing terminal as a new tab (`ptyxis --tab`, `gnome-terminal --tab`, etc.).
     - 🪟 **New Terminal Window:** Spawns an independent standalone terminal window.
     - 🔄 **Existing Terminal:** Runs directly in the active terminal session.
     - 🤫 **Background / Silent:** Runs in the background without opening any GUI window.
   * **Project Directory:**
     - Type any folder path with tilde expansion: `~/Documents/my-project`.
     - Or tap any of the auto-suggested directory chips.
   * **Stay Open After Exit:** Keeps your interactive shell open after the command exits so you can inspect output.
3. Tap **`SAVE CONFIGURATION`**.

### 5. Multi-Client Deck Semantics
Arya Dock operates as a shared physical workstation deck. All connected client devices share a synchronized active page and profile state:
- When any client navigates to next/previous page (`PAGE_NEXT` / `PAGE_PREV`) or switches profile (`SET_PROFILE`), all active screens (phone, tablet, desktop) update synchronously in real time.
- Key clicks trigger immediately on the workstation and send acknowledgment feedback (`BUTTON_ACK`) to the triggering client.

### 6. Data-Loss Protection on Tile Adjustments
- Decreasing the grid count or removing a configured tile requires user confirmation if the target button contains a configured command, URL, or custom label.
- Empty placeholder keys (`KEY n` with no assigned action) are removed cleanly without confirmation prompts.
- On the backend, `SET_BUTTONS_COUNT` protects configured buttons from accidental truncation unless explicitly confirmed with `force: true`.

---

## 📁 Repository Structure

```text
arya-dock/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml    # GitHub issue form for bug reports
│   │   └── feature_request.yml # GitHub issue form for feature requests
│   ├── workflows/
│   │   ├── ci.yml            # Multi-version Node matrix test CI workflow
│   │   └── security.yml      # CodeQL static analysis and security audit
│   └── pull_request_template.md # Clean PR checklist template
├── config/
│   ├── profiles.example.json # Version-controlled clean default configurations & shortcuts
│   ├── profiles.json         # Gitignored local profile configuration (atomic saves)
│   └── auth.json             # Gitignored local pairing token and editor key
├── lib/
│   ├── auth.js               # Cryptographic tokens, Origin check, constant-time compare
│   ├── config.js             # Atomic config persistence, schema validation, path resolution
│   ├── terminal.js           # Cached shell/terminal detection and safe command dispatch
│   ├── apps.js               # FreeDesktop .desktop app parser and project directories
│   ├── http.js               # Static file serving, security headers, path traversal guard
│   ├── ws.js                 # WebSocket connection handling, heartbeat, client sync
│   └── network.js            # Network interface discovery (USB tethering, Wi-Fi, LAN)
├── docs/
│   └── protocol-specs.md     # Reference protocol and hardware architecture guide
├── public/
│   ├── index.html            # Cockpit interface, modal dialogs, and drawer
│   ├── style.css             # Pitch black design system, container queries, and themes
│   ├── app.js                # Client controller, WebSocket heartbeat, dynamic grid reflow
│   ├── sw.js                 # Service Worker with offline PWA caching
│   ├── manifest.json         # Progressive Web App (PWA) manifest
│   └── icon.svg              # Cockpit application icon
├── test/
│   ├── auth.test.js          # Unit tests for security, constant-time compare, Origin checks
│   ├── config.test.js        # Unit tests for config validation and schema enforcement
│   ├── terminal.test.js      # Unit tests for command quoting and terminal builder
│   ├── http.test.js          # Tests for path traversal, malformed URLs, and security headers
│   └── integration.test.js   # End-to-end integration tests for WebSocket auth and mutations
├── CODE_OF_CONDUCT.md        # Contributor Covenant Code of Conduct
├── CONTRIBUTING.md           # Contribution, development setup, and testing guidelines
├── LICENSE                   # Standard MIT License
├── SECURITY.md               # Security policy and vulnerability reporting
├── server.js                 # Modular server entry point
└── package.json              # Project manifest, dependencies, and scripts
```

---

## 🤝 Contributing

Contributions, bug reports, and enhancements are warmly welcomed! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests or proposing major architectural changes.

---

## 🛡️ Security

To report security vulnerabilities responsibly, please consult our [Security Policy](SECURITY.md).

---

## 📄 License

This project is open-source under the [MIT License](LICENSE). Created by [Karthik Kulkarni](https://github.com/kartik1502).

