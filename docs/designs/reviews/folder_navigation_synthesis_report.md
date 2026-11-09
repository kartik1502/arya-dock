# Folder & Sub-Deck Navigation Engine (Epic E6-1) — Architectural Synthesis & Review Report

* **Author:** Swarm Compiler (EGM Stage 8) & Pragmatic Tech Lead (EGM Stage 9)
* **Date:** 2026-11-09
* **Status:** **APPROVED FOR IMPLEMENTATION**
* **Target Version:** Arya Dock v1.5.0 / Epic E6-1 (Folder & Sub-Deck Navigation Engine)
* **Audited Documents:** [`docs/designs/folder-subdeck-navigation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/folder-subdeck-navigation.md)
* **Source Modules:** [`lib/config.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/config.js), [`lib/navigation.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/navigation.js), [`lib/ws.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js), [`public/app.js`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js), [`public/index.html`](file:///home/karthikulkarni/Documents/arya-dock/public/index.html)

---

## 1. Executive Summary & Review Audit Consensus

Three independent Goldfish review streams evaluated the Folder & Sub-Deck Navigation Engine:
1. **Skeptical Architect (`egm-zoom-out`)**: Audited high-altitude simplicity, layer boundaries, and reuse. Flagged the Edit Mode trap with synthetic Back tiles, unbounded $N$-level recursion, missing folder lifecycle protocols, and mutation bifurcation in `lib/ws.js`.
2. **Naive Reader (`egm-comprehension`)**: Audited user and developer comprehension. Flagged undefined folder creation/deletion semantics, ID vs slot addressing contradictions, undefined paging behavior inside folders, and missing DOM contracts.
3. **Hostile Design Critic (`egm-design`)**: Stress-tested concurrency, security, and edge cases. Flagged unbounded stack memory exhaustion (DoS), root workspace tile mutation hijacking, orphaned folder zombie locks, and category lens desynchronization.

This synthesis report unifies, deduplicates, and resolves all findings into definitive architectural decisions and unambiguous implementation instructions.

---

## 2. Definitive Architectural Decisions

### Decision 1: Synthetic Back Tile & System Slot 0 Integrity
- **Invariant**: The physical keypad matrix is strictly capped at $\le 15$ slots ($5 \times 3$). When inside a folder, Slot 0 is reserved for the synthetic Back navigation tile (`id: '__back__'`, `actionType: 'folder_back'`, `isSystem: true`). User action buttons occupy Slots 1 through 14 (maximum 14 buttons).
- **Edit Mode Bypass**: In `public/app.js`, clicking a tile where `btnData.id === '__back__'` or `btnData.actionType === 'folder_back'` unconditionally triggers navigation (`sendButtonClick('__back__')`), bypassing `openEditModal` even when Edit Mode is active.
- **Server Mutation Immunity**: In `lib/ws.js`, any `UPDATE_BUTTON` or `DELETE_BUTTON` targeting `targetId === '__back__'` is rejected with `{ type: 'ERROR', code: 'CANNOT_MUTATE_SYSTEM_BUTTON', message: 'System navigation tile cannot be edited or deleted' }`.
- **Schema Separation**: User buttons stored on disk in `folder.buttons` use standard non-negative integer IDs (`0..13`). The synthetic Back button is never written to disk; it is projected only at runtime during client state serialization (`sendClientState`).

### Decision 2: Unified Container Resolution (`getClientActiveContainer`)
- All button mutations (`ADD_BUTTON`, `UPDATE_BUTTON`, `DELETE_BUTTON`, `SET_BUTTONS_COUNT`) and lookups (`BUTTON_CLICK`) route through a centralized helper `getClientActiveContainer(ws, appConfig)`:
  - If `ws.navState?.folderStack?.length > 0`, resolves `folder = activeWs.folders.find(f => f.id === currentFolderId)`. Operates on `folder.buttons` (capped at 14).
  - If no folder is active, resolves `page = getClientCurrentPage(ws, appConfig)`. Operates on `page.buttons` (capped at 15).
- Prevents mutation hijacking where folder edits could inadvertently delete or overwrite root workspace page tiles.

### Decision 3: Bounded Stack Depth & Cycle Prevention (Anti-DoS)
- Enforce `const MAX_FOLDER_DEPTH = 5;` in `lib/navigation.js`.
- In `navigationReducer` under `ENTER_FOLDER`:
  - If `current.folderStack.length >= MAX_FOLDER_DEPTH`, reject with no-op.
  - If `current.folderStack.includes(event.folderId)`, reject with no-op (strict anti-cycle guard).
- All workspace switches (`USER_SELECT`, `SET_WORKSPACE`, `CONTEXT_CHANGED`, `WORKSPACE_DELETED`) reset `folderStack: []`.

### Decision 4: Implicit Folder Lifecycle & Cascade Deletion
- **Auto-Provisioning**: In `lib/ws.js` (`ADD_BUTTON` and `UPDATE_BUTTON`), if a button is assigned `actionType: 'folder'` without an existing `folderId`, automatically generate a safe slug via `generateSafeFolderId(label, activeWs.folders)` and push `{ id: folderId, name: label, icon: '📁', color: '#1c69d4', buttons: [] }` into `activeWs.folders`.
- **Cascade Deletion**: In `DELETE_BUTTON`, if the deleted button has `actionType === 'folder'`, recursively discover and remove the target folder and any sub-folders from `activeWs.folders`.
- **Self-Healing Reconciliation**: In `sendClientState`, if a client's `folderStack` references a missing/deleted folder, automatically reset `folderStack: []` and project the root canonical page, preventing blank-screen zombie deadlocks.

### Decision 5: Subsystem Harmonization (Lenses & Steering Paddles)
- **Category Lenses**: When `ws.navState.folderStack.length > 0`, the client UI automatically hides the Category Lens strip (`#categoryLensStrip`), forces `activeLens = 'all'`, and displays the folder breadcrumb header (`#deckBreadcrumb`). On returning to root, previous lens state is restored.
- **Steering Paddles**: In `lib/navigation.js`, `PAGE_PREV` and `PAGE_NEXT` return `current` unchanged if `current.folderStack.length > 0`. In `public/app.js`, paddle buttons are disabled while inside a sub-deck.

---

## 3. Concrete Implementation Blueprint & File Mappings

### 3.1. `lib/config.js`
1. **Extend `ALLOWED_ACTIONS` in `validateButton` (around Line 379)**:
   - Add `'folder'` to `ALLOWED_ACTIONS = ['shell', 'media', 'url', 'folder']`.
   - When `actionType === 'folder'`: validate `folderId` format (`/^f-[a-z0-9_-]{1,62}$/`). Clear `command`, `url`, and `mediaAction`. Default `icon` to `'📁'`.
2. **Implement `generateSafeFolderId(name, existingFolders)` (around Line 580)**:
   - Base on `generateSafeWorkspaceId`: normalize Unicode NFKD, strip diacritics, slugify with `f-` prefix, check prototype collisions (`__proto__`, `constructor`, `toString`), and deduplicate.
3. **Extend `validateWorkspace` (around Line 627)**:
   - Validate optional `workspace.folders: Array<Folder>`.
   - Each folder must have safe `id`, `name` ($\le 64$ chars), `icon` ($\le 16$ chars), valid hex `color`, and `buttons: Array<Button>` capped at $\le 14$ buttons.

### 3.2. `lib/navigation.js`
1. **Extend `NavigationState`**:
   - Add `folderStack: Array<string>` (default `[]`) to `createInitialNavigationState`.
2. **Extend `navigationReducer`**:
   - Define `MAX_FOLDER_DEPTH = 5`.
   - Handle `ENTER_FOLDER`: depth check ($\le 5$), cycle check (`!folderStack.includes(folderId)`), push onto stack.
   - Handle `LEAVE_FOLDER`: pop top element (`folderStack.slice(0, -1)`).
   - In `PAGE_PREV` and `PAGE_NEXT`: return `current` unchanged if `folderStack.length > 0`.
   - In `USER_SELECT`, `CONTEXT_CHANGED`, `WORKSPACE_DELETED`: reset `folderStack: []`.

### 3.3. `lib/ws.js`
1. **Implement `getClientActiveContainer(ws, appConfig)`**:
   - Returns `{ isFolder: boolean, folder: Object|null, page: Object|null, buttons: Array, maxButtons: number }`.
2. **Update `sendClientState`**:
   - Check `ws.navState.folderStack`. If non-empty, lookup folder in `activeWs.folders`.
   - If missing, reset `folderStack: []` and project root page.
   - If valid, synthesize Back button at index 0:
     `{ id: '__back__', isSystem: true, actionType: 'folder_back', label: 'BACK', sublabel: activeWs.name || 'Up', icon: '⬅️', color: '#2a2a2a' }`.
     Project `displayedButtons = [backButton, ...(folder.buttons || []).slice(0, 14)]`.
   - Include `folderStack`, `currentFolderName`, `canGoBack` in payload.
3. **Update `BUTTON_CLICK`**:
   - Resolve button from `getClientActiveContainer(ws, appConfig).buttons`.
   - If `clickId === '__back__'` or `button?.actionType === 'folder_back'`:
     `ws.navState = navigationReducer(ws.navState, { type: 'LEAVE_FOLDER' })`.
     `sendClientState(ws, context, 'NAV_CHANGE')`.
   - If `button?.actionType === 'folder'`:
     `ws.navState = navigationReducer(ws.navState, { type: 'ENTER_FOLDER', folderId: button.folderId })`.
     `sendClientState(ws, context, 'NAV_CHANGE')`.
4. **Update `UPDATE_BUTTON`, `ADD_BUTTON`, `DELETE_BUTTON`, `SET_BUTTONS_COUNT`**:
   - Route through `getClientActiveContainer`.
   - Reject mutations targeting `targetId === '__back__'`.
   - In `ADD_BUTTON`: if in folder and `buttons.length >= 14`, reject with `FOLDER_CAPACITY_REACHED`.
   - In `DELETE_BUTTON`: if deleted button is `actionType === 'folder'`, cascade remove target folder from `activeWs.folders`.
5. **Support top-level `LEAVE_FOLDER` message**:
   - Dispatches `LEAVE_FOLDER` and refreshes state.

### 3.4. `public/index.html` & `public/style.css`
1. **Breadcrumb Header**:
   - Add `#deckBreadcrumb` in `.m-deck-status-bar` with `#btnBreadcrumbBack` and `#breadcrumbPath`.
   - Style with `.m-deck-breadcrumb`, `.m-breadcrumb-back` (touch target $\ge 44$px), ellipsis overflow.
2. **Action Dropdown**:
   - Add `<option value="folder">📁 Folder / Sub-Deck</option>` in `#editActionType`.

### 3.5. `public/app.js`
1. **Handle Sub-Deck State**:
   - In `STATE_UPDATE`, read `data.folderStack`, `data.currentFolderName`, `data.canGoBack`.
   - Update `#deckBreadcrumb` visibility and text.
   - Toggle `#categoryLensStrip` (hide inside folder, show at root).
   - Dim and disable `#btnPagePrev` and `#btnPageNext` while inside folder.
2. **Keypad Rendering**:
   - For `btnData.id === '__back__'` or `btnData.actionType === 'folder_back'`:
     - Exclude `.edit-mode` styling and dashed outlines.
     - Pointerdown always executes `sendButtonClick('__back__')`.
     - Prohibit drag-and-drop drops.

---

## 4. Verification Harness & Reticle Matrix

1. **Unit Tests in `test/navigation.test.js`**:
   - Update existing initial state test fixtures to expect `folderStack: []`.
   - Test `ENTER_FOLDER`, `LEAVE_FOLDER`, `MAX_FOLDER_DEPTH` capping, and cycle rejection.
2. **Comprehensive Integration Suite in `test/folder-navigation.test.js`**:
   - Test folder schema validation in `lib/config.js`.
   - Test WebSocket folder navigation, Back button synthesis, and multi-client isolation.
   - Test mutation containment: adding and deleting buttons in folder does not affect root pages.
   - Test cascade folder deletion and zombie client self-healing.
3. **Reticle v2 Flow Runner (`.reticle/flows/arya-dock-4f274f15/folder-navigation.json`)**:
   - Replay interactive journey: create folder -> enter folder -> verify breadcrumb & Back tile -> add folder button -> click Back tile in edit mode -> verify return to root deck.

---
*Report certified by Pragmatic Tech Lead and Swarm Compiler.*
