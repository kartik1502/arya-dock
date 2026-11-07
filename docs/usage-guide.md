# 🎛️ Arya Dock — Usage & Deck Customization Guide

This guide covers how to operate the deck, configure tiles, manage layout grids, and customize actions.

---

## 1. Navigation & Modes

* **M1 (Dev Cockpit):** Development workflows, AI coding agents, Docker, test runners, and text editors.
* **M2 (Media & Telemetry):** Volume up/down, mute, audio playback controls, screenshot, and workstation lock.
* **Shift Paddles:** Tap **`◀ PREV PAGE`** or **`NEXT PAGE ▶`** at the bottom of the bezel to switch pages.

---

## 2. Dynamic Tile Count (+ / −)

* Use the **`+`** and **`−`** buttons in the header to add or remove shortcuts.
* **Data-loss Protection:** If a configured tile with commands or custom labels is about to be deleted via `−`, a confirmation dialog prevents accidental mis-taps. Placeholder keys can be removed freely.

---

## 3. Drag & Drop Application Catalog

1. Click **`⚡ APPS`** to open the side drawer (available to Editors).
2. Browse or search through your installed system applications.
3. **Desktop:** Drag any application card directly onto any key.
4. **Mobile (Touch):** Tap any application card to open the quick-assign popup, then tap the target keycap.

---

## 4. Customizing Keys & Execution Modes

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

---

## 5. Multi-Client Deck Semantics

Arya Dock operates as a shared physical workstation deck. All connected client devices share a synchronized active page and profile state:
- When any client navigates to next/previous page (`PAGE_NEXT` / `PAGE_PREV`) or switches profile (`SET_PROFILE`), all active screens (phone, tablet, desktop) update synchronously in real time.
- Key clicks trigger immediately on the workstation and send acknowledgment feedback (`BUTTON_ACK`) to the triggering client.

---

## 6. Data-Loss Protection on Tile Adjustments

- Decreasing the grid count or removing a configured tile requires user confirmation if the target button contains a configured command, URL, or custom label.
- Empty placeholder keys (`KEY n` with no assigned action) are removed cleanly without confirmation prompts.
- On the backend, `SET_BUTTONS_COUNT` protects configured buttons from accidental truncation unless explicitly confirmed with `force: true`.
