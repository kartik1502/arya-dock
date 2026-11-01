const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const qrcode = require('qrcode-terminal');

const {
  loadConfig,
  saveConfigAtomic,
  validateButton,
  DEFAULT_CONFIG_PATH,
  DEFAULT_EXAMPLE_PATH
} = require('./lib/config');

const {
  safeEqual,
  loadOrCreateAuth,
  isAllowedOrigin,
  isLocalAddress,
  getRole
} = require('./lib/auth');

const {
  getDefaultShell,
  getDefaultTerminal,
  executeAction
} = require('./lib/terminal');

const {
  getInstalledApplications,
  getSuggestedProjectDirs
} = require('./lib/apps');

const { getNetworkInterfaces } = require('./lib/network');

const PORT = parseInt(process.env.PORT, 10) || 3333;
const HOST = process.env.HOST || '0.0.0.0';
const CONFIG_PATH = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;
const AUTH_PATH = process.env.AUTH_PATH || path.join(__dirname, 'config', 'auth.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function createServer(options = {}) {
  const configPath = options.configPath || CONFIG_PATH;
  const authPath = options.authPath || AUTH_PATH;
  const publicDir = options.publicDir || PUBLIC_DIR;

  const credentials = loadOrCreateAuth(authPath);
  let appConfig = loadConfig(configPath, DEFAULT_EXAMPLE_PATH);
  let currentPageIndex = 0;

  function saveConfig() {
    try {
      saveConfigAtomic(configPath, appConfig);
    } catch (err) {
      console.error('[Arya Dock] Failed to save config:', err.message);
    }
  }

  function getActiveProfile() {
    const pId = appConfig.activeProfile || 'developer';
    return appConfig.profiles[pId] || Object.values(appConfig.profiles)[0];
  }

  function getCurrentPage() {
    const profile = getActiveProfile();
    if (!profile.pages || profile.pages.length === 0) return { buttons: [] };
    if (currentPageIndex >= profile.pages.length) currentPageIndex = 0;
    if (currentPageIndex < 0) currentPageIndex = profile.pages.length - 1;
    return profile.pages[currentPageIndex];
  }

  function broadcastState(wssInstance) {
    const profile = getActiveProfile();
    const page = getCurrentPage();
    const basePayload = {
      type: 'STATE_UPDATE',
      activeProfileId: appConfig.activeProfile,
      profileName: profile.name,
      pageNumber: currentPageIndex + 1,
      totalPages: profile.pages ? profile.pages.length : 1,
      pageName: page.name || `Page ${currentPageIndex + 1}`,
      buttons: page.buttons || []
    };

    for (const client of wssInstance.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          ...basePayload,
          role: client.role,
          canEdit: client.canEdit
        }));
      }
    }
  }

  // HTTP Request Handler
  const server = http.createServer((req, res) => {
    // Check raw path (before query string) for traversal attacks
    const rawPath = (req.url || '').split('?')[0];
    let decodedRawPath = '';
    try {
      decodedRawPath = decodeURIComponent(rawPath);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    if (rawPath.includes('..') || rawPath.includes('%2e') || rawPath.includes('%2E') || decodedRawPath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied');
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    let reqPath = parsedUrl.pathname;
    const clientIp = options.mockClientIp || req.socket.remoteAddress;

    // Helper: authenticate HTTP request
    function checkHttpAuth() {
      const authHeader = req.headers['authorization'];
      let token = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      } else if (req.headers['x-pairing-token']) {
        token = req.headers['x-pairing-token'];
      } else {
        token = parsedUrl.searchParams.get('token');
      }
      return token && safeEqual(token, credentials.pairingToken);
    }

    // Security Headers
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self';");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // API Route: Installed system applications (requires valid pairing token)
    if (reqPath === '/api/apps') {
      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required' }));
        return;
      }
      const apps = getInstalledApplications();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apps));
      return;
    }

    // API Route: Suggested project directories (requires pairing token AND editor role)
    if (reqPath === '/api/directories') {
      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required' }));
        return;
      }

      const editKey = parsedUrl.searchParams.get('editKey');
      const isEditor = isLocalAddress(clientIp) || (editKey && safeEqual(editKey, credentials.editorKey));
      if (!isEditor) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: editor privilege required for directory suggestions' }));
        return;
      }

      const dirs = getSuggestedProjectDirs(appConfig.suggestedDirs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dirs));
      return;
    }

    // Static Files Serving
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.resolve(publicDir, '.' + safePath);

    // Path traversal check
    const relative = path.relative(publicDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  // WebSocket Server with manual upgrade handling
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

    // Check Origin Header (Issue #2)
    const interfaces = getNetworkInterfaces();
    const allowedIps = interfaces.map(i => i.address);
    if (HOST && HOST !== '0.0.0.0') {
      allowedIps.push(HOST);
    }
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, allowedIps)) {
      console.warn(`[Arya Dock] Rejected WebSocket upgrade with disallowed Origin: ${req.headers.origin}`);
      socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nForbidden Origin\r\n');
      socket.destroy();
      return;
    }

    // Check Pairing Secret / Token (Issue #1)
    const token = reqUrl.searchParams.get('token') || req.headers['x-pairing-token'];
    if (!token || !safeEqual(token, credentials.pairingToken)) {
      console.warn(`[Arya Dock] Rejected unauthenticated WebSocket connection attempt from ${socket.remoteAddress}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized\r\n');
      socket.destroy();
      return;
    }

    // Determine Role (Issue #3)
    const clientIp = options.mockClientIp || socket.remoteAddress;
    const editKey = reqUrl.searchParams.get('editKey');
    const role = getRole(clientIp, editKey, credentials.editorKey);

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { role });
    });
  });

  wss.on('connection', (ws, req, extra = {}) => {
    const clientIp = options.mockClientIp || req.socket.remoteAddress;
    ws.role = extra.role || 'operator';
    ws.canEdit = ws.role === 'editor';
    ws.isAlive = true;

    console.log(`[Arya Dock] Client connected from ${clientIp} (Role: ${ws.role})`);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Send initial state with role and permission
    const profile = getActiveProfile();
    const page = getCurrentPage();
    ws.send(JSON.stringify({
      type: 'INIT',
      profiles: Object.entries(appConfig.profiles).map(([id, p]) => ({ id, name: p.name })),
      activeProfileId: appConfig.activeProfile,
      pageNumber: currentPageIndex + 1,
      totalPages: profile.pages ? profile.pages.length : 1,
      pageName: page.name || `Page ${currentPageIndex + 1}`,
      buttons: page.buttons || [],
      role: ws.role,
      canEdit: ws.canEdit
    }));

    ws.on('message', (message) => {
      ws.isAlive = true;
      try {
        const data = JSON.parse(message);

        switch (data.type) {
          case 'BUTTON_CLICK': {
            const page = getCurrentPage();
            const button = page.buttons.find(b => b.id === data.buttonId);
            if (button) {
              executeAction(button);
              ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: data.buttonId, status: 'ok' }));
            }
            break;
          }

          case 'PAGE_PREV': {
            const profile = getActiveProfile();
            currentPageIndex = (currentPageIndex - 1 + profile.pages.length) % profile.pages.length;
            broadcastState(wss);
            break;
          }

          case 'PAGE_NEXT': {
            const profile = getActiveProfile();
            currentPageIndex = (currentPageIndex + 1) % profile.pages.length;
            broadcastState(wss);
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

          case 'SET_PROFILE': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted SET_PROFILE`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }
            if (appConfig.profiles[data.profileId]) {
              console.log(`[Arya Dock] [MUTATION] Client from ${clientIp} changed profile to ${data.profileId}`);
              appConfig.activeProfile = data.profileId;
              currentPageIndex = 0;
              saveConfig();
              broadcastState(wss);
            }
            break;
          }

          case 'UPDATE_BUTTON': {
            if (!ws.canEdit) {
              console.warn(`[Arya Dock] [MUTATION REJECTED] Client ${clientIp} (${ws.role}) attempted UPDATE_BUTTON`);
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
              return;
            }
            const page = getCurrentPage();
            const idx = page.buttons.findIndex(b => b.id === data.button?.id);
            if (idx === -1) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Button not found' }));
              return;
            }

            const validation = validateButton(data.button, { isUpdate: true, existingId: page.buttons[idx].id });
            if (!validation.valid) {
              ws.send(JSON.stringify({ type: 'ERROR', message: validation.error }));
              return;
            }

            console.log(`[Arya Dock] [MUTATION] Client ${clientIp} updated button ${validation.button.id} ('${validation.button.label}')`);
            const updated = { ...page.buttons[idx], ...validation.button };
            if (validation.button.actionType !== 'media') {
              delete updated.mediaAction;
            }
            page.buttons[idx] = updated;
            saveConfig();
            broadcastState(wss);
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
            broadcastState(wss);
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
            const idx = page.buttons.findIndex(b => b.id === data.buttonId);
            if (idx !== -1) {
              console.log(`[Arya Dock] [MUTATION] Client ${clientIp} deleted button ${data.buttonId}`);
              page.buttons.splice(idx, 1);
              saveConfig();
              broadcastState(wss);
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
            const targetCount = Math.max(1, Math.min(24, parseInt(data.count, 10) || 9));
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
                  keepOpen: false,
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
            broadcastState(wss);
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
    server,
    wss,
    credentials,
    getConfig: () => appConfig,
    close: (cb) => {
      clearInterval(heartbeatInterval);
      for (const client of wss.clients) {
        try { client.terminate(); } catch (e) {}
      }
      wss.close(() => {
        server.close(cb);
      });
    }
  };
}

// Start standalone server when executed directly
if (require.main === module) {
  const instance = createServer();
  const { server, credentials } = instance;

  server.listen(PORT, HOST, () => {
    const interfaces = getNetworkInterfaces();
    const qrTarget = interfaces.find(i => i.type.includes('Wi-Fi')) || interfaces[0];
    const pairingToken = credentials.pairingToken;
    const editorKey = credentials.editorKey;

    const qrUrl = qrTarget
      ? `http://${qrTarget.address}:${PORT}/?token=${pairingToken}`
      : `http://localhost:${PORT}/?token=${pairingToken}`;

    console.log('\n========================================================');
    console.log('         🚀 ARYA DOCK — VIRTUAL KEYPAD CONSOLE          ');
    console.log('========================================================\n');
    console.log(`  🖥️  PC Web App:            http://localhost:${PORT}/?token=${pairingToken}&editKey=${editorKey}`);

    const defaultShell = getDefaultShell();
    const defaultTerminal = getDefaultTerminal();
    console.log(`  🐚  System Shell:          ${defaultShell} (${path.basename(defaultShell)})`);
    console.log(`  ⚡  Terminal Emulator:     ${defaultTerminal.path} (${defaultTerminal.name})`);

    interfaces.forEach(iface => {
      const icon = iface.type.includes('USB') ? '🔌' : (iface.type.includes('Wi-Fi') ? '📱' : '🌐');
      console.log(`  ${icon}  ${iface.type} (${iface.name}): http://${iface.address}:${PORT}/?token=${pairingToken}`);
    });

    console.log('\n--- SECURITY & ROLES ---');
    console.log(`• Pairing Token:   ${pairingToken}`);
    console.log(`• Editor Key:      ${editorKey}`);
    console.log('• Role Privileges: Localhost sessions have editor privileges. Remote sessions connect as operators.');
    console.log('                   To unlock editing remotely, append &editKey=<key> or unlock in the console.');

    console.log('\n--- CONNECTION MODES ---');
    console.log('• USB CABLE: Turn on "USB Tethering" on phone and open the USB link above.');
    console.log('• WI-FI / LAN: Scan the QR code below on phone:');

    try {
      qrcode.generate(qrUrl, { small: true });
    } catch (e) {
      // ignore
    }

    console.log('========================================================\n');
  });
}

module.exports = {
  createServer
};
