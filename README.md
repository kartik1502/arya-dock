# 🎛️ Arya Dock — Virtual Virtual Keypad Console

> A high-performance web application and companion controller that emulates the **Virtual Keypad Console** on your phone, tablet, or browser over **USB Cable** or **Bluetooth / Wi-Fi**, eliminating the need for a physical hardware device.

---

## 🔍 1. Virtual Keypad Console Reverse Engineering Overview

The physical **Virtual Keypad Console** (`046d:c354`) uses Virtual's **HID++ 4.5** protocol over USB HID.

### Hardware Specifications & Geometry
* **Vendor ID (VID):** `0x046d` (Virtual Inc.)
* **Product ID (PID):** `0xc354` (Wired Keypad) / `0xbc00` (Dialpad over BLE)
* **Display Configuration:** Single 480×480 px LCD panel behind 9 optical button caps.
* **Per-Button Resolution:** 118×118 px active viewport with 40 px padding.
* **Paging Controls:** 2 physical navigation buttons below the LCD matrix (`page-l` = `0x01a1`, `page-r` = `0x01a2`).

### HID++ 4.5 Packet Architecture
* **Report ID `0x11` (Feature Configuration & Diversion):** 20-byte HID++ Long Report. Diverts page buttons (`0x01a1`, `0x01a2`) to software reporting via feature index `0x0b`.
* **Report ID `0x13` (Key Input State):** Pushed by device on key down/up events (`[0xff, 0x02, 0x00, 0x00, 0x01, key1, key2, ...]`). Key indices `1` to `9` map to the 3×3 matrix.
* **Report ID `0x14` (LCD Image Streaming):** Host streams JPEG chunks in 4095-byte packets directly to device coordinates with ACK handshakes (`0x2b`).

For complete protocol packet bytes, offsets, and technical specs, see:
📄 [`docs/virtual-keypad-mx-keypad-protocol.md`](docs/virtual-keypad-mx-keypad-protocol.md)

---

## ⚡ 2. How Mobile Communication Works (Cable vs Bluetooth)

Browsers cannot natively act as Bluetooth HID peripherals (W3C Web Bluetooth is GATT Client only). Arya Dock solves this with a **zero-latency dual-transport architecture**:

```
 📱 Mobile Device (Web App / PWA)
      │
      ├── [OPTION A: USB Cable] ──────► ADB Reverse / USB Tethering (1-2ms ping)
      │                                       │
      └── [OPTION B: Bluetooth / Wi-Fi] ─────► Bluetooth PAN / Local Network
                                              │
                                              ▼
                                 🖥️ Host PC (server.js)
                                     ├─ WebSocket Bridge (:3333)
                                     ├─ Action Dispatcher (Shell / Media / Apps)
                                     └─ System Automation (Linux/Mac/Win)
```

---

## 🚀 3. Quick Start

### 1. Install & Run
```bash
git clone https://github.com/karthikulkarni/arya-dock.git
cd arya-dock
npm install
npm start
```

### 2. Connect Your Mobile Device

#### Option A: Via USB Cable (Recommended for lowest latency)
1. Plug your phone into your PC with a USB cable.
2. Enable USB Debugging on your phone, then run in terminal:
   ```bash
   adb reverse tcp:3333 tcp:3333
   ```
3. Open Chrome or Safari on your phone and go to:
   ```
   http://localhost:3333
   ```
*(Alternative: Enable **USB Tethering** in phone network settings, and open your PC's IP)*.

#### Option B: Via Bluetooth PAN / Wi-Fi
1. Ensure your phone and PC are on the same Wi-Fi, hotspot, or paired via **Bluetooth Tethering (PAN)**.
2. The terminal prints a **QR Code** on startup — simply point your phone camera at it to open instantly!

---

## 📱 4. Mobile Hardware Experience (PWA)

* **Add to Home Screen:** Tap "Add to Home Screen" in your mobile browser to run Arya Dock in standalone fullscreen mode without browser URL bars.
* **Mechanical Haptics:** Simulates physical tactile button travel using the Vibration API (`18ms` micro-pulse on touch).
* **Screen Wake Lock:** Tap the eye icon (👁️) to keep your phone display permanently awake while docked on your desk.
* **Live Customizer:** Tap the pencil icon (✏️) to customize button icons, labels, accent colors, and shell commands directly from your phone.

---

## 🛠️ 5. Default Profiles

Arya Dock ships with pre-configured multi-page profiles in [`config/profiles.json`](config/profiles.json):

1. **Developer & AI Workflows:**
   - Page 1: AI Agent Runner, Terminal, Git Status, Test Suite, Prettier Formatter, Git Push, VS Code, Build, Docker status.
   - Page 2: Kubernetes Pods, Server Logs (`journalctl`), API Reload, Localhost 3000/8080, Postman, Cache Cleaner, Top CPU stats.
2. **Media & System Control:**
   - Audio Mute / Unmute (`wpctl` / `pactl`), Volume Up/Down, Play/Pause/Track Navigation (`playerctl`), Mic Mute, Screenshot capture, PC Session Lock.

---

## 📄 License
MIT
