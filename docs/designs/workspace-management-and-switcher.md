# Workspace Lifecycle Management & Scalable Dynamic Switcher — Technical Design Document

* **Author:** Karthik Kulkarni
* **Date:** 2026-11-09
* **Status:** Final Implementation Specification (EGM Approved)
* **Target Version:** Arya Dock v1.3.0 / Epic E6-2 (Workspace Lifecycle) & E6-3 (Scalable Switcher)
* **Verification Harness:** Node.js Concurrency Test Runner & Reticle v2 Flow Runner

---

## 1. Problem Statement & Motivation

Arya Dock v1.2.0 delivered multi-device context auto-switching (Epic E1-1) and per-client companion navigation (Epic E1-2). However, workspace creation, renaming, and app-matching customization were constrained by static templates:

1. **Static UI Workspace Bar**:
   `public/index.html` defines default buttons for `M1` (`developer`) and `M2` (`media`). While `public/app.js:renderWorkspaces` renders workspace buttons, the bar lacked an in-app trigger for authenticated editors to create dedicated macro decks for new workflows (e.g. "DevOps Cockpit", "3D Modeling", "Audio Production").
2. **Missing Workspace Lifecycle Protocol**:
   While `WORKSPACE_DELETED` existed in `lib/ws.js`, there were no `CREATE_WORKSPACE` or `UPDATE_WORKSPACE` protocol handlers. Adding or modifying workspaces required manual edits to `~/.config/arya-dock/profiles.json` on the host machine.
3. **Application Matching Rules Inaccessibility**:
   The active window auto-switching engine resolves foreground apps using `workspace.match.apps`, but `sendClientState` stripped `match` from the client broadcast, making match rules invisible to the UI.
4. **Mobile Viewport Starvation & Switcher Constraints**:
   When 4 or more workspaces are configured, a fixed wrapping header pushes controls onto multiple rows, squashing the 15-key keypad grid on mobile screens. The workspace switcher requires responsive horizontal scrolling without header blowout.

---

## 2. Core Architecture & Invariants

```
+-----------------------------------------------------------------------------------------+
|                                ARYA DOCK SERVER (Node.js)                               |
|                                                                                         |
|  [ WebSocket Server (lib/ws.js) ]                                                        |
|    |-- CREATE_WORKSPACE  --> Role Guard (canEdit) -> generateSafeWorkspaceId -> validate  |
|    |                         -> Add to appConfig.workspaces & sync profiles             |
|    |                         -> dispatchNav(USER_SELECT) -> saveConfig(immediate)        |
|    |                         -> Multi-client broadcastState(wss)                        |
|    |-- UPDATE_WORKSPACE  --> Role Guard (canEdit) -> validateWorkspace -> Patch        |
|    |                         -> sync profiles -> saveConfig(immediate) -> broadcastState|
|    |-- WORKSPACE_DELETED --> Role Guard -> Built-in Check -> Delete & clean profiles    |
|    |                         -> fallback dispatchNav -> saveConfig(immediate) -> fanout |
|    |-- sendClientState   --> Projects workspaces INCLUDING match: w.match || {apps: []} |
|                                                                                         |
|  [ Persistence & Reducer (lib/config.js, server.js, lib/navigation.js) ]                |
|    |-- generateSafeWorkspaceId() -> Pure prefix 'ws-${slug}' with numeric collision     |
|    |-- validateWorkspace()       -> Reused from lib/config.js                           |
|    |-- countGraphemes()          -> Unicode grapheme cluster counting via Intl.Segmenter|
|    |-- dispatchNav() in server.js-> Updates activeWorkspaceId on USER_SELECT & DELETED  |
+-----------------------------------------------------------------------------------------+
                                            |
                              WebSocket State Updates (JSON)
                                            |
                                            v
+-----------------------------------------------------------------------------------------+
|                                  CLIENT WEB COCKPIT                                     |
|                                                                                         |
|  [ Dynamic Header (public/index.html & public/style.css) ]                              |
|    |-- Single-row locked header (flex-wrap: nowrap)                                     |
|    |-- Horizontal Scrollable Switcher (.m-mode-selector: flex: 1 1 0; overflow-x: auto) |
|    |-- Add Deck Trigger (#btnAddWorkspace - hidden for operators when canEdit === false)|
|                                                                                         |
|  [ Consolidated Workspace Settings Modal (#workspaceSettingsModal) ]                   |
|    |-- Workspace CRUD Form (#inputWsName, #inputWsIcon, #inputWsMatchApps)              |
|    |-- Workspaces Management List (#workspaceListContainer with edit & delete buttons)  |
|    |-- Segregation Toggle (#toggleSegregation)                                          |
|    |-- Error Display (#workspaceSettingsError)                                          |
|                                                                                         |
|  [ Dynamic Keypad (public/app.js) ]                                                     |
|    |-- Empty-state placeholder when buttons.length === 0 (avoids black void)            |
+-----------------------------------------------------------------------------------------+
```

### Architectural Invariants:
1. **Editor Authorization Barrier**:
   Only authenticated editors (`ws.canEdit === true`) can execute `CREATE_WORKSPACE`, `UPDATE_WORKSPACE`, and `WORKSPACE_DELETED`. Operators receive an immediate `ERROR` payload.
2. **Immutable Built-in Origin**:
   Built-in workspaces (`origin: 'builtin'`, specifically `developer` and `media`) can be renamed, re-iconed, and assigned match apps, but can **NEVER** be deleted under any circumstances.
3. **Safe Workspace Slugification & Prototype Protection**:
   All user-created workspace IDs are prefixed with `ws-` (e.g. `ws-devops`), lowercase alphanumeric + hyphens only. Lookups against dictionary profiles use `Object.prototype.hasOwnProperty.call`.
4. **Physical 15-Key Layout Invariant**:
   Newly created workspaces are initialized with Page 1 containing 0 buttons (`pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }]`). Workspaces never exceed 15 buttons per page (5x3).
5. **Immediate Atomic Persistence**:
   Structural mutations (`CREATE_WORKSPACE`, `UPDATE_WORKSPACE`, `WORKSPACE_DELETED`) bypass the 250ms debounce and execute `saveConfig(true)` immediately.
6. **Host & Multi-Device Navigation Synchronization**:
   Creating a workspace dispatches `USER_SELECT` to the host workstation and caller socket, reassigning `appConfig.activeWorkspaceId = newId`. Connected companion viewers maintain their own navigation states, but receive `STATE_UPDATE` to update their switcher bar.
7. **No YAGNI Reordering**:
   Drag-and-drop workspace reordering is an explicit non-goal for v1.3.0. Canonical ordering follows `appConfig.workspaces` array indices.

---

## 3. Protocol & WebSocket Contracts

### 3.1. `CREATE_WORKSPACE`
* **Trigger:** Editor submits Add Workspace in `#workspaceSettingsModal`.
* **Payload:**
  ```json
  {
    "type": "CREATE_WORKSPACE",
    "name": "DevOps Cockpit",
    "icon": "🚀",
    "matchApps": ["kubectl", "docker", "k9s"]
  }
  ```
* **Validation Rules:**
  - `ws.canEdit === true` (else returns `{ type: "ERROR", code: "EDITOR_REQUIRED", message: "Unauthorized: editor privilege required", action: "CREATE_WORKSPACE" }`).
  - `name`: String, 1–64 characters, trimmed.
  - `icon`: String, 1–2 grapheme clusters (via `countGraphemes`). Default `'⚡'`.
  - `matchApps`: Array of strings, optional. Normalized to lowercase trimmed strings.
* **ID Generation:**
  - `newId = generateSafeWorkspaceId(name, appConfig.workspaces)`.
* **Server Action:**
  - Creates workspace object:
    ```javascript
    const newWs = {
      id: newId,
      name: validatedName,
      icon: validatedIcon,
      origin: 'user',
      segregation: { enabled: false },
      match: { apps: normalizedMatchApps },
      pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }]
    };
    ```
  - Appends to `appConfig.workspaces`.
  - Syncs `appConfig.profiles[newId]`.
  - Dispatches host navigation: `dispatchNav({ type: 'USER_SELECT', workspaceId: newId, pageIndex: 0 })`.
  - Updates caller socket: `ws.navState = navigationReducer(ws.navState, { type: 'USER_SELECT', workspaceId: newId, pageIndex: 0 }, context)`.
  - Calls `saveConfig(true)`.
  - Broadcasts `STATE_UPDATE` to all connected clients (`broadcastState(wss, context)`).

### 3.2. `UPDATE_WORKSPACE`
* **Trigger:** Editor saves workspace edits in `#workspaceSettingsModal`.
* **Payload:**
  ```json
  {
    "type": "UPDATE_WORKSPACE",
    "workspaceId": "ws-devops",
    "name": "DevOps & Cloud",
    "icon": "☁️",
    "matchApps": ["kubectl", "helm"]
  }
  ```
* **Semantics:** Partial patch. Undefined fields preserve existing values. `workspaceId` and `origin` are strictly immutable.
* **Server Action:**
  - Validates and updates properties in `appConfig.workspaces`.
  - Updates `appConfig.profiles[workspaceId]`.
  - Calls `saveConfig(true)`.
  - Broadcasts `STATE_UPDATE` to all connected clients.

### 3.3. `WORKSPACE_DELETED`
* **Trigger:** Editor clicks Delete on a user-created workspace.
* **Payload:**
  ```json
  {
    "type": "WORKSPACE_DELETED",
    "workspaceId": "ws-devops"
  }
  ```
* **Validation & Server Action:**
  - `ws.canEdit === true`.
  - `targetWs.origin !== 'builtin'` (built-ins reject with `{ type: "ERROR", code: "BUILTIN_IMMUTABLE", message: "Built-in workspaces cannot be deleted" }`).
  - `appConfig.workspaces.length > 1` (cannot delete last remaining workspace).
  - Splices `appConfig.workspaces`.
  - Deletes `delete appConfig.profiles[delWsId]`.
  - Dispatches host navigation: `dispatchNav({ type: 'WORKSPACE_DELETED', workspaceId: delWsId, fallbackWorkspaceId })`.
  - In `server.js:dispatchNav`, if `navState.workspaceId` changed, synchronously update `appConfig.activeWorkspaceId = navState.workspaceId`.
  - Fan-out updates each socket's `navState` via `navigationReducer` with event `WORKSPACE_DELETED`.
  - Calls `saveConfig(true)`.
  - Broadcasts `STATE_UPDATE`.

### 3.4. `sendClientState` Projection
* `lib/ws.js:sendClientState` is updated so the `workspaces` array projects `match`:
  ```javascript
  workspaces: (appConfig.workspaces || []).map(w => ({
    id: w.id,
    name: w.name,
    icon: w.icon || '⚡',
    origin: w.origin || 'user',
    segregation: w.segregation || { enabled: false },
    match: w.match || { apps: [] }
  }))
  ```

---

## 4. User Interface & Responsive Styling

### 4.1. Single-Row Header & Scrollable Switcher
In `public/style.css`:
```css
/* Prevent multi-line header expansion that squashes mobile keypads */
.m-header {
  flex-wrap: nowrap;
}

/* Horizontal scrollable switcher with touch drag inertia */
.m-mode-selector {
  flex: 1 1 0;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.m-mode-selector::-webkit-scrollbar {
  display: none;
}

.m-mode-btn {
  flex-shrink: 0;
}

#btnAddWorkspace {
  flex-shrink: 0;
}
```

### 4.2. Header Markup & Visibility
In `public/index.html`:
```html
<div class="m-mode-selector-wrap" style="display: flex; align-items: center; gap: 6px; flex: 1 1 0; min-width: 0;">
  <div class="m-mode-selector" id="workspaceSelector" role="tablist"></div>
  <button id="btnAddWorkspace" class="m-mode-btn m-add-ws-btn" title="Add New Workspace" aria-label="Add Workspace">
    <span class="m-mode-label">+</span>
    <span class="m-mode-sub">NEW</span>
  </button>
</div>
```
When `canEdit === false`, `updateEditorUI()` hides `#btnAddWorkspace`.

### 4.3. Consolidated `#workspaceSettingsModal`
The existing `#workspaceSettingsModal` is expanded to manage both workspace settings/creation and list management:
- Section 1: **Active Workspaces Management** (`#workspaceListContainer`).
  Each row renders: icon, name, match apps badge, origin badge, `[Edit]` button, and `[Delete]` button (disabled for built-in).
- Section 2: **Create / Edit Workspace Form**:
  - `#inputWsName` (text input, max 64)
  - `#inputWsIcon` (emoji input, 1–2 symbols)
  - `#inputWsMatchApps` (comma-separated desktop app names, e.g. `gimp, inkscape`)
  - `#btnCreateWorkspace` / `#btnSaveWorkspaceEdit`
  - `#workspaceSettingsError` (error text container)
- Section 3: **Category Segregation Toggle** (`#toggleSegregation`).

### 4.4. Empty Workspace Keypad State
In `public/app.js:renderKeypadState`, if `buttons.length === 0`:
- If `canEdit === true`: Renders a centered prompt `.m-keypad-empty-state` with button `[+ Add First Shortcut]` opening `#appDrawer`.
- If `canEdit === false`: Renders dim text `NO SHORTCUTS CONFIGURED`.

---

## 5. Verification & Testing Strategy

### 5.1. Concurrency & Unit Test Suite (`test/workspace-ws.test.js`)
1. **`CREATE_WORKSPACE` by editor**:
   - Creates workspace with 1 empty page.
   - Generates safe slug `ws-devops`.
   - Host `activeWorkspaceId` matches `ws-devops`.
   - Fan-out: Connected Client B receives `STATE_UPDATE` with new workspace in list.
2. **`CREATE_WORKSPACE` by operator**:
   - Rejection with `code: 'EDITOR_REQUIRED'`.
   - No mutation in `appConfig.workspaces`.
3. **`UPDATE_WORKSPACE`**:
   - Modifies name, icon, and match apps array.
   - Verifies partial update preserves unedited fields.
4. **`WORKSPACE_DELETED` guards**:
   - Deletion of built-in `developer` rejects with `BUILTIN_IMMUTABLE`.
   - Deletion of user workspace switches host and caller to fallback, deletes profile key.
   - Last remaining workspace deletion rejected.
5. **Prototype Pollution Protection**:
   - `name: "toString"`, `name: "valueOf"`, `name: "__proto__"`:
   - Evaluates to safe slug `ws-tostring`, `ws-valueof`.
   - Server does NOT crash on property access.

### 5.2. Reticle v2 In-App Verification Flow
File: `.reticle/flows/arya-dock-4f274f15/workspace-lifecycle.json`
- Step 1: Open Settings Modal via `#btnWorkspaceSettings`. Assert `#workspaceSettingsModal` visible.
- Step 2: Fill `#inputWsName` with `"DevOps Cockpit"`, `#inputWsIcon` with `"🚀"`.
- Step 3: `reticle_act_and_wait`: Click `#btnCreateWorkspace`, `until: { kind: "element", query: { name: "DEVOPS COCKPIT" } }, durable: true`.
- Step 4: Verify active workspace switched to `"DevOps Cockpit"` and empty state `ADD FIRST SHORTCUT` is visible.
- Step 5: Reload page and assert `"DevOps Cockpit"` persists on disk.

---

## 6. Implementation Checklist & Phase Plan

- [x] Phase 0: Design Specification & Multi-Stage EGM Reviews.
- [ ] Phase 1: Pure Helpers in `lib/config.js`:
  - `generateSafeWorkspaceId(name, existingWorkspaces)`
  - `countGraphemes(str)`
- [ ] Phase 2: Server & WebSocket Handlers:
  - Update `server.js:dispatchNav` condition on `WORKSPACE_DELETED`.
  - Update `sendClientState` projection in `lib/ws.js` to include `match`.
  - Add `CREATE_WORKSPACE` handler in `lib/ws.js`.
  - Add `UPDATE_WORKSPACE` handler in `lib/ws.js`.
  - Harden `WORKSPACE_DELETED` with built-in guard and `delete appConfig.profiles[delWsId]`.
- [ ] Phase 3: Frontend Layout & Modal Logic:
  - Single-row header CSS & horizontal scrolling switcher in `public/style.css`.
  - Add `#btnAddWorkspace` to header in `public/index.html`.
  - Expand `#workspaceSettingsModal` with list and form in `public/index.html`.
  - Wire modal handlers and empty-state keypad prompt in `public/app.js`.
- [ ] Phase 4: Automated Testing & Verification:
  - Add tests in `test/workspace-ws.test.js`.
  - Create and run Reticle verification flow.
  - Run `npm test`, `npm run test:reticle`, and `npm run lint`.
