# 🏁 /// M ARYA DOCK — Virtual Macro Keypad & Stream Controller

> A high-performance, Motorsport Motorsport-themed digital macro keypad and companion cockpit that transforms your phone, tablet, or secondary display into a tactile, programmable hardware-free stream deck.

---

## 🏎️ What is Arya Dock?

**Arya Dock** is a web-based, low-latency companion deck that eliminates the need for expensive physical macro keypads or hardware consoles. It runs as a local web service on your PC and streams an interactive, responsive control deck to any connected device (mobile browser, tablet, or desktop window).

Whether you are writing code, monitoring cloud infrastructure, compiling microservices, running tests, or streaming media, Arya Dock gives you instant, one-touch physical command over your workstation directly from your desk phone stand.

---

## 🎨 Design Philosophy & UI Architecture

Arya Dock is built from the ground up using the **Motorsport Motorsport Design System** (`DESIGN.md`), reflecting precision engineering, dark cockpit aesthetics, and motorsport ergonomics:

* **Pure Pitch Black Canvas (`#000000`):** Designed for OLED mobile screens to achieve infinite contrast, zero backlight bleed, and minimal battery consumption.
* **Iconic /// M Tricolor Accents:**
  - **Light Blue (`#0066b1`):** Precision telemetry, focus indicators, and active mode highlights.
  - **Dark Blue (`#1c69d4`):** Secondary controls, action keys, and terminal execution badges.
  - **M Red (`#e22718`):** Danger actions, deletion buttons, and high-impact execution alerts.
* **Fluid Dynamic Bezel & Container Queries:**
  - Uses CSS Container Queries (`container-type: inline-size`) and viewport math to adaptively resize keycap tiles from **1 up to 24 buttons**.
  - Dynamic aspect ratio reflow automatically computes the best column/row matrix (e.g. 1 tile, 4 tiles = 2×2, 6 tiles = 3×2, 9 tiles = 3×3, 12 tiles = 4×3, 16 tiles = 4×4) for both portrait and landscape screen orientations.
  - Zero text clipping: Labels scale dynamically with CSS `clamp(...)` to prevent awkward word chopping.
* **Cockpit Ergonomics & Steering Shift Paddles:**
  - Dual steering shift paddles at the bottom of the bezel (`PAGE PREV` / `PAGE NEXT`) for rapid multi-page navigation.
  - M Drive Mode switches (`M1 Dev Cockpit` and `M2 Media & Telemetry`).

---

## 💻 Languages & Tech Stack

Arya Dock avoids bloated frontend frameworks, ensuring maximum performance, near-zero latency, and instant touch response:

| Layer | Technologies & Tools | Purpose |
| :--- | :--- | :--- |
| **Backend** | **JavaScript / Node.js** (v18+) | Lightweight HTTP & WebSocket server, FreeDesktop parser, command dispatcher |
| **Real-time Protocol** | **Native WebSockets (`ws`)** | Sub-millisecond bidirectional communication, button state sync, and heartbeats |
| **Frontend Runtime**| **Vanilla JavaScript (ES2022+)** | Zero-framework client runtime for instant DOM rendering and minimal battery drain |
| **Styling & Layout** | **Modern CSS3 (Container Queries, Grid, Flexbox)** | `@container` responsive scaling, CSS custom properties, smooth hardware transitions |
| **OS & Shell Integration** | **Zsh & Bash (`/usr/bin/zsh`, `/bin/bash`)** | Interactive login shell execution (`-i -l`), expanding user aliases (`lzd`, `vus`, `spr`) |
| **Desktop Terminals** | **Ptyxis, GNOME Terminal, Konsole, Alacritty** | Multi-terminal emulator support with tab/window dispatching |
| **Mobile Web APIs** | **Vibration API, Screen Wake Lock, Fullscreen API** | Physical haptic feedback on touch, continuous display wakefulness, borderless HUD |
| **PWA & Offline** | **Service Worker (`sw.js`) & Manifest** | Cache-busting updates, Add to Home Screen standalone installation |

---

## ⚡ Connection Modes

```text
 📱 Phone / Tablet (PWA or Browser)
       │
       ├── [OPTION A: USB Cable] ────────► Sub-millisecond latency via USB Tethering
       │                                         │
       └── [OPTION B: Wi-Fi / Bluetooth] ────────► Instant LAN connection via QR Code
                                                 │
                                                 ▼
                                    🖥️ Workstation (server.js :3333)
                                        ├─ FreeDesktop App Parser (/usr/share/applications)
                                        ├─ Terminal Dispatcher (Ptyxis / GNOME / Konsole)
                                        ├─ Interactive Shell Bridge (Zsh / Bash)
                                        └─ Project Working Directory Auto-Resolver
```

### Option A: USB Cable (Recommended for Lowest Latency)
1. Connect your phone to your PC using a USB cable.
2. Turn on **USB Tethering** in your phone's network settings.
3. The server terminal detects the USB interface and prints the USB link (e.g. `http://10.91.187.251:3333`).
4. Open the URL in your phone browser for instant, jitter-free physical response.

### Option B: Wi-Fi / Bluetooth LAN
1. Ensure your phone and PC are connected to the same Wi-Fi or Bluetooth PAN.
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

# Start the service
npm start
```

### 2. Startup Banner Output
```text
========================================================
         🚀 ARYA DOCK — VIRTUAL KEYPAD CONSOLE          
========================================================

  🖥️  PC Web App:            http://localhost:3333
  🐚  System Shell:          /usr/bin/zsh (zsh)
  ⚡  Terminal Emulator:     /usr/bin/ptyxis (ptyxis)
  🔌  USB Cable Tethering:   http://10.91.187.251:3333
  📱  Wi-Fi (wlo1):          http://192.168.1.24:3333
```

---

## 🎛️ How to Use & Configure

### 1. Navigation & Modes
* **M1 (Dev Cockpit):** Development workflows, AI coding agents, Docker, test runners, and text editors.
* **M2 (Media & Telemetry):** Volume up/down, mute, audio playback controls, screenshot, and workstation lock.
* **Shift Paddles:** Tap **`◀ PREV PAGE`** or **`NEXT PAGE ▶`** at the bottom of the bezel to switch pages.

### 2. Dynamic Tile Count (+ / −)
* Use the **`+`** and **`−`** buttons in the header to add or remove shortcuts.
* The grid dynamically computes the optimal columns and rows for any number of keys (1 to 24).

### 3. Drag & Drop Application Catalog
1. Click **`📦 APPS CATALOG`** to open the side drawer.
2. Browse or search through your installed system applications.
3. **Desktop:** Drag any application card directly onto any key!
4. **Mobile (Touch):** Tap any application card to open the quick-assign popup, then tap the target keycap.

### 4. Customizing Keys & Execution Modes
1. Click **`/// EDIT TILES`** in the header to enter edit mode.
2. Tap the keycap you want to edit to open the configuration dialog:
   * **Label & Icon:** Customize emoji icon and primary label.
   * **Accent Color:** Choose from Motorsport Light Blue, Dark Blue, Red, or Graphite.
   * **Action Type:** Shell script (`shell`) or Web URL (`url`).
   * **Terminal Mode:**
     - ⚡ **New Tab in Terminal:** Opens in an existing terminal as a new tab (`ptyxis --tab`, `gnome-terminal --tab`, etc.).
     - 🪟 **New Terminal Window:** Spawns an independent standalone terminal window.
     - 🔄 **Existing Terminal:** Runs directly in the active terminal session.
     - 🤫 **Background / Silent:** Runs in the background without opening any GUI window.
   * **Project Directory:**
     - Type any folder path with tilde expansion: `~/Documents/my-project`.
     - Or tap any of the **one-click directory chips** (e.g. `📁 Arya Banking Infra`, `📁 Home (~)`, `📁 Arya Dock`) located directly beneath the input field!
   * **Stay Open After Exit:** Keeps your interactive shell open after the command exits so you can continue working.
3. Tap **`SAVE CONFIGURATION`**.

### 5. Shell Aliases & Environment Support
Arya Dock automatically executes terminal commands inside your system's default shell (`/usr/bin/zsh` or `/bin/bash`) using interactive login mode (`-i -l`).
* All aliases configured in your `~/.zshrc` (such as `lzd` for `lazydocker`, `spr` for `mvn spring-boot:run`, `vus` for `make vault-unseal-linux`) work out-of-the-box.
* Includes Powerlevel10k (`POWERLEVEL9K_INSTANT_PROMPT=quiet`) and Oh My Zsh lock mitigations to guarantee error-free terminal startup.

---

## 📁 Repository Structure

```text
arya-dock/
├── config/
│   └── profiles.json       # Persisted multi-page layout configurations & shortcuts
├── docs/
│   └── protocol-specs.md   # Low-level protocol and hardware architecture reference
├── public/
│   ├── index.html          # Motorsport cockpit interface, modal dialogs, and drawer
│   ├── style.css           # Pitch black design system, container queries, and themes
│   ├── app.js              # Client controller, WebSocket heartbeat, dynamic grid reflow
│   ├── sw.js               # Service Worker with automatic cache-busting
│   ├── manifest.json       # Progressive Web App (PWA) manifest
│   └── icon.svg            # /// M branded application icon
├── DESIGN.md               # Motorsport Motorsport design tokens and guidelines
├── server.js               # Node.js backend: FreeDesktop parser, terminal dispatcher, WebSockets
└── package.json            # Project manifest and minimal dependencies
```

---

## 📄 License
MIT License. Created by [Karthik Kulkarni](https://github.com/kartik1502).
