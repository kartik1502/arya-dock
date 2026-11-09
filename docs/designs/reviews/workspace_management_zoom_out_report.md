# Zoom-Out Architecture Review: Workspace Lifecycle Management & Scalable Switcher

* **Target Document:** [`docs/designs/workspace-management-and-switcher.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/workspace-management-and-switcher.md)
* **Reviewer:** Skeptical Architect (Zoom Out Goldfish)
* **Status:** Conditional Approval (Requires Simplification & Architectural Rectifications)

---

## 1. High-Altitude Assessment

The proposal to introduce first-class workspace lifecycle management (`CREATE_WORKSPACE`, `UPDATE_WORKSPACE`) and a responsive horizontal switcher solves a genuine operational friction: users currently have to edit `~/.config/arya-dock/profiles.json` on the host to create custom macro decks or configure app auto-switch match rules.

However, from an architectural simplicity, codebase reuse, and YAGNI standpoint, the design suffers from:
1. **A critical state broadcast blindspot:** [`sendClientState`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L54-L60) completely strips `match` rules from the workspace payload sent to clients, making client-side editing impossible as designed.
2. **Reinventing the wheel:** Proposing new validation helpers when [`validateWorkspace`](file:///home/karthikulkarni/Documents/arya-dock/lib/config.js#L556-L712) already exists in `lib/config.js`.
3. **Speculative feature creep (YAGNI):** Workspace "Reordering" in the UI without protocol, schema, or persistence support.
4. **Modal proliferation:** Proposing a new `#workspaceModal` alongside the existing [`#workspaceSettingsModal`](file:///home/karthikulkarni/Documents/arya-dock/public/index.html#L423-L448).
5. **State machine bypass:** Directly mutating `ws.navState` instead of using the pure [`navigationReducer`](file:///home/karthikulkarni/Documents/arya-dock/lib/navigation.js#L136-L194).

---

## 2. Categorized Findings & Audit Vectors

### Finding 1: Critical State Propagation Blindspot — `match` Rules Stripped in Broadcast
* **Severity:** **Blocker**
* **Affected Scope:** Section 1 (Item 3), Section 3.2, Section 4.2
* **Simplicity & Architectural Rationale:**
  Section 1 and Section 4.2 premise that users will view and edit application auto-switch matching rules (`matchApps`) from the web UI. However, inspecting [`sendClientState`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L54-L60) reveals what is currently projected to clients:
  ```javascript
  workspaces: (appConfig.workspaces || []).map(w => ({
    id: w.id,
    name: w.name,
    icon: w.icon || '⚡',
    origin: w.origin || 'user',
    segregation: w.segregation || { enabled: false }
  }))
  ```
  `match` is **completely omitted** from `sendClientState`. The web client has zero knowledge of configured match rules, cannot compute the "App Rules count", and cannot pre-populate the edit modal for existing workspaces.
  The design must explicitly include `match: w.match || { apps: [] }` in [`sendClientState`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L54-L60), matching the canonical Schema v2 workspace format.

---

### Finding 2: Reinventing the Wheel — Ignoring Existing `validateWorkspace`
* **Severity:** **Major**
* **Affected Scope:** Section 3.1, Section 3.2, Section 6 (Phase 1)
* **Simplicity & Codebase Reuse Rationale:**
  Section 6 proposes: *"Add slugification and validation helpers in lib/config.js or lib/ws.js"*, and Section 3 defines separate validation rules (e.g. 32 char limit vs existing 64 char limit).
  [`validateWorkspace(raw, options)`](file:///home/karthikulkarni/Documents/arya-dock/lib/config.js#L556-L712) **already exists and is exported** in [`lib/config.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/config.js#L1254). It already validates:
  - Prototype pollution / reserved property keys (`__proto__`, `constructor`, `prototype`).
  - Name, icon defaults (`⚡`), and origin flags (`builtin` vs `user`).
  - App match arrays (`match.apps`).
  - Pages and segregation options.
  - Safe repair fallbacks.
  
  Writing bespoke validation logic in `lib/ws.js` violates DRY and creates dual validation divergence. The protocol handlers must reuse [`validateWorkspace`](file:///home/karthikulkarni/Documents/arya-dock/lib/config.js#L556-L712) directly. Only a minimal slug generator function (e.g., `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ws-' + Date.now()`) needs to be added.

---

### Finding 3: YAGNI Feature Creep — Speculative Workspace Reordering
* **Severity:** **Major**
* **Affected Scope:** Section 2 (Architecture Diagram line 37), Section 4.2 (Item 2 line 155)
* **Simplicity & YAGNI Rationale:**
  The diagram lists: *"Active Workspaces List (Reorder, Rename, Delete)"*.
  Workspace reordering is not in the problem statement, has no protocol definition in Section 3 (there is no `REORDER_WORKSPACES` action), and introduces unnecessary drag-and-drop complexity into the management UI.
  **Recommendation:** Strike "Reorder" from the specification. Workspaces are ordered canonically in the `appConfig.workspaces` array. Do not build speculative sorting UI without a clear requirement or protocol backing it.

---

### Finding 4: Modal Proliferation Bloat — Competing Workspace Modals
* **Severity:** **Major**
* **Affected Scope:** Section 4.2
* **Simplicity & DOM Health Rationale:**
  The UI already contains three modals in [`public/index.html`](file:///home/karthikulkarni/Documents/arya-dock/public/index.html):
  1. `#editModal` (key configuration)
  2. `#unlockModal` (role authorization)
  3. [`#workspaceSettingsModal`](file:///home/karthikulkarni/Documents/arya-dock/public/index.html#L423-L448) (currently handles Category Segregation)
  
  Proposing a separate `#workspaceModal` creates DOM duplication, competing backdrop layers, duplicate ESC-key listeners, and confused UX (clicking gear vs clicking `+`).
  **Recommendation:** Consolidate workspace creation and management into the existing [`#workspaceSettingsModal`](file:///home/karthikulkarni/Documents/arya-dock/public/index.html#L423-L448). Clicking `+ Add Workspace` can either open the modal directly into a "New Workspace" form or launch a lightweight, focused creation card.

---

### Finding 5: Navigation State Reducer Bypass
* **Severity:** **Major**
* **Affected Scope:** Section 3.1 (Server Action line 100)
* **Simplicity & Architecture Rationale:**
  Section 3.1 states: *"Switches calling client's `ws.navState` to `newId` with `pageIndex: 0`."*
  Directly mutating `ws.navState` bypasses the pure state machine in [`lib/navigation.js:navigationReducer`](file:///home/karthikulkarni/Documents/arya-dock/lib/navigation.js#L136-L194).
  All workspace navigation transitions across Arya Dock (including `SET_WORKSPACE` and `WORKSPACE_DELETED`) dispatch events through `navigationReducer(ws.navState, { type: 'USER_SELECT', workspaceId: newId, pageIndex: 0 }, context)`.
  Bypassing the reducer creates architectural inconsistencies and fails to maintain mode consistency (`manual` vs `auto`).

---

### Finding 6: Operator UX Real Estate — Inconsistent Button Visibility
* **Severity:** **Nit**
* **Affected Scope:** Section 4.1
* **Simplicity Rationale:**
  Section 4.1 suggests: *"Append a permanent `+ Add Workspace` button at the end of the switcher bar (visible to editors, or prompting unlock for operators)."*
  In Arya Dock's companion architecture (Epic E1-2 & [`updateEditorUI`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L268-L292)):
  - Editor-only controls (`#tileControls`, `#btnOpenDrawer`, `[+ ADD TILE]`) are hidden when `canEdit === false`.
  - Companion mobile screens (phones/tablets) have limited horizontal space.
  Displaying an un-clickable or unlock-prompting `+ Add Workspace` button to read-only companion operators wastes valuable screen real estate in the top bar.
  **Recommendation:** Hide the `+` button when `canEdit === false`, matching the pattern of `#tileControls` and `[+ ADD TILE]`. When an operator unlocks editor mode via `#btnEdit`, the `+` button appears dynamically.

---

### Finding 7: Dual-Schema Profile Sync Hygiene in `WORKSPACE_DELETED`
* **Severity:** **Nit**
* **Affected Scope:** Section 2, Section 3.3
* **Simplicity & Data Integrity Rationale:**
  The design notes that `WORKSPACE_DELETED` is already supported in the backend. However, reviewing [`lib/ws.js` lines 479-486](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L479-L486):
  ```javascript
  if (Array.isArray(appConfig.workspaces)) {
    const wsIdx = appConfig.workspaces.findIndex(w => w && w.id === delWsId);
    if (wsIdx !== -1) {
      appConfig.workspaces.splice(wsIdx, 1);
      saveConfig();
    }
  }
  ```
  Existing code deletes the workspace from `appConfig.workspaces`, but **forgets to delete the key from `appConfig.profiles[delWsId]`**. While Schema v2 uses `workspaces`, stale keys accumulate in `profiles`.
  **Recommendation:** Introduce a single, clean config synchronization helper (or invoke the existing sync pattern in [`lib/ws.js` lines 848-861](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L848-L861)) whenever workspaces are created, updated, or deleted.

---

## 3. Physical Layout & Hardware Invariants Audit

1. **15-Tile Physical Keypad Cap**:
   - Initializing newly created workspaces with `pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }]` strictly adheres to the 15-tile physical keypad cap (5×3 grid ceiling).
   - In [`public/app.js:renderButtons`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js#L1031-L1038), an empty page cleanly renders the `[+ ADD TILE]` button when in edit mode.
2. **Horizontal Switcher Viewport Safety**:
   - The `.m-header` container uses `flex-wrap: wrap`.
   - If `.m-mode-selector` is given horizontal scrolling without `flex-shrink: 1`, `min-width: 0`, and `white-space: nowrap`, adding 6-8 workspaces will wrap the header, consuming critical vertical viewport height needed by the keypad bezel.
   - The design must ensure `.m-mode-selector` is strictly constrained to prevent multi-line header expansion.

---

## 4. Security & Role Boundary Audit

1. **Editor Authorization Barrier**:
   - Requiring `ws.canEdit === true` for `CREATE_WORKSPACE`, `UPDATE_WORKSPACE`, and `WORKSPACE_DELETED` preserves the security boundary established in Epic E1-2. Operators are restricted to `SET_WORKSPACE`.
2. **Prototype Pollution Protection**:
   - Validating generated and incoming IDs against `DANGEROUS_KEYS` (`__proto__`, `constructor`, `prototype`) and sanitizing slugs to `^[a-z0-9-]+$` prevents prototype pollution and path traversal in profile saving.
3. **Last-Remaining Workspace Guard**:
   - Server-side rejection when `workspaces.length <= 1` correctly guarantees that the deck is never left in a zero-workspace state.

---

## 5. Summary Action Items for Author

1. **Fix Broadcast Schema**: Update [`sendClientState`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L54-L60) to include `match: w.match || { apps: [] }` in the broadcasted `workspaces` array.
2. **Reuse Validator**: Replace proposed validation helpers with [`validateWorkspace`](file:///home/karthikulkarni/Documents/arya-dock/lib/config.js#L556-L712) from `lib/config.js`.
3. **Cull YAGNI Reordering**: Remove speculative workspace reordering from UI diagrams and scope.
4. **Unify Modals**: Merge the proposed `#workspaceModal` into the existing [`#workspaceSettingsModal`](file:///home/karthikulkarni/Documents/arya-dock/public/index.html#L423-L448).
5. **Use Navigation Reducer**: Dispatch navigation changes via [`navigationReducer`](file:///home/karthikulkarni/Documents/arya-dock/lib/navigation.js#L136-L194) rather than directly mutating `ws.navState`.
6. **Clean Operator UI**: Hide the `+ Add Workspace` button when `canEdit === false` to preserve mobile viewport width.
