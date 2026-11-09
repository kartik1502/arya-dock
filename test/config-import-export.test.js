const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const { createServer } = require('../server');
const { validateConfig, CURRENT_SCHEMA_VERSION, MAX_BUTTONS_PER_PAGE } = require('../lib/config');

function makeRequest(port, reqPath, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null
  } = options;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

test('Config Validator: validateConfig pure function tests', () => {
  // Non-object input
  const nonObj = validateConfig('not an object');
  assert.equal(nonObj.valid, false);
  assert.match(nonObj.error, /must be a JSON object/);

  // Prototype pollution in strict mode (repair: false)
  const protoPollution = JSON.parse('{"__proto__": {"injected": true}, "workspaces": [{"id": "ws1", "name": "WS 1", "pages": [{"pageNumber": 1, "name": "P1", "buttons": []}]}]}');
  const protoStrict = validateConfig(protoPollution, { repair: false });
  assert.equal(protoStrict.valid, false);
  assert.match(protoStrict.error, /Prohibited prototype pollution key/);

  // Schema version validation
  const invalidVersion = validateConfig({ schemaVersion: 99, workspaces: [] });
  assert.equal(invalidVersion.valid, false);
  assert.match(invalidVersion.error, /Unsupported schema version 99/);

  // Page exceeding MAX_BUTTONS_PER_PAGE in strict mode
  const overflowButtons = [];
  for (let i = 0; i < MAX_BUTTONS_PER_PAGE + 5; i++) {
    overflowButtons.push({ id: i, label: `B${i}`, actionType: 'shell', command: 'echo 1' });
  }
  const overflowWs = {
    schemaVersion: 2,
    activeWorkspaceId: 'ws-overflow',
    workspaces: [
      {
        id: 'ws-overflow',
        name: 'Overflow WS',
        pages: [{ pageNumber: 1, name: 'P1', buttons: overflowButtons }]
      }
    ]
  };
  const overflowStrict = validateConfig(overflowWs, { repair: false });
  assert.equal(overflowStrict.valid, false);
  assert.match(overflowStrict.error, /capped to maximum 15/);

  // Normalization of missing activeWorkspaceId
  const missingActive = {
    schemaVersion: 2,
    workspaces: [
      { id: 'first-ws', name: 'First WS', pages: [{ pageNumber: 1, name: 'P1', buttons: [] }] },
      { id: 'second-ws', name: 'Second WS', pages: [{ pageNumber: 1, name: 'P1', buttons: [] }] }
    ]
  };
  const activeNormalized = validateConfig(missingActive, { repair: false });
  assert.equal(activeNormalized.valid, true);
  assert.equal(activeNormalized.config.activeWorkspaceId, 'first-ws');
  assert.equal(activeNormalized.config.activeProfile, 'first-ws');
  assert.ok(activeNormalized.config.profiles['first-ws']);
});

test('HTTP Export: GET /api/config/export authentication, authorization, and headers', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-export-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const { pairingToken, editorKey } = app.credentials;

    // 1. Unauthenticated request (no token) -> 401
    const unauth = await makeRequest(port, '/api/config/export');
    assert.equal(unauth.statusCode, 401);
    assert.equal(unauth.json.code, 'ERR_UNAUTHORIZED');

    // 2. Authenticated loopback editor request (Bearer token) -> 200
    const authLoopback = await makeRequest(port, '/api/config/export', {
      headers: {
        'Authorization': `Bearer ${pairingToken}`
      }
    });
    assert.equal(authLoopback.statusCode, 200);
    assert.ok(authLoopback.headers['content-disposition'].includes('attachment; filename="arya-dock-config-'));
    assert.ok(authLoopback.headers['content-type'].includes('application/json'));
    assert.equal(authLoopback.json.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.ok(Array.isArray(authLoopback.json.workspaces));
    assert.ok(authLoopback.json.workspaces.length > 0);
    assert.ok(typeof authLoopback.json.profiles === 'object');
    assert.ok(typeof authLoopback.json.exportedAt === 'number');

    // Verify internal credentials are not leaked in export
    assert.equal(authLoopback.json.pairingToken, undefined);
    assert.equal(authLoopback.json.editorKey, undefined);

    // 3. HEAD request -> 200 with headers but empty body
    const headRes = await makeRequest(port, '/api/config/export', {
      method: 'HEAD',
      headers: {
        'x-pairing-token': pairingToken
      }
    });
    assert.equal(headRes.statusCode, 200);
    assert.ok(headRes.headers['content-disposition'].includes('attachment; filename="arya-dock-config-'));
    assert.equal(headRes.body, '');

    // 4. Method not allowed (PUT, DELETE) -> 405
    const putRes = await makeRequest(port, '/api/config/export', {
      method: 'PUT',
      headers: { 'x-pairing-token': pairingToken }
    });
    assert.equal(putRes.statusCode, 405);
    assert.equal(putRes.json.code, 'ERR_METHOD_NOT_ALLOWED');
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HTTP Export: Remote operator without editor key returns 403 Forbidden', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-export-remote-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({
    configPath,
    authPath,
    mockClientIp: '192.168.1.188'
  });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const { pairingToken, editorKey } = app.credentials;

    // Operator has pairing token but no editor key -> 403
    const opRes = await makeRequest(port, '/api/config/export', {
      headers: {
        'x-pairing-token': pairingToken
      }
    });
    assert.equal(opRes.statusCode, 403);
    assert.equal(opRes.json.code, 'ERR_FORBIDDEN');

    // Remote client with editor key -> 200
    const edRes = await makeRequest(port, '/api/config/export', {
      headers: {
        'x-pairing-token': pairingToken,
        'x-editor-key': editorKey
      }
    });
    assert.equal(edRes.statusCode, 200);
    assert.equal(edRes.json.schemaVersion, CURRENT_SCHEMA_VERSION);
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HTTP Import: POST /api/config/import validation, persistence, and pre-import backup', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-import-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const { pairingToken, editorKey } = app.credentials;

    // 1. Invalid Content-Type -> 400
    const badContentType = await makeRequest(port, '/api/config/import', {
      method: 'POST',
      headers: {
        'x-pairing-token': pairingToken,
        'Content-Type': 'text/plain'
      },
      body: 'hello'
    });
    assert.equal(badContentType.statusCode, 400);
    assert.equal(badContentType.json.code, 'ERR_INVALID_CONTENT_TYPE');

    // 2. Malformed JSON -> 400
    const malformed = await makeRequest(port, '/api/config/import', {
      method: 'POST',
      headers: {
        'x-pairing-token': pairingToken,
        'Content-Type': 'application/json'
      },
      body: '{ not valid json '
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json.code, 'ERR_INVALID_JSON');

    // 3. Prototype pollution injection payload -> 400
    const protoAttack = await makeRequest(port, '/api/config/import', {
      method: 'POST',
      headers: {
        'x-pairing-token': pairingToken,
        'Content-Type': 'application/json'
      },
      body: '{"__proto__": {"evil": "true"}, "workspaces": []}'
    });
    assert.equal(protoAttack.statusCode, 400);
    assert.equal(protoAttack.json.code, 'ERR_INVALID_JSON');

    // 4. Schema validation failure (> 15 buttons per page) -> 400
    const overflowButtons = [];
    for (let i = 0; i < 20; i++) {
      overflowButtons.push({ id: i, label: `Tile ${i}`, actionType: 'shell', command: 'ls' });
    }
    const overflowPayload = {
      schemaVersion: 2,
      activeWorkspaceId: 'overflow-test',
      workspaces: [{
        id: 'overflow-test',
        name: 'Overflow Test',
        pages: [{ pageNumber: 1, name: 'Page 1', buttons: overflowButtons }]
      }]
    };
    const invalidSchema = await makeRequest(port, '/api/config/import', {
      method: 'POST',
      headers: {
        'x-pairing-token': pairingToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(overflowPayload)
    });
    assert.equal(invalidSchema.statusCode, 400);
    assert.equal(invalidSchema.json.code, 'ERR_INVALID_SCHEMA');

    // 5. Valid Schema v2 Import -> 200, persists to disk, and creates pre-import backup
    const newWorkspaceConfig = {
      schemaVersion: 2,
      activeWorkspaceId: 'ws-imported',
      workspaces: [
        {
          id: 'ws-imported',
          name: 'Imported Deck',
          icon: '🚀',
          pages: [
            {
              pageNumber: 1,
              name: 'Page 1',
              buttons: [
                { id: 0, label: 'Git Pull', actionType: 'shell', command: 'git pull', color: '#10b981' }
              ]
            }
          ]
        }
      ]
    };

    const validImport = await makeRequest(port, '/api/config/import', {
      method: 'POST',
      headers: {
        'x-pairing-token': pairingToken,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(newWorkspaceConfig)
    });

    assert.equal(validImport.statusCode, 200);
    assert.equal(validImport.json.status, 'ok');
    assert.equal(validImport.json.workspaceCount, 1);
    assert.equal(validImport.json.activeWorkspaceId, 'ws-imported');

    // Verify in-memory state updated
    const currentConfig = app.getConfig();
    assert.equal(currentConfig.activeWorkspaceId, 'ws-imported');
    assert.equal(currentConfig.workspaces.length, 1);
    assert.equal(currentConfig.workspaces[0].name, 'Imported Deck');

    // Verify disk state persisted
    const diskContent = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(diskContent.activeWorkspaceId, 'ws-imported');
    assert.equal(diskContent.workspaces[0].id, 'ws-imported');

    // Verify pre-import timestamped backup was created
    const files = fs.readdirSync(tmpDir);
    const backupFiles = files.filter(f => f.startsWith('profiles.json.bak.'));
    assert.ok(backupFiles.length > 0, 'Expected timestamped backup file to exist');
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HTTP Import: 2MB payload cap enforcement aborts socket and returns 413', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-import-2mb-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const { pairingToken } = app.credentials;

    // Send a chunked stream larger than 2MB
    const resPromise = new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/config/import',
        method: 'POST',
        headers: {
          'x-pairing-token': pairingToken,
          'Content-Type': 'application/json',
          'Transfer-Encoding': 'chunked'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ statusCode: res.statusCode, json });
        });
      });

      req.on('error', (err) => {
        // Socket destruction is expected on 2MB overflow
        resolve({ statusCode: 413, error: err });
      });

      // Write 2.5MB of data in 256KB chunks
      const chunk = Buffer.alloc(256 * 1024, 'a');
      for (let i = 0; i < 10; i++) {
        req.write(chunk);
      }
      req.end();
    });

    const res = await resPromise;
    assert.equal(res.statusCode, 413);
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('HTTP Import: Debounce save cancellation and WebSocket client navigation reconciliation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-import-ws-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${app.credentials.pairingToken}`);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const { pairingToken } = app.credentials;

    // 1. Client selects 'media' workspace
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    await new Promise(resolve => setTimeout(resolve, 50));

    // 2. Client triggers a button update causing debounced save (hasPendingSave = true)
    app.saveConfig(false);
    assert.equal(app.hasPendingSave(), true);

    // 3. Editor posts an import that replaces workspaces with a new one
    const importedConfig = {
      schemaVersion: 2,
      activeWorkspaceId: 'k8s-ops',
      workspaces: [
        {
          id: 'k8s-ops',
          name: 'K8s Operations',
          icon: '☸️',
          pages: [{ pageNumber: 1, name: 'Main', buttons: [{ id: 0, label: 'Pods', actionType: 'shell', command: 'kubectl get pods' }] }]
        }
      ]
    };

    const importRes = await makeRequest(port, '/api/config/import', {
      method: 'POST',
      headers: {
        'x-pairing-token': pairingToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(importedConfig)
    });
    assert.equal(importRes.statusCode, 200);

    // 4. Verify debouncer was cleared and pending save is false
    assert.equal(app.hasPendingSave(), false);

    // 5. Wait past debounce interval (300ms) to ensure no delayed save overwrote the import
    await new Promise(resolve => setTimeout(resolve, 350));
    const finalDiskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(finalDiskConfig.activeWorkspaceId, 'k8s-ops');
    assert.equal(finalDiskConfig.workspaces[0].id, 'k8s-ops');

    // 6. Verify WebSocket client's navState was migrated from deleted 'media' workspace to 'k8s-ops'
    const clients = Array.from(app.wss.clients);
    assert.equal(clients.length, 1);
    assert.equal(clients[0].navState.workspaceId, 'k8s-ops');
    assert.equal(clients[0].navState.pageIndex, 0);
  } finally {
    ws.close();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
