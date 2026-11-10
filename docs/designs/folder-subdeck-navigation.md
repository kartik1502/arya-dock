# Folder & Sub-Deck Navigation Engine (Epic E6-1) — Technical Design Document

* **Author:** Karthik Kulkarni
* **Date:** 2026-11-09
* **Status:** EGM Approved Architecture Specification
* **Target Version:** Arya Dock v1.5.0 / Epic E6-1 (Folder & Sub-Deck Navigation Tiles)
* **Verification Harness:** Node.js Unit & Concurrency Test Runner & Reticle v2 Flow Runner
* **Review Synthesis:** [`docs/designs/reviews/folder-navigation/folder_navigation_synthesis_report.md`](./reviews/folder-navigation/folder_navigation_synthesis_report.md)

---

## 1. Problem Statement & Motivation

Arya Dock provides full workspace lifecycle management (Epic E6-2) and responsive dynamic workspace switchers (Epic E6-3). While workspaces allow high-level separation of distinct contexts (e.g. Developer, Media, DevOps Cockpit), power users frequently encounter deck clutter within a single workspace.

In standard physical stream decks (Elgato Stream Deck, Loupedeck, Touch Portal, Companion), users organize related macro sequences and tool groups into **Folders / Sub-Decks**. For example, inside a "Developer" workspace, a developer may want:
- A "Docker Tools" folder containing `up`, `down`, `logs`, `prune`, `exec`, and container status buttons.
- A "Git Workflows" folder containing `commit`, `stash`, `push`, `rebase`, and `pull`.
- A "Kubernetes" folder containing cluster context switches and pod inspectors.

Without folder navigation, users are forced to create numerous top-level workspaces or paginate across multiple workspace pages, losing fast tactile access.

### Acronym Glossary
* **EGM**: Elephant-Goldfish Model (Multi-agent specification audit workflow).
* **PWA**: Progressive Web App (Companion touchscreen client).
* **WS**: WebSocket.
* **UUID / Slug**: Safe alphanumeric identifier for workspaces and folders (`generateSafeFolderId`).
* **LIFO**: Last-In-First-Out breadcrumb navigation stack semantics.

---

## 2. Core Architecture & Invariants

```
+---------------------------------------------------------------------------------------------------+
|                                     WORKSPACE (Schema v2)                                         |
|                                                                                                   |
|   id: 'developer'                                                                                 |
|   name: 'Dev Cockpit'                                                                             |
|                                                                                                   |
|   pages: [                                                                                        |
|     {                                                                                             |
|       name: 'Root Page 1',                                                                        |
|       buttons: [                                                                                  |
|         { id: 0, label: 'Test Suite', actionType: 'shell', ... },                                 |
|         { id: 1, label: 'Docker Tools', actionType: 'folder', folderId: 'f-docker', icon: '📁' }, |
|         { id: 2, label: 'Spotify', actionType: 'media', ... }                                     |
|       ]                                                                                           |
|     }                                                                                             |
|   ]                                                                                               |
|                                                                                                   |
|   folders: [                                                                                      |
|     {                                                                                             |
|       id: 'f-docker',                                                                             |
|       name: 'Docker Tools',                                                                       |
|       icon: '🐳',                                                                                 |
|       color: '#0db7ed',                                                                           |
|       buttons: [                                                                                  |
|         { id: 0, label: 'Compose Up', actionType: 'shell', command: 'docker compose up -d' },     |
|         { id: 1, label: 'Compose Down', actionType: 'shell', command: 'docker compose down' },    |
|         { id: 2, label: 'View Logs', actionType: 'shell', command: 'docker compose logs -f' }     |
|       ]                                                                                           |
|     }                                                                                             |
|   ]                                                                                               |
+---------------------------------------------------------------------------------------------------+
                                            │
               Per-Client WebSocket Navigation State (ws.navState)
                                            │
                                            ▼
+---------------------------------------------------------------------------------------------------+
|                         CLIENT VIEWPORT & KEYPAD GRID (15 Slots Max)                              |
|                                                                                                   |
|  [ Breadcrumb Header (#deckBreadcrumb) ]                                                          |
|    ◀ Dev Cockpit  >  📁 Docker Tools                                                              |
|                                                                                                   |
|  [ 5x3 Grid (15 Tiles Max) ]                                                                      |
|    +-------------------+ +-------------------+ +-------------------+                              |
|    |  [ ⬅️ BACK ]       | |  🐳 Compose Up   | |  🛑 Compose Down  | ...                          |
|    |  (Slot 0: Auto)   | |  (Slot 1: User 0) | |  (Slot 2: User 1) |                              |
|    +-------------------+ +-------------------+ +-------------------+                              |
+---------------------------------------------------------------------------------------------------+
```

### Architectural & Security Invariants:

1. **The 15-Tile Matrix Ceiling Invariant ($1 + 14 = 15$)**:
   The physical grid is strictly capped at $\le 15$ tiles ($5 \times 3$). When inside a folder:
   - **Slot 0** is always reserved for the synthetic/dynamic **`[ ⬅️ BACK ]`** navigation tile (`id: '__back__'`, `actionType: 'folder_back'`, `isSystem: true`).
   - **Slots 1 to 14** (up to 14 buttons) are available for user actions stored on disk with standard integer IDs (`0..13`).
   - Users can never become trapped inside a folder: the Back button is generated unconditionally at runtime.

2. **Edit Mode Immunity for System Back Tile**:
   In `public/app.js`, clicking a tile with `id: '__back__'` or `actionType: 'folder_back'` unconditionally triggers navigation (`sendButtonClick('__back__')`), bypassing `openEditModal` even when Edit Mode is active. On the server in `lib/ws.js`, any mutation targeting `__back__` returns `CANNOT_MUTATE_SYSTEM_BUTTON`.

3. **Per-Client Independent Navigation Stack (LIFO)**:
   In accordance with Epic E1-2 (Per-Client Navigation), navigation state is stored per WebSocket connection (`ws.navState.folderStack: string[]`).
   - Phone A can be inside `Docker Tools` (`folderStack: ['f-docker']`).
   - Tablet B can simultaneously browse the root page (`folderStack: []`).
   - One device entering or leaving a folder has **zero effect** on other companion screens.

4. **Bounded Stack Depth & Anti-Cycle Guard (Anti-DoS)**:
   - Hard maximum nesting ceiling: `MAX_FOLDER_DEPTH = 5`.
   - Cycle prevention: `navigationReducer` rejects pushing any `folderId` already present in `folderStack`.

5. **Unified Container Resolution (`getClientActiveContainer`)**:
   All button mutations (`ADD_BUTTON`, `UPDATE_BUTTON`, `DELETE_BUTTON`, `SET_BUTTONS_COUNT`) and action dispatch (`BUTTON_CLICK`) resolve against `getClientActiveContainer(ws, appConfig)`. Folder mutations operate on `activeFolder.buttons` (capped at 14) and never mutate or splice root workspace pages.

6. **Self-Healing Reconciliation & Cascade Deletion**:
   - Deleting a folder button cascade-removes the folder from `workspace.folders`.
   - If a client's `folderStack` references a missing/deleted folder, `sendClientState` cleanly resets `folderStack: []` and projects the root canonical page, preventing blank-screen lockups.

7. **Subsystem Harmonization**:
   - While `folderStack.length > 0`, the Category Lens strip (`#categoryLensStrip`) is hidden, `activeLens` forced to `'all'`, and steering paddle paging buttons (`btnPagePrev`, `btnPageNext`) disabled. On returning to root, lens visibility is restored.

---

## 3. Schema & Validation Specifications (`lib/config.js`)

### 3.1. Button Schema Extension (`validateButton`)
- `ALLOWED_ACTIONS = ['shell', 'media', 'url', 'folder']`.
- When `actionType === 'folder'`:
  - `folderId`: String matching `/^f-[a-z0-9_-]{1,62}$/`. If omitted, auto-generated via `generateSafeFolderId(label, activeWs.folders)`.
  - Default `icon` is set to `'📁'`.
  - `command`, `url`, and `mediaAction` are cleaned to empty defaults.

### 3.2. Slug Generator (`generateSafeFolderId`)
- Base on `generateSafeWorkspaceId`: normalize Unicode NFKD, strip diacritics, slugify with `f-` prefix, check prototype collisions (`__proto__`, `constructor`, `toString`), and deduplicate against existing folders.

### 3.3. Workspace Schema Extension (`validateWorkspace`)
- Validate optional `workspace.folders: Array<Folder>`.
- Each folder must have:
  - `id`: Unique safe string.
  - `name`: String $\le 64$ characters.
  - `icon`: String $\le 16$ characters, default `'📁'`.
  - `color`: Hex color `#rrggbb`, default `'#1c69d4'`.
  - `buttons`: Array of up to 14 validated buttons.

---

## 4. Navigation Reducer Specification (`lib/navigation.js`)

```typescript
interface NavigationState {
  mode: 'manual' | 'auto';
  workspaceId: string;
  pageIndex: number;
  pinned: boolean;
  folderStack: string[];     // Array of folder IDs, e.g. ['f-docker']
}
```

- Initial state: `folderStack: []`.
- `MAX_FOLDER_DEPTH = 5`.
- **`ENTER_FOLDER`**:
  - If `state.folderStack.length >= MAX_FOLDER_DEPTH` or `state.folderStack.includes(event.folderId)`, return `state` (no-op).
  - Return `{ ...state, mode: 'manual', folderStack: [...state.folderStack, event.folderId] }`.
- **`LEAVE_FOLDER`**:
  - If `state.folderStack.length > 0`, return `{ ...state, folderStack: state.folderStack.slice(0, -1) }`.
- **`PAGE_PREV` / `PAGE_NEXT`**:
  - If `state.folderStack.length > 0`, return `state` (paging disabled in sub-decks).
- **`USER_SELECT` / `SET_WORKSPACE` / `CONTEXT_CHANGED` / `WORKSPACE_DELETED`**:
  - Reset `folderStack: []`.

---

## 5. WebSocket Protocol & Handlers (`lib/ws.js`)

### 5.1. Container Helper (`getClientActiveContainer`)
```javascript
function getClientActiveContainer(ws, appConfig) {
  const activeWs = getClientWorkspace(ws, appConfig);
  const currentFolderId = (ws.navState?.folderStack?.length > 0)
    ? ws.navState.folderStack[ws.navState.folderStack.length - 1]
    : null;
  if (currentFolderId && Array.isArray(activeWs.folders)) {
    const activeFolder = activeWs.folders.find(f => f && f.id === currentFolderId);
    if (activeFolder && Array.isArray(activeFolder.buttons)) {
      return {
        isFolder: true,
        folder: activeFolder,
        buttons: activeFolder.buttons,
        maxButtons: 14,
        workspace: activeWs
      };
    }
    if (ws.navState) ws.navState.folderStack = [];
  }
  const currentPage = getClientCurrentPage(ws, appConfig);
  return {
    isFolder: false,
    folder: null,
    page: currentPage,
    buttons: currentPage?.buttons || [],
    maxButtons: 15,
    workspace: activeWs
  };
}
```

### 5.2. `sendClientState` Projection
When inside a folder:
```javascript
const backButton = {
  id: '__back__',
  label: 'BACK',
  sublabel: activeWs.name || 'Up',
  icon: '⬅️',
  color: '#2a2a2a',
  actionType: 'folder_back',
  isSystem: true
};
displayedButtons = [backButton, ...(activeFolder.buttons || []).slice(0, 14)];
```
Payload includes `folderStack`, `currentFolderName`, `canGoBack`.

### 5.3. Event Handlers
- **`BUTTON_CLICK`**:
  - Check `getClientActiveContainer(ws, appConfig).buttons`.
  - If `clickId === '__back__'` or `button?.actionType === 'folder_back'`:
    Execute `LEAVE_FOLDER`, send updated client state.
  - If `button?.actionType === 'folder'`:
    Execute `ENTER_FOLDER`, send updated client state.
  - Otherwise execute normal action (`shell`, `url`, `media`).
- **`LEAVE_FOLDER`**: Top-level message handler executing stack pop.
- **`UPDATE_BUTTON`**:
  - If `targetId === '__back__'`, reject with `CANNOT_MUTATE_SYSTEM_BUTTON`.
  - If `validation.button.actionType === 'folder'`, auto-provision folder in `activeWs.folders`.
  - Mutate target container buttons.
- **`ADD_BUTTON`**:
  - If in folder and `buttons.length >= 14`, reject with `FOLDER_CAPACITY_REACHED`.
  - Do not paginate root workspace pages when in folder.
- **`DELETE_BUTTON`**:
  - If deleted button has `actionType === 'folder'`, cascade remove target folder.
  - Splice from target container.

---

## 6. Frontend Cockpit UI (`public/app.js`, `public/index.html`, `public/style.css`)

1. **Breadcrumb Header**:
   - `#deckBreadcrumb` with `#btnBreadcrumbBack` and `#breadcrumbPath`.
   - Hidden when at root (`folderStack.length === 0`).
   - Clicking `#btnBreadcrumbBack` sends `{ type: 'LEAVE_FOLDER' }`.
2. **Category Lens Suspension**:
   - When inside a folder, `#categoryLensStrip` hidden, `activeLens` forced to `'all'`.
3. **Keypad Rendering**:
   - For `btnData.id === '__back__'` or `btnData.actionType === 'folder_back'`:
     - Omit `.edit-mode` styling and dashed outlines.
     - Pointerdown always executes `sendButtonClick('__back__')`.
     - Disable drag-and-drop drop targets.

---

## 7. Verification Harness

1. **Unit Tests in `test/navigation.test.js`**:
   - Initial state `folderStack: []`.
   - `ENTER_FOLDER`, `LEAVE_FOLDER`, `MAX_FOLDER_DEPTH`, and cycle prevention tests.
2. **Comprehensive Integration Suite in `test/folder-navigation.test.js`**:
   - Schema validation, WebSocket sub-deck navigation, multi-client isolation, mutation containment, cascade deletion.
3. **Reticle v2 Flow (`.reticle/flows/arya-dock-4f274f15/folder-navigation.json`)**:
   - End-to-end journey verifying folder creation, navigation, edit mode back button bypass, and 15-tile cap assertions.
