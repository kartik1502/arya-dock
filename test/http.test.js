const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer } = require('../server');

function makeRequest(port, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method: 'GET',
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
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
