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

const DEFAULT_AUTH_PATH = process.env.AUTH_PATH
  ? resolvePath(process.env.AUTH_PATH)
  : path.join(__dirname, '..', 'config', 'auth.json');

/**
 * Load or generate pairing and editor authentication credentials.
 */
function loadOrCreateAuth(authFilePath = DEFAULT_AUTH_PATH) {
  const targetPath = resolvePath(authFilePath);
  const envPairing = process.env.ARYA_PAIRING_TOKEN;
  const envEditor = process.env.ARYA_EDITOR_KEY;

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

    // Origin hostname MUST be in localHostnames
    if (!localHostnames.has(originHostname)) {
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
 * Check if an IP address belongs to localhost.
 */
function isLocalAddress(ip) {
  if (!ip) return false;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost'
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
function rotateAuthCredentials(authFilePath = DEFAULT_AUTH_PATH) {
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
  DEFAULT_AUTH_PATH,
  safeEqual,
  loadOrCreateAuth,
  rotateAuthCredentials,
  isAllowedOrigin,
  isLocalAddress,
  getRole,
  resolvePath
};

if (require.main === module) {
  const authPath = DEFAULT_AUTH_PATH;
  if (process.argv.includes('--rotate-credentials')) {
    const rotated = rotateAuthCredentials(authPath);
    console.log('[Arya Dock] Credentials rotated successfully:');
    console.log(`• Pairing Token: ${rotated.pairingToken}`);
    console.log(`• Editor Key:    ${rotated.editorKey}`);
  }
}
