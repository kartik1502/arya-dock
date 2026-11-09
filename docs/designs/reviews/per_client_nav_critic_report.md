# Hostile Design Critic Audit Report: Per-Client Navigation & Independent Companion Screens (`docs/designs/per-client-navigation.md`)

* **Target Document:** [per-client-navigation.md](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md)
* **Auditor:** Design Critic Goldfish (Senior Software Engineer / Hostile Design Critic)
* **Review Mode:** Stage 7 Hostile Architectural & Concurrency Stress Test
* **Verdict:** **REJECTED (REQUIRES REVISION)** — 3 Blockers, 3 Majors, 1 Nit.

---

### Executive Summary

While the proposal correctly identifies the severe pain point of screen hijacking across multiple companion decks, the technical specification in its current form contains **critical architectural disconnects** that would cause catastrophic command misexecution on the workstation, zombie states on workspace deletion, and test harness failures. Most notably, the document redesigns navigation state but completely omits the execution path of `BUTTON_CLICK`, causing clicks from companion screens to execute buttons from arbitrary foreign workspaces.

Below is the exhaustive audit addressing all specific probe questions and structural vulnerabilities.

---

## Direct Probe Answers

### 1. What happens when a workspace is deleted by an editor while another client is viewing it?
**Outcome: Phantom / Zombie Workspace State (Blocker)**
- In current `lib/ws.js` (lines 378–384), `WORKSPACE_DELETED` only notifies the server's global `dispatchNav`.
- Section 5.4 of the design document completely omits `WORKSPACE_DELETED` from per-socket event handling.
- If Client B is viewing `custom-workspace` and Editor Client A deletes `custom-workspace`, Client B's `ws.navState.workspaceId` is **never updated**. It remains `'custom-workspace'`.
- When `broadcastState` runs, `getClientWorkspace(ws, appConfig)` fails to find `custom-workspace` and falls back to `workspaces[0]`, but `ws.navState` is left pointing to the phantom ID. Client B's `pageIndex` is not clamped, causing out-of-bounds rendering.
- Subsequent `PAGE_NEXT`/`PAGE_PREV` operations fail bounds calculations (`totalPages` defaults to 1). If workstation focus shifts, `CONTEXT_CHANGED` cannot heal the socket because it retains the unmatched phantom workspace.

### 2. What happens when segregation is toggled on a workspace by one client? Does it re-render correctly for all clients viewing that workspace?
**Outcome: Mutation Target Misdirection & Client Desynchronization (Major)**
- **Target Misdirection:** In `lib/ws.js:455`, `TOGGLE_SEGREGATION` evaluates `const targetId = data.workspaceId || activeWs.id;`. In `public/app.js:1602`, the client does NOT pass `workspaceId`. It falls back to `activeWs.id` (server singleton). If an editor viewing `media` toggles segregation, it mutates `segregation` on `developer` (the server's default), corrupting the wrong workspace!
- **Desynchronization:** When Client 1 toggles segregation, Client 1's UI triggers `termTab.click()` to switch `activeLens` to `'terminal'`. Client 2 (also viewing that workspace) receives `STATE_UPDATE`, but `handleServerMessage` (`public/app.js:838–847`) only updates `toggleSegregation.checked`. Client 2's `activeLens` remains `'all'`. Client 2 never sees the segregated view.
- **Pseudo-Code Omission:** Section 5.2 literally has an ellipsis (`// Calculate projected buttons (respecting segregation & 15-tile limit) ...`). The document fails to define whether segregation is server-projected or client-projected.

### 3. What happens to button click actions (`BUTTON_CLICK`) if a client passes a buttonId or pageIndex that differs from server default? Does button execution depend on server navState or client's navState?
**Outcome: Catastrophic Shell Action Misrouting / Wrong Command Execution (Blocker)**
- In `lib/ws.js:279–288`:
  ```javascript
  case 'BUTTON_CLICK': {
    const page = getCurrentPage(); // <-- EVALUATES SERVER-WIDE SINGLETON navState!
    const clickId = data.buttonId ...;
    const button = page.buttons.find(b => b.id === clickId);
    if (button) executeAction(button);
  }
  ```
- In `public/app.js:1172`, the client sends only `{ type: 'BUTTON_CLICK', buttonId }`. It does NOT pass `workspaceId` or `pageIndex`.
- In the design document, Section 5.4 **completely omits `BUTTON_CLICK`**.
- **The Catastrophe:** If Client A is on `media` (Page 0) and clicks Button 0 (intended for "Spotify Play/Pause"), while the server default is on `developer` (Page 0), the server looks up Button 0 on `developer` ("Run AI Agent" or "Terminal Shell"). **It executes the wrong workstation command.** If Button 0 does not exist on the server's global page, the click silently fails.
- **Category Lens Disconnect:** When client-side lenses are active (`activeLens !== 'all'`), virtual pages combine buttons across canonical pages. Button 2 on screen may come from canonical Page 3. If `BUTTON_CLICK` only checks `getClientCurrentPage()`, the button will not be found.

### 4. Are there privilege escalation risks where an operator navigates to an unauthorized area or tampers with state?
**Outcome: Persistence Bleed & Unchecked State Injection (Major)**
- **Persistence Bleed:** In `server.js:190–193`, any `USER_SELECT` event mutates `appConfig.activeWorkspaceId` and schedules disk persistence. If operators are granted permission to send `SET_WORKSPACE` ephemerally, but `server.js` is not decoupled, an unauthenticated operator can overwrite the host's persistent default startup workspace.
- **State Injection:** Section 5.4 invokes `ws.navState = navigationReducer(ws.navState, { type: 'USER_SELECT', workspaceId })` without passing `context`. In `lib/navigation.js:150`, workspace existence validation is skipped if `context.workspaces` is absent. An operator can inject arbitrary workspace strings (e.g. `__proto__`) into memory.
- **Administrative Workspaces:** Currently, operators have execution rights on whatever page they view. If a workstation defines sensitive workspaces (e.g., prod deployment scripts), granting operators navigation freedom lets them execute sensitive scripts unless workspace-level role gating is enforced.

### 5. Are the Reticle v2 verification checks deterministic?
**Outcome: Non-Deterministic / Physically Impossible Reticle Flow (Blocker)**
- Section 7 specifies a Reticle flow `.reticle/flows/arya-dock-4f274f15/per-client-navigation.json` that purports to connect two separate client devices, switch workspaces, and simulate workstation OS window focus shifts.
- Reticle v2 flow JSON files (`.reticle/flows/*/*.json`) are strictly single-client browser automation journeys (`startPath: "/"`, `reticle_act` with DOM roles). They have **no multi-client session schema**, cannot coordinate two WebSocket connections, and **cannot trigger native OS window focus shifts** (`ActiveWindowWatcher`).
- Specifying this as a Reticle flow asset is impossible and will fail Reticle schema validation and execution.

---

## Detailed Findings & Actionable Recommendations

### Finding 1: Disconnect Between `BUTTON_CLICK` and Per-Client Navigation State
* **Severity:** **Blocker**
* **Affected Scope:** `docs/designs/per-client-navigation.md` (Lines 144–184, Section 5.2 & 5.4), `lib/ws.js` (Lines 279–288), `server.js` (Lines 257–264)
* **Technical Description:**
  Button execution currently uses the global `getCurrentPage()` context from `server.js`. Because `public/app.js` only sends `{ type: 'BUTTON_CLICK', buttonId }`, button lookup resolves against whatever workspace and page the server's global state is set to. Under multi-device usage, tapping a button on a companion deck triggers the action corresponding to that slot on the workstation's current screen, not the companion screen.
* **Actionable Recommendation:**
  1. Add `BUTTON_CLICK` explicitly to Section 5.4 of the design doc.
  2. Implement `resolveClientButton(ws, clickId, appConfig)`:
     - Search the client's current page: `getClientCurrentPage(ws, appConfig).buttons.find(b => b.id === clickId)`.
     - If not found (to support client-side category lenses), search all buttons in the client's workspace: `getClientWorkspace(ws, appConfig).pages.flatMap(p => p.buttons).find(b => b.id === clickId)`.
  3. Include `{ workspaceId, pageIndex }` in the client's `BUTTON_CLICK` payload as a verification guard.

---

### Finding 2: Unhandled Client Desynchronization on `WORKSPACE_DELETED`
* **Severity:** **Blocker**
* **Affected Scope:** `docs/designs/per-client-navigation.md` (Lines 169–184, Section 5.4), `lib/ws.js` (Lines 358–386), `lib/navigation.js` (Lines 260–284)
* **Technical Description:**
  The design fails to route `WORKSPACE_DELETED` to connected client sessions. When an editor deletes a workspace, non-editor clients viewing that workspace are stranded with an invalid `workspaceId` in `ws.navState`. Subsequent pagination and context-switch events produce NaN/out-of-bounds page calculations.
* **Actionable Recommendation:**
  In Section 5.4, specify that `WORKSPACE_DELETED` must iterate over all connected clients:
  ```javascript
  wss.clients.forEach(client => {
    client.navState = navigationReducer(client.navState, {
      type: 'WORKSPACE_DELETED',
      workspaceId: delWsId,
      fallbackWorkspaceId: appConfig.workspaces[0]?.id || 'developer'
    }, { workspaces: appConfig.workspaces });
    sendClientState(client, context);
  });
  ```

---

### Finding 3: Reticle v2 Verification Architecture Flaw
* **Severity:** **Blocker**
* **Affected Scope:** `docs/designs/per-client-navigation.md` (Lines 195–200, Section 7)
* **Technical Description:**
  Section 7 claims multi-device isolation and OS window switching will be verified via a Reticle v2 JSON flow. Reticle v2 flows are single-session DOM scripts; they cannot instantiate multiple browser contexts or drive OS-level window streams.
* **Actionable Recommendation:**
  Replace Section 7 with a two-tiered verification strategy:
  1. **Node.js Concurrency Test Harness (`test/per-client-navigation.test.js`)**: Spin up two mock WebSocket clients against `createServer()`, execute interleaved `SET_WORKSPACE`, `PIN`, and mock active window events (`activeWatcher.onChange('spotify')`), asserting exact isolation and deterministic frame delivery.
  2. **Single-Client Reticle Flow (`.reticle/flows/.../companion-deck-state.json`)**: Verify that an individual client correctly renders its own `PINNED` badge, page indicator, and local button matrix without UI corruption.

---

### Finding 4: Incoherent Segregation State & Missing Implementation Specification
* **Severity:** **Major**
* **Affected Scope:** `docs/designs/per-client-navigation.md` (Lines 151–155, Section 5.2), `lib/ws.js` (Lines 448–465), `public/app.js` (Lines 1596–1612)
* **Technical Description:**
  Section 5.2 uses pseudo-code with an ellipsis (`...`) for calculating projected buttons. Furthermore, `TOGGLE_SEGREGATION` on the server uses global state fallback when `workspaceId` is omitted, causing the wrong workspace to be mutated. Finally, remote clients receiving `STATE_UPDATE` do not auto-switch their active lens.
* **Actionable Recommendation:**
  - Define clear segregation architecture: The server broadcasts canonical buttons and `segregation: { enabled }`; virtual category projection remains client-side (`renderKeypadState()`), OR the client sends `lens` to the server and the server projects pages. Choose one model and eliminate the ellipsis pseudo-code.
  - Require `workspaceId` in `TOGGLE_SEGREGATION` payloads, falling back to `ws.navState.workspaceId` rather than global state.
  - Update `public/app.js` to update `activeLens` when `data.segregation.enabled` transitions.

---

### Finding 5: Operator Persistence Bleed in `server.js`
* **Severity:** **Major**
* **Affected Scope:** `docs/designs/per-client-navigation.md` (Lines 77–79, Section 2.5), `server.js` (Lines 189–194)
* **Technical Description:**
  In `server.js`, `dispatchNav` mutates `appConfig.activeWorkspaceId` whenever `USER_SELECT` is dispatched. If operators can trigger `SET_WORKSPACE` ephemerally, this hook will persist operator selections to `profiles.json`, violating Principle 5.
* **Actionable Recommendation:**
  Decouple ephemeral client navigation from server configuration persistence:
  - Client navigation updates only `ws.navState`.
  - Only an explicit editor message (e.g. `SAVE_ACTIVE_WORKSPACE` or an editor-flagged action) updates `appConfig.activeWorkspaceId` and calls `saveConfig()`.

---

### Finding 6: Omission of Validation Context in Reducer Dispatch
* **Severity:** **Major**
* **Affected Scope:** `docs/designs/per-client-navigation.md` (Lines 170–174, Section 5.4), `lib/navigation.js` (Lines 144–175)
* **Technical Description:**
  Section 5.4 specifies `ws.navState = navigationReducer(ws.navState, { type: 'USER_SELECT', workspaceId })` without passing `{ workspaces: appConfig.workspaces }`. Without this context, `navigationReducer` bypasses workspace existence validation and page count bounds checking, allowing client navigation state to be set to arbitrary nonexistent IDs and unbounded page indices.
* **Actionable Recommendation:**
  Always pass context to `navigationReducer`:
  ```javascript
  ws.navState = navigationReducer(ws.navState, action, {
    workspaces: appConfig.workspaces,
    totalPages: targetWs?.pages?.length || 1
  });
  ```

---

### Finding 7: Lack of Session Resumption on Mobile Sleep / Reconnect
* **Severity:** **Nit**
* **Affected Scope:** `docs/designs/per-client-navigation.md` (Lines 113–125, Section 5.1), `public/app.js` (Lines 673–680)
* **Technical Description:**
  When a mobile phone locks its screen, the WebSocket drops. On unlock, `public/app.js` reconnects, creating a new socket that resets `ws.navState` back to the default workspace. This frustrates users using phones as dedicated decks.
* **Actionable Recommendation:**
  Add a client query param `ws?token=...&deckId=<id>`. Cache `navState` in a server `Map` with a 5-minute TTL so reconnections resume where the user left off.

---

### Required Actions for Design Approval
1. Revise Section 5.2 and 5.4 to specify exact `BUTTON_CLICK` routing via `ws.navState`.
2. Add full multi-client broadcast handling for `WORKSPACE_DELETED`.
3. Clarify server vs. client segregation responsibilities and fix the fallback target in `TOGGLE_SEGREGATION`.
4. Fix Section 7 by specifying a Node.js native multi-socket concurrency suite (`test/per-client-navigation.test.js`) instead of an unfeasible multi-client Reticle flow.
5. Explicitly decouple `server.js` active workspace disk persistence from operator navigation.
