'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { createServer } = require('../server');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

test('Presets HTTP: GET /api/presets/catalog authentication and catalog response', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-http-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  try {
    // 1. Unauthenticated request without token returns 401
    const unauthRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/presets/catalog',
      method: 'GET'
    });
    assert.equal(unauthRes.statusCode, 401);
    assert.equal(unauthRes.json.code, 'ERR_UNAUTHORIZED');

    // 2. Authenticated request with Bearer token returns 200
    const authRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/presets/catalog',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    assert.equal(authRes.statusCode, 200);
    assert.ok(Array.isArray(authRes.json.presets));
    assert.ok(authRes.json.presets.length >= 10);

    // 3. Authenticated request with query parameter token returns 200
    const queryRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/presets/catalog?token=${encodeURIComponent(token)}`,
      method: 'GET'
    });
    assert.equal(queryRes.statusCode, 200);
    assert.ok(Array.isArray(queryRes.json.presets));

    // 4. HEAD request returns 200 with empty body
    const headRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/presets/catalog?token=${encodeURIComponent(token)}`,
      method: 'HEAD'
    });
    assert.equal(headRes.statusCode, 200);
    assert.equal(headRes.data, '');

    // 5. Method not allowed on POST
    const postRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/presets/catalog?token=${encodeURIComponent(token)}`,
      method: 'POST'
    });
    assert.equal(postRes.statusCode, 405);
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Presets HTTP: GET /api/presets/detect role authorization & diagnostic probe', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-detect-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;
  const editorKey = app.credentials.editorKey;

  try {
    // 1. Without pairing token returns 401
    const unauthRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/presets/detect',
      method: 'GET'
    });
    assert.equal(unauthRes.statusCode, 401);

    // 2. Localhost defaults to editor, so local request without remote spoofing gets 200
    const localRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/presets/detect?token=${encodeURIComponent(token)}`,
      method: 'GET'
    });
    assert.equal(localRes.statusCode, 200);
    assert.ok(typeof localRes.json.timestamp === 'number');
    assert.ok(Array.isArray(localRes.json.detectedTools));

    // 3. With explicit editor key header
    const editorRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/presets/detect',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Editor-Key': editorKey
      }
    });
    assert.equal(editorRes.statusCode, 200);
    assert.ok(editorRes.json.timestamp > 0);

    // 4. Method not allowed on POST
    const badMethodRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/presets/detect?token=${encodeURIComponent(token)}`,
      method: 'POST'
    });
    assert.equal(badMethodRes.statusCode, 405);
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Presets HTTP: POST /api/presets/apply modes, payload cap, and prototype pollution defense', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-apply-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  // Seed fresh install with onboardingCompleted: false
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 2,
    activeWorkspaceId: 'developer',
    onboardingCompleted: false,
    workspaces: [
      {
        id: 'developer',
        name: 'Default',
        icon: '💻',
        origin: 'builtin',
        folders: [],
        match: { apps: [] },
        segregation: { enabled: false },
        pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }]
      }
    ]
  }));

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;
  const editorKey = app.credentials.editorKey;

  try {
    // 1. Unauthenticated apply returns 401
    const unauthRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/presets/apply',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ mode: 'skip' }));
    assert.equal(unauthRes.statusCode, 401);

    // 2. Prototype pollution rejection (__proto__)
    const protoPayload = '{"mode":"replace","workspaceIds":["developer"],"__proto__":{"polluted":true}}';
    const protoRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/presets/apply?token=${encodeURIComponent(token)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Editor-Key': editorKey
      }
    }, protoPayload);
    assert.equal(protoRes.statusCode, 400);
    assert.equal(protoRes.json.code, 'ERR_INVALID_PAYLOAD');

    // 3. Mode 'skip' marks onboardingCompleted: true
    const skipRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/presets/apply?token=${encodeURIComponent(token)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Editor-Key': editorKey
      }
    }, JSON.stringify({ mode: 'skip' }));
    assert.equal(skipRes.statusCode, 200);
    assert.equal(skipRes.json.status, 'ok');
    assert.equal(skipRes.json.onboardingCompleted, true);

    const savedConfigAfterSkip = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfigAfterSkip.onboardingCompleted, true);

    // 4. Mode 'replace' seeds starter workspaces
    const applyRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/presets/apply?token=${encodeURIComponent(token)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Editor-Key': editorKey
      }
    }, JSON.stringify({
      mode: 'replace',
      workspaceIds: ['developer', 'devops', 'system']
    }));
    assert.equal(applyRes.statusCode, 200);
    assert.equal(applyRes.json.status, 'ok');
    assert.equal(applyRes.json.onboardingCompleted, true);
    assert.equal(applyRes.json.workspaceCount, 3);

    const savedConfigAfterApply = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfigAfterApply.onboardingCompleted, true);
    assert.equal(savedConfigAfterApply.workspaces.length, 3);
    assert.ok(savedConfigAfterApply.workspaces.some(w => w.id === 'developer'));
    assert.ok(savedConfigAfterApply.workspaces.some(w => w.id === 'devops'));
    assert.ok(savedConfigAfterApply.workspaces.some(w => w.id === 'system'));

    // 5. Config export includes onboardingCompleted
    const exportRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/config/export?token=${encodeURIComponent(token)}`,
      method: 'GET'
    });
    assert.equal(exportRes.statusCode, 200);
    assert.equal(exportRes.json.onboardingCompleted, true);
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
