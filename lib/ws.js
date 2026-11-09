const WebSocket = require('ws');
const { isAllowedOrigin, safeEqual, getRole } = require('./auth');
const { getNetworkInterfaces } = require('./network');
const { validateButton, MAX_BUTTONS_PER_PAGE = 15, countGraphemes, generateSafeWorkspaceId, generateSafeFolderId } = require('./config');
const { executeAction } = require('./terminal');
const { createInitialNavigationState, navigationReducer } = require('./navigation');
const {
  generateCuratedWorkspaces,
  detectHostEcosystem,
  ALLOWED_STARTER_IDS
} = require('./presets');

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafePropertyKey(key) {
  return typeof key === 'string' && key.length > 0 && !DANGEROUS_KEYS.has(key);
}

function getClientWorkspace(ws, appConfig) {
  const wsId = ws?.navState?.workspaceId || appConfig.activeWorkspaceId;
  if (isSafePropertyKey(wsId)) {
    const found = appConfig.workspaces?.find(w => w && w.id === wsId);
    if (found) return found;
  }
  return appConfig.workspaces?.[0] || { id: 'developer', name: 'Dev Cockpit', pages: [] };
}

function getClientCurrentPage(ws, appConfig) {
  const wsObj = getClientWorkspace(ws, appConfig);
  if (!wsObj.pages || wsObj.pages.length === 0) return { buttons: [] };
  let idx = ws?.navState?.pageIndex || 0;
  if (idx >= wsObj.pages.length) idx = 0;
  if (idx < 0) idx = wsObj.pages.length - 1;
  return wsObj.pages[idx];
}

function getClientActiveContainer(ws, appConfig) {
  const activeWs = getClientWorkspace(ws, appConfig);
  const currentFolderId = (ws?.navState?.folderStack?.length > 0)
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
    // Folder not found - self-heal orphaned client navigation stack
    if (ws && ws.navState) ws.navState.folderStack = [];
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

function cascadeDeleteFolder(workspace, folderId, wss) {
  if (!workspace || !Array.isArray(workspace.folders) || !folderId) return;
  const fIdx = workspace.folders.findIndex(f => f && f.id === folderId);
  if (fIdx === -1) return;
  const targetFolder = workspace.folders[fIdx];
  workspace.folders.splice(fIdx, 1);

  // Recursively cascade delete any nested folders referenced inside this folder
  if (Array.isArray(targetFolder.buttons)) {
    for (const btn of targetFolder.buttons) {
      if (btn && btn.actionType === 'folder' && btn.folderId) {
        cascadeDeleteFolder(workspace, btn.folderId, wss);
      }
    }
  }

  // Reconcile any connected clients inside this folder back to root
  if (wss && wss.clients) {
    for (const client of wss.clients) {
      if (client.navState && Array.isArray(client.navState.folderStack) && client.navState.folderStack.includes(folderId)) {
        client.navState.folderStack = [];
      }
    }
  }
}

function sendClientState(ws, context, messageType = 'STATE_UPDATE') {
  if (ws.readyState !== WebSocket.OPEN) return;
  const appConfig = context.getConfig();
  const workspace = getClientWorkspace(ws, appConfig);
  const page = getClientCurrentPage(ws, appConfig);
  const container = getClientActiveContainer(ws, appConfig);
  const navState = ws.navState || (context.getNavState ? context.getNavState() : {
    workspaceId: workspace.id,
    pageIndex: 0,
    pinned: false,
    mode: 'auto',
    folderStack: []
  });

  const safePageIndex = Math.max(0, Math.min(navState.pageIndex || 0, Math.max(0, (workspace.pages?.length || 1) - 1)));
  navState.pageIndex = safePageIndex;

  let displayedButtons = [];
  let currentFolderName = null;
  const canGoBack = Boolean(ws?.navState?.folderStack?.length > 0);

  if (container.isFolder) {
    currentFolderName = container.folder.name;
    const backButton = {
      id: '__back__',
      label: 'BACK',
      sublabel: workspace.name || 'Up',
      icon: '⬅️',
      color: '#2a2a2a',
      actionType: 'folder_back',
      isSystem: true
    };
    displayedButtons = [backButton, ...container.buttons.slice(0, 14)];
  } else {
    displayedButtons = (page.buttons || []).slice(0, 15);
  }

  const payload = {
    type: messageType,
    // Workspace first-class fields
    workspaceId: workspace.id || appConfig.activeWorkspaceId || appConfig.activeProfile,
    workspaceName: workspace.name,
    workspaceIcon: workspace.icon || '⚡',
    segregation: workspace.segregation || { enabled: false },
    workspaces: (appConfig.workspaces || []).map(w => ({
      id: w.id,
      name: w.name,
      icon: w.icon || '⚡',
      origin: w.origin || 'user',
      segregation: w.segregation || { enabled: false },
      match: w.match || { apps: [] }
    })),
    // Navigation state
    navigation: {
      mode: navState.mode || (navState.pinned ? 'manual' : 'auto'),
      workspaceId: navState.workspaceId,
      pageIndex: safePageIndex,
      pinned: Boolean(navState.pinned),
      folderStack: navState.folderStack || []
    },
    folderStack: navState.folderStack || [],
    currentFolderName,
    canGoBack,
    // Backwards-compatible profile properties
    profiles: (appConfig.workspaces || Object.entries(appConfig.profiles || {}).map(([id, p]) => ({ id, name: p.name }))).map(w => ({ id: w.id, name: w.name })),
    activeProfileId: workspace.id || appConfig.activeProfile,
    profileName: workspace.name,
    pageNumber: container.isFolder ? 1 : safePageIndex + 1,
    totalPages: container.isFolder ? 1 : (workspace.pages ? workspace.pages.length : 1),
    pageName: container.isFolder ? currentFolderName : (page.name || `Page ${safePageIndex + 1}`),
    buttons: displayedButtons,
    allButtons: (workspace.pages || []).flatMap(p => Array.isArray(p.buttons) ? p.buttons : []),
    role: ws.role,
    canEdit: ws.canEdit,
    onboardingCompleted: Boolean(appConfig.onboardingCompleted)
  };

  ws.send(JSON.stringify(payload));
}

/**
 * Broadcast current profile/page state to all connected WebSocket clients.
 */
function broadcastState(wss, context) {
  if (!wss || !wss.clients) return;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      sendClientState(client, context, 'STATE_UPDATE');
    }
  }
}

/**
 * Distribute tiles to subsequent pages with capacity (< MAX_BUTTONS_PER_PAGE),
 * dynamically creating new pages as needed.
 */
function distributeTilesToSubsequentPages(activeWs, startIdx, buttonsToMigrate, placeholdersToAdd, defaultColors) {
  let migrateIdx = 0;
  let remainingPlaceholders = placeholdersToAdd;

  function getNextTile(targetButtons) {
    if (migrateIdx < buttonsToMigrate.length) {
      const tile = { ...buttonsToMigrate[migrateIdx++] };
      const seen = new Set(targetButtons.map(b => b.id));
      if (seen.has(tile.id)) {
        const validIds = targetButtons.map(b => (typeof b.id === 'number' && Number.isInteger(b.id) ? b.id : -1));
        tile.id = validIds.length > 0 ? Math.max(...validIds, -1) + 1 : 0;
      }
      return tile;
    }
    if (remainingPlaceholders > 0) {
      remainingPlaceholders--;
      const validIds = targetButtons.map(b => (typeof b.id === 'number' && Number.isInteger(b.id) ? b.id : -1));
      const newId = validIds.length > 0 ? Math.max(...validIds, -1) + 1 : 0;
      return {
        id: newId,
        label: `KEY ${newId + 1}`,
        sublabel: 'EMPTY',
        icon: '◻️',
        color: defaultColors[targetButtons.length % defaultColors.length],
        actionType: 'shell',
        command: '',
        terminalMode: 'background',
        workingDir: '',
        keepOpen: true,
        url: ''
      };
    }
    return null;
  }

  // 1. Distribute into existing subsequent pages with available capacity
  for (let p = startIdx + 1; p < activeWs.pages.length; p++) {
    const subPage = activeWs.pages[p];
    if (subPage) {
      if (!Array.isArray(subPage.buttons)) subPage.buttons = [];
      while (subPage.buttons.length < MAX_BUTTONS_PER_PAGE) {
        if (migrateIdx >= buttonsToMigrate.length && remainingPlaceholders <= 0) break;
        const nextTile = getNextTile(subPage.buttons);
        if (!nextTile) break;
        subPage.buttons.push(nextTile);
      }
    }
    if (migrateIdx >= buttonsToMigrate.length && remainingPlaceholders <= 0) break;
  }

  // 2. Create dynamic new pages for any remaining tiles
  while (migrateIdx < buttonsToMigrate.length || remainingPlaceholders > 0) {
    const newPageNumber = activeWs.pages.length + 1;
    const newPage = {
      pageNumber: newPageNumber,
      name: `Page ${newPageNumber}`,
      buttons: []
    };
    activeWs.pages.push(newPage);
    while (newPage.buttons.length < MAX_BUTTONS_PER_PAGE) {
      if (migrateIdx >= buttonsToMigrate.length && remainingPlaceholders <= 0) break;
      const nextTile = getNextTile(newPage.buttons);
      if (!nextTile) break;
      newPage.buttons.push(nextTile);
    }
  }
}

/**
 * Set up WebSocket server, upgrade authentication, and message dispatch.
 */
function setupWebSocketServer(server, context) {
  const {
    credentials,
    getConfig,
    saveConfig,
    getActiveWorkspace,
    getActiveProfile,
    getCurrentPage,
    getNavState,
    dispatchNav,
    getPageIndex,
    setPageIndex,
    mockClientIp = null,
    host = '0.0.0.0'
  } = context;

  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let reqUrl;
    try {
      reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (e) {
      socket.write('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nBad Request\r\n');
      socket.destroy();
      return;
    }

    const pathname = reqUrl.pathname;
    if (pathname !== '/' && pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nNot Found\r\n');
      socket.destroy();
      return;
    }

    // Origin Check
    const interfaces = getNetworkInterfaces();
    const allowedIps = interfaces.map(i => i.address);
    if (host && host !== '0.0.0.0') {
      allowedIps.push(host);
    }

    if (!isAllowedOrigin(req.headers.origin, req.headers.host, allowedIps)) {
      console.warn(`[Arya Dock] Rejected WebSocket upgrade with disallowed Origin: ${req.headers.origin}`);
      socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nForbidden Origin\r\n');
      socket.destroy();
      return;
    }

    // Pairing Secret / Token Check
    const token = reqUrl.searchParams.get('token') || req.headers['x-pairing-token'];
    if (!token || !safeEqual(token, credentials.pairingToken)) {
      console.warn(`[Arya Dock] Rejected unauthenticated WebSocket connection attempt from ${socket.remoteAddress}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized\r\n');
      socket.destroy();
      return;
    }

    // Determine Role
    const clientIp = mockClientIp || socket.remoteAddress;
    const editKey = req.headers['x-editor-key'];
    const role = getRole(clientIp, editKey, credentials.editorKey);

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { role });
    });
  });

  wss.on('connection', (ws, req, extra = {}) => {
    const clientIp = mockClientIp || req.socket.remoteAddress;
    ws.role = extra.role || 'operator';
    ws.canEdit = ws.role === 'editor';
    ws.isAlive = true;

    console.log(`[Arya Dock] Client connected from ${clientIp} (Role: ${ws.role})`);

    if (typeof context.onClientConnect === 'function') {
      context.onClientConnect(wss.clients.size);
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const appConfig = getConfig();
    let initialWsId = (getActiveWorkspace ? getActiveWorkspace()?.id : null) || appConfig.activeWorkspaceId || (appConfig.workspaces?.[0]?.id) || 'developer';
    if (req && req.url) {
      try {
        const clientUrl = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
        const requestedWorkspaceId = clientUrl.searchParams.get('workspace');
        if (requestedWorkspaceId && appConfig.workspaces?.some(w => w.id === requestedWorkspaceId)) {
          initialWsId = requestedWorkspaceId;
        }
      } catch (e) {
        // Ignore URL parsing errors
      }
    }

    ws.navState = createInitialNavigationState({
      workspaces: appConfig.workspaces,
      initialWorkspaceId: initialWsId,
      mode: 'auto',
      pinned: false
    });

    sendClientState(ws, context, 'INIT');

    ws.on('message', async (message) => {
      ws.isAlive = true;
      try {
        const data = JSON.parse(message);
        const appConfig = getConfig();

        switch (data.type) {
          case 'BUTTON_CLICK': {
            const clickId = data.buttonId !== undefined ? data.buttonId : (data.button?.id !== undefined ? data.button.id : data.id);
            const container = getClientActiveContainer(ws, appConfig);

            // Back button click (either by sentinel id or actionType)
            if (clickId === '__back__' || data.actionType === 'folder_back') {
              if (ws.navState) {
                ws.navState = navigationReducer(ws.navState, { type: 'LEAVE_FOLDER' });
              }
              sendClientState(ws, context, 'NAV_CHANGE');
              ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: '__back__', status: 'ok' }));
              break;
            }

            // 1. Resolve from caller's active container (folder or current page)
            let button = container.buttons?.find(b => b && b.id === clickId);

            // 2. Fallback to caller's workspace button pool (if not in a folder)
            if (!button && !container.isFolder) {
              const allButtons = (container.workspace?.pages || []).flatMap(p => Array.isArray(p.buttons) ? p.buttons : []);
              button = allButtons.find(b => b && b.id === clickId);
            }

            if (button) {
              if (button.actionType === 'folder') {
                if (ws.navState) {
                  ws.navState = navigationReducer(ws.navState, { type: 'ENTER_FOLDER', folderId: button.folderId });
                }
                sendClientState(ws, context, 'NAV_CHANGE');
                ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: clickId, status: 'ok' }));
                break;
              }
              if (button.actionType === 'folder_back') {
                if (ws.navState) {
                  ws.navState = navigationReducer(ws.navState, { type: 'LEAVE_FOLDER' });
                }
                sendClientState(ws, context, 'NAV_CHANGE');
                ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: clickId, status: 'ok' }));
                break;
              }
              executeAction(button);
              ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: clickId, status: 'ok' }));
            } else {
              console.warn(`[Arya Dock] Button ${clickId} not found on client's workspace ${container.workspace?.id}`);
            }
            break;
          }

          case 'LEAVE_FOLDER': {
            if (ws.navState) {
              ws.navState = navigationReducer(ws.navState, { type: 'LEAVE_FOLDER' });
            }
            sendClientState(ws, context, 'NAV_CHANGE');
            break;
          }

          case 'PAGE_PREV': {
            const activeWs = getClientWorkspace(ws, appConfig);
            const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
            if (ws.navState) {
              const nextNav = navigationReducer(ws.navState, { type: 'PAGE_PREV' }, {
                workspaces: appConfig.workspaces,
                totalPages
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
              }
            }
            if (ws.canEdit && dispatchNav) {
              dispatchNav({ type: 'PAGE_PREV', totalPages });
            }
            sendClientState(ws, context, 'STATE_UPDATE');
            break;
          }

          case 'PAGE_NEXT': {
            const activeWs = getClientWorkspace(ws, appConfig);
            const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
            if (ws.navState) {
              const nextNav = navigationReducer(ws.navState, { type: 'PAGE_NEXT' }, {
                workspaces: appConfig.workspaces,
                totalPages
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
              }
            }
            if (ws.canEdit && dispatchNav) {
              dispatchNav({ type: 'PAGE_NEXT', totalPages });
            }
            sendClientState(ws, context, 'STATE_UPDATE');
            break;
          }

          case 'SET_PAGE_INDEX': {
            const activeWs = getClientWorkspace(ws, appConfig);
            const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
            const targetIdx = typeof data.pageIndex === 'number' ? data.pageIndex : 0;
            if (ws.navState) {
              const nextNav = navigationReducer(ws.navState, {
                type: 'USER_SELECT',
                workspaceId: ws.navState.workspaceId,
                pageIndex: targetIdx
              }, {
                workspaces: appConfig.workspaces,
                totalPages
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
              }
            }
            if (ws.canEdit && setPageIndex) {
              setPageIndex(targetIdx);
            }
            sendClientState(ws, context, 'STATE_UPDATE');
            break;
          }

          case 'PIN': {
            const activeWs = getClientWorkspace(ws, appConfig);
            const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
            if (ws.navState) {
              const nextNav = navigationReducer(ws.navState, { type: 'PIN' }, {
                workspaces: appConfig.workspaces,
                totalPages
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
              }
            }
            if (ws.canEdit && dispatchNav) {
              dispatchNav({ type: 'PIN' });
            }
            sendClientState(ws, context, 'STATE_UPDATE');
            break;
          }

          case 'UNPIN': {
            const activeWs = getClientWorkspace(ws, appConfig);
            const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
            if (ws.navState) {
              const nextNav = navigationReducer(ws.navState, { type: 'UNPIN' }, {
                workspaces: appConfig.workspaces,
                totalPages
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
              }
            }
            if (ws.canEdit && dispatchNav) {
              dispatchNav({ type: 'UNPIN' });
            }
            sendClientState(ws, context, 'STATE_UPDATE');
            break;
          }

          case 'TOGGLE_PIN': {
            const activeWs = getClientWorkspace(ws, appConfig);
            const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
            const currentPinned = ws.navState ? ws.navState.pinned : (getNavState ? getNavState().pinned : false);
            const targetType = currentPinned ? 'UNPIN' : 'PIN';
            if (ws.navState) {
              const nextNav = navigationReducer(ws.navState, { type: targetType }, {
                workspaces: appConfig.workspaces,
                totalPages
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
              }
            }
            if (ws.canEdit && dispatchNav) {
              dispatchNav({ type: targetType });
            }
            sendClientState(ws, context, 'STATE_UPDATE');
            break;
          }

          case 'CONTEXT_CHANGED': {
            if (dispatchNav) {
              dispatchNav({
                type: 'CONTEXT_CHANGED',
                appId: data.appId,
                matchedWorkspaceId: data.matchedWorkspaceId || data.workspaceId
              });
            }
            if (ws.navState) {
              const activeWs = getClientWorkspace(ws, appConfig);
              const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
              const nextNav = navigationReducer(ws.navState, {
                type: 'CONTEXT_CHANGED',
                appId: data.appId,
                matchedWorkspaceId: data.matchedWorkspaceId || data.workspaceId
              }, {
                workspaces: appConfig.workspaces,
                totalPages,
                findWorkspaceForApp: (workspaces, app) => {
                  if (typeof app === 'string') {
                    return findWorkspaceForApp(workspaces || appConfig.workspaces, app);
                  }
                  return findWorkspaceForApp(appConfig.workspaces, workspaces);
                }
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
                sendClientState(ws, context, 'STATE_UPDATE');
              }
            } else {
              broadcastState(wss, context);
            }
            break;
          }

          case 'COMPLETE_ONBOARDING': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted COMPLETE_ONBOARDING`);
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'EDITOR_REQUIRED',
                message: 'Unauthorized: editor privilege required',
                action: 'COMPLETE_ONBOARDING'
              }));
              return;
            }

            appConfig.onboardingCompleted = true;
            saveConfig();
            broadcastState(wss, context);
            break;
          }

          case 'APPLY_STARTER_WORKSPACES': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted APPLY_STARTER_WORKSPACES`);
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'EDITOR_REQUIRED',
                message: 'Unauthorized: editor privilege required',
                action: 'APPLY_STARTER_WORKSPACES'
              }));
              return;
            }

            const rawIds = Array.isArray(data.workspaceIds) ? data.workspaceIds : ['developer'];
            const selectedIds = rawIds.filter(id => ALLOWED_STARTER_IDS.includes(id));
            if (selectedIds.length === 0) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'INVALID_PAYLOAD',
                message: 'At least one valid workspaceId must be specified'
              }));
              return;
            }

            const mode = (typeof data.mode === 'string') ? data.mode.toLowerCase() : 'replace';
            let detected = {};
            try {
              detected = await detectHostEcosystem();
            } catch (_) {}

            const starterWorkspaces = generateCuratedWorkspaces(selectedIds, detected);
            let nextWorkspaces = [];
            if (mode === 'merge') {
              nextWorkspaces = Array.isArray(appConfig.workspaces) ? [...appConfig.workspaces] : [];
              for (const sw of starterWorkspaces) {
                const existingIdx = nextWorkspaces.findIndex(w => w.id === sw.id);
                if (existingIdx !== -1) {
                  nextWorkspaces[existingIdx] = sw;
                } else {
                  nextWorkspaces.push(sw);
                }
              }
            } else {
              nextWorkspaces = starterWorkspaces;
            }

            const nextConfig = {
              ...appConfig,
              onboardingCompleted: true,
              activeWorkspaceId: nextWorkspaces[0] ? nextWorkspaces[0].id : 'developer',
              workspaces: nextWorkspaces
            };

            if (typeof context.onImportConfig === 'function') {
              try {
                await context.onImportConfig(nextConfig);
              } catch (err) {
                ws.send(JSON.stringify({ type: 'ERROR', code: 'INTERNAL_ERROR', message: err.message }));
              }
            } else {
              appConfig.onboardingCompleted = true;
              appConfig.workspaces = nextWorkspaces;
              appConfig.activeWorkspaceId = nextConfig.activeWorkspaceId;
              saveConfig();
              broadcastState(wss, context);
            }
            break;
          }

          case 'CREATE_WORKSPACE': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted CREATE_WORKSPACE`);
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'EDITOR_REQUIRED',
                message: 'Unauthorized: editor privilege required',
                action: 'CREATE_WORKSPACE'
              }));
              return;
            }

            const rawName = typeof data.name === 'string' ? data.name.trim() : '';
            if (!rawName || rawName.length > 64) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'INVALID_NAME',
                message: 'Workspace name must be a non-empty string up to 64 characters'
              }));
              return;
            }

            let icon = '⚡';
            if (typeof data.icon === 'string' && data.icon.trim().length > 0) {
              const trimmedIcon = data.icon.trim();
              const graphemeCount = countGraphemes(trimmedIcon);
              if (graphemeCount < 1 || graphemeCount > 2) {
                ws.send(JSON.stringify({
                  type: 'ERROR',
                  code: 'INVALID_ICON',
                  message: 'Workspace icon must be 1 to 2 grapheme clusters'
                }));
                return;
              }
              icon = trimmedIcon;
            }

            let matchApps = [];
            if (Array.isArray(data.matchApps)) {
              matchApps = data.matchApps
                .filter(a => typeof a === 'string' && a.trim().length > 0)
                .map(a => a.trim().toLowerCase());
            }

            if (!Array.isArray(appConfig.workspaces)) {
              appConfig.workspaces = [];
            }

            const newId = generateSafeWorkspaceId(rawName, appConfig.workspaces);
            const newWs = {
              id: newId,
              name: rawName,
              icon,
              origin: 'user',
              segregation: { enabled: false },
              match: { apps: matchApps },
              pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }]
            };

            appConfig.workspaces.push(newWs);

            if (!appConfig.profiles || typeof appConfig.profiles !== 'object') {
              appConfig.profiles = {};
            }
            appConfig.profiles[newId] = {
              name: newWs.name,
              icon: newWs.icon,
              segregation: newWs.segregation,
              pages: newWs.pages,
              origin: newWs.origin,
              match: newWs.match
            };

            console.log(`[Arya Dock] [MUTATION] Client from ${clientIp} created workspace ${newId} (${rawName})`);

            if (dispatchNav) {
              dispatchNav({ type: 'USER_SELECT', workspaceId: newId, pageIndex: 0 });
            }

            if (ws.navState) {
              ws.navState = navigationReducer(ws.navState, { type: 'USER_SELECT', workspaceId: newId, pageIndex: 0 }, {
                workspaces: appConfig.workspaces,
                totalPages: 1
              });
            }

            saveConfig(true);
            broadcastState(wss, context);
            break;
          }

          case 'UPDATE_WORKSPACE': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted UPDATE_WORKSPACE`);
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'EDITOR_REQUIRED',
                message: 'Unauthorized: editor privilege required',
                action: 'UPDATE_WORKSPACE'
              }));
              return;
            }

            const targetId = data.workspaceId;
            if (!isSafePropertyKey(targetId)) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'INVALID_WORKSPACE_ID',
                message: 'Invalid workspace id'
              }));
              return;
            }

            if (!Array.isArray(appConfig.workspaces)) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'WORKSPACE_NOT_FOUND',
                message: 'Workspace not found'
              }));
              return;
            }

            const targetWs = appConfig.workspaces.find(w => w && w.id === targetId);
            if (!targetWs) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'WORKSPACE_NOT_FOUND',
                message: 'Workspace not found'
              }));
              return;
            }

            if (data.name !== undefined) {
              const rawName = typeof data.name === 'string' ? data.name.trim() : '';
              if (!rawName || rawName.length > 64) {
                ws.send(JSON.stringify({
                  type: 'ERROR',
                  code: 'INVALID_NAME',
                  message: 'Workspace name must be a non-empty string up to 64 characters'
                }));
                return;
              }
              targetWs.name = rawName;
            }

            if (data.icon !== undefined) {
              const rawIcon = typeof data.icon === 'string' ? data.icon.trim() : '';
              if (rawIcon.length > 0) {
                const graphemeCount = countGraphemes(rawIcon);
                if (graphemeCount < 1 || graphemeCount > 2) {
                  ws.send(JSON.stringify({
                    type: 'ERROR',
                    code: 'INVALID_ICON',
                    message: 'Workspace icon must be 1 to 2 grapheme clusters'
                  }));
                  return;
                }
                targetWs.icon = rawIcon;
              }
            }

            if (data.matchApps !== undefined) {
              if (!Array.isArray(data.matchApps)) {
                ws.send(JSON.stringify({
                  type: 'ERROR',
                  code: 'INVALID_MATCH_APPS',
                  message: 'Workspace matchApps must be an array of application names'
                }));
                return;
              }
              targetWs.match = {
                apps: data.matchApps
                  .filter(a => typeof a === 'string' && a.trim().length > 0)
                  .map(a => a.trim().toLowerCase())
              };
            }

            if (appConfig.profiles && typeof appConfig.profiles === 'object') {
              appConfig.profiles[targetId] = {
                name: targetWs.name,
                icon: targetWs.icon,
                segregation: targetWs.segregation || { enabled: false },
                pages: targetWs.pages,
                origin: targetWs.origin,
                match: targetWs.match
              };
            }

            console.log(`[Arya Dock] [MUTATION] Client from ${clientIp} updated workspace ${targetId}`);

            saveConfig(true);
            broadcastState(wss, context);
            break;
          }

          case 'WORKSPACE_DELETED': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted WORKSPACE_DELETED`);
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'EDITOR_REQUIRED',
                message: 'Unauthorized: editor privilege required',
                action: 'WORKSPACE_DELETED'
              }));
              return;
            }
            const delWsId = data.workspaceId;
            if (!isSafePropertyKey(delWsId)) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'INVALID_WORKSPACE_ID',
                message: 'Invalid workspace id'
              }));
              return;
            }
            if (!Array.isArray(appConfig.workspaces) || appConfig.workspaces.length <= 1) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'CANNOT_DELETE_LAST_WORKSPACE',
                message: 'Cannot delete the last remaining workspace'
              }));
              return;
            }
            const wsIdx = appConfig.workspaces.findIndex(w => w && w.id === delWsId);
            if (wsIdx === -1) {
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'WORKSPACE_NOT_FOUND',
                message: 'Workspace not found'
              }));
              return;
            }
            const targetWs = appConfig.workspaces[wsIdx];
            if (targetWs && targetWs.origin === 'builtin') {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} attempted to delete built-in workspace ${delWsId}`);
              ws.send(JSON.stringify({
                type: 'ERROR',
                code: 'BUILTIN_IMMUTABLE',
                message: 'Built-in workspaces cannot be deleted'
              }));
              return;
            }

            console.log(`[Arya Dock] [MUTATION] Client from ${clientIp} deleted workspace ${delWsId}`);
            appConfig.workspaces.splice(wsIdx, 1);
            if (appConfig.profiles && Object.prototype.hasOwnProperty.call(appConfig.profiles, delWsId)) {
              delete appConfig.profiles[delWsId];
            }

            const fallbackWsId = data.fallbackWorkspaceId || appConfig.workspaces[0]?.id || 'developer';
            if (dispatchNav) {
              dispatchNav({
                type: 'WORKSPACE_DELETED',
                workspaceId: delWsId,
                fallbackWorkspaceId: fallbackWsId
              });
            }

            saveConfig(true);

            // Multi-client fan-out: update every connected socket
            for (const client of wss.clients) {
              if (client.readyState === WebSocket.OPEN) {
                if (client.navState) {
                  const clientWs = getClientWorkspace(client, appConfig);
                  client.navState = navigationReducer(client.navState, {
                    type: 'WORKSPACE_DELETED',
                    workspaceId: delWsId,
                    fallbackWorkspaceId: fallbackWsId
                  }, {
                    workspaces: appConfig.workspaces,
                    totalPages: clientWs?.pages?.length || 1
                  });
                }
                sendClientState(client, context, 'STATE_UPDATE');
              }
            }
            break;
          }

          case 'AUTH_EDIT': {
            if (data.editKey && safeEqual(data.editKey, credentials.editorKey)) {
              ws.role = 'editor';
              ws.canEdit = true;
              console.log(`[Arya Dock] Client from ${clientIp} elevated to editor role`);
              ws.send(JSON.stringify({ type: 'ROLE_UPDATE', role: 'editor', canEdit: true }));
            } else {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid editor key' }));
            }
            break;
          }

          case 'SET_WORKSPACE': {
            const targetId = data.workspaceId || data.id;
            if (!isSafePropertyKey(targetId)) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid workspace id' }));
              return;
            }
            const foundWs = (Array.isArray(appConfig.workspaces) && appConfig.workspaces.find(w => w && w.id === targetId)) ||
                          (appConfig.profiles && Object.prototype.hasOwnProperty.call(appConfig.profiles, targetId) ? appConfig.profiles[targetId] : null);
            if (!foundWs || typeof foundWs !== 'object' || foundWs === Object.prototype) {
              ws.send(JSON.stringify({ type: 'ERROR', message: `Workspace '${targetId}' not found` }));
              return;
            }
            console.log(`[Arya Dock] Client from ${clientIp} changed workspace to ${targetId}`);
            if (ws.navState) {
              const nextNav = navigationReducer(ws.navState, {
                type: 'USER_SELECT',
                workspaceId: targetId,
                pageIndex: 0
              }, {
                workspaces: appConfig.workspaces,
                totalPages: (foundWs.pages && foundWs.pages.length > 0) ? foundWs.pages.length : 1
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
              }
            }
            if (ws.canEdit) {
              if (dispatchNav) {
                dispatchNav({ type: 'USER_SELECT', workspaceId: targetId });
              }
              appConfig.activeWorkspaceId = targetId;
              appConfig.activeProfile = targetId;
              saveConfig();
            }
            sendClientState(ws, context, 'STATE_UPDATE');
            break;
          }

          case 'SET_PROFILE': {
            const targetId = data.profileId || data.id || data.workspaceId;
            if (!isSafePropertyKey(targetId)) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid profile id' }));
              return;
            }
            const found = (Array.isArray(appConfig.workspaces) && appConfig.workspaces.find(w => w && w.id === targetId)) ||
                          (appConfig.profiles && Object.prototype.hasOwnProperty.call(appConfig.profiles, targetId) ? appConfig.profiles[targetId] : null);
            if (!found || typeof found !== 'object' || found === Object.prototype) {
              ws.send(JSON.stringify({ type: 'ERROR', message: `Profile '${targetId}' not found` }));
              return;
            }
            console.log(`[Arya Dock] Client from ${clientIp} changed profile to ${targetId}`);
            if (ws.navState) {
              const nextNav = navigationReducer(ws.navState, {
                type: 'USER_SELECT',
                workspaceId: targetId,
                pageIndex: 0
              }, {
                workspaces: appConfig.workspaces,
                totalPages: (found.pages && found.pages.length > 0) ? found.pages.length : 1
              });
              if (nextNav !== ws.navState) {
                ws.navState = nextNav;
              }
            }
            if (ws.canEdit) {
              if (dispatchNav) {
                dispatchNav({ type: 'USER_SELECT', workspaceId: targetId });
              }
              appConfig.activeWorkspaceId = targetId;
              appConfig.activeProfile = targetId;
              saveConfig();
            }
            sendClientState(ws, context, 'STATE_UPDATE');
            break;
          }

          case 'TOGGLE_SEGREGATION': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted TOGGLE_SEGREGATION`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }
            const targetId = data.workspaceId || ws.navState?.workspaceId || (getActiveWorkspace ? getActiveWorkspace()?.id : null) || appConfig.activeWorkspaceId;
            if (!isSafePropertyKey(targetId)) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid workspace id' }));
              return;
            }
            const targetWs = Array.isArray(appConfig.workspaces)
              ? appConfig.workspaces.find(w => w && w.id === targetId)
              : null;
            if (!targetWs || typeof targetWs !== 'object' || targetWs === Object.prototype) {
              ws.send(JSON.stringify({ type: 'ERROR', message: `Workspace '${targetId}' not found` }));
              return;
            }
            const enabled = Boolean(data.enabled);
            targetWs.segregation = { enabled };
            console.log(`[Arya Dock] [MUTATION] Client from ${clientIp} toggled segregation to ${enabled} on workspace ${targetId}`);
            saveConfig();
            broadcastState(wss, context);
            break;
          }

          case 'UPDATE_BUTTON': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted UPDATE_BUTTON`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }
            if (!data.button || typeof data.button !== 'object' || Array.isArray(data.button)) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Button payload must be a non-null object' }));
              return;
            }

            const rawTargetId = (data.button.id !== undefined) ? data.button.id : (data.buttonId !== undefined ? data.buttonId : data.id);
            if (rawTargetId === '__back__' || rawTargetId === 'back' || data.button.actionType === 'folder_back') {
              ws.send(JSON.stringify({ type: 'ERROR', code: 'CANNOT_MUTATE_SYSTEM_BUTTON', message: 'System navigation tile cannot be edited or deleted' }));
              return;
            }

            const targetId = rawTargetId;
            if (targetId === undefined || targetId === null || typeof targetId !== 'number' || !Number.isInteger(targetId) || targetId < 0) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Valid button id is required for update' }));
              return;
            }

            const container = getClientActiveContainer(ws, appConfig);
            const idx = container.buttons.findIndex(b => b && b.id === targetId);
            if (idx === -1) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Button not found' }));
              return;
            }

            const existingButton = container.buttons[idx];
            let buttonPayload = { ...data.button };
            if (buttonPayload.actionType === 'folder' && !buttonPayload.folderId) {
              buttonPayload.folderId = generateSafeFolderId(buttonPayload.label || 'folder', container.workspace.folders);
            }

            const validation = validateButton(buttonPayload, {
              isUpdate: true,
              existingId: targetId,
              existingButton
            });

            if (!validation.valid) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Invalid button update from ${clientIp}: ${validation.error}`);
              ws.send(JSON.stringify({ type: 'ERROR', message: validation.error }));
              return;
            }

            // Auto-provision or update folder in workspace.folders if actionType === 'folder'
            if (validation.button.actionType === 'folder') {
              if (!Array.isArray(container.workspace.folders)) {
                container.workspace.folders = [];
              }
              let targetFolder = container.workspace.folders.find(f => f && f.id === validation.button.folderId);
              if (!targetFolder) {
                targetFolder = {
                  id: validation.button.folderId,
                  name: validation.button.label || 'New Folder',
                  icon: validation.button.icon || '📁',
                  color: validation.button.color || '#1c69d4',
                  buttons: []
                };
                container.workspace.folders.push(targetFolder);
              } else {
                targetFolder.name = validation.button.label || targetFolder.name;
                targetFolder.icon = validation.button.icon || targetFolder.icon;
                targetFolder.color = validation.button.color || targetFolder.color;
              }
            }

            console.log(`[Arya Dock] [MUTATION] Client ${clientIp} updated button ${validation.button.id} ('${validation.button.label}')`);
            container.buttons[idx] = validation.button;
            saveConfig();
            broadcastState(wss, context);
            break;
          }

          case 'ADD_BUTTON': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted ADD_BUTTON`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }

            const container = getClientActiveContainer(ws, appConfig);
            if (container.isFolder) {
              if (container.buttons.length >= 14) {
                ws.send(JSON.stringify({
                  type: 'ERROR',
                  code: 'FOLDER_CAPACITY_REACHED',
                  message: 'Folders are limited to 14 buttons (1 Back tile + 14 action tiles)'
                }));
                return;
              }

              const validIds = container.buttons.map(b => (b && typeof b.id === 'number' && Number.isInteger(b.id) ? b.id : -1));
              const newId = validIds.length > 0 ? Math.max(...validIds, -1) + 1 : 0;
              let rawButton = (data && data.button && typeof data.button === 'object' && !Array.isArray(data.button))
                ? { ...data.button }
                : {};

              if (rawButton.actionType === 'folder' && !rawButton.folderId) {
                rawButton.folderId = generateSafeFolderId(rawButton.label || 'folder', container.workspace.folders);
              }

              const validation = validateButton(rawButton, { repair: true, defaultId: newId });
              if (validation.valid) {
                if (validation.button.actionType === 'folder') {
                  if (!Array.isArray(container.workspace.folders)) container.workspace.folders = [];
                  let targetFolder = container.workspace.folders.find(f => f && f.id === validation.button.folderId);
                  if (!targetFolder) {
                    targetFolder = {
                      id: validation.button.folderId,
                      name: validation.button.label || 'New Folder',
                      icon: validation.button.icon || '📁',
                      color: validation.button.color || '#1c69d4',
                      buttons: []
                    };
                    container.workspace.folders.push(targetFolder);
                  }
                }
                container.buttons.push(validation.button);
                saveConfig();
                broadcastState(wss, context);
              }
              break;
            }

            const activeWs = container.workspace;
            if (!activeWs.pages || !Array.isArray(activeWs.pages) || activeWs.pages.length === 0) {
              activeWs.pages = [{ pageNumber: 1, name: 'Page 1', buttons: [] }];
            }

            const currentNavState = ws.navState || (getNavState ? getNavState() : null);
            const currentIdx = currentNavState ? currentNavState.pageIndex : (getPageIndex ? getPageIndex() : 0);
            const clampedCurrentIdx = Math.max(0, Math.min(currentIdx, activeWs.pages.length - 1));

            const activePage = activeWs.pages[clampedCurrentIdx];
            if (!Array.isArray(activePage.buttons)) {
              activePage.buttons = [];
            }

            // Determine target page and whether overflow is required
            let targetPageIndex = clampedCurrentIdx;
            let needsNewPage = false;

            if (activePage.buttons.length >= MAX_BUTTONS_PER_PAGE) {
              let foundSubsequentIndex = -1;
              for (let i = clampedCurrentIdx + 1; i < activeWs.pages.length; i++) {
                const subPage = activeWs.pages[i];
                if (subPage) {
                  if (!Array.isArray(subPage.buttons)) subPage.buttons = [];
                  if (subPage.buttons.length < MAX_BUTTONS_PER_PAGE) {
                    foundSubsequentIndex = i;
                    break;
                  }
                }
              }

              if (foundSubsequentIndex !== -1) {
                targetPageIndex = foundSubsequentIndex;
              } else {
                needsNewPage = true;
                targetPageIndex = activeWs.pages.length;
              }
            }

            // Compute prospective ID on target page
            let prospectiveTargetButtons = [];
            if (!needsNewPage) {
              const targetCandidate = activeWs.pages[targetPageIndex];
              prospectiveTargetButtons = Array.isArray(targetCandidate?.buttons) ? targetCandidate.buttons : [];
            }
            const validIds = prospectiveTargetButtons
              .map(b => (b && typeof b.id === 'number' && Number.isInteger(b.id) ? b.id : -1));
            const newId = validIds.length > 0 ? Math.max(...validIds, -1) + 1 : 0;

            // Validate button BEFORE performing any mutations on workspace pages or navigation
            const defaultButton = {
              id: newId,
              label: `KEY ${newId + 1}`,
              sublabel: 'SHORTCUT',
              icon: '⚡',
              color: '#1c69d4',
              actionType: 'shell',
              command: ''
            };

            const rawButton = data.button;
            let candidatePayload;
            if (rawButton && typeof rawButton === 'object' && !Array.isArray(rawButton)) {
              candidatePayload = { ...rawButton, id: newId };
            } else if (rawButton !== undefined && rawButton !== null) {
              candidatePayload = rawButton;
            } else {
              candidatePayload = defaultButton;
            }

            const validation = validateButton(candidatePayload, { defaultId: newId });
            if (!validation.valid) {
              ws.send(JSON.stringify({ type: 'ERROR', message: validation.error }));
              return;
            }

            // Validation passed! Now commit workspace modifications
            let targetPage;
            if (needsNewPage) {
              const newPageNumber = activeWs.pages.length + 1;
              targetPage = {
                pageNumber: newPageNumber,
                name: `Page ${newPageNumber}`,
                buttons: []
              };
              activeWs.pages.push(targetPage);
            } else {
              targetPage = activeWs.pages[targetPageIndex];
              if (!Array.isArray(targetPage.buttons)) {
                targetPage.buttons = [];
              }
            }

            if (targetPageIndex !== clampedCurrentIdx) {
              if (typeof setPageIndex === 'function') {
                setPageIndex(targetPageIndex);
              } else if (dispatchNav) {
                const wsId = activeWs.id || (currentNavState ? currentNavState.workspaceId : undefined);
                dispatchNav({ type: 'USER_SELECT', workspaceId: wsId, pageIndex: targetPageIndex });
              }
              if (currentNavState) {
                currentNavState.pageIndex = targetPageIndex;
              }
            }

            validation.button.id = newId;
            console.log(`[Arya Dock] [MUTATION] Client ${clientIp} added button ${newId} ('${validation.button.label}')`);
            targetPage.buttons.push(validation.button);
            saveConfig();
            broadcastState(wss, context);
            break;
          }

          case 'DELETE_BUTTON': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted DELETE_BUTTON`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }

            const delId = data.buttonId !== undefined ? data.buttonId : (data.button?.id !== undefined ? data.button.id : data.id);
            if (delId === '__back__' || delId === 'back') {
              ws.send(JSON.stringify({ type: 'ERROR', code: 'CANNOT_MUTATE_SYSTEM_BUTTON', message: 'System navigation tile cannot be edited or deleted' }));
              return;
            }

            const container = getClientActiveContainer(ws, appConfig);
            if (container.isFolder) {
              const idx = container.buttons.findIndex(b => b && b.id === delId);
              if (idx === -1) {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Button not found' }));
                return;
              }
              const deletedButton = container.buttons[idx];
              console.log(`[Arya Dock] [MUTATION] Client ${clientIp} deleted button ${delId} in folder ${container.folder.id}`);
              container.buttons.splice(idx, 1);

              if (deletedButton && deletedButton.actionType === 'folder' && deletedButton.folderId) {
                cascadeDeleteFolder(container.workspace, deletedButton.folderId, wss);
              }

              saveConfig();
              broadcastState(wss, context);
              break;
            }

            const activeWs = container.workspace;
            if (!activeWs.pages || !Array.isArray(activeWs.pages) || activeWs.pages.length === 0) {
              activeWs.pages = [{ pageNumber: 1, name: 'Page 1', buttons: [] }];
            }

            const currentNavState = ws.navState || (getNavState ? getNavState() : null);
            const currentIdx = currentNavState ? currentNavState.pageIndex : (getPageIndex ? getPageIndex() : 0);
            const clampedCurrentIdx = Math.max(0, Math.min(currentIdx, activeWs.pages.length - 1));
            const page = activeWs.pages[clampedCurrentIdx];
            if (!Array.isArray(page.buttons)) {
              page.buttons = [];
            }

            const idx = page.buttons.findIndex(b => b.id === delId);
            if (idx === -1) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Button not found' }));
              return;
            }

            const deletedButton = page.buttons[idx];
            console.log(`[Arya Dock] [MUTATION] Client ${clientIp} deleted button ${delId}`);
            page.buttons.splice(idx, 1);

            if (deletedButton && deletedButton.actionType === 'folder' && deletedButton.folderId) {
              cascadeDeleteFolder(activeWs, deletedButton.folderId, wss);
            }

            if (page.buttons.length === 0) {
              if (activeWs.pages.length > 1) {
                activeWs.pages.splice(clampedCurrentIdx, 1);
                activeWs.pages.forEach((p, pIdx) => {
                  p.pageNumber = pIdx + 1;
                  if (!p.name || /^Page \d+$/i.test(p.name)) {
                    p.name = `Page ${pIdx + 1}`;
                  }
                });
                const targetPageIndex = Math.max(0, Math.min(clampedCurrentIdx - 1, activeWs.pages.length - 1));
                if (typeof setPageIndex === 'function') {
                  setPageIndex(targetPageIndex);
                }
                if (dispatchNav) {
                  const wsId = activeWs.id || (currentNavState ? currentNavState.workspaceId : undefined);
                  dispatchNav({ type: 'USER_SELECT', workspaceId: wsId, pageIndex: targetPageIndex });
                }
                if (currentNavState) {
                  currentNavState.pageIndex = targetPageIndex;
                }
              } else {
                page.buttons = [];
              }
            }

            if (Array.isArray(appConfig.workspaces)) {
              const syncedProfiles = {};
              const reservedKeys = new Set(['__proto__', 'constructor', 'prototype']);
              for (const wsItem of appConfig.workspaces) {
                if (wsItem && wsItem.id && !reservedKeys.has(wsItem.id)) {
                  syncedProfiles[wsItem.id] = {
                    name: wsItem.name,
                    icon: wsItem.icon,
                    pages: wsItem.pages,
                    origin: wsItem.origin,
                    match: wsItem.match
                  };
                }
              }
              appConfig.profiles = syncedProfiles;
            }

            saveConfig();
            broadcastState(wss, context);
            break;
          }

          case 'SET_BUTTONS_COUNT': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted SET_BUTTONS_COUNT`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }

            const container = getClientActiveContainer(ws, appConfig);
            if (container.isFolder) {
              const parsedCount = parseInt(data.count, 10);
              const folderTargetCount = Math.max(0, Math.min(Number.isNaN(parsedCount) ? 8 : parsedCount, 14));
              const currentCount = container.buttons.length;
              const defaultColors = ['#0066b1', '#1c69d4', '#e22718', '#2b2b2b'];

              if (currentCount > folderTargetCount) {
                const discarded = container.buttons.slice(folderTargetCount);
                const hasConfigured = discarded.some(b => (b.command && b.command.trim()) || (b.url && b.url.trim()) || (b.label && !/^KEY\s*\d+$/i.test(b.label.trim())));
                if (hasConfigured && !data.force) {
                  ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot reduce tile count: removed buttons contain configured actions. Pass force: true to confirm.' }));
                  return;
                }
                container.folder.buttons = container.buttons.slice(0, folderTargetCount);
              } else {
                for (let i = currentCount; i < folderTargetCount; i++) {
                  const validIds = container.folder.buttons.map(b => (b && typeof b.id === 'number' && Number.isInteger(b.id) ? b.id : -1));
                  const newId = validIds.length > 0 ? Math.max(...validIds, -1) + 1 : 0;
                  container.folder.buttons.push({
                    id: newId,
                    label: `KEY ${newId + 1}`,
                    sublabel: 'EMPTY',
                    icon: '◻️',
                    color: defaultColors[i % defaultColors.length],
                    actionType: 'shell',
                    command: '',
                    terminalMode: 'background',
                    workingDir: '',
                    keepOpen: true,
                    url: ''
                  });
                }
              }
              saveConfig();
              broadcastState(wss, context);
              break;
            }

            const activeWs = container.workspace;
            if (!activeWs.pages || !Array.isArray(activeWs.pages) || activeWs.pages.length === 0) {
              activeWs.pages = [{ pageNumber: 1, name: 'Page 1', buttons: [] }];
            }

            const currentNavState = ws.navState || (getNavState ? getNavState() : null);
            const currentIdx = currentNavState ? currentNavState.pageIndex : (getPageIndex ? getPageIndex() : 0);
            const clampedCurrentIdx = Math.max(0, Math.min(currentIdx, activeWs.pages.length - 1));
            const page = activeWs.pages[clampedCurrentIdx];
            if (!Array.isArray(page.buttons)) {
              page.buttons = [];
            }

            const parsedCount = parseInt(data.count, 10);
            const rawTargetCount = Math.max(1, Number.isNaN(parsedCount) ? 9 : parsedCount);
            const currentCount = page.buttons.length;
            const defaultColors = ['#0066b1', '#1c69d4', '#e22718', '#2b2b2b'];

            // The active page can have at most MAX_BUTTONS_PER_PAGE (15)
            const pageTargetCount = Math.min(rawTargetCount, MAX_BUTTONS_PER_PAGE);
            const requestedExcess = Math.max(0, rawTargetCount - MAX_BUTTONS_PER_PAGE);

            if (currentCount > pageTargetCount) {
              // Active page has buttons beyond pageTargetCount
              const extraButtons = page.buttons.slice(pageTargetCount);
              const buttonsToMigrate = extraButtons.slice(0, requestedExcess);
              const buttonsToDiscard = extraButtons.slice(requestedExcess);

              const hasConfigured = buttonsToDiscard.some(b => (b.command && b.command.trim()) || (b.url && b.url.trim()) || (b.label && !/^KEY\s*\d+$/i.test(b.label.trim())));
              if (hasConfigured && !data.force) {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot reduce tile count: removed buttons contain configured actions. Pass force: true to confirm.' }));
                return;
              }

              page.buttons = page.buttons.slice(0, pageTargetCount);
              const remainingExcessNeeded = requestedExcess - buttonsToMigrate.length;
              distributeTilesToSubsequentPages(activeWs, clampedCurrentIdx, buttonsToMigrate, remainingExcessNeeded, defaultColors);
            } else {
              // Fill active page up to pageTargetCount
              for (let i = currentCount; i < pageTargetCount; i++) {
                const validIds = page.buttons.map(b => (b && typeof b.id === 'number' && Number.isInteger(b.id) ? b.id : -1));
                const newId = validIds.length > 0 ? Math.max(...validIds, -1) + 1 : 0;
                page.buttons.push({
                  id: newId,
                  label: `KEY ${newId + 1}`,
                  sublabel: 'EMPTY',
                  icon: '◻️',
                  color: defaultColors[i % defaultColors.length],
                  actionType: 'shell',
                  command: '',
                  terminalMode: 'background',
                  workingDir: '',
                  keepOpen: true,
                  url: ''
                });
              }

              if (requestedExcess > 0) {
                distributeTilesToSubsequentPages(activeWs, clampedCurrentIdx, [], requestedExcess, defaultColors);
              }
            }

            console.log(`[Arya Dock] [MUTATION] Client ${clientIp} adjusted tile count to ${rawTargetCount}`);
            saveConfig();
            broadcastState(wss, context);
            break;
          }

          case 'PING': {
            ws.send(JSON.stringify({ type: 'PONG' }));
            break;
          }
        }
      } catch (e) {
        console.error('[Arya Dock] WebSocket message error:', e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[Arya Dock] Client disconnected (${clientIp})`);
      if (typeof context.onClientDisconnect === 'function') {
        context.onClientDisconnect(wss.clients.size);
      }
    });
  });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return {
    wss,
    broadcastState: () => broadcastState(wss, context),
    close: () => {
      clearInterval(heartbeatInterval);
      for (const client of wss.clients) {
        try { client.terminate(); } catch (e) {}
      }
    }
  };
}

module.exports = {
  setupWebSocketServer,
  broadcastState,
  sendClientState,
  getClientWorkspace,
  getClientCurrentPage
};
