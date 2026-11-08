const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function resolvePath(p) {
  if (!p || typeof p !== 'string') return '';
  const trimmed = p.trim();
  if (!trimmed || /[\x00-\x1f\x7f]/.test(trimmed)) return '';
  const home = os.homedir();
  if (trimmed === '~' || trimmed === '$HOME') return home;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return path.join(home, trimmed.slice(2));
  if (trimmed.startsWith('$HOME/') || trimmed.startsWith('$HOME\\')) return path.join(home, trimmed.slice(6));
  return path.resolve(trimmed);
}

function isWritable(p) {
  let cur = p;
  while (cur) {
    if (fs.existsSync(cur)) {
      try {
        fs.accessSync(cur, fs.constants.W_OK);
        return true;
      } catch (_) {
        return false;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

const LEGACY_AUTH_PATH = path.join(__dirname, '..', 'config', 'auth.json');

/**
 * Determine default directory for authentication credentials outside the repository.
 * Supports ARYA_HOME, XDG_CONFIG_HOME, and ~/.config/arya-dock.
 * Falls back to repository config if user directory is non-writable (e.g. read-only HOME in sandbox/container).
 */
function getDefaultAuthDir() {
  if (process.env.ARYA_HOME) {
    const customHome = resolvePath(process.env.ARYA_HOME);
    if (customHome) return customHome;
  }
  if (process.env.XDG_CONFIG_HOME) {
    const xdgHome = resolvePath(process.env.XDG_CONFIG_HOME);
    if (xdgHome) return path.join(xdgHome, 'arya-dock');
  }
  if (os.platform() === 'win32' && process.env.APPDATA) {
    const appData = resolvePath(process.env.APPDATA);
    if (appData) return path.join(appData, 'arya-dock');
  }

  const standardUserDir = path.join(os.homedir(), '.config', 'arya-dock');
  if (!isWritable(standardUserDir) && isWritable(path.join(__dirname, '..', 'config'))) {
    return path.join(__dirname, '..', 'config');
  }

  return standardUserDir;
}

/**
 * Determine the default authentication file path for auth.json.
 */
function getDefaultAuthPath() {
  if (process.env.AUTH_PATH) {
    const p = resolvePath(process.env.AUTH_PATH);
    if (p) return p;
  }
  return path.join(getDefaultAuthDir(), 'auth.json');
}

/**
 * Load or generate pairing and editor authentication credentials.
 * Automatically migrates legacy credentials on first boot if needed.
 * Strictly maintains 0600 file permissions for credentials security.
 */
function loadOrCreateAuth(authFilePath = getDefaultAuthPath(), options = {}) {
  const targetPath = resolvePath(authFilePath);
  const envPairing = process.env.ARYA_PAIRING_TOKEN;
  const envEditor = process.env.ARYA_EDITOR_KEY;

  // First boot automatic legacy credentials migration
  if (!fs.existsSync(targetPath)) {
    const legacyPath = options.legacyAuthPath || LEGACY_AUTH_PATH;
    const shouldMigrate = options.migrateLegacy !== false && fs.existsSync(legacyPath) && path.resolve(targetPath) !== path.resolve(legacyPath);
    if (shouldMigrate) {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(legacyPath, targetPath);
      try {
        fs.chmodSync(targetPath, 0o600);
      } catch (_) {}
      const logFn = options.logger || console.log;
      if (!options.silent) {
        logFn(`[Arya Dock] Migrated legacy credentials from ${legacyPath} to ${targetPath}`);
      }
    }
  }

  let credentials = {
    pairingToken: envPairing || null,
    editorKey: envEditor || null
  };

  if (fs.existsSync(targetPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
      if (!credentials.pairingToken && data.pairingToken) {
        credentials.pairingToken = data.pairingToken;
      }
      if (!credentials.editorKey && data.editorKey) {
        credentials.editorKey = data.editorKey;
      }
    } catch (e) {
      console.warn('[Auth] Warning: Could not parse auth file, regenerating credentials:', e.message);
    }
  }

  let modified = false;
  if (!credentials.pairingToken) {
    credentials.pairingToken = crypto.randomBytes(16).toString('hex');
    modified = true;
  }
  if (!credentials.editorKey) {
    credentials.editorKey = crypto.randomBytes(16).toString('hex');
    modified = true;
  }

  if (modified) {
    try {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
      try { fs.chmodSync(targetPath, 0o600); } catch (e) {}
    } catch (e) {
      console.warn('[Auth] Warning: Could not persist auth credentials to disk:', e.message);
    }
  } else if (fs.existsSync(targetPath)) {
    try { fs.chmodSync(targetPath, 0o600); } catch (e) {}
  }

  return credentials;
}

/**
 * Check if the Origin header is acceptable.
 * Browsers always send Origin on WebSocket upgrade.
 * Non-browser clients (wscat, curl) may omit it.
 */
function isAllowedOrigin(origin, hostHeader, allowedAddresses = []) {
  if (!origin) return true; // Non-browser clients without Origin

  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
      return false;
    }

    const originHostname = originUrl.hostname.toLowerCase();
    const localHostnames = new Set([
      'localhost',
      '127.0.0.1',
      '::1',
      ...allowedAddresses.map(a => a.toLowerCase())
    ]);

    // Origin hostname MUST be in localHostnames or resolve to local loopback
    if (!localHostnames.has(originHostname) && !isLocalAddress(originHostname)) {
      return false;
    }

    if (hostHeader) {
      let hostHeaderHostname = hostHeader.toLowerCase();
      let hostHeaderPort = '';
      if (hostHeaderHostname.includes(':')) {
        const lastColon = hostHeaderHostname.lastIndexOf(':');
        hostHeaderPort = hostHeaderHostname.slice(lastColon + 1);
        hostHeaderHostname = hostHeaderHostname.slice(0, lastColon).replace(/^\[|\]$/g, '');
      }

      // Host header hostname MUST also be in localHostnames
      if (!localHostnames.has(hostHeaderHostname)) {
        return false;
      }

      // Origin port must match Host header port
      const originPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80');
      const expectedPort = hostHeaderPort || (originUrl.protocol === 'https:' ? '443' : '80');
      if (originPort !== expectedPort) {
        return false;
      }
    }

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check if an IP address belongs to localhost or IPv4/IPv6 loopback (RFC 1122 127.0.0.0/8).
 */
function isLocalAddress(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const cleanIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return (
    cleanIp === 'localhost' ||
    cleanIp === '::1' ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(cleanIp)
  );
}

/**
 * Determine client role: 'editor' or 'operator'.
 */
function getRole(clientIp, providedEditKey, actualEditorKey) {
  if (isLocalAddress(clientIp)) {
    return 'editor';
  }
  if (providedEditKey && safeEqual(providedEditKey, actualEditorKey)) {
    return 'editor';
  }
  return 'operator';
}

/**
 * Rotate pairing token and editor key, persisting new random credentials.
 */
/**
 * Rotate pairing token and editor key, persisting new random credentials.
 */
function rotateAuthCredentials(authFilePath = getDefaultAuthPath()) {
  const targetPath = resolvePath(authFilePath);
  const credentials = {
    pairingToken: crypto.randomBytes(16).toString('hex'),
    editorKey: crypto.randomBytes(16).toString('hex')
  };

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  try { fs.chmodSync(targetPath, 0o600); } catch (e) {}

  return credentials;
}

module.exports = {
  safeEqual,
  loadOrCreateAuth,
  rotateAuthCredentials,
  isAllowedOrigin,
  isLocalAddress,
  getRole,
  resolvePath,
  getDefaultAuthDir,
  getDefaultAuthPath,
  LEGACY_AUTH_PATH
};

Object.defineProperty(module.exports, 'DEFAULT_AUTH_PATH', {
  get: () => getDefaultAuthPath(),
  enumerable: true
});

if (require.main === module) {
  let authPath = getDefaultAuthPath();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--auth' && args[i + 1]) {
      authPath = resolvePath(args[i + 1]);
      i++;
    } else if (args[i].startsWith('--auth=')) {
      authPath = resolvePath(args[i].slice(7));
    }
  }

  if (process.argv.includes('--rotate-credentials')) {
    const rotated = rotateAuthCredentials(authPath);
    console.log('[Arya Dock] Credentials rotated successfully:');
    console.log(`• Pairing Token: ${rotated.pairingToken}`);
    console.log(`• Editor Key:    ${rotated.editorKey}`);
    console.log('⚠️  Restart of running server is required for new credentials to take effect.');
  }
}
