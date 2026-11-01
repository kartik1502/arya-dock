const http = require('http');
const path = require('path');
const qrcode = require('qrcode-terminal');

const {
  loadConfig,
  saveConfigAtomic,
  DEFAULT_CONFIG_PATH,
  DEFAULT_EXAMPLE_PATH
} = require('./lib/config');

const {
  loadOrCreateAuth,
  rotateAuthCredentials,
  DEFAULT_AUTH_PATH
} = require('./lib/auth');

const {
  getDefaultShell,
  getDefaultTerminal
} = require('./lib/terminal');

const { getNetworkInterfaces } = require('./lib/network');
const { createHttpHandler } = require('./lib/http');
const { setupWebSocketServer } = require('./lib/ws');

const PORT = !isNaN(parseInt(process.env.PORT, 10)) ? parseInt(process.env.PORT, 10) : 3333;
const HOST = process.env.HOST || '0.0.0.0';
const CONFIG_PATH = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;
const AUTH_PATH = process.env.AUTH_PATH || DEFAULT_AUTH_PATH;
const PUBLIC_DIR = path.join(__dirname, 'public');

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

  const httpHandler = createHttpHandler({
    credentials,
    getConfig: () => appConfig,
    publicDir,
    mockClientIp: options.mockClientIp
  });

  const server = http.createServer(httpHandler);

  const wsManager = setupWebSocketServer(server, {
    credentials,
    getConfig: () => appConfig,
    saveConfig,
    getActiveProfile,
    getCurrentPage,
    getPageIndex: () => currentPageIndex,
    setPageIndex: (idx) => { currentPageIndex = idx; },
    mockClientIp: options.mockClientIp,
    host: HOST
  });

  return {
    server,
    wss: wsManager.wss,
    credentials,
    getConfig: () => appConfig,
    close: (cb) => {
      wsManager.close();
      wsManager.wss.close(() => {
        server.close(cb);
      });
    }
  };
}

// Start standalone server when executed directly
if (require.main === module) {
  if (process.argv.includes('--rotate-credentials')) {
    const rotated = rotateAuthCredentials(AUTH_PATH);
    console.log('[Arya Dock] Credentials rotated successfully:');
    console.log(`• New Pairing Token: ${rotated.pairingToken}`);
    console.log(`• New Editor Key:    ${rotated.editorKey}\n`);
    if (!process.argv.includes('--start')) {
      process.exit(0);
    }
  }

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
  createServer
};
