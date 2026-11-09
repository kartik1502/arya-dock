# Per-Client Navigation & Independent Companion Screens — Technical Design Document

* **Author:** Karthik Kulkarni
* **Date:** 2026-11-09
* **Status:** Approved Architecture Specification (Post EGM Readiness Verification)
* **Target Version:** Arya Dock v1.2.0 / Epic E1-2
* **Verification Harness:** Node.js Concurrency Test Runner & Reticle v2 Flow Runner

---

## 1. Problem Statement

Arya Dock is deployed across multi-device developer workspaces:
- **Device 1 (Mobile Phone mounted vertically)**: Dedicated developer deck for terminal build commands, git actions, and linter triggers (`developer` workspace).
- **Device 2 (Tablet mounted horizontally)**: Media controls, Spotify/VLC playback, volume sliders, and system telemetry indicators (`media` workspace).
- **Device 3 (Secondary Browser Tab / Pi Touchscreen)**: Monitoring dashboards, custom utilities, or application drawers.

### The Problem in Current Architecture
Currently, navigation state (`navState`) in `server.js` is globally shared across all WebSocket connections:
```javascript
let navState = createInitialNavigationState({ ... });
```
When any client changes page index (`SET_PAGE_INDEX`, `PAGE_NEXT`, `PAGE_PREV`), selects a workspace (`SET_WORKSPACE`), or toggles pin mode (`PIN`, `UNPIN`), `broadcastState` broadcasts that exact navigation state to **all connected clients**. 

### Concrete Operational Failures
1. **Screen Hijacking**: If the user has their tablet viewing media controls and their phone viewing developer commands, tapping "Next Page" on the phone flips the tablet's page too.
2. **Global Pin Collisions**: If the user pins the tablet to `media`, the phone is also locked to `media`, disabling the phone's active-window auto-switching.
3. **Multi-Deck Incoherence**: Power users cannot build dedicated physical stations (e.g. one dedicated audio mixer deck and one dedicated IDE deck).
4. **Button Action Misrouting**: If navigation state were split across sockets without updating `BUTTON_CLICK`, companion clients viewing `media` would execute button slots from the host workstation's `developer` workspace.

---

## 2. Architecture & Solution Design

The **Per-Client Navigation & Independent Companion Screens Engine (Epic E1-2)** transitions navigation state from a single server-wide singleton to **per-connection WebSocket sessions** (`ws.navState`) while preserving global configuration persistence, active window routing, and backwards compatibility.

```
                              ┌────────────────────────────────────────┐
                              │           Workstation Host             │
                              │              (Arya Dock)               │
                              │                                        │
                              │  ActiveWindowWatcher                   │
                              │   └─► emits focus shift ('spotify')    │
                              └──────────────────┬─────────────────────┘
                                                 │
                                                 │ broadcast CONTEXT_CHANGED
                                                 ▼
             ┌───────────────────────────────────┴───────────────────────────────────┐
             │                                                                       │
             ▼                                                                       ▼
┌──────────────────────────┐                                            ┌──────────────────────────┐
│   Companion Client A     │                                            │    Companion Client B    │
│  (Phone - Developer)     │                                            │     (Tablet - Media)     │
├──────────────────────────┤                                            ├──────────────────────────┤
│ ws.navState:             │                                            │ ws.navState:             │
│   workspaceId: 'developer│                                            │   workspaceId: 'media'   │
│   pageIndex: 0           │                                            │   pageIndex: 0           │
│   pinned: false (AUTO)   │                                            │   pinned: true (PINNED)  │
├──────────────────────────┤                                            ├──────────────────────────┤
│ Outcome: Switches to     │                                            │ Outcome: Ignores shift,  │
│ 'media' on focus shift   │                                            │ stays locked on 'media'  │
└──────────────────────────┘                                            └────────────────────────┘
```

### Core Design Principles
1. **Per-Connection Ephemeral State**:
   - Each WebSocket client (`ws`) owns its own `NavigationState` initialized upon connection from URL parameters (`/?workspace=id`) or `appConfig.activeWorkspaceId`.
   - Client navigation actions (`USER_SELECT`, `PAGE_NEXT`, `PAGE_PREV`, `PIN`, `UNPIN`) update only that client's `ws.navState`.
   - On socket close, `ws.navState = null` for zero-leak garbage collection.
2. **Targeted Button Execution Routing**:
   - `BUTTON_CLICK` actions always resolve against the calling client's active workspace and active page (`getClientCurrentPage(ws, appConfig)`), with fallback to the client's workspace button pool (`allButtons`) for virtual category lenses.
3. **Active Window Multi-Cast with Independent Pin Guards**:
   - When workstation focus shifts (e.g. `ActiveWindowWatcher` detects `spotify`), `CONTEXT_CHANGED` is dispatched to every connected client's reducer.
   - `appId` resolves to `workspaceId` via matching rules in `appConfig.workspaces[].match.apps` (using `findWorkspaceForApp`).
   - If Client A is `pinned: true`, Client A ignores the shift.
   - If Client B is `pinned: false` (`mode: 'auto'`), Client B switches to `media`.
4. **Physical Layout Hard Invariant (15-Tile Max)**:
   - Canonical pages delivered by the server are strictly capped at **15 tiles (5×3)**. Virtual category lens chunking remains client-side in `public/app.js`.
5. **Strict Persistence Decoupling**:
   - Companion deck navigation is strictly ephemeral in memory. Disk configuration (`appConfig.activeWorkspaceId` in `profiles.json`) is **only** modified when an authenticated editor (`role: 'editor'`) explicitly saves a default workspace in settings.

---

## 3. Reference Glossary & Definitions

| Term | Definition |
| :--- | :--- |
| **`NavigationState`** | Ephemeral runtime state object: `{ workspaceId: string, pageIndex: number, pinned: boolean, mode: 'auto' | 'manual' }`. |
| **`ws.navState`** | Ephemeral navigation state instance attached directly to a connected `WebSocket` instance. |
| **`sendClientState(ws, context, type)`** | Serializes and sends a personalized `STATE_UPDATE` or `INIT` payload to a specific socket. |
| **`broadcastState(wss, context)`** | Iterates over `wss.clients` and delivers personalized state updates to each socket. |
| **15-Tile Invariant** | Architectural constraint ensuring all deck views never exceed 15 tiles (5 columns × 3 rows). |

---

## 4. Goals & Non-Goals

### 4.1 Goals
1. **Independent Page Flipping**: Client A flipping to Page 2 does not affect Client B on Page 1.
2. **Independent Workspace Navigation**: Client A viewing `media` does not pull Client B away from `developer`.
3. **Independent Pinning**: Client A can pin its workspace (`PINNED`) while Client B remains in `AUTO` mode following active window shifts.
4. **Correct Button Dispatch & Visual Feedback**: Tapping Button X on Client A executes Button X of Client A's workspace and delivers `BUTTON_ACK` immediate visual flash.
5. **Tile Mutation Isolation**: When an editor on a companion screen configures a button, it mutates that client's active workspace.
6. **Workspace Deletion Safety**: Deleting a workspace updates all viewing clients safely to the fallback workspace.
7. **Stateless Reconnection Ergonomics**: Companion devices can specify `/?workspace=media` to reconnect directly into their desired workspace without server session leaks.
8. **Two-Tier Verification**: Verified via native Node.js concurrency tests for multi-client isolation and Reticle v2 for single-client UI indicators.

### 4.2 Non-Goals
1. **Server-Side Session Maps**: No persistent device registries or `Map<deviceId, State>` on the server. State lifecycle is bounded to the socket.
2. **Server-Side Category Lens Projection**: Category lens selection (`activeLens`) remains purely client-side UI state.

---

## 5. Architectural Specification & Protocol Contracts

### 5.1 Per-Socket Navigation Initialization (`lib/ws.js`)
When a WebSocket connection is established in `setupWebSocketServer`:
```javascript
// Parse optional initial workspace from connection URL query parameter (?workspace=media)
const clientUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
const requestedWorkspaceId = clientUrl.searchParams.get('workspace');
const isValidRequested = appConfig.workspaces?.some(w => w.id === requestedWorkspaceId);

const initialWsId = isValidRequested
  ? requestedWorkspaceId
  : (appConfig.activeWorkspaceId || appConfig.workspaces?.[0]?.id || 'developer');

ws.navState = createInitialNavigationState({
  workspaces: appConfig.workspaces,
  initialWorkspaceId: initialWsId,
  mode: 'auto',
  pinned: false
});

ws.on('close', () => {
  ws.navState = null; // Clean up memory immediately
});

// Deliver personalized initial state (INIT) to new client
sendClientState(ws, context, 'INIT');
```

### 5.2 Client State Serialization & Protocol Schema (`sendClientState`)
```javascript
function getClientWorkspace(ws, appConfig) {
  const wsId = ws?.navState?.workspaceId || appConfig.activeWorkspaceId;
  const found = appConfig.workspaces?.find(w => w.id === wsId);
  return found || appConfig.workspaces?.[0] || { id: 'developer', name: 'Dev Cockpit', pages: [] };
}

function getClientCurrentPage(ws, appConfig) {
  const wsObj = getClientWorkspace(ws, appConfig);
  if (!wsObj.pages || wsObj.pages.length === 0) return { buttons: [] };
  let idx = ws?.navState?.pageIndex || 0;
  if (idx >= wsObj.pages.length) idx = 0;
  if (idx < 0) idx = wsObj.pages.length - 1;
  return wsObj.pages[idx];
}

function sendClientState(ws, context, messageType = 'STATE_UPDATE') {
  if (ws.readyState !== WebSocket.OPEN) return;
  const appConfig = context.getConfig();
  const workspace = getClientWorkspace(ws, appConfig);
  const page = getClientCurrentPage(ws, appConfig);
  const navState = ws.navState || {
    workspaceId: workspace.id,
    pageIndex: 0,
    pinned: false,
    mode: 'auto'
  };

  // Safe clamping for out-of-bounds page index
  const safePageIndex = Math.max(0, Math.min(navState.pageIndex, Math.max(0, (workspace.pages?.length || 1) - 1)));
  navState.pageIndex = safePageIndex;

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
      pageIndex: safePageIndex,
      pinned: Boolean(navState.pinned)
    },
    pageNumber: safePageIndex + 1,
    totalPages: workspace.pages?.length || 1,
    pageName: page.name || `Page ${safePageIndex + 1}`,
    buttons: (page.buttons || []).slice(0, 15), // Enforce 15-tile physical limit
    allButtons: (workspace.pages || []).flatMap(p => p.buttons || []),
    role: ws.role,
    canEdit: ws.canEdit
  };

  ws.send(JSON.stringify(payload));
}
```

### 5.3 Broadcast Fan-Out (`broadcastState`)
```javascript
function broadcastState(wss, context) {
  if (!wss || !wss.clients) return;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      sendClientState(client, context, 'STATE_UPDATE');
    }
  });
}
```

### 5.4 Message Handler Routing

#### 1. `BUTTON_CLICK` (Execution Resolution & ACK)
```javascript
case 'BUTTON_CLICK': {
  const clickId = typeof data.buttonId === 'number' ? data.buttonId : parseInt(data.buttonId, 10);
  const activeWs = getClientWorkspace(ws, appConfig);
  const currentPage = getClientCurrentPage(ws, appConfig);

  // 1. Resolve from caller's active canonical page
  let button = currentPage.buttons?.find(b => b.id === clickId);

  // 2. Fallback to caller's workspace button pool (for client-side category lenses)
  if (!button) {
    const allButtons = (activeWs.pages || []).flatMap(p => p.buttons || []);
    button = allButtons.find(b => b.id === clickId);
  }

  if (button) {
    executeAction(button);
    ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: clickId, status: 'ok' }));
  } else {
    console.warn(`[Arya Dock] Button ${clickId} not found on client's workspace ${activeWs.id}`);
  }
  break;
}
```

#### 2. `SET_WORKSPACE`
```javascript
case 'SET_WORKSPACE': {
  const targetId = data.workspaceId;
  const targetWs = appConfig.workspaces?.find(w => w.id === targetId);
  if (!targetWs) {
    ws.send(JSON.stringify({ type: 'ERROR', message: `Workspace '${targetId}' not found` }));
    return;
  }

  const nextNav = navigationReducer(ws.navState, {
    type: 'USER_SELECT',
    workspaceId: targetId,
    pageIndex: 0
  }, {
    workspaces: appConfig.workspaces,
    totalPages: targetWs.pages?.length || 1
  });

  if (nextNav !== ws.navState) {
    ws.navState = nextNav;
    sendClientState(ws, context);
  }
  break;
}
```

#### 3. `PAGE_NEXT` / `PAGE_PREV` / `SET_PAGE_INDEX`
```javascript
case 'PAGE_NEXT':
case 'PAGE_PREV':
case 'SET_PAGE_INDEX': {
  const targetWs = getClientWorkspace(ws, appConfig);
  const totalPages = targetWs.pages?.length || 1;
  const event = data.type === 'SET_PAGE_INDEX'
    ? { type: 'USER_SELECT', workspaceId: ws.navState.workspaceId, pageIndex: data.pageIndex }
    : { type: data.type };

  const nextNav = navigationReducer(ws.navState, event, {
    workspaces: appConfig.workspaces,
    totalPages
  });

  if (nextNav !== ws.navState) {
    ws.navState = nextNav;
    sendClientState(ws, context);
  }
  break;
}
```

#### 4. `PIN` / `UNPIN`
```javascript
case 'PIN':
case 'UNPIN': {
  const targetWs = getClientWorkspace(ws, appConfig);
  const nextNav = navigationReducer(ws.navState, { type: data.type }, {
    workspaces: appConfig.workspaces,
    totalPages: targetWs.pages?.length || 1
  });

  if (nextNav !== ws.navState) {
    ws.navState = nextNav;
    sendClientState(ws, context);
  }
  break;
}
```

#### 5. `WORKSPACE_DELETED` (Multi-Client Fan-Out with Last Workspace Guard)
```javascript
case 'WORKSPACE_DELETED': {
  if (!canEdit) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized' }));
    return;
  }
  if (!Array.isArray(appConfig.workspaces) || appConfig.workspaces.length <= 1) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot delete last remaining workspace' }));
    return;
  }
  const deletedId = data.workspaceId;
  appConfig.workspaces = appConfig.workspaces.filter(w => w.id !== deletedId);
  saveConfig();

  // Fan out to all connected clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.navState) {
      client.navState = navigationReducer(client.navState, {
        type: 'WORKSPACE_DELETED',
        workspaceId: deletedId,
        fallbackWorkspaceId: appConfig.workspaces[0]?.id || 'developer'
      }, {
        workspaces: appConfig.workspaces,
        totalPages: appConfig.workspaces[0]?.pages?.length || 1
      });
      sendClientState(client, context);
    }
  });
  break;
}
```

#### 6. `CONTEXT_CHANGED` (Workstation Active Window Multi-Cast)
In `server.js` watcher callback:
```javascript
const activeWatcher = new ActiveWindowWatcher(platformAdapter, (appId) => {
  if (appId && wsManager?.wss) {
    wsManager.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.navState) {
        const targetWs = getClientWorkspace(client, appConfig);
        const nextNav = navigationReducer(client.navState, {
          type: 'CONTEXT_CHANGED',
          appId
        }, {
          workspaces: appConfig.workspaces,
          totalPages: targetWs.pages?.length || 1,
          findWorkspaceForApp: (workspaces, app) => findWorkspaceForApp(workspaces || appConfig.workspaces, app)
        });

        // Whenever state changed (either workspaceId OR mode auto/manual), push update
        if (nextNav !== client.navState) {
          client.navState = nextNav;
          sendClientState(client, wsContext);
        }
      }
    });
  }
});
```

#### 7. Tile Mutations (`UPDATE_BUTTON`, `ADD_BUTTON`, `DELETE_BUTTON`, `SET_BUTTONS_COUNT`, `TOGGLE_SEGREGATION`)
All editor mutation handlers resolve their target workspace and target page from the calling socket:
```javascript
const activeWs = getClientWorkspace(ws, appConfig);
const activePage = getClientCurrentPage(ws, appConfig);
```
`TOGGLE_SEGREGATION`:
```javascript
case 'TOGGLE_SEGREGATION': {
  if (!canEdit) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized' }));
    return;
  }
  const targetId = data.workspaceId || ws.navState?.workspaceId || appConfig.activeWorkspaceId;
  const targetWs = appConfig.workspaces?.find(w => w.id === targetId);
  if (targetWs) {
    targetWs.segregation = { enabled: Boolean(data.enabled) };
    saveConfig();
    broadcastState(wss, context);
  }
  break;
}
```

### 5.5 Frontend Client Workspace Tapping Freedom (`public/app.js`)
Update `public/app.js` workspace selector and pill click event listeners (lines 969, 1225, 1234) by removing `canEdit &&`. Operators are authorized to switch workspaces on their own deck:
```javascript
btn.addEventListener('click', () => {
  triggerHaptic(20);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: wsItem.id }));
  }
});
```

---

## 6. Security & Persistence Invariants

1. **Remote Navigation Freedom**: Operators (`role: 'operator'`) can freely switch workspaces and pages on their own deck screen. They are only prevented from mutating button definitions (`UPDATE_BUTTON`, `DELETE_BUTTON`, `TOGGLE_SEGREGATION`).
2. **Zero Global Bleed**: A client's navigation changes never dirty `profiles.json` or alter other companion decks.
3. **15-Tile Layout Invariant**: All projected and raw pages sent to any client strictly adhere to `<= 15` tiles.

---

## 7. Two-Tier Verification Plan

### 7.1 Tier 1: Node.js Native Multi-Socket Concurrency Suite (`test/per-client-navigation.test.js`)
1. **Isolation Test**: Connect Client A and Client B. Client A switches to `media` and advances to Page 2. Client B remains on `developer` Page 1.
2. **Button Execution Test**: Client A on `media` clicks Button 0 -> executes media volume action. Client B on `developer` clicks Button 0 -> executes developer shell action.
3. **Multi-Cast Active Window Test**: Client A is pinned; Client B is unpinned. Host active window shifts to `code`. Client B auto-switches to `developer`; Client A stays on `media`.
4. **Workspace Deletion Test**: Editor deletes workspace `media`. Client A viewing `media` transitions to fallback workspace `developer` without error.

### 7.2 Tier 2: Reticle v2 Single-Session In-App Flow (`.reticle/flows/arya-dock-4f274f15/companion-deck-state.json`)
- Step 1: Click `#btnPinWorkspace` -> expect `#navStatusBadge` text contains `PINNED`.
- Step 2: Click `#btnModeM2` -> expect `#deckStatusPage` text contains `PAGE 1`.
- Step 3: Click `#btnPinWorkspace` -> expect `#navStatusBadge` text contains `AUTO`.
