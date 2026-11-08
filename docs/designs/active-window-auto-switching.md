# Active Window Auto-Switching Engine — Technical Design Document

* **Author:** Karthik Kulkarni
* **Date:** 2026-11-08
* **Status:** Approved Architecture Specification (Post EGM Readiness Verification)
* **Target Version:** Arya Dock v1.1.0 / Epic E1-1
* **Verification Harness:** Reticle v2 & Node.js Native Test Runner

---

## 1. The Problem

Arya Dock provides developers and power users with an interactive, low-latency control deck on secondary devices (mobile phones, tablets, mounted browsers). Workspaces in Arya Dock are optimized for specific operational contexts:
- **`developer`**: Interactive terminal commands, code formatting, git commits, docker scripts, test runners.
- **`media`**: System volume controls, Spotify/VLC playback, mute toggles, telemetry indicators.
- **Custom User Workspaces**: Specialized control surfaces for gaming, streaming, video editing, or database administration.

Currently, switching workspaces requires manual user intervention: tapping workspace mode tabs (`M1 DEV COCKPIT`, `M2 MEDIA`) on the touch screen. When developers switch workstation focus between their IDE (e.g. IntelliJ, VS Code), media players (e.g. Spotify), or browser dashboards, Arya Dock remains on whatever workspace was last viewed unless manually toggled.

### Operational Friction Points
1. **Context Fragmentation**: Developers must divide their attention between physical workstation input (Alt-Tab, keyboard shortcuts) and manually tapping the mobile companion screen to change toolsets.
2. **Stale Shortcuts**: Launching an IDE leaves media shortcuts on screen; switching to Spotify leaves terminal build shortcuts visible.
3. **Touch Disruption & Accidental Taps**: Having to manually tap the companion screen during high-flow coding breaks keyboard-centric flow.

---

## 2. Overview & Solution Design

The **Active Window Auto-Switching Engine** connects workstation window management focus events to Arya Dock's navigation state reducer (`lib/navigation.js`). As the workstation user focuses an application, the engine detects the application identifier, resolves matching workspace rules (`workspace.match.apps`), and dispatches focus transitions over WebSockets to connected companion decks.

### Core Architectural Pillars
- **Zero-Cost Idle Lifecycle with Teardown Grace Period**: The active window detection watcher is paused when zero WebSocket clients are connected to Arya Dock. When `connectedClients.size === 0`, a 3000ms teardown hysteresis timer starts. If no companion reconnects within 3 seconds, the watcher process is terminated with an `AbortController`. If a client reconnects within 3 seconds (e.g. mobile browser reload, Wi-Fi blip), teardown is cancelled, preventing process churn.
- **Privacy-First Invariant (Zero Title Leakage)**: Window titles (`title`, `_NET_WM_NAME`) frequently leak confidential data (active code filenames, git branches, sensitive URLs, customer names). Titles are **never captured or logged**. In X11, titles are never requested from the X server (`WM_CLASS` query only). In GNOME Wayland, `busctl` output is parsed in-memory, discarding `title` immediately. Error logs strictly record `{ error: err.message, exitCode }`, never raw stdout buffers.
- **Dual-Path Platform Engine (Stream vs. Serialized Poll)**:
  - **X11 / XWayland**: Runs a persistent streaming process `xprop -spy -root _NET_ACTIVE_WINDOW`. It emits events push-style on focus shifts with zero periodic polling overhead (latency ~160ms).
  - **GNOME Wayland**: Uses serialized recursive `setTimeout` (500ms interval) with single-flight mutex protection (`isQueryRunning`), single-sample edge detection, and a 250ms abort timeout (latency <600ms). Child processes never pile up during system load.
- **Debounced Alt-Tab Coalescing**: Rapid Alt-Tabbing through intermediate windows is coalesced: on X11 streams, a 150ms trailing timer debounces rapid focus shifts; on Wayland polls, focus transitions only dispatch when a new resting window is detected.
- **Workspace Pinning & Concurrency Safety**: When a companion deck user pins a workspace via the UI pin button (`#btnPinWorkspace`), auto-switching is suppressed, honoring operator intent until unpinned. Operators (`role: 'operator'`) are authorized to switch workspaces (`SET_WORKSPACE`) and toggle pins (`TOGGLE_PIN`), ensuring mobile companion decks are never trapped.
- **Strict Boundary: Transient Focus vs. Persistent Config**: Auto-switching updates only the in-memory runtime pointer (`navState.workspaceId`). It **never** mutates `appConfig.activeWorkspaceId` and **never** triggers `saveConfig()`. Focus-driven navigation is strictly transient.

---

## 3. Reference Glossary & Definitions

| Term / Acronym | Definition & Upstream Reference |
| :--- | :--- |
| **D-Bus** | Linux desktop Inter-Process Communication (IPC) bus allowing applications and desktop components to call methods and broadcast signals. |
| **Wayland Compositor** | The display server and window manager under Wayland (e.g. GNOME Shell / Mutter). For security isolation, Wayland forbids applications from querying global window state. |
| **`org.gnome.Shell.Introspect`** | Private D-Bus interface exposed by GNOME Shell allowing authorized session tools to query window metadata via method `GetWindows`. |
| **`busctl`** | Standard systemd D-Bus CLI tool supporting `--json=short` for structured JSON output directly deserializable by `JSON.parse()`. |
| **XWayland** | Compatibility X11 server running inside Wayland to support legacy X11 clients. |
| **`_NET_ACTIVE_WINDOW`** | Extended Window Manager Hints (EWMH) standard root window property storing the X11 window ID of the currently focused window. |
| **`WM_CLASS`** | ICCCM standard X11 property identifying the application name and class string (e.g. `"code", "Code"`). |
| **`xprop`** | Standard X11 command-line tool for reading and monitoring window properties (`-spy` mode streams property changes). |

---

## 4. Goals & Non-Goals

### 4.1 Goals
1. **Reliable Linux Detection**: Support native GNOME Wayland via `busctl --json=short` and X11/XWayland via streaming `xprop -spy`.
2. **Resource-Efficient & Zero Fork-Storm**: No un-gated `setInterval` process spawning. Max 1 long-running stream on X11, or 1 serialized tick per 500ms on Wayland with single-flight mutex protection.
3. **Responsive Latency SLA**: Sub-400ms focus-to-deck latency on X11 streaming path (~160ms); sub-600ms on GNOME Wayland single-flight polled path without fork churn.
4. **Strict Privacy**: Zero capture, storage, or transmission of window titles.
5. **Transient Focus Pointers**: Focus changes never touch disk storage (`profiles.json`).
6. **Codebase Reuse**: Reuse existing `normalizeAppId()` and `findWorkspaceForApp()` from `lib/navigation.js`.
7. **Reticle v2 Verification**: Full in-app verification flow asserting auto-switching and pin override mechanics.

### 4.2 Non-Goals
1. **Window Content or Title Parsing**: No reading or parsing of window titles, URLs, or window contents.
2. **Arbitrary Wayland Compositor Reverse Engineering**: Compositors lacking standard introspection APIs or IPC sockets (e.g. minimalist Weston without plugins) degrade gracefully to manual mode (`activeWindow: false`).
3. **Multi-Monitor Per-Display Tracking**: The deck follows the single focused active window across the workstation.
4. **Destructive Profile Alterations**: Workspace configurations and tile layouts remain untouched.

---

## 5. Architectural Specification & Code Contracts

### 5.1 Platform Adapter Implementation (`platform/linux.js`)

The Linux platform adapter exposes:
1. `capabilities()`: Returns `{ activeWindow: boolean, media: boolean, applications: boolean }`.
   - Returns `true` for `activeWindow` if `busctl` is available on GNOME Wayland or `xprop` is available on X11.
2. `getActiveWindow()`: Returns `Promise<{ appId: string, wmClass?: string } | null>`:
   - **GNOME Wayland (Polled with Mutex)**:
     ```bash
     busctl --user --json=short call org.gnome.Shell.Introspect /org/gnome/Shell/Introspect org.gnome.Shell.Introspect GetWindows
     ```
     - Enforces single-flight lock (`isQueryRunning = true`).
     - Parses JSON payload directly; finds entry with `has-focus.data === true`.
     - Extracts `app-id.data` or `wm-class.data`.
     - Ignores `title` property completely.
   - **X11 / XWayland (Direct Query)**:
     ```bash
     xprop -root 32x "\t$0" _NET_ACTIVE_WINDOW
     ```
     - Validates extracted window ID against `/^0x[0-9a-fA-F]+$/`.
     - Checks `parseInt(winId, 16) !== 0` to ignore desktop background clicks.
     - Queries `xprop -id <winId> WM_CLASS`.
     - Returns `{ appId: wmClass, wmClass }`.
3. `createActiveWindowStream(onAppChange, onError)`:
   - On X11: Spawns `xprop -spy -root _NET_ACTIVE_WINDOW` as a persistent child process, listening on `stdout` lines with trailing 150ms debounce.
   - On GNOME Wayland: Runs serialized `setTimeout(..., pollInterval)` loop (500ms default; 5000ms upon circuit breaker trigger after 3 consecutive failures).
   - Returns `{ stop() }` function that kills persistent processes (`SIGKILL`) and cancels pending timers via `AbortController`.

### 5.2 Navigation State Schema & Reducer (`lib/navigation.js`)

Formal TypeScript definition of `NavigationState`:
```typescript
interface NavigationState {
  workspaceId: string;       // Active workspace identifier
  pageIndex: number;         // Active page index (0-based)
  mode: 'auto' | 'manual';   // Mode: 'auto' (following focus) or 'manual' (user selected)
  pinned: boolean;           // If true, auto-switching is locked
  lastAppId: string | null;  // Last detected active application identifier
}
```

#### Rule Resolution (`findWorkspaceForApp`)
```javascript
function findWorkspaceForApp(workspaces, rawAppId) {
  if (!Array.isArray(workspaces) || !rawAppId) return null;
  const normalized = normalizeAppId(rawAppId);
  if (!normalized) return null;

  for (const ws of workspaces) {
    if (!ws || !ws.match || !Array.isArray(ws.match.apps)) continue;
    for (const rule of ws.match.apps) {
      const normalizedRule = normalizeAppId(rule);
      // Exact match
      if (normalized === normalizedRule) return ws.id;
      // Dot/hyphen token segment match (e.g. 'code' matches 'com.visualstudio.code')
      const segments = normalized.split(/[.-]/);
      if (segments.includes(normalizedRule)) return ws.id;
    }
  }
  return null; // No match -> preserve current workspace
}
```

### 5.3 Server Integration & State vs. Persistence Boundary (`server.js`)

In `server.js#dispatchNav`:
```javascript
function dispatchNav(event) {
  const nextState = navigationReducer(navState, event, {
    workspaces: appConfig.workspaces,
    getCurrentWorkspace: () => getActiveWorkspace()
  });

  if (nextState !== navState) {
    navState = nextState;
    // CRITICAL: Only persist active workspace on explicit user manual selection!
    // Automated CONTEXT_CHANGED events must NEVER mutate appConfig.activeWorkspaceId or trigger saveConfig().
    if (event.type === 'USER_SELECT' && appConfig.activeWorkspaceId !== navState.workspaceId) {
      appConfig.activeWorkspaceId = navState.workspaceId;
      appConfig.activeProfile = navState.workspaceId;
    }
  }
  return navState;
}
```

### 5.4 Lifecycle Manager with 3-Second Hysteresis (`ActiveWindowWatcher` in `server.js`)

```javascript
class ActiveWindowWatcher {
  constructor(platform, onChange) {
    this.platform = platform;
    this.onChange = onChange;
    this.stream = null;
    this.teardownTimer = null;
    this.consecutiveFailures = 0;
  }

  handleClientConnected() {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    if (!this.stream && this.platform?.capabilities()?.activeWindow) {
      this.start();
    }
  }

  handleClientDisconnected(clientCount) {
    if (clientCount === 0 && this.stream) {
      if (this.teardownTimer) clearTimeout(this.teardownTimer);
      this.teardownTimer = setTimeout(() => {
        this.stop();
        this.teardownTimer = null;
      }, 3000); // 3-second grace period
    }
  }

  start() {
    this.stream = this.platform.createActiveWindowStream(
      (appId) => {
        this.consecutiveFailures = 0;
        this.onChange(appId);
      },
      (err) => {
        this.consecutiveFailures++;
        if (this.consecutiveFailures <= 3) {
          console.warn('[Arya Dock] Active window watcher warning:', err.message);
        }
      }
    );
  }

  stop() {
    if (this.stream) {
      this.stream.stop();
      this.stream = null;
    }
  }
}
```

#### Server Creation & Teardown Wiring
In `createServer()`:
```javascript
const watcher = new ActiveWindowWatcher(platformAdapter, (appId) => {
  if (appId) {
    const prevWs = navState.workspaceId;
    const nextNav = dispatchNav({ type: 'CONTEXT_CHANGED', appId });
    if (nextNav && nextNav.workspaceId !== prevWs) {
      broadcastState(wsManager.wss, wsContext);
    }
  }
});

const wsManager = setupWebSocketServer(server, {
  ...wsContext,
  onClientConnect: (count) => watcher.handleClientConnected(),
  onClientDisconnect: (count) => watcher.handleClientDisconnected(count)
});

// Inside server.close(cb):
watcher.stop();
```

### 5.5 WebSocket Permission & Persistence Boundaries (`lib/ws.js`)

In `lib/ws.js` `SET_WORKSPACE` handler:
```javascript
case 'SET_WORKSPACE': {
  // Allow operators and editors to navigate
  const targetId = data.workspaceId;
  const targetWs = appConfig.workspaces?.find(w => w.id === targetId);
  if (!targetWs) {
    ws.send(JSON.stringify({ type: 'ERROR', message: `Workspace '${targetId}' not found` }));
    return;
  }
  
  if (dispatchNav) {
    dispatchNav({ type: 'USER_SELECT', workspaceId: targetId });
  }

  // Only persist default workspace if client has editor privileges
  if (ws.canEdit) {
    appConfig.activeWorkspaceId = targetId;
    appConfig.activeProfile = targetId;
    saveConfig();
  }
  broadcastState(wss, context);
  break;
}
```

In `public/app.js`: Remove `canEdit` requirement from workspace mode button listeners so companion operators can tap tabs.

---

## 6. Security & Privacy Guarantees

1. **Zero Window Title Capture**:
   - In X11, only `WM_CLASS` is queried; window titles are never requested from the X server.
   - In GNOME Wayland, `busctl --json=short` is parsed in-memory, extracting only `app-id` and `wm-class`. Window titles are dropped immediately upon JSON ingestion.
   - Server logs record only sanitized error messages (`err.message`), never raw subprocess stdout buffers.
2. **Local Session Isolation**:
   - D-Bus and X11 queries run strictly in the user's local session environment. Remote companion clients cannot execute arbitrary window manager queries.
3. **Operator Safe Navigation**:
   - Operators can switch workspaces (`SET_WORKSPACE`) and toggle pins (`TOGGLE_PIN`), but cannot modify workspace layout or edit button commands (`UPDATE_BUTTON`, `ADD_BUTTON`).

---

## 7. Failure Modes & Edge Cases

| Scenario | Trigger / Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- |
| **Non-GNOME Wayland (e.g. Weston)** | Introspect D-Bus call fails or does not exist. | Graceful fallback to X11 streaming. If both fail, `capabilities().activeWindow` reports `false`. UI hides pin button. Zero crashes. |
| **Desktop / Lock Screen Active** | No window reports `has-focus: true` (or X11 reports `0x0`). | Watcher receives `null` appId; ignores transition. Deck maintains previous workspace. |
| **Rapid Alt-Tab Storm** | User cycles windows at 80ms intervals. | X11 trailing 150ms debounce / Wayland single-flight edge detection coalesces transitions; only the final resting window triggers a workspace switch. |
| **Unmatched Application** | User focuses an app not listed in any workspace `match.apps`. | Reducer returns current workspace unchanged. Deck does not blank or reset. |
| **Browser Reload / Wi-Fi Blip** | WebSocket disconnects for <500ms. | 3-second teardown hysteresis keeps watcher alive, preventing process churn. |
| **D-Bus Crash / Restart** | GNOME Shell restarts or D-Bus daemon resets. | Circuit breaker detects 3 consecutive errors, backs off to 5s interval, and suppresses duplicate log spam. |

---

## 8. Reticle Verification & Testing Plan

1. **Unit Tests (`test/active-window.test.js`)**:
   - `normalizeAppId()` testing all packaging variations (`.desktop`, JetBrains, case normalization).
   - `findWorkspaceForApp()` rule resolution against exact matches, token segments, and negative cases (e.g. `"sh"` not matching `"photoshop"`).
   - Mock platform tests with `fake` adapter simulating focus shifts and asserting reducer transitions.
2. **Lifecycle & Mutex Tests**:
   - Verify watcher starts when client 1 connects.
   - Verify 3-second grace period: client disconnect -> reconnect within 1s preserves watcher instance.
   - Verify watcher stops when client count remains 0 after 3 seconds.
   - Verify that focus transitions do **not** mutate `appConfig.activeWorkspaceId` or trigger `saveConfig()`.
3. **Reticle v2 Verification Flow ([`.reticle/flows/arya-dock-4f274f15/active-window-auto-switching.json`](file:///home/karthikulkarni/Documents/arya-dock/.reticle/flows/arya-dock-4f274f15/active-window-auto-switching.json))**:
   - Step 1: Click `#btnPinWorkspace` -> verify pin status becomes `PINNED`.
   - Step 2: Click `#btnPinWorkspace` (unpin) -> verify pin status becomes `UNPINNED`.
   - Step 3: Click `#btnModeM2` -> verify workspace switches to `M2 MEDIA & TELEMETRY`.
   - Step 4: Click `#btnModeM1` -> verify workspace switches to `M1 DEV COCKPIT`.
   - Registered in `requiredFlows` in `test/reticle.test.js`.
   - Integration assertions replay simulated `{ type: 'CONTEXT_CHANGED', appId }` messages and verify pin locking against auto-switch.
