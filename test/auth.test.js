const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
  safeEqual,
  isAllowedOrigin,
  isLocalAddress,
  getRole,
  loadOrCreateAuth,
  rotateAuthCredentials,
  resolvePath
} = require('../lib/auth');

test('Auth: safeEqual constant-time comparison', () => {
  assert.equal(safeEqual('secret123', 'secret123'), true);
  assert.equal(safeEqual('secret123', 'secret124'), false);
  assert.equal(safeEqual('short', 'longer_string'), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual(null, 'secret'), false);
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual(123, 123), false);
});

test('Auth: resolvePath path expansion and control character sanitization', () => {
  const home = os.homedir();
  assert.equal(resolvePath(''), '');
  assert.equal(resolvePath('~'), home);
  assert.equal(resolvePath('$HOME'), home);
  assert.equal(resolvePath('~/config/auth.json'), path.join(home, 'config/auth.json'));
  assert.equal(resolvePath('$HOME/config/auth.json'), path.join(home, 'config/auth.json'));
  assert.equal(resolvePath('/etc/auth.json'), path.resolve('/etc/auth.json'));
  assert.equal(resolvePath('path/with\0null'), '');
  assert.equal(resolvePath('path/with\nnewline'), '');
});

test('Auth: isAllowedOrigin checks', () => {
  const allowedIps = ['192.168.1.50', '10.91.187.251'];

  // Missing origin (CLI/non-browser) is permitted
  assert.equal(isAllowedOrigin(undefined, 'localhost:3333', allowedIps), true);
  assert.equal(isAllowedOrigin(null, 'localhost:3333', allowedIps), true);
  assert.equal(isAllowedOrigin('', 'localhost:3333', allowedIps), true);

  // Exact matching host header
  assert.equal(isAllowedOrigin('http://localhost:3333', 'localhost:3333', allowedIps), true);
  assert.equal(isAllowedOrigin('http://192.168.1.50:3333', '192.168.1.50:3333', allowedIps), true);

  // Allowed local IPs
  assert.equal(isAllowedOrigin('http://127.0.0.1:3333', 'localhost:3333', allowedIps), true);
  assert.equal(isAllowedOrigin('http://10.91.187.251:3333', 'localhost:3333', allowedIps), true);

  // Foreign or malicious origins must be rejected (even if Host header matches Origin)
  assert.equal(isAllowedOrigin('https://evil.example', 'localhost:3333', allowedIps), false);
  assert.equal(isAllowedOrigin('http://evil.example:3333', 'localhost:3333', allowedIps), false);
  assert.equal(isAllowedOrigin('http://evil.example:3333', 'evil.example:3333', allowedIps), false);
  assert.equal(isAllowedOrigin('http://localhost:3333', 'evil.example:3333', allowedIps), false);
  assert.equal(isAllowedOrigin('https://attacker.site', '192.168.1.50:3333', allowedIps), false);
  assert.equal(isAllowedOrigin('http://localhost:8080', 'localhost:3333', allowedIps), false);
  assert.equal(isAllowedOrigin('javascript:alert(1)', 'localhost:3333', allowedIps), false);
  assert.equal(isAllowedOrigin('file:///etc/passwd', 'localhost:3333', allowedIps), false);
});

test('Auth: isLocalAddress checks', () => {
  assert.equal(isLocalAddress('127.0.0.1'), true);
  assert.equal(isLocalAddress('127.0.1.1'), true);
  assert.equal(isLocalAddress('127.0.0.2'), true);
  assert.equal(isLocalAddress('127.255.255.255'), true);
  assert.equal(isLocalAddress('::1'), true);
  assert.equal(isLocalAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLocalAddress('::ffff:127.0.1.1'), true);
  assert.equal(isLocalAddress('localhost'), true);

  assert.equal(isLocalAddress('192.168.1.50'), false);
  assert.equal(isLocalAddress('10.91.187.251'), false);
  assert.equal(isLocalAddress('8.8.8.8'), false);
  assert.equal(isLocalAddress('1270.0.0.1'), false);
  assert.equal(isLocalAddress(null), false);
});

test('Auth: getRole privilege assignment', () => {
  const editorKey = 'admin_editor_secret_key_12345';

  // Localhost is always editor
  assert.equal(getRole('127.0.0.1', null, editorKey), 'editor');
  assert.equal(getRole('::1', 'wrong_key', editorKey), 'editor');

  // Remote address without editorKey is operator
  assert.equal(getRole('192.168.1.100', null, editorKey), 'operator');
  assert.equal(getRole('192.168.1.100', 'wrong_key', editorKey), 'operator');

  // Remote address with valid editorKey is editor
  assert.equal(getRole('192.168.1.100', editorKey, editorKey), 'editor');
});

test('Auth: loadOrCreateAuth persists and generates credentials', () => {
  const tmpAuth = path.join(os.tmpdir(), `arya-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const creds1 = loadOrCreateAuth(tmpAuth);
    assert.ok(creds1.pairingToken);
    assert.ok(creds1.editorKey);
    assert.equal(creds1.pairingToken.length, 32);
    assert.equal(creds1.editorKey.length, 32);

    // Second call should reload same credentials
    const creds2 = loadOrCreateAuth(tmpAuth);
    assert.equal(creds2.pairingToken, creds1.pairingToken);
    assert.equal(creds2.editorKey, creds1.editorKey);

    // rotateAuthCredentials generates new credentials and updates disk
    const rotated = rotateAuthCredentials(tmpAuth);
    assert.ok(rotated.pairingToken);
    assert.ok(rotated.editorKey);
    assert.notEqual(rotated.pairingToken, creds1.pairingToken);
    assert.notEqual(rotated.editorKey, creds1.editorKey);

    const reloaded = loadOrCreateAuth(tmpAuth);
    assert.equal(reloaded.pairingToken, rotated.pairingToken);
    assert.equal(reloaded.editorKey, rotated.editorKey);
  } finally {
    if (fs.existsSync(tmpAuth)) fs.unlinkSync(tmpAuth);
  }
});

test('Auth: --rotate-credentials CLI flag rotates credentials and exits', () => {
  const tmpAuth = path.join(os.tmpdir(), `arya-cli-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const creds1 = loadOrCreateAuth(tmpAuth);
    const serverScript = path.join(__dirname, '..', 'server.js');
    const authScript = path.join(__dirname, '..', 'lib', 'auth.js');

    // Test on server.js
    const outputServer = execSync(`node "${serverScript}" --rotate-credentials`, {
      env: { ...process.env, AUTH_PATH: tmpAuth },
      encoding: 'utf-8'
    });
    assert.ok(outputServer.includes('Credentials rotated successfully'));
    assert.match(outputServer, /Restart of running server is required/i);

    const creds2 = loadOrCreateAuth(tmpAuth);
    assert.notEqual(creds2.pairingToken, creds1.pairingToken);
    assert.notEqual(creds2.editorKey, creds1.editorKey);

    // Test on lib/auth.js
    const outputAuth = execSync(`node "${authScript}" --rotate-credentials`, {
      env: { ...process.env, AUTH_PATH: tmpAuth },
      encoding: 'utf-8'
    });
    assert.ok(outputAuth.includes('Credentials rotated successfully'));
    assert.match(outputAuth, /Restart of running server is required/i);

    const creds3 = loadOrCreateAuth(tmpAuth);
    assert.notEqual(creds3.pairingToken, creds2.pairingToken);
    assert.notEqual(creds3.editorKey, creds2.editorKey);
  } finally {
    if (fs.existsSync(tmpAuth)) fs.unlinkSync(tmpAuth);
  }
});

test('Auth: --rotate-credentials --start rotates credentials and starts server', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-rotatestart-'));
  const tmpAuth = path.join(tmpDir, 'auth.json');
  const tmpConfig = path.join(tmpDir, 'profiles.json');
  const serverScript = path.join(__dirname, '..', 'server.js');

  try {
    const creds1 = loadOrCreateAuth(tmpAuth);
    const { spawn } = require('child_process');

    const proc = spawn('node', [serverScript, '--rotate-credentials', '--start'], {
      env: {
        ...process.env,
        AUTH_PATH: tmpAuth,
        CONFIG_PATH: tmpConfig,
        PORT: '0',
        HOST: '127.0.0.1'
      }
    });

    let output = '';
    await new Promise((resolve, reject) => {
      proc.stdout.on('data', (d) => {
        output += d.toString();
        if (output.includes('ARYA DOCK — VIRTUAL KEYPAD CONSOLE')) {
          resolve();
        }
      });
      proc.stderr.on('data', (d) => {
        output += d.toString();
      });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (!output.includes('ARYA DOCK — VIRTUAL KEYPAD CONSOLE')) {
          reject(new Error(`Server exited prematurely with code ${code}. Output: ${output}`));
        }
      });
    });

    assert.ok(output.includes('Credentials rotated successfully'));
    const creds2 = loadOrCreateAuth(tmpAuth);
    assert.notEqual(creds2.pairingToken, creds1.pairingToken);
    assert.notEqual(creds2.editorKey, creds1.editorKey);
    assert.ok(output.includes(creds2.pairingToken));

    proc.kill('SIGTERM');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Auth: ARYA_PAIRING_TOKEN and ARYA_EDITOR_KEY env overrides', () => {
  const tmpAuth = path.join(os.tmpdir(), `arya-env-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const origPairing = process.env.ARYA_PAIRING_TOKEN;
  const origEditor = process.env.ARYA_EDITOR_KEY;

  try {
    process.env.ARYA_PAIRING_TOKEN = 'custom_pairing_token_1234567890';
    process.env.ARYA_EDITOR_KEY = 'custom_editor_key_123456789012';

    const creds = loadOrCreateAuth(tmpAuth);
    assert.equal(creds.pairingToken, 'custom_pairing_token_1234567890');
    assert.equal(creds.editorKey, 'custom_editor_key_123456789012');
  } finally {
    if (origPairing !== undefined) process.env.ARYA_PAIRING_TOKEN = origPairing;
    else delete process.env.ARYA_PAIRING_TOKEN;
    if (origEditor !== undefined) process.env.ARYA_EDITOR_KEY = origEditor;
    else delete process.env.ARYA_EDITOR_KEY;
    if (fs.existsSync(tmpAuth)) fs.unlinkSync(tmpAuth);
  }
});

function makeRequest(port, reqPath, headers = {}) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port,
      path: reqPath,
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('Auth: credential rotation restart-required policy verification', async () => {
  const { createServer } = require('../server');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-restart-policy-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  try {
    // Start active server app1 with remote client IP to test both pairingToken and editorKey barriers
    const app1 = createServer({ configPath, authPath, mockClientIp: '192.168.1.185' });
    await new Promise(resolve => app1.server.listen(0, '127.0.0.1', resolve));
    const port1 = app1.server.address().port;
    const initialToken = app1.credentials.pairingToken;
    const initialEditorKey = app1.credentials.editorKey;

    // 1. Initial credentials succeed on active server for remote editor
    const res1 = await makeRequest(port1, '/api/apps', {
      'x-pairing-token': initialToken,
      'x-editor-key': initialEditorKey
    });
    assert.equal(res1.statusCode, 200);

    // 2. Rotate credentials on disk
    const rotated = rotateAuthCredentials(authPath);
    assert.notEqual(rotated.pairingToken, initialToken);
    assert.notEqual(rotated.editorKey, initialEditorKey);

    // 3. Active server STILL accepts initial credentials (in-memory credentials unchanged)
    const resStillValid = await makeRequest(port1, '/api/apps', {
      'x-pairing-token': initialToken,
      'x-editor-key': initialEditorKey
    });
    assert.equal(resStillValid.statusCode, 200);

    // 4. Active server REJECTS newly rotated pairing token because restart is required
    const resNewTokenRejected = await makeRequest(port1, '/api/apps', {
      'x-pairing-token': rotated.pairingToken,
      'x-editor-key': initialEditorKey
    });
    assert.equal(resNewTokenRejected.statusCode, 401);

    // 4b. Active server REJECTS newly rotated editor key because restart is required
    const resNewEditorRejected = await makeRequest(port1, '/api/apps', {
      'x-pairing-token': initialToken,
      'x-editor-key': rotated.editorKey
    });
    assert.equal(resNewEditorRejected.statusCode, 403);

    // 5. Close running server and restart (boot new server instance app2 with rotated disk credentials)
    await new Promise(resolve => app1.close(resolve));

    const app2 = createServer({ configPath, authPath, mockClientIp: '192.168.1.185' });
    await new Promise(resolve => app2.server.listen(0, '127.0.0.1', resolve));
    const port2 = app2.server.address().port;

    // 6. After restart, old pairing token is now REJECTED (401)
    const resOldTokenAfterRestart = await makeRequest(port2, '/api/apps', {
      'x-pairing-token': initialToken,
      'x-editor-key': rotated.editorKey
    });
    assert.equal(resOldTokenAfterRestart.statusCode, 401);

    // 6b. After restart, old editor key is now REJECTED (403)
    const resOldEditorAfterRestart = await makeRequest(port2, '/api/apps', {
      'x-pairing-token': rotated.pairingToken,
      'x-editor-key': initialEditorKey
    });
    assert.equal(resOldEditorAfterRestart.statusCode, 403);

    // 7. After restart, new rotated credentials are now ACCEPTED (200)
    const resNewCredsAfterRestart = await makeRequest(port2, '/api/apps', {
      'x-pairing-token': rotated.pairingToken,
      'x-editor-key': rotated.editorKey
    });
    assert.equal(resNewCredsAfterRestart.statusCode, 200);

    await new Promise(resolve => app2.close(resolve));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
