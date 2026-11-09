const http = require('http');
const path = require('path');
const qrcode = require('qrcode-terminal');

const {
  loadConfig,
  saveConfigAtomic,
  getDefaultConfigPath,
  resolveConfigPath,
  DEFAULT_EXAMPLE_PATH,
  migrateLegacyConfigAndAuth
} = require('./lib/config');

const {
  loadOrCreateAuth,
  rotateAuthCredentials,
  getDefaultAuthPath,
  resolvePath
} = require('./lib/auth');

const {
  getDefaultShell,
  getDefaultTerminal
} = require('./lib/terminal');

const {
  createInitialNavigationState,
  navigationReducer,
  findWorkspaceForApp
} = require('./lib/navigation');

const { getNetworkInterfaces } = require('./lib/network');
const { createHttpHandler } = require('./lib/http');
const { setupWebSocketServer, broadcastState, sendClientState, getClientWorkspace } = require('./lib/ws');
const platform = require('./platform');

const PORT = !isNaN(parseInt(process.env.PORT, 10)) ? parseInt(process.env.PORT, 10) : 3333;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

function parseCliArgs() {
  const args = process.argv.slice(2);
  let configPath = null;
  let authPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    } else if (args[i].startsWith('--config=')) {
      configPath = args[i].slice(9);
    } else if (args[i] === '--auth' && args[i + 1]) {
      authPath = args[i + 1];
      i++;
    } else if (args[i].startsWith('--auth=')) {
      authPath = args[i].slice(7);
    }
  }
  return { configPath, authPath };
}

class ActiveWindowWatcher {
  constructor(platformAdapter, onChange) {
    this.platform = platformAdapter;
    this.onChange = onChange;
    this.stream = null;
    this.teardownTimer = null;
    this.consecutiveFailures = 0;
  }

  handleClientConnected() {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    if (!this.stream && this.platform && typeof this.platform.capabilities === 'function' && this.platform.capabilities().activeWindow) {
      this.start();
    }
  }

  handleClientDisconnected(clientCount) {
    if (clientCount === 0 && this.stream) {
      if (this.teardownTimer) clearTimeout(this.teardownTimer);
      this.teardownTimer = setTimeout(() => {
        this.stop();
        this.teardownTimer = null;
      }, 3000); // 3-second grace period
    }
  }

  start() {
    if (!this.platform || typeof this.platform.createActiveWindowStream !== 'function') {
      return;
    }
    this.stream = this.platform.createActiveWindowStream(
      (appId) => {
        this.consecutiveFailures = 0;
        this.onChange(appId);
      },
      (err) => {
        this.consecutiveFailures++;
        if (this.consecutiveFailures <= 3) {
          console.warn('[Arya Dock] Active window watcher warning:', err?.message || err);
        }
      }
    );
  }

  stop() {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    if (this.stream) {
      if (typeof this.stream.stop === 'function') {
        this.stream.stop();
      }
      this.stream = null;
    }
  }
}

function createServer(options = {}) {
  const cliArgs = parseCliArgs();
  const cliConfig = cliArgs.configPath ? resolveConfigPath(cliArgs.configPath) : null;
  const cliAuth = cliArgs.authPath ? resolvePath(cliArgs.authPath) : null;

  const configPath = options.configPath || cliConfig || (process.env.CONFIG_PATH ? resolveConfigPath(process.env.CONFIG_PATH) : getDefaultConfigPath());
  const authPath = options.authPath || cliAuth || (process.env.AUTH_PATH ? resolvePath(process.env.AUTH_PATH) : getDefaultAuthPath());
  const publicDir = options.publicDir || PUBLIC_DIR;

  // Run first boot migration if legacy config/auth exists and target does not exist
  migrateLegacyConfigAndAuth({
    configPath,
    authPath,
    silent: options.silent
  });

  const platformAdapter = options.platformAdapter || (options.platform ? platform.getPlatform(options.platform, { logger: options.logger || console.warn, silent: options.silent }) : platform.getActivePlatform());
  if (options.platform || options.platformAdapter) {
    platform.setPlatform(platformAdapter);
  }

  const credentials = loadOrCreateAuth(authPath, { silent: options.silent });
  let appConfig = loadConfig(configPath, DEFAULT_EXAMPLE_PATH, { silent: options.silent });

  // Navigation State Management (E3-2)
  let navState = createInitialNavigationState({
    workspaces: appConfig.workspaces,
    initialWorkspaceId: appConfig.activeWorkspaceId || (appConfig.workspaces && appConfig.workspaces[0] && appConfig.workspaces[0].id) || 'developer',
    mode: 'auto',
    pinned: false
  });

  function getActiveWorkspace() {
    const wsId = navState.workspaceId;
    if (Array.isArray(appConfig.workspaces)) {
      const found = appConfig.workspaces.find(w => w.id === wsId);
      if (found) return found;
      if (appConfig.workspaces.length > 0) return appConfig.workspaces[0];
    }
    if (appConfig.profiles && Object.prototype.hasOwnProperty.call(appConfig.profiles, wsId)) {
      return { id: wsId, ...appConfig.profiles[wsId] };
    }
    return { id: 'developer', name: 'Developer', pages: [{ buttons: [] }] };
  }

  function getActiveProfile() {
    return getActiveWorkspace();
  }

  function dispatchNav(event) {
    const activeWs = getActiveWorkspace();
    const totalPages = (activeWs && Array.isArray(activeWs.pages) && activeWs.pages.length > 0)
      ? activeWs.pages.length
      : 1;
    const context = {
      workspaces: appConfig.workspaces,
      totalPages,
      findWorkspaceForApp: (workspaces, appId) => {
        if (typeof appId === 'string') {
          return findWorkspaceForApp(workspaces || appConfig.workspaces, appId);
        }
        return findWorkspaceForApp(appConfig.workspaces, workspaces);
      }
    };
    const nextState = navigationReducer(navState, event, context);
    if (nextState !== navState) {
      navState = nextState;
      // Only persist active workspace on explicit user manual selection, NEVER on automated context changes
      if (event?.type === 'USER_SELECT' && appConfig.activeWorkspaceId !== navState.workspaceId) {
        appConfig.activeWorkspaceId = navState.workspaceId;
        appConfig.activeProfile = navState.workspaceId;
      }
    }
    return navState;
  }

  // Persistence hardening: debounced writes and shutdown flushing
  let saveTimer = null;
  let hasPendingSave = false;
  const debounceMs = options.debounceMs !== undefined ? options.debounceMs : 250;
  const maxBackups = options.maxBackups !== undefined ? options.maxBackups : 5;

  function flushConfigSync() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!hasPendingSave) return;
    try {
      saveConfigAtomic(configPath, appConfig, { maxBackups });
      hasPendingSave = false;
    } catch (err) {
      console.error('[Arya Dock] Failed to save config:', err.message);
    }
  }

  function saveConfig(immediate = false) {
    hasPendingSave = true;
    if (immediate || debounceMs <= 0) {
      flushConfigSync();
      return;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushConfigSync();
    }, debounceMs);
  }

  // Shutdown flush hooks (SIGINT, SIGTERM, beforeExit)
  const shouldRegisterSignals = options.registerSignalHandlers ?? (require.main === module);
  const onSigint = () => {
    flushConfigSync();
    if (options.exitOnSignal !== false) {
      process.exit(0);
    }
  };
  const onSigterm = () => {
    flushConfigSync();
    if (options.exitOnSignal !== false) {
      process.exit(0);
    }
  };
  const onBeforeExit = () => {
    flushConfigSync();
  };

  if (shouldRegisterSignals) {
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    process.on('beforeExit', onBeforeExit);
  }

  function getCurrentPage() {
    const ws = getActiveWorkspace();
    if (!ws || !ws.pages || ws.pages.length === 0) return { buttons: [] };
    let idx = navState.pageIndex;
    if (idx >= ws.pages.length) idx = 0;
    if (idx < 0) idx = ws.pages.length - 1;
    return ws.pages[idx];
  }

  const httpHandler = createHttpHandler({
    credentials,
    getConfig: () => appConfig,
    publicDir,
    mockClientIp: options.mockClientIp
  });

  const server = http.createServer(httpHandler);

  let wsManager = null;

  const activeWatcher = new ActiveWindowWatcher(platformAdapter, (appId) => {
    if (appId) {
      dispatchNav({ type: 'CONTEXT_CHANGED', appId });
      if (wsManager && wsManager.wss && wsManager.wss.clients) {
        for (const client of wsManager.wss.clients) {
          if (client.readyState === 1 && client.navState) {
            const targetWs = getClientWorkspace(client, appConfig);
            const totalPages = (targetWs && Array.isArray(targetWs.pages) && targetWs.pages.length > 0)
              ? targetWs.pages.length
              : 1;
            const nextNav = navigationReducer(client.navState, {
              type: 'CONTEXT_CHANGED',
              appId
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

            if (nextNav !== client.navState) {
              client.navState = nextNav;
              sendClientState(client, wsContext, 'STATE_UPDATE');
            }
          }
        }
      }
    }
  });

  const wsContext = {
    credentials,
    getConfig: () => appConfig,
    saveConfig,
    getActiveWorkspace,
    getActiveProfile,
    getCurrentPage,
    getNavState: () => navState,
    dispatchNav,
    getPageIndex: () => navState.pageIndex,
    setPageIndex: (idx) => {
      dispatchNav({ type: 'USER_SELECT', workspaceId: navState.workspaceId, pageIndex: idx });
    },
    mockClientIp: options.mockClientIp,
    host: HOST,
    onClientConnect: (count) => activeWatcher.handleClientConnected(),
    onClientDisconnect: (count) => activeWatcher.handleClientDisconnected(count)
  };

  wsManager = setupWebSocketServer(server, wsContext);

  return {
    server,
    wss: wsManager.wss,
    credentials,
    getConfig: () => appConfig,
    getNavState: () => navState,
    dispatchNav,
    getActiveWorkspace,
    getActiveProfile,
    platform: platformAdapter,
    activeWatcher,
    saveConfig,
    flushConfig: flushConfigSync,
    hasPendingSave: () => hasPendingSave,
    close: (cb) => {
      if (shouldRegisterSignals) {
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
        process.removeListener('beforeExit', onBeforeExit);
      }
      activeWatcher.stop();
      flushConfigSync();
      wsManager.close();
      wsManager.wss.close(() => {
        if (server.listening) {
          server.close(cb);
        } else if (typeof cb === 'function') {
          process.nextTick(cb);
        }
      });
    }
  };
}

// Start standalone server when executed directly
if (require.main === module) {
  const cliArgs = parseCliArgs();
  const cliConfig = cliArgs.configPath ? resolveConfigPath(cliArgs.configPath) : null;
  const cliAuth = cliArgs.authPath ? resolvePath(cliArgs.authPath) : null;
  const authPath = cliAuth || (process.env.AUTH_PATH ? resolvePath(process.env.AUTH_PATH) : getDefaultAuthPath());
  const configPath = cliConfig || (process.env.CONFIG_PATH ? resolveConfigPath(process.env.CONFIG_PATH) : getDefaultConfigPath());

  if (process.argv.includes('--rotate-credentials')) {
    const rotated = rotateAuthCredentials(authPath);
    console.log('[Arya Dock] Credentials rotated successfully:');
    console.log(`• New Pairing Token: ${rotated.pairingToken}`);
    console.log(`• New Editor Key:    ${rotated.editorKey}`);
    console.log('⚠️  Restart of running server is required for new credentials to take effect.\n');
    if (!process.argv.includes('--start')) {
      process.exit(0);
    }
  }

  const instance = createServer({ configPath, authPath, registerSignalHandlers: true });
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
    console.log(`  🖥️  PC Web App:            http://localhost:${PORT}/?token=${pairingToken}`);

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
    console.log('                   To unlock editing remotely, use the in-app unlock modal or pass the X-Editor-Key header.');

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
  createServer,
  ActiveWindowWatcher
};
