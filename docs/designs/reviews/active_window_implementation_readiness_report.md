# Implementation Readiness Audit Report: Active Window Auto-Switching Engine

**Target Document:** [`docs/designs/active-window-auto-switching.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md)  
**Target Version:** Arya Dock v1.1.0 / Epic E1-1  
**Auditor:** Pragmatic Tech Lead (`egm-implementation-readiness`)  
**Verdict:** **NO-GO (Conditional — Requires Resolution of 3 Blocker & 3 Major Items Before Coding)**
**Date:** 2026-11-08

---

## Executive Summary

The architectural direction of [`docs/designs/active-window-auto-switching.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md) is sound: it adopts a zero-cost idle lifecycle (3-second teardown hysteresis), strict zero-title-capture privacy guarantees, dual-path platform detection (X11 stream vs. GNOME Wayland single-flight polled introspection), and transient runtime focus pointers.

However, a forensic audit of the existing codebase ([`server.js`](file:///home/karthikulkarni/Documents/arya-dock/server.js), [`lib/ws.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js), [`lib/navigation.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/navigation.js), [`public/app.js`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js)) against this design specification reveals **critical execution gaps, contract mismatches, and an internal latency contradiction** that will cause build hangs, memory leaks, or runtime permission errors if handed to an engineer today.

---

## Audit Findings & Defect Catalog

### 1. Blocker: Hidden Persistence Leak in `server.js` `dispatchNav()`
* **Severity:** Blocker
* **Affected Scope:** [`docs/designs/active-window-auto-switching.md#L188-L203`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L188-L203) & [`server.js#L121-L127`](file:///home/karthikulkarni/Documents/arya-dock/server.js#L121-L127)
* **Finding & Technical Hurdle:**  
  Section 5.3 includes the comment:  
  `// CRITICAL: DO NOT mutate appConfig.activeWorkspaceId!`  
  `// Transient focus switching must NEVER dirty profiles.json or trigger saveConfig().`  
  However, in the actual implementation of [`server.js#L121-L127`](file:///home/karthikulkarni/Documents/arya-dock/server.js#L121-L127), `dispatchNav` unconditionally executes:
  ```javascript
  if (nextState !== navState) {
    navState = nextState;
    if (appConfig.activeWorkspaceId !== navState.workspaceId) {
      appConfig.activeWorkspaceId = navState.workspaceId;
      appConfig.activeProfile = navState.workspaceId;
    }
  }
  ```
  Whenever `onActiveWindowChanged` calls `dispatchNav({ type: 'CONTEXT_CHANGED', appId })`, `appConfig.activeWorkspaceId` is immediately mutated in memory. Any subsequent save operation (e.g. tile edit, page turn, or graceful shutdown `flushConfigSync()`) will flush the transient active window workspace to `profiles.json` on disk!
* **Required Guidance:**  
  The design must explicitly specify the code modification in [`server.js`](file:///home/karthikulkarni/Documents/arya-dock/server.js):
  ```javascript
  if (nextState !== navState) {
    navState = nextState;
    // Only persist default workspace on explicit user manual selection, NEVER on automated context changes
    if (event.type === 'USER_SELECT' && appConfig.activeWorkspaceId !== navState.workspaceId) {
      appConfig.activeWorkspaceId = navState.workspaceId;
      appConfig.activeProfile = navState.workspaceId;
    }
  }
  ```

---

### 2. Blocker: Missing Client Lifecycle Hook Contract in `lib/ws.js` and Server Teardown Leak
* **Severity:** Blocker
* **Affected Scope:** [`docs/designs/active-window-auto-switching.md#L205-L259`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L205-L259), [`server.js#L208-L254`](file:///home/karthikulkarni/Documents/arya-dock/server.js#L208-L254), [`lib/ws.js#L215-L225`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L215-L225)
* **Finding & Technical Hurdle:**  
  1. `ActiveWindowWatcher` exposes `handleClientConnected()` and `handleClientDisconnected(clientCount)`. However, [`lib/ws.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js) does not emit events on client disconnect, nor does `setupWebSocketServer()` accept connection/disconnection callbacks. Disconnections are handled purely internally inside an un-forwarded `ws.on('close')`.
  2. The specification omits where `ActiveWindowWatcher` is instantiated in `createServer()` and how `server.close()` stops it. If `watcher.stop()` is not invoked inside `server.close()`, persistent child processes (`xprop -spy`) or recurring `setTimeout` timers will remain active on the Node.js event loop, causing integration tests (such as `test/reticle.test.js`) to hang indefinitely.
* **Required Guidance:**  
  1. Update `setupWebSocketServer(server, context)` in [`lib/ws.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js) to accept `onClientConnect: (clientCount) => void` and `onClientDisconnect: (clientCount) => void` in `context`, or emit `'clientConnected'` and `'clientDisconnected'` on `wsManager`.
  2. Explicitly document the wiring in [`server.js`](file:///home/karthikulkarni/Documents/arya-dock/server.js):
     - Instantiate `ActiveWindowWatcher` within `createServer()`.
     - Wire `onClientConnect` to `watcher.handleClientConnected()` and `onClientDisconnect` to `watcher.handleClientDisconnected(count)`.
     - Call `watcher.stop()` inside `close(cb)` prior to closing the HTTP/WS servers.

---

### 3. Blocker: Mathematical Contradiction Between Sub-400ms Latency Goal and Wayland Polling Rule
* **Severity:** Blocker
* **Affected Scope:** [`docs/designs/active-window-auto-switching.md#L63`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L63) vs. [`docs/designs/active-window-auto-switching.md#L37`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L37) & [`#L150`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L150)
* **Finding & Technical Hurdle:**  
  - Section 4.1 Goal 3 demands: *"Sub-400ms Focus-to-Deck Latency: Complete detection, normalization, debounce, and WebSocket broadcast in under 400ms from user focus transition."*
  - Section 2 & Section 5.1 specify for Wayland: *"Runs serialized setTimeout(..., 750) loop with 2 consecutive stable samples edge detection."*
  - **The Contradiction:** Requiring 2 consecutive samples at 750ms intervals imposes a mathematical minimum latency of **750ms to 1500ms** from focus transition to dispatch! It is physically impossible to meet the <400ms SLA with this specification.
* **Required Guidance:**  
  Reconcile the SLA and sampling algorithm in the document:
  - Clarify that sub-400ms latency is native to the **X11 / XWayland streaming path** (150ms trailing debounce + ~10ms IPC = ~160ms).
  - For **GNOME Wayland**, state:
    - Wayland operates with a 500ms polling tick and single-sample edge detection (relying on single-flight mutex rather than 2-tick stability), targeting a <600ms latency without fork churn.

---

### 4. Major: Operator Permissions for `SET_WORKSPACE` Blocked by Existing Code & Persistence Guard Missing
* **Severity:** Major
* **Affected Scope:** [`docs/designs/active-window-auto-switching.md#L38`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L38), [`#L268`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L268), [`lib/ws.js#L396-L417`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L396-L417), [`public/app.js#L969`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L969)
* **Finding & Technical Hurdle:**  
  The design states: *"Operators (`role: 'operator'`) are authorized to switch workspaces (`SET_WORKSPACE`) and toggle pins (`TOGGLE_PIN`), ensuring mobile companion decks are never trapped."*
  However:
  1. [`lib/ws.js#L397`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L397) currently enforces `if (!ws.canEdit) return ws.send({ type: 'ERROR', message: 'Unauthorized: editor privilege required' });`.
  2. [`public/app.js#L969`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L969) checks `if (canEdit && ws ...)`, meaning an un-elevated mobile operator clicking an M-mode button does not even emit the WS message.
  3. Furthermore, when `SET_WORKSPACE` succeeds in [`lib/ws.js#L413-L415`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L413-L415), it executes `appConfig.activeWorkspaceId = targetId; saveConfig();`. If an unauthenticated or operator client triggers `SET_WORKSPACE`, it must **not** persist changes to `profiles.json` on disk!
* **Required Guidance:**  
  1. Document that in [`lib/ws.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js), `SET_WORKSPACE` permission check must permit `role === 'operator' || role === 'editor'`.
  2. Document that `appConfig.activeWorkspaceId = targetId; saveConfig();` is **only** executed if `ws.canEdit === true`. For operators, it strictly calls `dispatchNav({ type: 'USER_SELECT', workspaceId: targetId })`.
  3. Document removal of the `canEdit` guard on workspace mode button listeners in [`public/app.js`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js).

---

### 5. Major: Schema Incompatibility in Reticle v2 Verification Flow Definition
* **Severity:** Major
* **Affected Scope:** [`docs/designs/active-window-auto-switching.md#L312-L318`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L312-L318) & [`test/reticle.test.js#L41-L72`](file:///home/karthikulkarni/Documents/arya-dock/test/reticle.test.js#L41-L72)
* **Finding & Technical Hurdle:**  
  Section 8.3 outlines a Reticle flow in `.reticle/flows/arya-dock-4f274f15/active-window-auto-switching.json` with steps like:
  `Step 2: Trigger CONTEXT_CHANGED with spotify -> assert deck switches to media`
  In this project's test suite ([`test/reticle.test.js#L64-L71`](file:///home/karthikulkarni/Documents/arya-dock/test/reticle.test.js#L64-L71)), all Reticle flows must strictly validate against the schema:
  `step.tool === 'reticle_act'`, `step.anchor.kind` (e.g. `'role'`, `'button'`), and `step.action === 'click'`.
  A client-side Reticle flow JSON cannot execute an arbitrary server-side OS context trigger.
* **Required Guidance:**  
  Specify the verification harness cleanly into two distinct layers:
  1. **In-App Reticle Flow (`active-window-auto-switching.json`)**: Drives UI anchors: clicks `#btnPinWorkspace`, asserts `#navModeText` becomes `"PINNED"`, clicks unpin, clicks `#btnModeM2`, asserts `#navModeText` becomes `"MANUAL"`.
  2. **Integration Test (`test/reticle.test.js` & `test/active-window.test.js`)**: Uses a direct WebSocket test client to transmit `{ type: 'CONTEXT_CHANGED', appId: 'spotify' }` and verifies `STATE_UPDATE` broadcasts, pin locking, and disk non-mutation.
  3. Explicitly document adding `'active-window-auto-switching.json'` to the `requiredFlows` array in [`test/reticle.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/reticle.test.js).

---

### 6. Major: Circuit Breaker Backoff Missing in Implementation Spec
* **Severity:** Major
* **Affected Scope:** [`docs/designs/active-window-auto-switching.md#L243-L248`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L243-L248) vs. [`docs/designs/active-window-auto-switching.md#L297`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L297)
* **Finding & Technical Hurdle:**  
  Section 7 states: *"Circuit breaker detects 3 consecutive errors, backs off to 5s interval, and suppresses duplicate log spam."*  
  However, in Section 5.4's code for `ActiveWindowWatcher.start()`, errors simply increment `consecutiveFailures` and silence logging after 3 errors. The loop inside `createActiveWindowStream` continues firing at the standard interval without any 5-second backoff.
* **Required Guidance:**  
  Specify where the 5000ms backoff interval is applied in `platform/linux.js` or `ActiveWindowWatcher` when `consecutiveFailures >= 3`, and how it resets to 500ms on the next successful query.

---

### 7. Nit: Missing `0x0` Desktop Window Guard in X11 Parsing
* **Severity:** Nit
* **Affected Scope:** [`docs/designs/active-window-auto-switching.md#L141-L147`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md#L141-L147)
* **Finding & Technical Hurdle:**  
  When an X11 user clicks the empty desktop background, `_NET_ACTIVE_WINDOW` reports `0x0`. Regex `/^0x[0-9a-fA-F]+$/` matches `0x0`, and querying `xprop -id 0x0 WM_CLASS` emits an error.
* **Required Guidance:**  
  Explicitly specify checking `parseInt(winId, 16) !== 0` before querying `WM_CLASS`.

---

## Definitive Verdict: NO-GO (Conditional)

The architecture is high quality and nearly complete, but coding should **NOT** begin until the 3 Blocker and 3 Major items identified above are amended into [`docs/designs/active-window-auto-switching.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md). Once these amendments are applied, the design will be 100% implementation-ready for zero-ambiguity execution.
