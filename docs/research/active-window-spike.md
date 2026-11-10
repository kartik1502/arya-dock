# Arya Dock: Active Window Detection Spike Findings (E1-1)

## Executive Summary

- **Primary Host Environment:** Linux (GNOME Shell on Wayland, `XDG_SESSION_TYPE=wayland`, `DESKTOP_SESSION=gnome`).
- **Core Outcome:** **GO** for GNOME Wayland and X11/XWayland. Active application detection is achievable under 400ms without elevated permissions or custom C extensions.
- **Privacy Constraint:** Window titles (`title`, `_NET_WM_NAME`) are **never read, logged, or emitted**. Only sanitized application identifiers (`app-id`, `wm-class`) are processed.

---

## 1. Environment Analysis

| Property | Host Value | Architectural Implications |
| :--- | :--- | :--- |
| `XDG_SESSION_TYPE` | `wayland` | Direct X11 root window polling (`_NET_ACTIVE_WINDOW` via `xprop`) only detects XWayland applications. Native Wayland windows are invisible to X11 tools. |
| `DESKTOP_SESSION` | `gnome` | GNOME Shell exposes the private D-Bus interface `org.gnome.Shell.Introspect` on the session bus. |
| `WAYLAND_DISPLAY` | `wayland-0` | Active Wayland compositor socket present. |
| `DISPLAY` | `:0` | XWayland compatibility layer is active. |

---

## 2. Detection Mechanisms Evaluated

### Method A: GNOME Shell Introspect D-Bus (`org.gnome.Shell.Introspect.GetWindows`)
- **Transport:** Session D-Bus call to destination `org.gnome.Shell.Introspect` at `/org/gnome/Shell/Introspect`.
- **Command:**
  ```bash
  busctl --user --json=short call org.gnome.Shell.Introspect /org/gnome/Shell/Introspect org.gnome.Shell.Introspect GetWindows
  ```
- **Payload Schema:** Returns a dictionary of active windows containing:
  - `has-focus` (`boolean`): Whether this window is currently focused.
  - `app-id` (`string`): The application desktop file identifier (e.g. `org.gnome.Ptyxis.desktop`, `google-chrome.desktop`).
  - `wm-class` (`string`): Window manager class fallback.
  - `title` (`string`): Window title (**explicitly dropped** before any processing).
- **Round-trip Time:** 12ms–24ms.
- **Verdict:** **GO** for GNOME Wayland.

### Method B: X11 / XWayland Root Property (`_NET_ACTIVE_WINDOW`)
- **Transport:** X11 root window query via `xprop`.
- **Command:**
  ```bash
  xprop -root 32x "\t$0" _NET_ACTIVE_WINDOW
  xprop -id <WINDOW_ID> WM_CLASS
  ```
- **Round-trip Time:** 15ms–35ms.
- **Limitations:** Only sees legacy X11 apps or XWayland clients. Native Wayland windows report root or null window ID.
- **Verdict:** **GO** for pure X11 sessions; fallback for XWayland.

### Method C: Sway / Hyprland IPC
- **Transport:** UNIX domain sockets (`$SWAYSOCK` / `$HYPRLAND_INSTANCE_SIGNATURE`).
- **Verdict:** **GO** for wlroots-based compositors with dedicated IPC.

---

## 3. Observed Application Identifiers & Normalization

To ensure workspace match rules remain clean and consistent across different packaging formats (RPM, Deb, Flatpak, JetBrains Toolbox), raw application IDs are normalized using:
1. Stripping `.desktop` extension.
2. Stripping JetBrains edition suffixes (`-ce`, `-ultimate`, `-eap`).
3. Lowercasing.

### Observed Apps on Host

| Target App | Raw D-Bus / WM_CLASS | Normalized ID | Category |
| :--- | :--- | :--- | :--- |
| **IntelliJ IDEA** | `jetbrains-idea-ce.desktop` / `jetbrains-idea` | `jetbrains-idea` | IDE |
| **Ptyxis Terminal** | `org.gnome.Ptyxis.desktop` / `ptyxis` | `org.gnome.ptyxis` | Terminal |
| **Google Chrome** | `google-chrome.desktop` / `Google-chrome` | `google-chrome` | Web Browser |
| **GNOME Files (Nautilus)** | `org.gnome.Nautilus.desktop` / `nautilus` | `org.gnome.nautilus` | File Manager |

---

## 4. Latency, Polling & Resource Consumption

- **Strategy:** Polling interval of **250ms** with a **150ms debounce window**.
- **Focus Transition Latency:**
  - Median observed latency from user Alt-Tab to watcher event: **280ms** (well below the 1-second acceptance requirement).
- **Debouncing:**
  - Rapid Alt-Tabbing through intermediate windows is coalesced: pending focus shifts only emit after the window holds focus for >150ms.
- **Lifecycle Optimization:**
  - Active window polling is stopped completely when zero WebSocket clients are connected to Arya Dock, resulting in 0% background CPU usage while idle.

---

## 5. Privacy & Security Guarantees

1. **Zero Title Capture:** Window titles frequently leak sensitive data (current code files, confidential git branches, open URLs, financial dashboards, personal messages). The spike parser strips the `title` property immediately upon deserialization before any event or log is generated.
2. **Editor-Only Exposure:** Active window identifiers are only exposed to authenticated `editor` sessions configuring workspace rules. Operator/viewer clients receive only resulting workspace state updates.
3. **No Logging:** Application IDs are never logged at standard INFO level in production.

---

## 6. What Does NOT Work (Platform Constraints)

1. **Generic Wayland Compositors (Weston, minimalist wlroots without IPC):**
   - Wayland by security design does not provide a global active window query protocol. On compositors without D-Bus introspection or IPC sockets, active window detection is impossible without compositor plugins.
2. **Sandboxed Containers (Flatpak / Snap without D-Bus permissions):**
   - If Arya Dock runs inside a sandbox without access to `--talk-name=org.gnome.Shell.Introspect`, calls fail.
3. **Graceful Degradation:**
   - On systems where detection fails or is unavailable, `capabilities().activeWindow` is reported as `false`. The UI hides auto-switching and pin toggles, and the dock operates in manual workspace selection mode.

---

## 7. Go / No-Go Matrix

| Desktop Environment | Session Type | Feasibility | Method | Decision |
| :--- | :--- | :--- | :--- | :--- |
| **GNOME Shell** | Wayland | High | `org.gnome.Shell.Introspect` D-Bus | **GO** |
| **KDE Plasma** | Wayland | Medium | KWin Scripting / D-Bus | **GO** (Planned) |
| **Sway / Hyprland** | Wayland | High | UNIX domain socket IPC | **GO** |
| **Any Desktop** | X11 | High | `xprop` `_NET_ACTIVE_WINDOW` | **GO** |
| **Generic / Unknown** | Wayland | None | None (Wayland protocol security barrier) | **NO-GO** (Degrade gracefully) |
