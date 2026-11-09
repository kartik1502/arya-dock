const fs = require('fs');
const path = require('path');
const { safeEqual, isLocalAddress, getRole } = require('./auth');
const { getInstalledApplications, getSuggestedProjectDirs } = require('./apps');
const { validateConfig } = require('./config');
const {
  STATIC_PRESETS,
  detectHostEcosystem,
  generateCuratedWorkspaces,
  ALLOWED_STARTER_IDS
} = require('./presets');

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

/**
 * Creates the HTTP request handler for static assets and REST API endpoints.
 */
function createHttpHandler(options = {}) {
  const {
    credentials,
    getConfig,
    onImportConfig,
    publicDir = path.join(__dirname, '..', 'public'),
    mockClientIp = null
  } = options;

  return function handleHttpRequest(req, res) {
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
    const normalizedReqPath = (reqPath.length > 1 && reqPath.endsWith('/')) ? reqPath.slice(0, -1) : reqPath;
    const clientIp = mockClientIp || req.socket.remoteAddress;

    // Helper: authenticate HTTP request
    function checkHttpAuth() {
      let authHeader = req.headers['authorization'];
      if (Array.isArray(authHeader)) authHeader = authHeader[0];
      let token = null;
      if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      } else if (req.headers['x-pairing-token']) {
        const h = req.headers['x-pairing-token'];
        token = Array.isArray(h) ? h[0] : h;
      } else {
        token = parsedUrl.searchParams.get('token');
      }
      return token && safeEqual(token, credentials.pairingToken);
    }

    // Helper: verify editor role privilege
    function checkEditorPrivilege() {
      let editKey = req.headers['x-editor-key'];
      if (Array.isArray(editKey)) editKey = editKey[0];
      return getRole(clientIp, editKey, credentials.editorKey) === 'editor';
    }

    // Security Headers: tightened CSP connect-src, Referrer-Policy, nosniff, DENY
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: http://127.0.0.1:* ws://127.0.0.1:*; font-src 'self';"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // Health check endpoint (for container probes, systemd, and uptime monitoring)
    if (normalizedReqPath === '/health' || normalizedReqPath === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, HEAD' });
        res.end('Method Not Allowed');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(JSON.stringify({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        timestamp: Date.now()
      }));
      return;
    }

    // API Route: Installed system applications (requires pairing token AND editor role)
    if (normalizedReqPath === '/api/apps') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, HEAD' });
        res.end('Method Not Allowed');
        return;
      }

      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required' }));
        return;
      }

      if (!checkEditorPrivilege()) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: editor privilege required for application scan' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const forceRefresh = parsedUrl.searchParams.get('refresh') === 'true';
      const apps = getInstalledApplications(forceRefresh);
      res.end(JSON.stringify(apps));
      return;
    }

    // API Route: Suggested project directories (requires pairing token AND editor role)
    if (normalizedReqPath === '/api/directories') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, HEAD' });
        res.end('Method Not Allowed');
        return;
      }

      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required' }));
        return;
      }

      if (!checkEditorPrivilege()) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: editor privilege required for directory suggestions' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const appConfig = (typeof getConfig === 'function') ? getConfig() : (options.appConfig || {});
      const dirs = getSuggestedProjectDirs(appConfig.suggestedDirs);
      res.end(JSON.stringify(dirs));
      return;
    }

    // API Route: Static Presets Catalog (requires pairing token)
    if (normalizedReqPath === '/api/presets/catalog') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, HEAD' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', code: 'ERR_METHOD_NOT_ALLOWED' }));
        return;
      }

      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required', code: 'ERR_UNAUTHORIZED' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      res.end(JSON.stringify({ presets: STATIC_PRESETS }));
      return;
    }

    // API Route: Host Ecosystem Diagnostic Scan (requires pairing token AND editor role)
    if (normalizedReqPath === '/api/presets/detect') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, HEAD' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', code: 'ERR_METHOD_NOT_ALLOWED' }));
        return;
      }

      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required', code: 'ERR_UNAUTHORIZED' }));
        return;
      }

      if (!checkEditorPrivilege()) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: editor privilege required for ecosystem scan', code: 'ERR_FORBIDDEN' }));
        return;
      }

      const forceRefresh = parsedUrl.searchParams.get('refresh') === 'true';
      detectHostEcosystem({ forceRefresh })
        .then((detected) => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          res.end(JSON.stringify(detected));
        })
        .catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to detect host ecosystem: ' + err.message, code: 'ERR_INTERNAL' }));
        });
      return;
    }

    // API Route: Apply Starter Workspaces (requires pairing token AND editor role)
    if (normalizedReqPath === '/api/presets/apply') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', code: 'ERR_METHOD_NOT_ALLOWED' }));
        return;
      }

      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required', code: 'ERR_UNAUTHORIZED' }));
        return;
      }

      if (!checkEditorPrivilege()) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: editor privilege required to apply presets', code: 'ERR_FORBIDDEN' }));
        return;
      }

      const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
      let body = '';
      let receivedBytes = 0;
      let aborted = false;

      req.on('data', (chunk) => {
        if (aborted) return;
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_PAYLOAD_BYTES) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload Too Large: exceeds 2MB limit', code: 'ERR_PAYLOAD_TOO_LARGE' }));
          req.destroy();
          return;
        }
        body += chunk;
      });

      req.on('end', async () => {
        if (aborted) return;
        let payload;
        try {
          payload = JSON.parse(body, (key, value) => {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
              throw new Error(`Dangerous prototype pollution key rejected: ${key}`);
            }
            return value;
          });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON payload: ' + err.message, code: 'ERR_INVALID_PAYLOAD' }));
          return;
        }

        const appConfig = (typeof getConfig === 'function') ? getConfig() : (options.appConfig || {});
        const mode = (typeof payload.mode === 'string') ? payload.mode.toLowerCase() : 'replace';

        if (mode === 'skip') {
          const nextConfig = {
            ...appConfig,
            onboardingCompleted: true
          };
          if (typeof onImportConfig === 'function') {
            try {
              await onImportConfig(nextConfig);
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to persist configuration: ' + err.message, code: 'ERR_INTERNAL' }));
              return;
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', onboardingCompleted: true }));
          return;
        }

        const rawIds = Array.isArray(payload.workspaceIds) ? payload.workspaceIds : ['developer'];
        const selectedIds = rawIds.filter(id => ALLOWED_STARTER_IDS.includes(id));
        if (selectedIds.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'At least one valid workspaceId required', code: 'ERR_INVALID_PAYLOAD' }));
          return;
        }

        let detected;
        try {
          detected = await detectHostEcosystem();
        } catch (_) {
          detected = {};
        }

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
          // 'replace'
          nextWorkspaces = starterWorkspaces;
        }

        const nextConfig = {
          ...appConfig,
          onboardingCompleted: true,
          activeWorkspaceId: nextWorkspaces[0] ? nextWorkspaces[0].id : 'developer',
          workspaces: nextWorkspaces
        };

        if (typeof onImportConfig === 'function') {
          try {
            await onImportConfig(nextConfig);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to persist configuration: ' + err.message, code: 'ERR_INTERNAL' }));
            return;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          workspaceCount: nextWorkspaces.length,
          workspacesCount: nextWorkspaces.length,
          activeWorkspaceId: nextConfig.activeWorkspaceId,
          onboardingCompleted: true
        }));
      });

      return;
    }

    // API Route: Configuration Export (requires pairing token AND editor role)
    if (normalizedReqPath === '/api/config/export') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, HEAD' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', code: 'ERR_METHOD_NOT_ALLOWED' }));
        return;
      }

      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required', code: 'ERR_UNAUTHORIZED' }));
        return;
      }

      if (!checkEditorPrivilege()) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: editor privilege required to export configuration', code: 'ERR_FORBIDDEN' }));
        return;
      }

      const appConfig = (typeof getConfig === 'function') ? getConfig() : (options.appConfig || {});
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `arya-dock-config-${timestampStr}.json`;

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const exportPayload = {
        schemaVersion: 2,
        onboardingCompleted: Boolean(appConfig.onboardingCompleted),
        activeWorkspaceId: appConfig.activeWorkspaceId || (appConfig.workspaces && appConfig.workspaces[0] && appConfig.workspaces[0].id) || 'developer',
        workspaces: Array.isArray(appConfig.workspaces) ? appConfig.workspaces : [],
        profiles: (appConfig.profiles && typeof appConfig.profiles === 'object') ? appConfig.profiles : {},
        exportedAt: Date.now()
      };

      res.end(JSON.stringify(exportPayload, null, 2));
      return;
    }

    // API Route: Configuration Import (requires pairing token AND editor role)
    if (normalizedReqPath === '/api/config/import') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', code: 'ERR_METHOD_NOT_ALLOWED' }));
        return;
      }

      if (!checkHttpAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: pairing token required', code: 'ERR_UNAUTHORIZED' }));
        return;
      }

      if (!checkEditorPrivilege()) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: editor privilege required to import configuration', code: 'ERR_FORBIDDEN' }));
        return;
      }

      const contentType = (req.headers['content-type'] || '').toLowerCase();
      if (!contentType.startsWith('application/json')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Request: Content-Type must be application/json', code: 'ERR_INVALID_CONTENT_TYPE' }));
        return;
      }

      let totalBytes = 0;
      let bodyText = '';
      const MAX_BYTES = 2 * 1024 * 1024; // 2MB
      let aborted = false;

      req.on('data', chunk => {
        if (aborted) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          aborted = true;
          req.destroy();
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Payload Too Large: import configuration exceeds 2MB limit',
              code: 'ERR_PAYLOAD_TOO_LARGE'
            }));
          }
          return;
        }
        bodyText += chunk;
      });

      req.on('end', async () => {
        if (aborted) return;

        let parsed = null;
        try {
          if (!bodyText.trim()) {
            throw new Error('Empty request body');
          }
          parsed = JSON.parse(bodyText, (key, value) => {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
              throw new Error(`Prohibited prototype key "${key}" detected`);
            }
            return value;
          });
        } catch (parseErr) {
          if (!res.headersSent) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: `Bad Request: Malformed JSON or security violation (${parseErr.message})`,
              code: 'ERR_INVALID_JSON'
            }));
          }
          return;
        }

        const validation = validateConfig(parsed, { repair: false });
        if (!validation.valid) {
          if (!res.headersSent) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: `Bad Request: ${validation.error}`,
              code: 'ERR_INVALID_SCHEMA'
            }));
          }
          return;
        }

        if (typeof onImportConfig !== 'function') {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Internal Server Error: onImportConfig handler not configured',
              code: 'ERR_IMPORT_FAILED'
            }));
          }
          return;
        }

        try {
          await onImportConfig(validation.config);
          if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              message: 'Configuration successfully imported',
              workspaceCount: validation.config.workspaces.length,
              activeWorkspaceId: validation.config.activeWorkspaceId
            }));
          }
        } catch (importErr) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: `Internal Server Error: Import application failed (${importErr.message})`,
              code: 'ERR_IMPORT_FAILED'
            }));
          }
        }
      });

      return;
    }

    // Static Files Serving - only allow GET and HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

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
      const contentType = Object.prototype.hasOwnProperty.call(MIME_TYPES, ext) ? MIME_TYPES[ext] : 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Content-Length': stats.size
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Internal Server Error');
      });
      stream.pipe(res);
    });
  };
}

module.exports = {
  createHttpHandler,
  MIME_TYPES
};
