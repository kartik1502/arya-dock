# Stage 5 Skeptical Architect Review Report: Per-Client Navigation

**Target Document:** [`docs/designs/per-client-navigation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md)  
**Reviewer:** Skeptical Architect (Zoom Out Goldfish)  
**Status:** **CONDITIONAL PASS WITH REQUIRED SIMPLIFICATIONS (2 Blockers, 4 Majors, 1 Nit)**  

---

## Executive Summary

The core motivation of [per-client-navigation.md](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md) is sound and addresses a genuine user need in multi-screen setups (e.g. tablet locked to media while phone navigates developer tools). Moving navigation state off the server singleton and onto individual client connections is the right architectural direction.

However, the proposal suffers from two significant architectural oversights:
1. **Critical Synchronization & Execution Blindspots:** The design focuses entirely on page flipping events but completely ignores [`BUTTON_CLICK`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L279-L287) and editor mutations (`ADD_BUTTON`, `DELETE_BUTTON`, `WORKSPACE_DELETED`). If Client B is on workspace "media" and clicks a button while the server's global state is on workspace "developer", the button action either silently fails or executes the wrong command from the wrong workspace.
2. **Speculative Abstractions & Phantom Architecture:** The document introduces unnecessary concepts like *"Sync Intent"* (never used or specified) and a server-side *"defaultNavState for legacy HTTP endpoints"* (which do not exist in [`lib/http.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/http.js)). It also hints at calculating category lens projections on the server, which is already cleanly handled on the client side in [`public/app.js`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L767-L785).

---

## Architectural Core Evaluation

### 1. Does per-client navigation complicate the server or create synchronization traps?
**Yes, if implemented as written.**
- **The Button Execution Trap:** Currently, [`lib/ws.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L280) looks up buttons via `context.getCurrentPage()`, which reads the global server state. If companion Client B on workspace `media` clicks button ID 2, and the server's fallback/editor workspace is `developer`, button ID 2 will resolve to a developer command (e.g. running a shell test or kill command instead of media playback). `BUTTON_CLICK` **must** resolve tiles from the calling socket's own `ws.navState`.
- **Dangling Socket States on Page/Workspace Mutation:** If an editor deletes page 2 or deletes a workspace, existing companion sockets viewing that workspace or page will hold stale out-of-bounds indices. While [`getClientCurrentPage`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md#L135-L142) clamps for display, it leaves `ws.navState` internally desynchronized.
- **Navigation vs Configuration Decoupling:** In the current codebase, [`SET_WORKSPACE`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L401-L422) is restricted to `canEdit` and writes to `appConfig.activeWorkspaceId`. The design must cleanly decouple:
  - *Transient client deck navigation* (allowed for all roles, mutates only `ws.navState`, never touches disk).
  - *Persistent boot profile modification* (editor-only, mutates `appConfig.activeWorkspaceId`).

### 2. Can we reuse existing `navigationReducer` in `lib/navigation.js` without adding complex session state stores?
**Yes, 100%.**
[`navigationReducer`](file:///home/karthikulkarni/Documents/arya-dock/lib/navigation.js#L136-L345) in `lib/navigation.js` is already a pure, deterministic reducer. It already handles `USER_SELECT`, `CONTEXT_CHANGED` (with pin blocking), `PAGE_NEXT`, `PAGE_PREV`, `PIN`, `UNPIN`, and `WORKSPACE_DELETED`. 
No external session stores, classes, or database maps are needed. Storing `ws.navState = createInitialNavigationState(...)` directly on the `WebSocket` object and invoking `navigationReducer(ws.navState, event, context)` is completely sufficient and minimalist.

### 3. What are the memory leak risks with `ws.navState` on disconnected sockets?
**Zero risk if kept directly on the socket; High risk if external registries are created.**
- As long as `navState` is an object property directly attached to `ws` (`ws.navState`), Node's V8 engine garbage-collects it as soon as the socket closes and is removed from `wss.clients`.
- The 15-second ping/pong heartbeat in [`lib/ws.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L800-L808) guarantees stale/unclean socket drops (e.g., mobile phone Wi-Fi sleep) are terminated within 15–30 seconds.
- **Constraint:** Reject any proposed `SessionManager`, `DeviceRegistry`, or `Map<socketId, State>` abstractions. They create memory leak vectors when sockets disconnect abruptly. For defensive hygiene, `ws.on('close')` should set `ws.navState = null`.

### 4. Are we maintaining the 15-tile (5x3) hard limit invariant?
**Yes, provided server-side projection is kept out of `lib/ws.js`.**
- Each workspace page in `appConfig` is already enforced at `<= 15` buttons by [`MAX_BUTTONS_PER_PAGE`](file:///home/karthikulkarni/Documents/arya-dock/lib/config.js).
- In [`public/app.js`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L774-L785), virtual category lenses chunk `cachedAllButtons` into slices of 15 (`slice(startIdx, startIdx + 15)`).
- The server must simply transmit the active page (`buttons`) and the workspace button pool (`allButtons`). Attempting to calculate lens chunking on the server would violate client-server separation and introduce redundant complexity.

---

## Detailed Audit Findings

### Finding 1: Button Execution Desynchronization Trap
* **Severity:** **Blocker**
* **Affected Scope:** Section 5.4 (*Message Handler Routing*) & Section 5.2
* **Simplicity Rationale:** Section 5.4 details page flips and workspace switches but omits [`BUTTON_CLICK`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L279-L287). If Client B is on workspace "media" while the server/editor is on "developer", calling `context.getCurrentPage()` executes the wrong button from the wrong workspace.
* **Resolution:** In `lib/ws.js`, resolve button actions against the calling client's page:
  ```javascript
  const activeWs = getClientWorkspace(ws, appConfig);
  const page = getClientCurrentPage(ws, appConfig);
  const button = page.buttons.find(b => b.id === clickId);
  ```

### Finding 2: Unhandled Workspace/Page Deletions on Companion Sockets
* **Severity:** **Blocker**
* **Affected Scope:** Section 5.2 & Section 5.4
* **Simplicity Rationale:** When an editor deletes a workspace or trims pages on one client, other connected sockets retain stale `ws.navState.workspaceId` or out-of-bounds `pageIndex`. Clamping only inside serialization leaves the client's internal reducer state corrupted.
* **Resolution:** When `WORKSPACE_DELETED` or page count reduction occurs, iterate over `wss.clients` and pass the deletion event through each client's `navigationReducer`.

### Finding 3: Speculative Protocol Bloat — "Sync Intent"
* **Severity:** **Major**
* **Affected Scope:** Section 3 (*Reference Glossary & Definitions*, Line 91)
* **Simplicity Rationale:** "Sync Intent" is defined as a protocol event for clients to sync or break away from default navigation. It is never used, described, or implemented anywhere else in the document. Unpinned clients already track the active window automatically; pinned clients stay locked. "Sync Intent" is a textbook YAGNI violation.
* **Resolution:** Delete "Sync Intent" from the glossary and specification.

### Finding 4: Phantom Legacy HTTP Navigation State (`defaultNavState`)
* **Severity:** **Major**
* **Affected Scope:** Section 3 (*Reference Glossary & Definitions*, Line 88)
* **Simplicity Rationale:** The document proposes `defaultNavState` as a fallback for "legacy HTTP endpoints (`/api/*`)". A code search of [`lib/http.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/http.js) confirms that HTTP routes only serve `/health`, `/api/apps`, and `/api/directories`. There are no HTTP navigation endpoints. Maintaining a parallel server-side `defaultNavState` singleton adds dead weight.
* **Resolution:** Remove `defaultNavState`. The server needs only `appConfig.activeWorkspaceId` as the default initial value for newly connected sockets.

### Finding 5: Responsibility Leakage — Server-Side Category Lens Projection
* **Severity:** **Major**
* **Affected Scope:** Section 2 (Principle 4) & Section 5.2 (Line 151)
* **Simplicity Rationale:** Section 5.2 suggests calculating category lens and segregation projections on the server (`// Calculate projected buttons (respecting segregation & 15-tile limit)`). In Arya Dock, category lens selection (`activeLens`) is purely client-side UI state in [`public/app.js`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L767-L785). The server does not know which lens is selected.
* **Resolution:** Keep `sendClientState` simple: send canonical `page.buttons` (capped at 15) and flattened `allButtons`. Let the client maintain its existing projection logic.

### Finding 6: Ambiguous Navigation vs. Persistence Contract
* **Severity:** **Major**
* **Affected Scope:** Section 2 (Principle 5) vs Section 5.4 (Item 1)
* **Simplicity Rationale:** Section 2 states that user actions from an editor mutate `appConfig.activeWorkspaceId` on disk, whereas Section 5.4 states that `SET_WORKSPACE` updates only `ws.navState` and does not mutate other clients. If an editor merely switches tabs to edit a button, mutating disk persistence disrupts the next server boot.
* **Resolution:** Make deck switching strictly ephemeral across all clients. Only explicit configuration updates (e.g. setting the default workspace in Workspace Settings) should mutate `appConfig.activeWorkspaceId`.

### Finding 7: Implementation Weeds in Specification
* **Severity:** **Nit**
* **Affected Scope:** Section 5.2 (Lines 129–142)
* **Simplicity Rationale:** The document includes granular pseudocode for helper functions (`getClientWorkspace`, `getClientCurrentPage`) while failing to define message contracts for button clicks and role security boundaries.
* **Resolution:** Replace helper pseudocode with explicit protocol contracts for `sendClientState` and `BUTTON_CLICK`.

---

## Minimalist Implementation Plan

To implement per-client navigation with maximum simplicity:
1. **Initialize Socket State:** In [`lib/ws.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L215-L225), set `ws.navState = createInitialNavigationState({ workspaces: appConfig.workspaces, initialWorkspaceId: appConfig.activeWorkspaceId })`.
2. **Reuse Existing Reducer:** In message handlers (`SET_WORKSPACE`, `PAGE_NEXT`, `PAGE_PREV`, `PIN`, `UNPIN`), run `ws.navState = navigationReducer(ws.navState, event, context)` and invoke `sendClientState(ws, context)`.
3. **Fix Button Click Scope:** Update `BUTTON_CLICK` in `lib/ws.js` to look up buttons on the caller's active page:
   ```javascript
   const wsObj = (appConfig.workspaces || []).find(w => w.id === ws.navState.workspaceId) || appConfig.workspaces?.[0];
   const page = wsObj?.pages?.[ws.navState.pageIndex] || wsObj?.pages?.[0] || { buttons: [] };
   const button = page.buttons.find(b => b.id === clickId);
   ```
4. **Context Change Fan-Out:** In the active window watcher callback, iterate `wss.clients` and pass `{ type: 'CONTEXT_CHANGED', appId }` into each socket's `navigationReducer`.
