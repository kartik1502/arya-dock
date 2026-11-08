const WebSocket = require('ws');
const { isAllowedOrigin, safeEqual, getRole } = require('./auth');
const { getNetworkInterfaces } = require('./network');
const { validateButton } = require('./config');
const { executeAction } = require('./terminal');

/**
 * Broadcast current profile/page state to all connected WebSocket clients.
 */
function broadcastState(wss, context) {
  const {
    getActiveWorkspace,
    getActiveProfile,
    getCurrentPage,
    getPageIndex,
    getNavState,
    getConfig
  } = context;
  const appConfig = getConfig();
  const workspace = getActiveWorkspace ? getActiveWorkspace() : getActiveProfile();
  const page = getCurrentPage();
  const pageIndex = getPageIndex ? getPageIndex() : 0;
  const navState = getNavState ? getNavState() : {
    mode: 'manual',
    workspaceId: appConfig.activeWorkspaceId || workspace.id || appConfig.activeProfile,
    pageIndex,
    pinned: false
  };

  const basePayload = {
    type: 'STATE_UPDATE',
    // Workspace first-class fields
    workspaceId: workspace.id || appConfig.activeWorkspaceId || appConfig.activeProfile,
    workspaceName: workspace.name,
    workspaceIcon: workspace.icon || '⚡',
    workspaces: (appConfig.workspaces || []).map(w => ({
      id: w.id,
      name: w.name,
      icon: w.icon || '⚡',
      origin: w.origin || 'user'
    })),
    // Navigation state
    navigation: {
      mode: navState.mode,
      workspaceId: navState.workspaceId,
      pageIndex: navState.pageIndex,
      pinned: navState.pinned
    },
    // Backwards-compatible profile properties
    activeProfileId: workspace.id || appConfig.activeProfile,
    profileName: workspace.name,
    pageNumber: navState.pageIndex + 1,
    totalPages: workspace.pages ? workspace.pages.length : 1,
    pageName: page.name || `Page ${navState.pageIndex + 1}`,
    buttons: page.buttons || []
  };

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        ...basePayload,
        role: client.role,
        canEdit: client.canEdit
      }));
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

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const appConfig = getConfig();
    const workspace = getActiveWorkspace ? getActiveWorkspace() : getActiveProfile();
    const page = getCurrentPage();
    const pageIndex = getPageIndex ? getPageIndex() : 0;
    const navState = getNavState ? getNavState() : {
      mode: 'manual',
      workspaceId: appConfig.activeWorkspaceId || workspace.id || appConfig.activeProfile,
      pageIndex,
      pinned: false
    };

    ws.send(JSON.stringify({
      type: 'INIT',
      workspaceId: workspace.id || appConfig.activeWorkspaceId || appConfig.activeProfile,
      workspaceName: workspace.name,
      workspaceIcon: workspace.icon || '⚡',
      workspaces: (appConfig.workspaces || []).map(w => ({
        id: w.id,
        name: w.name,
        icon: w.icon || '⚡',
        origin: w.origin || 'user'
      })),
      navigation: {
        mode: navState.mode,
        workspaceId: navState.workspaceId,
        pageIndex: navState.pageIndex,
        pinned: navState.pinned
      },
      profiles: (appConfig.workspaces || Object.entries(appConfig.profiles || {}).map(([id, p]) => ({ id, name: p.name }))).map(w => ({ id: w.id, name: w.name })),
      activeProfileId: workspace.id || appConfig.activeProfile,
      pageNumber: navState.pageIndex + 1,
      totalPages: workspace.pages ? workspace.pages.length : 1,
      pageName: page.name || `Page ${navState.pageIndex + 1}`,
      buttons: page.buttons || [],
      role: ws.role,
      canEdit: ws.canEdit
    }));

    ws.on('message', (message) => {
      ws.isAlive = true;
      try {
        const data = JSON.parse(message);
        const appConfig = getConfig();

        switch (data.type) {
          case 'BUTTON_CLICK': {
            const page = getCurrentPage();
            const clickId = data.buttonId !== undefined ? data.buttonId : (data.button?.id !== undefined ? data.button.id : data.id);
            const button = page.buttons.find(b => b.id === clickId);
            if (button) {
              executeAction(button);
              ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: clickId, status: 'ok' }));
            }
            break;
          }

          case 'PAGE_PREV': {
            if (dispatchNav) {
              const activeWs = getActiveWorkspace ? getActiveWorkspace() : getActiveProfile();
              const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
              dispatchNav({ type: 'PAGE_PREV', totalPages });
            } else {
              const profile = getActiveProfile();
              const currentIdx = getPageIndex();
              setPageIndex((currentIdx - 1 + profile.pages.length) % profile.pages.length);
            }
            broadcastState(wss, context);
            break;
          }

          case 'PAGE_NEXT': {
            if (dispatchNav) {
              const activeWs = getActiveWorkspace ? getActiveWorkspace() : getActiveProfile();
              const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0) ? activeWs.pages.length : 1;
              dispatchNav({ type: 'PAGE_NEXT', totalPages });
            } else {
              const profile = getActiveProfile();
              const currentIdx = getPageIndex();
              setPageIndex((currentIdx + 1) % profile.pages.length);
            }
            broadcastState(wss, context);
            break;
          }

          case 'PIN': {
            if (dispatchNav) {
              dispatchNav({ type: 'PIN' });
              broadcastState(wss, context);
            }
            break;
          }

          case 'UNPIN': {
            if (dispatchNav) {
              dispatchNav({ type: 'UNPIN' });
              broadcastState(wss, context);
            }
            break;
          }

          case 'TOGGLE_PIN': {
            if (dispatchNav && getNavState) {
              const nav = getNavState();
              dispatchNav({ type: nav.pinned ? 'UNPIN' : 'PIN' });
              broadcastState(wss, context);
            }
            break;
          }

          case 'CONTEXT_CHANGED': {
            if (dispatchNav) {
              const before = getNavState ? getNavState() : null;
              const after = dispatchNav({
                type: 'CONTEXT_CHANGED',
                appId: data.appId,
                matchedWorkspaceId: data.matchedWorkspaceId || data.workspaceId
              });
              if (after !== before) {
                broadcastState(wss, context);
              }
            }
            break;
          }

          case 'WORKSPACE_DELETED': {
            if (dispatchNav) {
              dispatchNav({
                type: 'WORKSPACE_DELETED',
                workspaceId: data.workspaceId,
                fallbackWorkspaceId: data.fallbackWorkspaceId
              });
              broadcastState(wss, context);
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
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted SET_WORKSPACE`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }
            const targetId = data.workspaceId || data.id;
            const foundWs = (appConfig.workspaces && appConfig.workspaces.find(w => w.id === targetId)) ||
                          (appConfig.profiles && Object.prototype.hasOwnProperty.call(appConfig.profiles, targetId));
            if (!foundWs) {
              ws.send(JSON.stringify({ type: 'ERROR', message: `Workspace '${targetId}' not found` }));
              return;
            }
            console.log(`[Arya Dock] [MUTATION] Client from ${clientIp} changed workspace to ${targetId}`);
            if (dispatchNav) {
              dispatchNav({ type: 'USER_SELECT', workspaceId: targetId });
            }
            appConfig.activeWorkspaceId = targetId;
            appConfig.activeProfile = targetId;
            saveConfig();
            broadcastState(wss, context);
            break;
          }

          case 'SET_PROFILE': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted SET_PROFILE`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }
            const targetId = data.profileId || data.id || data.workspaceId;
            const found = (appConfig.workspaces && appConfig.workspaces.find(w => w.id === targetId)) ||
                          (appConfig.profiles && Object.prototype.hasOwnProperty.call(appConfig.profiles, targetId));
            if (!found) {
              ws.send(JSON.stringify({ type: 'ERROR', message: `Profile '${targetId}' not found` }));
              return;
            }
            console.log(`[Arya Dock] [MUTATION] Client from ${clientIp} changed profile to ${targetId}`);
            if (dispatchNav) {
              dispatchNav({ type: 'USER_SELECT', workspaceId: targetId });
            }
            appConfig.activeWorkspaceId = targetId;
            appConfig.activeProfile = targetId;
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

            const targetId = (data.button.id !== undefined) ? data.button.id : (data.buttonId !== undefined ? data.buttonId : data.id);
            if (targetId === undefined || targetId === null || typeof targetId !== 'number' || !Number.isInteger(targetId) || targetId < 0) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Valid button id is required for update' }));
              return;
            }

            const page = getCurrentPage();
            const idx = page.buttons.findIndex(b => b.id === targetId);
            if (idx === -1) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Button not found' }));
              return;
            }

            const existingButton = page.buttons[idx];
            const validation = validateButton(data.button, {
              isUpdate: true,
              existingId: targetId,
              existingButton
            });

            if (!validation.valid) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Invalid button update from ${clientIp}: ${validation.error}`);
              ws.send(JSON.stringify({ type: 'ERROR', message: validation.error }));
              return;
            }

            console.log(`[Arya Dock] [MUTATION] Client ${clientIp} updated button ${validation.button.id} ('${validation.button.label}')`);
            page.buttons[idx] = validation.button;
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
            const page = getCurrentPage();
            if (page.buttons.length >= 24) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Maximum tile limit (24) reached' }));
              return;
            }
            const newId = page.buttons.length > 0 ? Math.max(...page.buttons.map(b => b.id)) + 1 : 0;
            const validation = validateButton(data.button || {
              id: newId,
              label: `KEY ${newId + 1}`,
              sublabel: 'SHORTCUT',
              icon: '⚡',
              color: '#1c69d4',
              actionType: 'shell',
              command: ''
            });

            if (!validation.valid) {
              ws.send(JSON.stringify({ type: 'ERROR', message: validation.error }));
              return;
            }

            validation.button.id = newId;
            console.log(`[Arya Dock] [MUTATION] Client ${clientIp} added button ${newId} ('${validation.button.label}')`);
            page.buttons.push(validation.button);
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
            const page = getCurrentPage();
            if (page.buttons.length <= 1) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot delete the last remaining button' }));
              return;
            }
            const delId = data.buttonId !== undefined ? data.buttonId : (data.button?.id !== undefined ? data.button.id : data.id);
            const idx = page.buttons.findIndex(b => b.id === delId);
            if (idx !== -1) {
              console.log(`[Arya Dock] [MUTATION] Client ${clientIp} deleted button ${delId}`);
              page.buttons.splice(idx, 1);
              saveConfig();
              broadcastState(wss, context);
            } else {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Button not found' }));
            }
            break;
          }

          case 'SET_BUTTONS_COUNT': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted SET_BUTTONS_COUNT`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }
            const page = getCurrentPage();
            const parsedCount = parseInt(data.count, 10);
            const targetCount = Math.max(1, Math.min(24, Number.isNaN(parsedCount) ? 9 : parsedCount));
            const currentCount = page.buttons.length;
            if (targetCount > currentCount) {
              const defaultColors = ['#0066b1', '#1c69d4', '#e22718', '#2b2b2b'];
              for (let i = currentCount; i < targetCount; i++) {
                const newId = page.buttons.length > 0 ? Math.max(...page.buttons.map(b => b.id)) + 1 : 0;
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
            } else if (targetCount < currentCount) {
              const toRemove = page.buttons.slice(targetCount);
              const hasConfigured = toRemove.some(b => (b.command && b.command.trim()) || (b.url && b.url.trim()) || (b.label && !/^KEY\s*\d+$/i.test(b.label.trim())));
              if (hasConfigured && !data.force) {
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot reduce tile count: removed buttons contain configured actions. Pass force: true to confirm.' }));
                return;
              }
              page.buttons = page.buttons.slice(0, targetCount);
            }
            console.log(`[Arya Dock] [MUTATION] Client ${clientIp} adjusted tile count to ${targetCount}`);
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
  broadcastState
};
