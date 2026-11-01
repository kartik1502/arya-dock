# 🏁 ARYA DOCK — Virtual Macro Keypad & Stream Controller

> A responsive, dark-cockpit digital macro keypad and companion deck that transforms your phone, tablet, or secondary display into a tactile, programmable hardware-free stream deck.

---

## 🏎️ What is Arya Dock?

**Arya Dock** is a web-based companion deck that eliminates the need for expensive physical macro keypads or hardware consoles. It runs as a local web service on your PC and streams an interactive, responsive control deck to any connected device (mobile browser, tablet, or desktop window).

Whether you are writing code, monitoring cloud infrastructure, compiling microservices, running tests, or streaming media, Arya Dock gives you instant physical command over your workstation directly from your desk phone stand.

---

## 🔒 Security & Role Architecture

Arya Dock implements strict defense-in-depth boundaries to protect your workstation:

* **Cryptographic Pairing Token (Issue #1):**
  - All WebSocket upgrades and `/api/*` endpoints require a secure 32-character hexadecimal token.
  - The token is displayed on server startup in the console and embedded inside the QR code for seamless mobile pairing.
  - Evaluated on upgrade using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks.
* **Origin Header Verification (Issue #2):**
  - WebSocket upgrade requests verify the `Origin` header to block cross-site hijacking from malicious browser tabs.
  - Wildcard CORS (`Access-Control-Allow-Origin: *`) is removed from all API endpoints.
* **Role Separation: Operator vs. Editor (Issue #3):**
  - **Operator Role (Viewer/Trigger):** Permitted to trigger button actions, switch pages, and send heartbeats. Cannot modify commands, profiles, or buttons.
  - **Editor Role:** Permitted to update button configurations, add/remove tiles, and browse system directories.
  - **Privilege Assignment:** Localhost sessions (`127.0.0.1`, `localhost`) receive Editor privileges automatically. Remote phone/tablet sessions connect as Operators by default and can be unlocked by providing the `editorKey` printed at server startup.
* **Content Security Policy & XSS Elimination (Issue #6):**
  - Strict `Content-Security-Policy` headers prevent script injection.
  - Dynamic user-controlled strings and application metadata are rendered via safe DOM `textContent` APIs.

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

  🖥️  PC Web App:            http://localhost:3333/?token=...&editKey=...
  🐚  System Shell:          /usr/bin/zsh (zsh)
  ⚡  Terminal Emulator:     /usr/bin/ptyxis (ptyxis)
  🔌  USB Cable Tethering:   http://10.91.187.251:3333/?token=...
  📱  Wi-Fi (wlo1):          http://192.168.1.24:3333/?token=...

--- SECURITY & ROLES ---
• Pairing Token:   <random_32_char_hex>
• Editor Key:      <random_32_char_hex>
• Role Privileges: Localhost sessions have editor privileges. Remote sessions connect as operators.
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

### 5. Multi-Client Deck Semantics (Issue #16)
Arya Dock operates as a shared physical workstation deck. All connected client devices share a synchronized active page and profile state:
- When any client navigates to next/previous page (`PAGE_NEXT` / `PAGE_PREV`) or switches profile (`SET_PROFILE`), all active screens (phone, tablet, desktop) update synchronously in real time.
- Key clicks trigger immediately on the workstation and send acknowledgment feedback (`BUTTON_ACK`) to the triggering client.

### 6. Data-Loss Protection on Tile Adjustments (Issue #10)
- Decreasing the grid count or removing a configured tile requires user confirmation if the target button contains a configured command, URL, or custom label.
- Empty placeholder keys (`KEY n` with no assigned action) are removed cleanly without confirmation prompts.
- On the backend, `SET_BUTTONS_COUNT` protects configured buttons from accidental truncation unless explicitly confirmed with `force: true`.

---

## 📁 Repository Structure

```text
arya-dock/
├── config/
│   ├── profiles.example.json # Version-controlled clean default configurations & shortcuts
│   ├── profiles.json         # Gitignored local profile configuration (atomic saves)
│   └── auth.json             # Gitignored local pairing token and editor key
├── lib/
│   ├── auth.js               # Cryptographic tokens, Origin check, constant-time compare
│   ├── config.js             # Atomic config persistence, schema validation, path resolution
│   ├── terminal.js           # Cached shell/terminal detection and safe command dispatch
│   ├── apps.js               # FreeDesktop .desktop app parser and project directories
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
├── server.js                 # Modular server entry point
└── package.json              # Project manifest and test runner
```

---

## 📄 License
MIT License. Created by [Karthik Kulkarni](https://github.com/kartik1502).
