# Hardware Keypad Protocol & Architecture Specifications
**Protocol, HID Reports, Transport Layer & Software Emulation Guide**

> **Project Scope Note**: This document provides low-level protocol and HID specifications as an engineering reference for optional hardware console integration. The primary Arya Dock platform is a standalone, web-based virtual companion deck.

---

## 1. Device Architecture & Hardware Identifiers

This specification documents the physical and protocol architecture of hardware LCD macro consoles. Unlike traditional numeric keypads, this hardware category features an active color LCD panel mapped behind 9 translucent physical push-buttons, plus 2 dedicated paging buttons below the LCD matrix.

### Hardware Identification Reference
* **Target VID:** `0x046d`
* **Target Wired PID:** `0xc354` (USB-C Wired)
* **Target Wireless PID:** `0xbc00` (Bluetooth Low Energy)
* **USB Interface Class:** USB Human Interface Device (HID)
* **Transport:** USB Full Speed / High Speed vendor-defined HID interface

### Linux `udev` Rule
To grant non-root access to the raw HID device on Linux:
```udev
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="c354", MODE="0666", TAG+="uaccess"
```

---

## 2. Physical Layout & Geometry

* **LCD Panel Size:** 480 × 480 pixels
* **Keypad Grid:** 3 columns × 3 rows = 9 display keys
* **Single Button Visible Pixel Size:** 118 × 118 pixels
* **Button Spacing / Padding:** 40 pixels
* **Top-Left Offset:** X = 23 px, Y = 6 px
* **Page Buttons:**
  - Located beneath the LCD display matrix.
  - Height: 70 pixels.
  - Aligned with columns 0 and 1.
  - `page-l` (Left Page Button): column 0, row 3, index 9, HID Control ID `0x01a1`
  - `page-r` (Right Page Button): column 1, row 3, index 10, HID Control ID `0x01a2`

```
┌───────────────────────────────────────┐
│              480 × 480 LCD            │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐  │
│  │ Key 0   │   │ Key 1   │   │ Key 2   │  │
│  │ (HID 1) │   │ (HID 2) │   │ (HID 3) │  │
│  └─────────┘   └─────────┘   └─────────┘  │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐  │
│  │ Key 3   │   │ Key 4   │   │ Key 5   │  │
│  │ (HID 4) │   │ (HID 5) │   │ (HID 6) │  │
│  └─────────┘   └─────────┘   └─────────┘  │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐  │
│  │ Key 6   │   │ Key 7   │   │ Key 8   │  │
│  │ (HID 7) │   │ (HID 8) │   │ (HID 9) │  │
│  └─────────┘   └─────────┘   └─────────┘  │
└───────────────────────────────────────┘
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ Page <  │   │ Page >  │   │ CONSOLE │
   │ (0x01a1)│   │ (0x01a2)│   │ BADGE   │
   └─────────┘   └─────────┘   └─────────┘
```

---

## 3. Communication Protocol: HID++ 4.5

The Keypad uses **HID++ 4.5**, communicating over vendor-defined USB HID endpoints using standard report packets.

### Report IDs Overview
| Report ID | Direction | Purpose | Packet Size |
|---|---|---|---|
| `0x11` | In / Out | HID++ Long Report (Feature queries, control diversion) | 20 bytes |
| `0x13` | In (Device → Host) | 9 LCD Key Input State Notifications | Variable (up to 64 bytes) |
| `0x14` | Out (Host → Device) | High-speed JPEG LCD Image Stream Packets | Up to 4095 bytes |
| `0x2b` | In (Device → Host) | LCD Drawing Acknowledge (ACK / Busy) | 5 bytes |

---

### 3.1 Diverting Control to Software (`0x11`)
By default, the device firmware does not send notifications for physical page keys until they are explicitly diverted from hardware fallback to software reporting.

**Divert Request Packet (20 bytes):**
```
Byte 0:  0x11 (HID++ Long Report ID)
Byte 1:  0xff (Device Index / Root)
Byte 2:  0x0b (Feature Index: KEYPAD_REPROG_CONTROLS)
Byte 3:  0x3b ((Function 3 << 4) | Software ID 0x0b)
Byte 4:  Control ID High Byte (e.g. 0x01)
Byte 5:  Control ID Low Byte  (e.g. 0xa1 for page-l, 0xa2 for page-r)
Byte 6:  0x03 (Divert Flag: REPROG_CONTROLS_DIVERT)
Bytes 7-19: 0x00 (Padding)
```

---

### 3.2 Key Input Notification (`0x13` and `0x11`)

#### A. 3x3 LCD Keys (Report `0x13`)
When any of the 9 display keys are pressed or released, the device pushes an input report:
```
Byte 0: 0xff
Byte 1: 0x02
Byte 2: 0x00
Byte 3: 0x00
Byte 4: 0x01 (Key event flag)
Byte 5..N: Currently pressed key indices (1 to 9). Terminated by 0x00.
```
- If Key 0 is pressed: Byte 5 = `0x01`
- If Key 0 and Key 4 are pressed simultaneously: Byte 5 = `0x01`, Byte 6 = `0x05`, Byte 7 = `0x00`
- When all keys are released: Byte 5 = `0x00`

#### B. Page Buttons (Report `0x11`)
When the left or right page buttons are pressed:
```
Byte 0: 0xff
Byte 1: 0x0b (Feature Index)
Byte 2: 0x00
Byte 3..N: 16-bit Big-Endian Control IDs (e.g., 0x01a1 for Page Left, 0x01a2 for Page Right).
```

---

### 3.3 LCD Display Image Streaming (`0x14`)
Images are encoded as baseline **JPEG** images and streamed to the device across multi-packet writes.

#### First Packet (Packet 1, Header Length = 20 bytes):
```
Byte 0:     0x14 (Report ID)
Byte 1:     0xff (Device Index)
Byte 2:     0x02 (Feature Index)
Byte 3:     0x2b (Function: Image Write)
Byte 4:     Flags: Part index (1) | 0x80 (First Packet) | (0x40 if Last Packet)
Byte 5-6:   0x0100
Byte 7-8:   0x0100
Byte 9-10:  X position uint16 (Big-Endian)
Byte 11-12: Y position uint16 (Big-Endian)
Byte 13-14: Width uint16 (e.g. 118)
Byte 15-16: Height uint16 (e.g. 118)
Byte 17:    0x00
Byte 18-19: Total JPEG buffer length uint16
Byte 20+:   JPEG byte payload (up to 4075 bytes)
```

#### Subsequent Packets:
```
Byte 0:     0x14
Byte 1:     0xff
Byte 2:     0x02
Byte 3:     0x2b
Byte 4:     Flags: Part index (2, 3...) | (0x40 if Last Packet)
Byte 5+:    Remaining JPEG payload
```

#### Acknowledge Response (`0x2b`):
- Byte 4 = `0x00`: Success (`accepted`).
- Byte 4 = `0xfb`: Device buffer busy (`busy`).

---

## 4. Web & Mobile Emulation Architecture

### The Bluetooth & Cable Challenge
1. **Web Bluetooth Limitation:** The browser standard **Web Bluetooth API** is strictly client-side (Central/GATT Client). W3C specs prevent any web page from advertising as a BLE HID Peripheral or GATT Server.
2. **The Solution:** A dual-mode bridge architecture:
   - **Over Cable (USB):**
     - **ADB Reverse Tunnel:** `adb reverse tcp:3333 tcp:3333` allows the mobile browser to connect directly over USB at `http://localhost:3333` with sub-millisecond latency.
     - **USB Tethering:** The phone connects directly to the host's USB network adapter (`192.168.42.x`).
   - **Over Bluetooth / Wireless:**
     - **Bluetooth PAN (Tethering):** Phone and PC pair via standard Bluetooth PAN networking, allowing local HTTP/WebSocket communication.
     - **Wi-Fi / Local Hotspot:** Zero-setup mobile connection via QR Code scan.
   - **Backend Dispatcher:**
     - A lightweight Node.js daemon handles incoming keypresses from the web app and invokes native desktop shortcuts, media keys, audio volume (`wpctl`/`pactl`), developer tools, or AI workflows.
