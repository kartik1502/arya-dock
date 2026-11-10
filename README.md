# 🏁 Arya Dock — Virtual Macro Keypad & Stream Deck Alternative for Linux

[![GitHub Actions CI Build Status](https://github.com/kartik1502/arya-dock/actions/workflows/ci.yml/badge.svg)](https://github.com/kartik1502/arya-dock/actions/workflows/ci.yml)
[![CodeQL Static Security Analysis](https://github.com/kartik1502/arya-dock/actions/workflows/security.yml/badge.svg)](https://github.com/kartik1502/arya-dock/actions/workflows/security.yml)
[![Open Source License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version Requirement](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Progressive Web App](https://img.shields.io/badge/PWA-Ready-orange.svg)](public/manifest.json)

> **Arya Dock** is a high-performance, dark-cockpit virtual macro keypad and stream deck alternative for Linux. Transform your smartphone, tablet, or secondary display into a customizable, low-latency companion deck for developer workflows, terminal scripts, system hotkeys, and media controls — completely free and hardware-independent.

<p align="center">
  <img src="https://raw.githubusercontent.com/kartik1502/arya-dock/main/public/og-image.png?v=2" alt="Arya Dock — Virtual Macro Keypad & Control Deck for Linux" width="760">
</p>

---

## 📑 Table of Contents

- [🏎️ What is Arya Dock?](#what-is-arya-dock)
- [✨ Key Features](#key-features)
- [🛠️ Supported Platforms & Requirements](#supported-platforms--requirements)
- [⚡ Connection Modes](#connection-modes)
  - [Option A: USB Cable (Lowest Latency)](#option-a-usb-cable-recommended-for-lowest-latency)
  - [Option B: Wi-Fi / LAN](#option-b-wi-fi--lan)
- [🚀 Getting Started](#getting-started)
  - [1. Prerequisites](#1-prerequisites)
  - [2. Installation](#2-installation)
  - [3. Run Verification Tests](#3-run-verification-tests)
  - [4. Start the Service](#4-start-the-service)
  - [5. Startup Banner Output](#5-startup-banner-output)
- [⚙️ Configuration Options](#configuration-options)
- [🔒 Security Model](#security-model)
- [📚 Documentation Guides](#documentation-guides)
- [📁 Repository Structure](#repository-structure)
- [🤝 Contributing](#contributing)
- [🛡️ Security](#security)
- [📄 License](#license)

---

<a id="what-is-arya-dock"></a>
## 🏎️ What is Arya Dock?

**Arya Dock** is a web-based companion deck and virtual stream deck alternative that eliminates the need for expensive physical macro keypads or proprietary hardware consoles. It runs as a local web service on your Linux workstation and streams an interactive, responsive control deck to any connected device (mobile browser, tablet, or desktop window).

Whether you are writing code, monitoring cloud infrastructure, compiling microservices, running tests, or controlling media playback, Arya Dock gives you instant physical command over your workstation directly from your desk phone stand.

---

<a id="key-features"></a>
## ✨ Key Features

- 📱 **Hardware-Free Companion Deck:** Turn any phone or tablet into a tactile macro keypad via modern Progressive Web App (PWA) technology.
- ⚡ **Ultra Low-Latency Execution:** USB tethering connection mode ensures near-zero latency input dispatch to your system.
- 🔒 **Defense-in-Depth Security:** Cryptographically generated pairing tokens, constant-time authentication, and Origin verification protect your workstation.
- 📐 **Dynamic Responsive Bezel:** Container-query-based adaptive layout scales dynamically from 1 to 24 keys without text truncation.
- 🚀 **Native Linux Integration:** Direct execution in your preferred shell (Bash, Zsh) and terminal emulator (`ptyxis`, `gnome-terminal`, `konsole`, `alacritty`, `kitty`).
- 🎵 **Workstation & Media Controls:** Native hotkeys for volume adjustment, mute toggles, and media track playback.

---

<a id="supported-platforms--requirements"></a>
## 🛠️ Supported Platforms & Requirements

* **Operating System:** Linux (systemd-based distributions such as Fedora, Ubuntu, Arch, Debian)
* **Runtime:** Node.js v18.0.0 or higher
* **Default Shells:** Zsh (`/usr/bin/zsh`) or Bash (`/bin/bash`)
* **Terminal Emulators (auto-detected):** Ptyxis, GNOME Terminal, Konsole, Alacritty, Kitty, Xfce Terminal, xterm
* **System Utilities (modular platform adapters):**
  - Media player control & volume via PipeWire/WirePlumber or PulseAudio
  - Desktop URL and file manager dispatching

---

<a id="connection-modes"></a>
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

<a id="option-a-usb-cable-recommended-for-lowest-latency"></a>
### Option A: USB Cable (Recommended for Lowest Latency)
1. Connect your phone to your PC using a USB cable.
2. Turn on **USB Tethering** in your phone's network settings.
3. The server terminal detects the USB interface and prints the paired USB link (e.g. `http://10.91.187.251:3333/?token=...`).
4. Open the URL in your phone browser for instant, jitter-free physical response.

<a id="option-b-wi-fi--lan"></a>
### Option B: Wi-Fi / LAN
1. Ensure your phone and PC are connected to the same Wi-Fi network.
2. Scan the **QR Code** generated in your terminal at server startup.

---

<a id="getting-started"></a>
## 🚀 Getting Started

<a id="1-prerequisites"></a>
### 1. Prerequisites
- Linux workstation with Node.js >= 18.0.0 installed.
- Modern browser on your phone/tablet (Chrome, Firefox, Safari).

<a id="2-installation"></a>
### 2. Installation
```bash
# Clone the repository
git clone https://github.com/kartik1502/arya-dock.git
cd arya-dock

# Install dependencies
npm install
```

<a id="3-run-verification-tests"></a>
### 3. Run Verification Tests
```bash
# Run full unit and integration test suite
npm test
```

<a id="4-start-the-service"></a>
### 4. Start the Service
```bash
# Start Arya Dock
npm start
```

<a id="5-startup-banner-output"></a>
### 5. Startup Banner Output
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

<a id="configuration-options"></a>
## ⚙️ Configuration Options

Arya Dock is fully configurable through environment variables and command-line flags:

| Option / Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | IP address to bind the HTTP and WebSocket server. Set to `127.0.0.1` for local-only workstation access. |
| `PORT` | `3333` | Port for the HTTP and WebSocket service. |
| `ARYA_HOME` | `~/.config/arya-dock` | Base directory for user profiles and credentials outside the repository. |
| `CONFIG_PATH` | `~/.config/arya-dock/profiles.json` | Filesystem path for profiles, buttons, pages, and key bindings. |
| `AUTH_PATH` | `~/.config/arya-dock/auth.json` | Filesystem path for pairing token and editor key credentials (mode 0600). |
| `TERMINAL` | Auto-detected | Preferred terminal emulator command or path override (e.g. `ptyxis`, `gnome-terminal`, `konsole`, `alacritty`, `kitty`, `xterm`). |
| `ARYA_PAIRING_TOKEN` | Generated | Static 32-character hexadecimal token override instead of generating a random token on boot. |
| `ARYA_EDITOR_KEY` | Generated | Static 32-character hexadecimal key override instead of generating a random key on boot. |
| `ARYA_PLATFORM` | `linux` (auto-detected) | Modular OS platform adapter override (`linux`, `darwin`, `fake`). |
| `--config <path>` | *CLI Flag* | Path override for profiles configuration file. |
| `--auth <path>` | *CLI Flag* | Path override for authentication credentials file. |
| `--rotate-credentials` | *CLI Flag* | Generates a new random pairing token and editor key, saves them to `auth.json`, prints them to stdout, and exits. *(Caveat: server restart required).* |
| `--start` | *CLI Flag* | Combined with `--rotate-credentials` (`node server.js --rotate-credentials --start`), rotates credentials on disk and starts the server immediately with the new credentials. |

---

<a id="security-model"></a>
## 🔒 Security Model

Arya Dock provides layered defense-in-depth protection to safeguard the host workstation while allowing low-latency control from mobile and companion devices:

### 1. Cryptographic Pairing & Constant-Time Validation
- All WebSocket upgrade handshakes and dynamic `/api/*` endpoints require a secure 32-character token (`ARYA_PAIRING_TOKEN`).
- Tokens can be provided via `Authorization: Bearer <token>`, `X-Pairing-Token` header, or `?token=<token>`.
- Token comparison uses constant-time string equality (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

### 2. Role Separation (Operator vs. Editor)
- **Operator Role (Viewer / Trigger):** Default role assigned to remote connections (phones, tablets over Wi-Fi or USB tethering). Operators can trigger macro keys (`BUTTON_CLICK`), change deck pages (`PAGE_PREV`, `PAGE_NEXT`), and maintain heartbeats (`PING`/`PONG`). Operators **cannot** modify tile layouts, update shell commands, adjust tile counts, switch active profiles, browse workstation directories (`/api/directories`), or scan host applications and executable commands (`/api/apps`).
- **Editor Role:** Full workstation configuration privilege. Editors can modify button actions (`UPDATE_BUTTON`), add/delete tiles, change profiles (`SET_PROFILE`), resize grid layouts (`SET_BUTTONS_COUNT`), browse suggested project directories (`/api/directories`), and scan installed host applications (`/api/apps`).

### 3. Key Security Caveats & Operational Considerations
- ⚠️ **Localhost as Editor:** Connections originating directly from localhost (`127.0.0.1`, `::1`, `localhost`) automatically receive **Editor** privileges without requiring an editor key.
  - *Reverse Proxy / SSH Forwarding Warning:* If you expose Arya Dock through an SSH tunnel (e.g. `ssh -L 3333:localhost:3333`) or behind a reverse proxy (e.g. Nginx, Caddy) that forwards connections as `127.0.0.1` without preserving remote client IPs, **all incoming connections will appear as localhost and inherit Editor privileges**. When accessing remotely across untrusted or shared networks, bind directly to your LAN IP or configure reverse proxies so that client IPs are not masked as `127.0.0.1`.
- ⚠️ **Unauthenticated Static Assets:** Static frontend assets (`/`, `/index.html`, `/style.css`, `/app.js`, `/manifest.json`, `/icon.svg`) are intentionally served without requiring authentication. This allows Progressive Web App (PWA) client shells and service workers to boot and cache assets offline before pairing. All dynamic control channels (`/ws`) and data endpoints (`/api/*`) strictly require authentication.
- ⚠️ **Credential Rotation Takes Effect on Restart:** Running `node server.js --rotate-credentials` rotates credentials on disk in `config/auth.json`. However, the running server process holds credentials in memory and does not reload credentials dynamically mid-flight. **A restart of the server process is required for newly rotated credentials to take effect.** To rotate credentials and restart immediately in a single step, run `node server.js --rotate-credentials --start`.
- ⚠️ **Environment Scan Barrier (`/api/apps` & `/api/directories`):** Workstation application scanning (`/api/apps`) and directory suggestions (`/api/directories`) expose executable commands (`Exec=`) and directory paths. These endpoints are strictly restricted to sessions with **Editor** privileges (localhost or remote sessions providing `X-Editor-Key`). Unprivileged operators querying these endpoints receive `403 Forbidden`. Furthermore, editor keys sent via query parameters (`?editKey=...`) are rejected to avoid leaking keys in browser history, logs, or HTTP Referer headers.
- ⚠️ **Origin Header Verification:** All WebSocket upgrade requests verify the HTTP `Origin` header against allowed workstation addresses and network interfaces to prevent Cross-Site WebSocket Hijacking (CSWSH).

---

<a id="documentation-guides"></a>
## 📚 Documentation Guides

For in-depth architecture, configuration, and customization guides, see the dedicated documentation:

* 🔒 **[Security Model & Architecture Guide](docs/architecture/security-model.md)**: Pairing tokens, Origin header verification, Operator vs. Editor role separation, localhost proxy caveats, credential rotation lifecycle, and Content Security Policy.
* 🛠️ **[Configuration Architecture & Persistence Design](docs/architecture/config-design.md)**: Ownership model, XDG Base Directory layout, path precedence, first-boot legacy migration, debounced saves, and backup rotation with auto-recovery.
* ⚙️ **[Configuration & Environment Reference](docs/guides/configuration.md)**: Complete reference of all environment variables (`HOST`, `PORT`, `CONFIG_PATH`, `AUTH_PATH`, `TERMINAL`, `ARYA_*`), CLI flags (`--rotate-credentials`, `--start`), and custom config paths.
* 🎛️ **[Usage & Deck Customization Guide](docs/guides/usage-guide.md)**: Navigation modes (M1 Dev, M2 Media), dynamic tile count adjustments (`+`/`−`), drag & drop application catalog, terminal execution modes, multi-client synchronization, and data-loss protection.
* 🎨 **[Motorsport Cockpit Design System](DESIGN.md)**: Design philosophy, pitch-black OLED canvas, container queries, and cockpit ergonomics.
* 🔌 **[Protocol Specifications](docs/architecture/protocol-specs.md)**: WebSocket message types, JSON payloads, and network framing.
* 🔭 **[Active Window Detection Spike](docs/research/active-window-spike.md)**: Investigation findings for desktop window focus tracking on GNOME Wayland and X11.

---

<a id="repository-structure"></a>
## 📁 Repository Structure

```text
arya-dock/
├── config/                   # Default templates and local configuration
├── docs/                     # In-depth architectural, operational, and design guides
│   ├── architecture/         # Security, storage persistence, and protocol specifications
│   ├── guides/               # User operation manuals and configuration reference
│   ├── designs/              # Feature RFCs and categorized review archives
│   └── research/             # Technical spikes and prototypes
├── lib/                      # Core backend services (auth, config, terminal, apps, ws, http)
├── platform/                 # Modular OS abstraction layer (Linux, Darwin, Fake)
├── public/                   # Frontend PWA (HTML, CSS, JS, manifest, Service Worker)
├── scripts/                  # Utility scripts (lint.js)
├── test/                     # Comprehensive test suites (unit, integration, platform, security)
├── server.js                 # Server entry point
└── package.json              # Project manifest and scripts
```

---

<a id="contributing"></a>
## 🤝 Contributing

Contributions, bug reports, and enhancements are warmly welcomed! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

---

<a id="security"></a>
## 🛡️ Security

To report security vulnerabilities responsibly, please consult our [Security Policy](SECURITY.md).

---

<a id="license"></a>
## 📄 License

This project is open-source under the [MIT License](LICENSE). Created by [Karthik Kulkarni](https://github.com/kartik1502).
