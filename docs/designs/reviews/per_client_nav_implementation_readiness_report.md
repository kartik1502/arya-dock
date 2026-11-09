# Stage 9 Pragmatic Tech Lead Implementation-Readiness Audit Report

**Target Document:** [`docs/designs/per-client-navigation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md)  
**Auditor:** Stage 9 Implementation Readiness Goldfish (Pragmatic Tech Lead & Implementing Software Engineer)  
**Reference Input:** [`per_client_nav_intermediate_zoom_out_report.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/reviews/per_client_nav_intermediate_zoom_out_report.md)  
**Readiness Verdict:** **CONDITIONAL PASS / MINOR REVISION REQUIRED BEFORE IMPLEMENTATION** (0 Hard Blockers, 5 Majors, 3 Nits)

---

## 1. Executive Summary & Verification Checklist Answers

The revised technical specification at [`docs/designs/per-client-navigation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md) is a massive improvement over earlier drafts. The core architectural vision—transitioning `navState` from a server-wide singleton to per-socket properties (`ws.navState`) with stateless rehydration—is solid, feasible, and directly actionable.

Here are the direct answers to the five audit verification queries:

1. **Are all protocol message shapes, handler signatures, and reducer dispatches fully specified without ambiguity?**  
   *Mostly Yes, with two specific omissions:*  
   - `sendClientState` (Section 5.2) specifies the payload structure but omits `role: ws.role`, `canEdit: ws.canEdit`, and `pageName`, which breaks client privilege detection. Furthermore, initial connection handshake should support `type: 'INIT'` (or preserve backwards compatibility with tests expecting `INIT`).  
   - Tile mutation handlers (`UPDATE_BUTTON`, `ADD_BUTTON`, `DELETE_BUTTON`, `SET_BUTTONS_COUNT`) were omitted from Section 5.4; if left untouched, editor button edits on companion screens will still mutate the global fallback workspace instead of the client's active workspace.

2. **Is `BUTTON_CLICK` resolution fully actionable?**  
   *Yes, but missing feedback ACK:*  
   - The dual-tier resolution (`getClientCurrentPage` followed by `allButtons` fallback) is completely actionable and solves virtual lens execution.  
   - However, the handler in Section 5.4 omits `BUTTON_ACK` (`ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: clickId, status: 'ok' }))`), which breaks the client-side visual tap flash animation in `public/app.js`.

3. **Is multi-client fan-out on `WORKSPACE_DELETED` and `CONTEXT_CHANGED` fully defined?**  
   *Yes, but contains one subtle state broadcast bug:*  
   - In `CONTEXT_CHANGED` (lines 354–356), the code guards state dispatch with `if (client.navState.workspaceId !== prevWs)`. When a client is in `manual` mode on the same workspace and shifts to `auto` mode, `workspaceId` does not change, suppressing `sendClientState` and leaving the client UI badge stuck on `MANUAL`.

4. **Is the two-tier verification plan (`test/per-client-navigation.test.js` and Reticle flow) unambiguous?**  
   *Partially:*  
   - Tier 1 (`test/per-client-navigation.test.js`) is clear on the four required concurrency scenarios.  
   - Tier 2 (`companion-deck-state.json`) uses an elliptical path (`.reticle/flows/.../companion-deck-state.json`) and lacks concrete step definitions (selectors, tools, expectations).

5. **Are all previously identified blockers from `per_client_nav_intermediate_zoom_out_report.md` successfully resolved?**  
   *All 4 Blockers are architecturally resolved:*  
   - Blocker 1 (`BUTTON_CLICK` desynchronization): Resolved via per-client resolution.  
   - Blocker 2 (Zombie sockets on workspace deletion): Resolved via `wss.clients` fan-out.  
   - Blocker 3 (Reticle test infeasibility): Resolved via two-tier separation.  
   - Blocker 4 (Ellipsis serialization): Resolved via explicit JSON schema in Section 5.2.

---

## 2. Review of Previously Identified Issues

| Issue from Synthesis Report | Severity | Status in Revised Spec | Implementation Note |
| :--- | :---: | :---: | :--- |
| **Blocker 1: `BUTTON_CLICK` Desynchronization** | Blocker | **RESOLVED** | Dual-tier lookup in Section 5.4 item 1 is verified. Must re-add `BUTTON_ACK`. |
| **Blocker 2: Zombie Multi-Client Deletion** | Blocker | **RESOLVED** | Section 5.4 item 5 fans out to all `wss.clients`. Must preserve `>= 1` workspace guard. |
| **Blocker 3: Reticle v2 Test Infeasibility** | Blocker | **RESOLVED** | Converted to Tier 1 Node.js suite + Tier 2 single-client Reticle flow. |
| **Blocker 4: Serialization Ellipsis** | Blocker | **RESOLVED** | Explicit schema provided in Section 5.2. Must include `role` and `canEdit`. |
| **Major 1: `CONTEXT_CHANGED` Reducer Context** | Major | **RESOLVED** | `findWorkspaceForApp` and `workspaces` context passed in Section 5.4 item 6. |
| **Major 2: Navigation vs Persistence Bleed** | Major | **RESOLVED** | Ephemeral actions do not mutate `appConfig.activeWorkspaceId` or call `saveConfig()`. |
| **Major 3: Segregation Target Misdirection** | Major | **RESOLVED** | Section 5.4 item 7 targets caller's `ws.navState?.workspaceId`. |
| **Major 4: Dead-Weight Pruning ("Sync Intent")** | Major | **RESOLVED** | Deleted from glossary and spec. |
| **Major 5: State Model Simplification (`mode`/`pinned`)** | Major | **RESOLVED** | Consolidated with `pinned` canonical and `mode` derived helper. |
| **Major 6: Reconnection Ergonomics** | Major | **RESOLVED** | Section 5.1 implements stateless query param rehydration `/?workspace=id`. |

---

## 3. Prioritized Audit Findings & Technical Implementation Guidance

### 🟡 Major Findings

#### Major 1: Frontend Client Workspace Switching Locked by `canEdit` in `public/app.js`
* **Severity:** Major
* **Affected Scope:** [`public/app.js:969`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L969), [`public/app.js:1225`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L1225), [`public/app.js:1234`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L1234), `docs/designs/per-client-navigation.md` Section 6.
* **Finding:**  
  Section 6 Principle 1 establishes: *"Remote Navigation Freedom: Operators (`role: 'operator'`) can freely switch workspaces and pages on their own deck screen."* However, `public/app.js` guards all workspace button click handlers with `if (canEdit)`:
  ```javascript
  btn.addEventListener('click', () => {
    triggerHaptic(20);
    if (canEdit && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: wsItem.id }));
    }
  });
  ```
  If the backend unblocks operators from sending `SET_WORKSPACE` but the design fails to instruct updating `public/app.js`, companion phones in operator mode will completely ignore taps on M1/M2/workspace pills.
* **Guidance:**  
  In the design document (or implementation task list), explicitly specify updating `public/app.js` (lines 969, 1225, 1234) to remove `canEdit &&` from workspace switching clicks:
  ```javascript
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: wsItem.id }));
  }
  ```

#### Major 2: Missing `role` and `canEdit` in `sendClientState` Payload & Handshake Compatibility
* **Severity:** Major
* **Affected Scope:** `docs/designs/per-client-navigation.md` Section 5.2 (lines 168–194).
* **Finding:**  
  The `payload` in Section 5.2 omits `role: ws.role` and `canEdit: ws.canEdit`. When a client connects or receives a state update, `public/app.js` checks `if (data.role !== undefined) userRole = data.role` and `if (data.canEdit !== undefined) canEdit = data.canEdit`. Omitting them means localhost connections or authenticated editors will fail to reflect their editor status in the UI.  
  Additionally, `test/reticle.test.js:494` asserts that the initial WebSocket message has `type: 'INIT'`. If `sendClientState` unconditionally sends `type: 'STATE_UPDATE'` on connection, existing test suites will fail.
* **Guidance:**  
  1. Add `role`, `canEdit`, and `pageName` to Section 5.2:
     ```javascript
     function sendClientState(ws, context, messageType = 'STATE_UPDATE') {
       if (ws.readyState !== WebSocket.OPEN) return;
       const appConfig = context.getConfig();
       const workspace = getClientWorkspace(ws, appConfig);
       const page = getClientCurrentPage(ws, appConfig);
       const navState = ws.navState || { workspaceId: workspace.id, pageIndex: 0, pinned: false, mode: 'auto' };

       const payload = {
         type: messageType,
         workspaceId: workspace.id,
         workspaceName: workspace.name,
         workspaceIcon: workspace.icon || '⚡',
         segregation: workspace.segregation || { enabled: false },
         workspaces: (appConfig.workspaces || []).map(w => ({
           id: w.id,
           name: w.name,
           icon: w.icon || '⚡',
           origin: w.origin || 'user',
           segregation: w.segregation || { enabled: false }
         })),
         navigation: {
           mode: navState.mode || (navState.pinned ? 'manual' : 'auto'),
           workspaceId: navState.workspaceId,
           pageIndex: navState.pageIndex,
           pinned: Boolean(navState.pinned)
         },
         pageNumber: navState.pageIndex + 1,
         totalPages: workspace.pages?.length || 1,
         pageName: page.name || `Page ${navState.pageIndex + 1}`,
         buttons: (page.buttons || []).slice(0, 15),
         allButtons: (workspace.pages || []).flatMap(p => p.buttons || []),
         role: ws.role,
         canEdit: ws.canEdit
       };
       ws.send(JSON.stringify(payload));
     }
     ```
  2. On socket connection in `setupWebSocketServer`: call `sendClientState(ws, context, 'INIT')`.

#### Major 3: Missing `BUTTON_ACK` in `BUTTON_CLICK` Routing
* **Severity:** Major
* **Affected Scope:** `docs/designs/per-client-navigation.md` Section 5.4 item 1 (lines 213–234).
* **Finding:**  
  When executing a button, the current production code in [`lib/ws.js:285`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L285) sends:
  ```javascript
  ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: clickId, status: 'ok' }));
  ```
  `public/app.js:868` relies on `BUTTON_ACK` to call `flashButtonAck(data.buttonId)`, giving the physical deck user immediate visual feedback (scaling down and flashing the red border). Section 5.4 omits `BUTTON_ACK`, causing companion deck taps to feel dead or unresponsive.
* **Guidance:**  
  Update Section 5.4 item 1:
  ```javascript
  if (button) {
    executeAction(button);
    ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: clickId, status: 'ok' }));
  } else {
    console.warn(`[Arya Dock] Button ${clickId} not found on client's workspace ${activeWs.id}`);
  }
  ```

#### Major 4: Unhandled Tile Mutations on Companion Screens (`UPDATE_BUTTON`, `ADD_BUTTON`, etc.)
* **Severity:** Major
* **Affected Scope:** [`lib/ws.js:484`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L484), [`lib/ws.js:518`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L518), [`lib/ws.js:638`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L638), [`lib/ws.js:714`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L714).
* **Finding:**  
  Section 5.4 defines routing for navigation actions (`SET_WORKSPACE`, `PAGE_NEXT`, `PIN`, etc.) but does not mention tile mutation actions. In `lib/ws.js`, `UPDATE_BUTTON`, `ADD_BUTTON`, `DELETE_BUTTON`, and `SET_BUTTONS_COUNT` currently resolve target pages via `getCurrentPage()` or `getActiveWorkspace()`. If an authenticated editor on a tablet viewing `media` configures or adds a button, it will mutate the server singleton's `developer` workspace instead of `media`.
* **Guidance:**  
  Add an explicit note in Section 5.4 specifying that `UPDATE_BUTTON`, `ADD_BUTTON`, `DELETE_BUTTON`, and `SET_BUTTONS_COUNT` must be updated to resolve target workspace and page from the calling socket:
  ```javascript
  const activeWs = getClientWorkspace(ws, appConfig);
  const activePage = getClientCurrentPage(ws, appConfig);
  ```

#### Major 5: State Update Suppression on Context Shift Mode Transition
* **Severity:** Major
* **Affected Scope:** `docs/designs/per-client-navigation.md` Section 5.4 item 6 (lines 352–357).
* **Finding:**  
  In the `ActiveWindowWatcher` callback:
  ```javascript
  if (nextNav !== client.navState) {
    client.navState = nextNav;
    if (client.navState.workspaceId !== prevWs) {
      sendClientState(client, wsContext);
    }
  }
  ```
  If Client A is viewing `developer` with `mode: 'manual'` (unpinned, but user manually flipped a page), and focus shifts to `code` (which maps to `developer`), `navigationReducer` updates `mode` to `'auto'`.  
  Here, `nextNav !== client.navState` is `true`, but `client.navState.workspaceId !== prevWs` is `false`. Because of this inner `if` check, `sendClientState` is never called. The UI badge stays stuck on `MANUAL` instead of updating to `AUTO`.
* **Guidance:**  
  Remove the `if (client.navState.workspaceId !== prevWs)` condition. `nextNav !== client.navState` already guarantees a state change occurred:
  ```javascript
  if (nextNav !== client.navState) {
    client.navState = nextNav;
    sendClientState(client, wsContext);
  }
  ```

---

### 🟢 Nits & Minor Polish

#### Nit 1: Missing Safe Page Clamping on Pruning in `sendClientState`
* **Affected Scope:** Section 5.2 line 187 (`pageNumber: navState.pageIndex + 1`).
* **Finding:** If an editor removes a page or deletes tiles causing page count to drop from 3 to 1 while a companion socket is on `pageIndex: 2`, `getClientCurrentPage` clamps to page 0, but `sendClientState` transmits `pageNumber: 3, totalPages: 1`.
* **Guidance:** Clamp before sending:
  ```javascript
  const safePageIndex = Math.max(0, Math.min(navState.pageIndex, Math.max(0, (workspace.pages?.length || 1) - 1)));
  navState.pageIndex = safePageIndex;
  ```

#### Nit 2: Omission of Last-Workspace Guard in `WORKSPACE_DELETED`
* **Affected Scope:** Section 5.4 item 5 (lines 308–331).
* **Finding:** The snippet drops the production check `if (appConfig.workspaces.length <= 1)`. Deleting the only remaining workspace will cause undefined access on `appConfig.workspaces[0]`.
* **Guidance:** Re-add `if (appConfig.workspaces.length <= 1) { ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot delete last remaining workspace' })); return; }`.

#### Nit 3: Reticle Flow Step Specification Gap
* **Affected Scope:** Section 7.2 (`.reticle/flows/.../companion-deck-state.json`).
* **Finding:** The path has an ellipsis `...`, and the flow steps are not detailed.
* **Guidance:** Specify exact path `.reticle/flows/arya-dock-4f274f15/companion-deck-state.json` and declare the exact Reticle v2 step definitions:
  - Step 1: Click `#btnPinWorkspace` -> expect `#navStatusBadge` text contains `PINNED`.
  - Step 2: Click `#btnModeM2` -> expect `#deckStatusPage` text contains `PAGE 1`.
  - Step 3: Click `#btnPinWorkspace` -> expect `#navStatusBadge` text contains `AUTO`.

---

## 4. Final Verdict & Next Steps

The design is **approved for implementation subject to incorporating the 5 guidance items above**. None of the findings require architectural redesign; they are concrete, pragmatic adjustments that eliminate implementation stumbling blocks.
