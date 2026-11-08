const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer } = require('../server');

function makeRequest(port, reqPath, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('HTTP: static file serving, path traversal guard, and security headers', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-http-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // 1. Normal static file request
    const resRoot = await makeRequest(port, '/');
    assert.equal(resRoot.statusCode, 200);
    assert.ok(resRoot.headers['content-type'].includes('text/html'));
    assert.ok(resRoot.headers['content-security-policy']);
    assert.equal(resRoot.headers['x-content-type-options'], 'nosniff');
    assert.equal(resRoot.headers['x-frame-options'], 'DENY');
    assert.equal(resRoot.headers['referrer-policy'], 'no-referrer');
    assert.ok(resRoot.headers['content-security-policy'].includes("connect-src 'self' ws: wss:"));
    // Verify wildcard CORS is removed
    assert.equal(resRoot.headers['access-control-allow-origin'], undefined);

    // 2. Path traversal attempts must return 403
    const resTraversal1 = await makeRequest(port, '/../server.js');
    assert.equal(resTraversal1.statusCode, 403);

    const resTraversal2 = await makeRequest(port, '/%2e%2e/server.js');
    assert.equal(resTraversal2.statusCode, 403);

    const resTraversal3 = await makeRequest(port, '/..%2fconfig/profiles.json');
    assert.equal(resTraversal3.statusCode, 403);

    // 3. Malformed URI must return 400
    const resMalformed = await makeRequest(port, '/%c0%af');
    assert.equal(resMalformed.statusCode, 400);

    // 4. Non-existent file must return 404
    const resNotFound = await makeRequest(port, '/non-existent-file-xyz.js');
    assert.equal(resNotFound.statusCode, 404);

    // 5. Unauthenticated API request returns 401
    const resApiNoAuth = await makeRequest(port, '/api/apps');
    assert.equal(resApiNoAuth.statusCode, 401);

    // 6. Authenticated API request returns 200
    const token = app.credentials.pairingToken;
    const resApiAuth = await makeRequest(port, `/api/apps?token=${token}`);
    assert.equal(resApiAuth.statusCode, 200);
    const apps = JSON.parse(resApiAuth.body);
    assert.ok(Array.isArray(apps));

    // 6b. Authenticated API request via x-pairing-token header returns 200
    const resApiHeader = await makeRequest(port, '/api/apps', { 'x-pairing-token': token });
    assert.equal(resApiHeader.statusCode, 200);

    // 6c. Query parameter containing ".." must NOT trigger false-positive path traversal 403
    const resQueryDots = await makeRequest(port, `/index.html?token=${token}..version1`);
    assert.equal(resQueryDots.statusCode, 200);

    // 7. Directories API requires editor role (127.0.0.1 is local, so it succeeds)
    const resDirs = await makeRequest(port, `/api/directories?token=${token}`);
    assert.equal(resDirs.statusCode, 200);
    const dirs = JSON.parse(resDirs.body);
    assert.ok(Array.isArray(dirs));

    // 8. Health check endpoint (GET and HEAD return 200, POST returns 405)
    const resHealth = await makeRequest(port, '/health');
    assert.equal(resHealth.statusCode, 200);
    assert.ok(resHealth.headers['content-type'].includes('application/json'));
    const healthJson = JSON.parse(resHealth.body);
    assert.equal(healthJson.status, 'ok');
    assert.equal(typeof healthJson.uptime, 'number');
    assert.equal(typeof healthJson.timestamp, 'number');

    const resApiHealth = await makeRequest(port, '/api/health');
    assert.equal(resApiHealth.statusCode, 200);
    const apiHealthJson = JSON.parse(resApiHealth.body);
    assert.equal(apiHealthJson.status, 'ok');

    const resHealthHead = await makeRequest(port, '/health', {}, 'HEAD');
    assert.equal(resHealthHead.statusCode, 200);
    assert.equal(resHealthHead.body, '');

    const resHealthPost = await makeRequest(port, '/health', {}, 'POST');
    assert.equal(resHealthPost.statusCode, 405);
    assert.equal(resHealthPost.headers['allow'], 'GET, HEAD');

    // 8b. Authenticated API request with forceRefresh flag
    const resApiRefresh = await makeRequest(port, `/api/apps?token=${token}&refresh=true`);
    assert.equal(resApiRefresh.statusCode, 200);
    const refreshedApps = JSON.parse(resApiRefresh.body);
    assert.ok(Array.isArray(refreshedApps));

    // 9. HEAD request returns 200 with headers but empty body
    const resHead = await makeRequest(port, '/index.html', {}, 'HEAD');
    assert.equal(resHead.statusCode, 200);
    assert.equal(resHead.body, '');
    assert.ok(resHead.headers['content-length']);

    // 10. POST to static file returns 405 Method Not Allowed
    const resPostStatic = await makeRequest(port, '/index.html', {}, 'POST');
    assert.equal(resPostStatic.statusCode, 405);
    assert.equal(resPostStatic.headers['allow'], 'GET, HEAD');
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HTTP: /api/apps endpoint security barrier enforces editor privilege on remote IP', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-http-apps-sec-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath, mockClientIp: '192.168.1.185' });
  const server = app.server;

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;
  const editorKey = app.credentials.editorKey;

  try {
    // 1. Unauthenticated request returns 401
    const resNoAuth = await makeRequest(port, '/api/apps');
    assert.equal(resNoAuth.statusCode, 401);

    // 2. Remote operator with valid pairing token but without editorKey gets 403 Forbidden
    const resForbidden = await makeRequest(port, `/api/apps?token=${token}`);
    assert.equal(resForbidden.statusCode, 403);
    const forbiddenJson = JSON.parse(resForbidden.body);
    assert.ok(forbiddenJson.error.includes('editor privilege required'));

    // 3. Remote operator attempting to supply editKey in query string is REJECTED (403)
    const resQueryEditKey = await makeRequest(port, `/api/apps?token=${token}&editKey=${editorKey}`);
    assert.equal(resQueryEditKey.statusCode, 403);

    // 3b. Remote operator supplying invalid x-editor-key header gets 403 Forbidden
    const resWrongEditKey = await makeRequest(port, '/api/apps', {
      'x-pairing-token': token,
      'x-editor-key': 'incorrect_secret_key_1234567890'
    });
    assert.equal(resWrongEditKey.statusCode, 403);

    // 4. Remote editor with x-editor-key header gets 200 OK and application list with commands
    const resAuthorized = await makeRequest(port, '/api/apps', {
      'x-pairing-token': token,
      'x-editor-key': editorKey
    });
    assert.equal(resAuthorized.statusCode, 200);
    assert.ok(resAuthorized.headers['content-type'].includes('application/json'));
    assert.ok(resAuthorized.headers['cache-control'].includes('no-store'));
    const apps = JSON.parse(resAuthorized.body);
    assert.ok(Array.isArray(apps));

    // 5. POST to /api/apps returns 405 Method Not Allowed
    const resPostApps = await makeRequest(port, '/api/apps', {
      'x-pairing-token': token,
      'x-editor-key': editorKey
    }, 'POST');
    assert.equal(resPostApps.statusCode, 405);
    assert.equal(resPostApps.headers['allow'], 'GET, HEAD');

    // 6. HEAD to /api/apps returns 200 with empty body
    const resHeadApps = await makeRequest(port, '/api/apps', {
      'x-pairing-token': token,
      'x-editor-key': editorKey
    }, 'HEAD');
    assert.equal(resHeadApps.statusCode, 200);
    assert.equal(resHeadApps.body, '');

    // 7. Trailing slash /api/apps/ is normalized and returns 200
    const resTrailingSlash = await makeRequest(port, '/api/apps/', {
      'x-pairing-token': token,
      'x-editor-key': editorKey
    });
    assert.equal(resTrailingSlash.statusCode, 200);

    // 8. Duplicate / conflicting pairing headers are safely rejected with 401 without server crash
    const resDuplicateHeaders = await makeRequest(port, '/api/apps', {
      'x-pairing-token': [token, 'other-token'],
      'x-editor-key': editorKey
    });
    assert.equal(resDuplicateHeaders.statusCode, 401);
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HTTP: directories endpoint with remote IP requires editorKey header', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-http-remote-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath, mockClientIp: '192.168.1.180' });
  const server = app.server;

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;
  const editorKey = app.credentials.editorKey;

  try {
    // Remote client with token but without editorKey gets 403
    const resForbidden = await makeRequest(port, `/api/directories?token=${token}`);
    assert.equal(resForbidden.statusCode, 403);

    // Remote client attempting to supply editKey via query string is REJECTED (403)
    const resQueryEditKey = await makeRequest(port, `/api/directories?token=${token}&editKey=${editorKey}`);
    assert.equal(resQueryEditKey.statusCode, 403);

    // Remote client providing x-editor-key header gets 200 without query string leakage
    const resAuthorized = await makeRequest(port, '/api/directories', {
      'x-pairing-token': token,
      'x-editor-key': editorKey
    });
    assert.equal(resAuthorized.statusCode, 200);
    assert.ok(resAuthorized.headers['content-type'].includes('application/json'));
    assert.ok(resAuthorized.headers['cache-control'].includes('no-store'));
    const dirs = JSON.parse(resAuthorized.body);
    assert.ok(Array.isArray(dirs));

    // POST to /api/directories returns 405 Method Not Allowed
    const resPostDirs = await makeRequest(port, '/api/directories', {
      'x-pairing-token': token,
      'x-editor-key': editorKey
    }, 'POST');
    assert.equal(resPostDirs.statusCode, 405);
    assert.equal(resPostDirs.headers['allow'], 'GET, HEAD');

    // HEAD to /api/directories returns 200 with empty body
    const resHeadDirs = await makeRequest(port, '/api/directories', {
      'x-pairing-token': token,
      'x-editor-key': editorKey
    }, 'HEAD');
    assert.equal(resHeadDirs.statusCode, 200);
    assert.equal(resHeadDirs.body, '');

    // Trailing slash /api/directories/ returns 200
    const resTrailingDirs = await makeRequest(port, '/api/directories/', {
      'x-pairing-token': token,
      'x-editor-key': editorKey
    });
    assert.equal(resTrailingDirs.statusCode, 200);

    // Client static app.js is served without auth, does not read editKey from urlParams, and avoids undeclared variable bugs
    const resApp = await makeRequest(port, '/app.js');
    assert.equal(resApp.statusCode, 200);
    assert.ok(!resApp.body.includes("urlParams.get('editKey')"));
    assert.ok(!resApp.body.includes("type: 'AUTH_EDIT', editKey }"));
    assert.ok(resApp.body.includes("type: 'AUTH_EDIT', editKey: editorKey }"));
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
