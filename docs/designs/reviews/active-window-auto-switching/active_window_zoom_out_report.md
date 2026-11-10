# Architectural Review: Active Window Auto-Switching Engine
**Document Under Review:** `docs/designs/active-window-auto-switching.md`  
**Reviewer:** Skeptical Architect (Zoom-Out Evaluation)  
**Date:** 2026-11-08  
**Status:** Actionable Findings & Recommendations  

---

## 1. High-Altitude Assessment: Simplicity, Minimalism & YAGNI

### 1.1 Is Active Window Auto-Switching Solving a Real Problem?
**Verdict: YES.**  
Arya Dock functions as an interactive macro keypad alongside a developer's workstation. Tapping physical touch targets on a phone or mounted tablet breaks keyboard muscle memory. Automatic switching between `developer` (IDE/terminal tools) and `media` (playback/volume) when the workstation window focus changes aligns directly with the core value proposition of an adaptive companion deck.

### 1.2 Is the Proposed Solution Over-Engineered or Speculative?
**Verdict: PARTIALLY OVER-ENGINEERED / BRUTE-FORCE.**  
While the architectural boundaries are largely well-placed, the detection mechanism leans on a brute-force child-process polling loop (`gdbus` / `xprop` spawned every 250ms). Spawning up to 8 child processes per second (in X11 where `xprop` requires querying root active window, then querying window class) is a heavy-handed, battery-draining solution for a companion deck that developers run for hours on laptops.

---

## 2. Structured Audit Findings

### Finding 1: Polling Process Storm & Child Process Pile-Up
* **Severity:** Blocker
* **Affected Scope:** Section 4.1 (`platform/linux.js`), Section 4.2 (`server.js`), Line 74
* **Simplicity & Architectural Rationale:**
  - Spawning `gdbus` or `xprop` via `child_process.exec` or `execFile` every 250ms spawns **240 to 480 child processes every minute**.
  - On Linux laptops, continuous fork/exec cycles at 4Hz cause unnecessary CPU wakeups, context switches, and power drain.
  - If D-Bus is congested or an X11 client hangs, `setInterval(..., 250)` will create process pile-ups (fork exhaustion).
  - On X11, `_NET_ACTIVE_WINDOW` can be monitored passively without polling by running `xprop -spy -root _NET_ACTIVE_WINDOW` as a **single long-lived streaming process**.
  - On GNOME Wayland, if polling is necessary due to Wayland security boundaries, polling must be strictly **serialized** (recursive `setTimeout` in completion callback, not `setInterval`), with a relaxed interval (e.g. 500ms–1000ms) and an explicit execution timeout (e.g. 400ms) with process abortion.

### Finding 2: Reinventing the Wheel & Codebase Divergence (`normalizeAppId`)
* **Severity:** Major
* **Affected Scope:** Section 4.1 (Point 3: `normalizeAppId`), Section 4 (Diagram Line 72)
* **Simplicity & Architectural Rationale:**
  - The design doc proposes implementing `normalizeAppId(rawId)` inside `platform/linux.js` to strip `.desktop`, JetBrains suffixes (`-ce`, `-ultimate`), and paths.
  - **This is already implemented in `lib/navigation.js` (lines 55–68)** and covered by unit tests in `test/navigation.test.js`.
  - Platform adapters (`platform/linux.js`, `platform/darwin.js`, `platform/fake.js`) should remain minimal OS extraction layers: their sole responsibility is reading the OS window state and returning `{ appId: string, wmClass: string }` or `null`.
  - Normalization, regex stripping, and rule resolution belong exclusively in the navigation state domain (`lib/navigation.js`). Duplicating normalization in `platform/linux.js` creates architectural dead weight and risks drift.

### Finding 3: Sampling Rate vs. Debounce Window Disconnect
* **Severity:** Major
* **Affected Scope:** Section 2 (Pillar 3), Section 3.1 (Goal 2), Section 6 (Scenario 3)
* **Simplicity & Architectural Rationale:**
  - The design specifies a **150ms debounce window** to eliminate rapid Alt-Tab thrashing, while specifying a **250ms polling cycle**.
  - Mathematically, a discrete sampling cycle of 250ms cannot measure or debounce a 150ms duration. An Alt-Tab transition occurring within 150ms will either be missed completely or sampled at an arbitrary midpoint.
  - If a 250ms poll detects a change and waits an additional 150ms to debounce, the latency jumps to 400ms+, breaching the sub-400ms end-to-end responsiveness goal.
  - **Resolution**:
    - For push-based event streams (e.g. `xprop -spy`), a 150ms timer debounce is optimal.
    - For pull-based polling, debouncing should simply require **2 consecutive identical non-matching samples**, or the polling interval should be explicitly decoupled from the debounce state machine.

### Finding 4: Discrepancy with Existing WebSocket Actions & DOM Selectors
* **Severity:** Minor
* **Affected Scope:** Section 4.3, Section 4.4 (`btnWorkspacePin`, `PIN_WORKSPACE`, `UNPIN_WORKSPACE`)
* **Simplicity & Architectural Rationale:**
  - The document references `#btnWorkspacePin` and actions `PIN_WORKSPACE` / `UNPIN_WORKSPACE`.
  - In `public/index.html` (line 129), the existing element is `#btnPinWorkspace`.
  - In `lib/ws.js` (lines 314–337), the server already handles `PIN`, `UNPIN`, and `TOGGLE_PIN`.
  - In `server.js` (line 128), `dispatchNav()` returns the updated `navState` object, NOT a boolean `changed`.
  - The technical specification must adhere to existing codebase contracts rather than introducing phantom message names and incorrect return signatures.

### Finding 5: Watcher Lifecycle Thrashing During Browser Reloads
* **Severity:** Minor
* **Affected Scope:** Section 4.2 (`ActiveWindowWatcher` lifecycle)
* **Simplicity & Architectural Rationale:**
  - The design states that when `connectedClients.size === 0`, `activeWindowWatcher.stop()` is called immediately.
  - When a user refreshes their companion browser tab or when mobile Wi-Fi briefly blips, the socket disconnects and reconnects within 50–150ms.
  - Immediately killing the watcher and spawning a new watcher process 50ms later causes process thrashing.
  - Introducing a **2–3 second idle teardown delay** (hysteresis / grace period) avoids churn while maintaining the zero-cost idle invariant.

### Finding 6: Legacy Callback Pattern in Platform Interface
* **Severity:** Nit
* **Affected Scope:** Section 4.1 (`getActiveWindow(callback)`)
* **Simplicity & Architectural Rationale:**
  - Section 4.1 specifies `getActiveWindow(callback)`.
  - The modern Node.js standard throughout Arya Dock uses Promises / `async`/`await`.
  - `platform.getActiveWindow()` should return `Promise<{ appId: string, wmClass?: string } | null>`. In `platform/fake.js`, it returns synchronous objects or can return a resolved Promise.

---

## 3. Concrete Recommendations & Architecture Simplification Plan

```
Current Spec (Over-Engineered / Brute-Force):
  setInterval(250ms) -> spawn(gdbus/xprop) -> normalizeAppId() -> dispatchNav() -> broadcastState()

Hardened, Minimalist Architecture:
  Linux Platform Adapter
    ├─ Wayland: Polling with serialized setTimeout(500ms) + 400ms abort timeout
    └─ X11: Streaming via single long-running `xprop -spy -root _NET_ACTIVE_WINDOW`
           │
           ▼ returns raw { appId }
  Navigation Reducer (lib/navigation.js)
    └─ Reuses existing normalizeAppId() & findWorkspaceForApp()
           │
           ▼ dispatches { type: 'CONTEXT_CHANGED', appId }
  Server Manager (server.js)
    └─ Watcher starts at clientCount > 0; stops after 3s idle grace period (clientCount === 0)
```

1. **Leverage Existing `lib/navigation.js` Completely**:
   Do not duplicate `normalizeAppId()` or workspace resolution in `platform/linux.js`. Keep `platform/linux.js` focused entirely on extracting raw window identifiers.

2. **Differentiate X11 Event Streaming from Wayland Polling**:
   - For X11: Run `xprop -spy -root _NET_ACTIVE_WINDOW` as a persistent child process. On each output line, fetch `WM_CLASS`. This eliminates 95% of process spawning overhead.
   - For GNOME Wayland: Use recursive `setTimeout` with a 500ms interval and `execFile` timeout of 400ms. If a client disconnects, clear the timeout.

3. **Incorporate a 3-Second Teardown Grace Period**:
   When WebSocket connections drop to 0, start a 3-second timer. If no client reconnects, terminate the watcher. If a client connects within 3 seconds, cancel the timer.

4. **Align Protocol & UI Elements with Master**:
   Update documentation to use `PIN`, `UNPIN`, `TOGGLE_PIN`, and `#btnPinWorkspace`. Correct the pseudocode in section 4.3 to match `dispatchNav` returning `navState`.
