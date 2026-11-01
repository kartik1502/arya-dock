const fs = require('fs');
const path = require('path');
const { safeEqual, isLocalAddress } = require('./auth');
const { getInstalledApplications, getSuggestedProjectDirs } = require('./apps');

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
    const clientIp = mockClientIp || req.socket.remoteAddress;

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

    // Security Headers: tightened CSP connect-src, Referrer-Policy, nosniff, DENY
    const host = req.headers.host || 'localhost';
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://${host} wss://${host}; font-src 'self';`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

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

      const appConfig = (typeof getConfig === 'function') ? getConfig() : (options.appConfig || {});
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
  };
}

module.exports = {
  createHttpHandler,
  MIME_TYPES
};
