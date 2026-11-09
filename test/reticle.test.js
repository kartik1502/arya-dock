'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const WebSocket = require('ws');
const { createServer } = require('../server');

const rootDir = path.resolve(__dirname, '..');
const flowsDir = path.join(rootDir, '.reticle', 'flows', 'arya-dock-4f274f15');

function createMessageQueue(ws) {
  const queue = [];
  let waiter = null;
  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(data);
    } else {
      queue.push(data);
    }
  });
  return function nextMessage() {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift());
    }
    return new Promise(resolve => {
      waiter = resolve;
    });
  };
}

test('Reticle: Predefined flow definitions exist and conform to Reticle v2 schema', () => {
  assert.ok(fs.existsSync(flowsDir), `Flows directory must exist: ${flowsDir}`);

  const requiredFlows = [
    'deck-pagination.json',
    'mode-switch.json',
    'tile-count-adjustment.json',
    'app-catalog-drawer.json',
    'editor-mode-security.json',
    'category-lens-switching.json',
    'workspace-settings-modal.json',
    'workspace-lifecycle.json',
    'active-window-auto-switching.json',
    'companion-deck-state.json',
    'config-import-export.json',
    'folder-navigation.json',
    'onboarding-wizard.json'
  ];

  for (const flowFileName of requiredFlows) {
    const filePath = path.join(flowsDir, flowFileName);
    assert.ok(fs.existsSync(filePath), `Required Reticle flow ${flowFileName} must exist`);

    const flow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(flow.version, 2, `${flowFileName}: must be schema version 2`);
    assert.equal(flow.projectId, 'arya-dock-4f274f15', `${flowFileName}: projectId must match`);
    assert.ok(typeof flow.name === 'string' && flow.name.length > 0, `${flowFileName}: must have a name`);
    assert.ok(typeof flow.intent === 'string' && flow.intent.length > 0, `${flowFileName}: must describe intent`);
    assert.ok(Array.isArray(flow.requires), `${flowFileName}: must define preconditions`);
    assert.ok(Array.isArray(flow.ensures), `${flowFileName}: must define postconditions`);
    assert.ok(Array.isArray(flow.steps) && flow.steps.length > 0, `${flowFileName}: must define at least one step`);

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      assert.equal(step.tool, 'reticle_act', `${flowFileName} step ${i}: must use tool 'reticle_act'`);
      assert.ok(step.anchor, `${flowFileName} step ${i}: must have an anchor`);
      assert.ok(step.anchor.kind, `${flowFileName} step ${i}: anchor must have kind`);
      assert.ok(typeof step.action === 'string', `${flowFileName} step ${i}: action must be a string`);
      assert.ok(step.expect, `${flowFileName} step ${i}: must define expectation`);
    }
  }
});

test('Reticle: Verification layer assets and offline bundle integrity', () => {
  // 1. .reticle.json project metadata
  const reticleConfigPath = path.join(rootDir, '.reticle.json');
  assert.ok(fs.existsSync(reticleConfigPath), '.reticle.json must exist');
  const reticleConfig = JSON.parse(fs.readFileSync(reticleConfigPath, 'utf8'));
  assert.equal(reticleConfig.projectId, 'arya-dock-4f274f15');
  assert.equal(reticleConfig.framework, 'html');

  // 2. public/reticle.js local bundle exists and is valid JS
  const reticleBundlePath = path.join(rootDir, 'public', 'reticle.js');
  assert.ok(fs.existsSync(reticleBundlePath), 'public/reticle.js must exist for offline verification');
  const bundleContent = fs.readFileSync(reticleBundlePath, 'utf8');
  assert.ok(bundleContent.length > 10000, 'public/reticle.js must be a populated bundle');
  assert.ok(bundleContent.includes('ReticleSdk') || bundleContent.includes('reticle'), 'bundle must contain Reticle SDK');

  // 3. public/index.html includes Reticle module and segregation controls
  const htmlPath = path.join(rootDir, 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('reticle.js') || html.includes('reticle'), 'index.html must load Reticle');
  assert.ok(html.includes('arya-dock-4f274f15'), 'index.html must reference project id');
  assert.ok(html.includes('categoryLensStrip'), 'index.html must include category lens strip');
  assert.ok(html.includes('workspaceSettingsModal'), 'index.html must include workspace settings modal');

  // 4. Content Security Policy permits local loopback daemon connections
  const httpHandlerFile = fs.readFileSync(path.join(rootDir, 'lib', 'http.js'), 'utf8');
  assert.ok(httpHandlerFile.includes('http://127.0.0.1:*'), 'CSP must allow local HTTP daemon');
  assert.ok(httpHandlerFile.includes('ws://127.0.0.1:*'), 'CSP must allow local WS daemon');
});

test('Reticle Predefined Flow Replay: Deck Pagination (deck-pagination)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-flow-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    assert.equal(initMsg.pageNumber, 1, 'Initial page is 1');
    const totalPages = initMsg.totalPages || 2;

    // Step 1: Click "NEXT ▶" -> expectation: PAGE 2/2
    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
    const update1 = await nextMsg();
    assert.equal(update1.type, 'STATE_UPDATE');
    assert.equal(update1.pageNumber, 2, 'Advanced to Page 2');
    assert.equal(`PAGE ${update1.pageNumber}/${totalPages}`, 'PAGE 2/2');

    // Step 2: Click "◀ PREV" -> expectation: PAGE 1/2
    ws.send(JSON.stringify({ type: 'PAGE_PREV' }));
    const update2 = await nextMsg();
    assert.equal(update2.type, 'STATE_UPDATE');
    assert.equal(update2.pageNumber, 1, 'Returned to Page 1');
    assert.equal(`PAGE ${update2.pageNumber}/${totalPages}`, 'PAGE 1/2');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Mode Switching (mode-switch)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-mode-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    assert.equal(initMsg.activeProfileId, 'developer');

    // Step 1: Click "M2 MEDIA & TELEMETRY" -> switch to media profile
    ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: 'media' }));
    const update1 = await nextMsg();
    assert.equal(update1.type, 'STATE_UPDATE');
    assert.equal(update1.activeProfileId, 'media', 'Switched to media profile');
    assert.ok(update1.buttons.length > 0, 'Media profile buttons loaded');

    // Step 2: Click "M1 DEV COCKPIT" -> switch back to developer profile
    ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: 'developer' }));
    const update2 = await nextMsg();
    assert.equal(update2.type, 'STATE_UPDATE');
    assert.equal(update2.activeProfileId, 'developer', 'Restored developer profile');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Tile Count Adjustment (tile-count-adjustment)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-tile-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    const initialCount = initMsg.buttons.length;

    // Step 1: Click "+" -> increment tile count
    ws.send(JSON.stringify({ type: 'SET_BUTTONS_COUNT', count: initialCount + 1 }));
    const incMsg = await nextMsg();
    assert.equal(incMsg.type, 'STATE_UPDATE');
    assert.equal(incMsg.buttons.length, initialCount + 1, 'Tile count incremented by 1');

    // Step 2: Click "−" -> decrement tile count
    ws.send(JSON.stringify({ type: 'SET_BUTTONS_COUNT', count: initialCount }));
    const decMsg = await nextMsg();
    assert.equal(decMsg.type, 'STATE_UPDATE');
    assert.equal(decMsg.buttons.length, initialCount, 'Tile count decremented back');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: App Catalog Drawer Endpoint (app-catalog-drawer)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-drawer-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  try {
    const fetchJson = (urlPath) => new Promise((resolve, reject) => {
      http.get({
        host: '127.0.0.1',
        port,
        path: `${urlPath}?token=${token}`
      }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(body) }));
      }).on('error', reject);
    });

    const appsRes = await fetchJson('/api/apps');
    assert.equal(appsRes.statusCode, 200, '/api/apps returns 200');
    assert.ok(Array.isArray(appsRes.data), '/api/apps returns array of applications');

    const dirsRes = await fetchJson('/api/directories');
    assert.equal(dirsRes.statusCode, 200, '/api/directories returns 200');
    assert.ok(Array.isArray(dirsRes.data), '/api/directories returns array of suggestions');
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Editor Mode Security Barrier (editor-mode-security)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-security-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  // Start with remote IP so client is operator, not local editor
  const app = createServer({
    configPath,
    authPath,
    mockClientIp: '192.168.1.200'
  });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;
  const editorKey = app.credentials.editorKey;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.role, 'operator', 'Remote client starts as operator role (editor mode locked)');
    assert.equal(initMsg.canEdit, false);

    // Step 1: Operator attempts an unauthorized button mutation -> rejected with ERROR
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: { id: 0, label: 'HACKED' }
    }));
    const rejectMsg = await nextMsg();
    assert.equal(rejectMsg.type, 'ERROR');
    assert.ok(rejectMsg.message.includes('Unauthorized'));

    // Step 2: Elevate with valid editorKey
    ws.send(JSON.stringify({
      type: 'AUTH_EDIT',
      editKey: editorKey
    }));
    const elevatedMsg = await nextMsg();
    assert.equal(elevatedMsg.type, 'ROLE_UPDATE');
    assert.equal(elevatedMsg.role, 'editor', 'Client successfully elevated to editor');
    assert.equal(elevatedMsg.canEdit, true);

    // Step 3: Editor performs authorized update
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: { id: 0, label: 'VERIFIED EDIT' }
    }));
    const updateMsg = await nextMsg();
    assert.equal(updateMsg.type, 'STATE_UPDATE', 'Authorized button edit succeeds in editor role');
    const updatedBtn = updateMsg.buttons.find(b => b.id === 0);
    assert.ok(updatedBtn);
    assert.equal(updatedBtn.label, 'VERIFIED EDIT');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Category Lens Switching (category-lens-switching)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-lens-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    assert.ok(initMsg.allButtons, 'INIT message includes allButtons array');
    assert.ok(Array.isArray(initMsg.allButtons));
    assert.ok(initMsg.segregation, 'INIT message includes segregation config');
    assert.equal(typeof initMsg.segregation.enabled, 'boolean');

    // Step 1: Editor toggles segregation enabled -> verify STATE_UPDATE includes segregation and allButtons
    ws.send(JSON.stringify({ type: 'TOGGLE_SEGREGATION', enabled: true }));
    const update1 = await nextMsg();
    assert.equal(update1.type, 'STATE_UPDATE');
    assert.equal(update1.segregation.enabled, true, 'Segregation enabled in STATE_UPDATE');
    assert.ok(Array.isArray(update1.allButtons), 'allButtons array broadcasted');

    // Verify classifier categorizes buttons across categories
    const { classifyButton, getCategoryProjection } = require('../lib/segregation');
    const categories = new Set(update1.allButtons.map(b => classifyButton(b)));
    assert.ok(categories.size > 0, 'Classified buttons present in allButtons');

    // Verify virtual projection chunking with MAX_BUTTONS_PER_PAGE = 15
    const terminalProjection = getCategoryProjection({ pages: [{ buttons: update1.buttons }] }, 'terminal');
    assert.ok(terminalProjection.length > 0, 'Virtual projection produces terminal pages');
    assert.ok(terminalProjection[0].buttons.length <= 15, 'Virtual projection page <= 15 tiles');

    // Step 2: Editor switches back to ALL mode by toggling segregation off
    ws.send(JSON.stringify({ type: 'TOGGLE_SEGREGATION', enabled: false }));
    const update2 = await nextMsg();
    assert.equal(update2.type, 'STATE_UPDATE');
    assert.equal(update2.segregation.enabled, false, 'Segregation disabled in STATE_UPDATE');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Workspace Settings Modal & Segregation Toggle (workspace-settings-modal)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-modal-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  // Start with remote IP to test operator security barrier
  const app = createServer({
    configPath,
    authPath,
    debounceMs: 0,
    mockClientIp: '192.168.1.205'
  });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;
  const editorKey = app.credentials.editorKey;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.role, 'operator');
    assert.equal(initMsg.canEdit, false);

    // Step 1: Operator attempts TOGGLE_SEGREGATION -> rejected with ERROR
    ws.send(JSON.stringify({ type: 'TOGGLE_SEGREGATION', enabled: true }));
    const rejectMsg = await nextMsg();
    assert.equal(rejectMsg.type, 'ERROR');
    assert.ok(rejectMsg.message.includes('Unauthorized'));

    // Step 2: Elevate to editor role
    ws.send(JSON.stringify({ type: 'AUTH_EDIT', editKey: editorKey }));
    const elevatedMsg = await nextMsg();
    assert.equal(elevatedMsg.type, 'ROLE_UPDATE');
    assert.equal(elevatedMsg.role, 'editor');

    // Step 3: Editor toggles segregation enabled -> persists to disk
    ws.send(JSON.stringify({ type: 'TOGGLE_SEGREGATION', enabled: true }));
    const updateMsg = await nextMsg();
    assert.equal(updateMsg.type, 'STATE_UPDATE');
    assert.equal(updateMsg.segregation.enabled, true);

    // Verify atomic disk persistence
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const activeWorkspace = savedConfig.workspaces.find(w => w.id === (savedConfig.activeWorkspaceId || 'developer'));
    assert.ok(activeWorkspace, 'Active workspace found');
    assert.ok(activeWorkspace.segregation, 'Saved workspace has segregation object');
    assert.equal(activeWorkspace.segregation.enabled, true, 'Disk persistence reflects enabled segregation');

    // Step 4: Toggle off again and verify disk persistence
    ws.send(JSON.stringify({ type: 'TOGGLE_SEGREGATION', enabled: false }));
    const updateOff = await nextMsg();
    assert.equal(updateOff.type, 'STATE_UPDATE');
    assert.equal(updateOff.segregation.enabled, false);

    const savedConfigOff = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const activeWsOff = savedConfigOff.workspaces.find(w => w.id === (savedConfigOff.activeWorkspaceId || 'developer'));
    assert.ok(activeWsOff, 'Active workspace found');
    assert.equal(activeWsOff.segregation.enabled, false);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Active Window Auto-Switching & Pinning (active-window-auto-switching)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-active-win-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  let activeWindowEmitter = null;
  const fakeAdapter = require('../platform').adapters.fake.createFakeAdapter({
    createActiveWindowStream: (onChange) => {
      activeWindowEmitter = onChange;
      return { stop: () => {} };
    }
  });
  fakeAdapter.capabilities = () => ({ activeWindow: true, media: true, applications: true });

  const app = createServer({
    configPath,
    authPath,
    platformAdapter: fakeAdapter,
    debounceMs: 0
  });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    assert.equal(initMsg.workspaceId, 'developer');

    // Step 1: Pin workspace via WebSocket PIN action
    ws.send(JSON.stringify({ type: 'PIN' }));
    const pinUpdate = await nextMsg();
    assert.equal(pinUpdate.type, 'STATE_UPDATE');
    assert.equal(pinUpdate.navigation.pinned, true);
    assert.equal(pinUpdate.navigation.mode, 'manual');

    // Step 2: Switch to M2 Media workspace manually
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    const wsUpdate = await nextMsg();
    assert.equal(wsUpdate.type, 'STATE_UPDATE');
    assert.equal(wsUpdate.workspaceId, 'media');

    // Step 3: Unpin workspace to restore auto-switching
    ws.send(JSON.stringify({ type: 'UNPIN' }));
    const unpinUpdate = await nextMsg();
    assert.equal(unpinUpdate.type, 'STATE_UPDATE');
    assert.equal(unpinUpdate.navigation.pinned, false);
    assert.equal(unpinUpdate.navigation.mode, 'auto');

    // Step 4: Focus shift to code automatically navigates to developer
    assert.ok(activeWindowEmitter, 'Watcher emitter must be active');
    activeWindowEmitter('code');
    const autoUpdate = await nextMsg();
    assert.equal(autoUpdate.type, 'STATE_UPDATE');
    assert.equal(autoUpdate.workspaceId, 'developer');
    assert.equal(autoUpdate.navigation.workspaceId, 'developer');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle: companion-deck-state replay passes against Arya Dock live backend', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-reticle-companion-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({
    configPath,
    authPath,
    debounceMs: 0
  });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    assert.equal(initMsg.workspaceId, 'developer');

    // Step 1: Pin companion deck
    ws.send(JSON.stringify({ type: 'PIN' }));
    const pinUpdate = await nextMsg();
    assert.equal(pinUpdate.type, 'STATE_UPDATE');
    assert.equal(pinUpdate.navigation.pinned, true);

    // Step 2: Switch to M2 Media
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    const mediaUpdate = await nextMsg();
    assert.equal(mediaUpdate.type, 'STATE_UPDATE');
    assert.equal(mediaUpdate.workspaceId, 'media');

    // Step 3: Switch back to M1 Developer
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'developer' }));
    const devUpdate = await nextMsg();
    assert.equal(devUpdate.type, 'STATE_UPDATE');
    assert.equal(devUpdate.workspaceId, 'developer');

    // Step 4: Unpin companion deck
    ws.send(JSON.stringify({ type: 'UNPIN' }));
    const unpinUpdate = await nextMsg();
    assert.equal(unpinUpdate.type, 'STATE_UPDATE');
    assert.equal(unpinUpdate.navigation.pinned, false);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Workspace Lifecycle Management (workspace-lifecycle)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-lifecycle-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({
    configPath,
    authPath,
    debounceMs: 0
  });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.role, 'editor');

    // Step 1: Create new workspace 'DevOps Cockpit'
    ws.send(JSON.stringify({
      type: 'CREATE_WORKSPACE',
      name: 'DevOps Cockpit',
      icon: '🚀',
      matchApps: ['kubectl', 'docker', 'k9s']
    }));

    const createMsg = await nextMsg();
    assert.equal(createMsg.type, 'STATE_UPDATE');
    assert.equal(createMsg.workspaceName, 'DevOps Cockpit');
    assert.equal(createMsg.workspaceId, 'ws-devops-cockpit');
    assert.equal(createMsg.workspaceIcon, '🚀');
    assert.equal(createMsg.buttons.length, 0, 'New workspace initializes with 0 buttons');

    // Step 2: Verify disk persistence
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfig.activeWorkspaceId, 'ws-devops-cockpit');
    assert.ok(savedConfig.workspaces.some(w => w.id === 'ws-devops-cockpit'));

    // Step 3: Switch back to developer workspace
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'developer' }));
    const devMsg = await nextMsg();
    assert.equal(devMsg.type, 'STATE_UPDATE');
    assert.equal(devMsg.workspaceId, 'developer');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Configuration Export & Import Lifecycle (config-import-export)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-import-export-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({
    configPath,
    authPath,
    debounceMs: 0
  });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.role, 'editor');

    // Step 1: Export current configuration via HTTP GET
    const exportRes = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/config/export?token=${encodeURIComponent(token)}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(data) }));
      }).on('error', reject);
    });
    assert.equal(exportRes.statusCode, 200);
    assert.equal(exportRes.data.schemaVersion, 2);
    assert.ok(Array.isArray(exportRes.data.workspaces));

    // Step 2: Mutate configuration by importing a custom deck
    const importPayload = {
      schemaVersion: 2,
      activeWorkspaceId: 'stream-ops',
      workspaces: [
        {
          id: 'stream-ops',
          name: 'Streaming Cockpit',
          icon: '🎙️',
          pages: [
            {
              pageNumber: 1,
              name: 'Page 1',
              buttons: [
                { id: 0, label: 'Mute Mic', actionType: 'shell', command: 'pactl set-source-mute @DEFAULT_SOURCE@ toggle' }
              ]
            }
          ]
        }
      ]
    };

    const importRes = await new Promise((resolve, reject) => {
      const postReq = http.request(`http://127.0.0.1:${port}/api/config/import?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(data) }));
      });
      postReq.on('error', reject);
      postReq.write(JSON.stringify(importPayload));
      postReq.end();
    });
    assert.equal(importRes.statusCode, 200);
    assert.equal(importRes.data.status, 'ok');

    // Step 3: Verify WebSocket client receives real-time fan-out STATE_UPDATE
    const updateMsg = await nextMsg();
    assert.equal(updateMsg.type, 'STATE_UPDATE');
    assert.equal(updateMsg.workspaceId, 'stream-ops');
    assert.equal(updateMsg.workspaceName, 'Streaming Cockpit');
    assert.equal(updateMsg.buttons.length, 1);
    assert.equal(updateMsg.buttons[0].label, 'Mute Mic');

    // Step 4: Verify atomic disk persistence
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfig.activeWorkspaceId, 'stream-ops');
    assert.equal(savedConfig.workspaces[0].name, 'Streaming Cockpit');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Folder Sub-Deck Navigation (folder-navigation)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-folder-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');

    // Create a folder button with actionType: 'folder'
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: {
        id: 0,
        label: 'DEV SUITE',
        icon: '📁',
        actionType: 'folder'
      }
    }));
    const updateMsg = await nextMsg();
    assert.equal(updateMsg.type, 'STATE_UPDATE');
    const folderId = updateMsg.buttons[0].folderId;
    assert.ok(folderId, 'Folder ID must be provisioned');

    // Step 1: Reticle act - click folder button to enter sub-deck
    ws.send(JSON.stringify({ type: 'BUTTON_CLICK', buttonId: 0 }));
    const m1 = await nextMsg();
    const m2 = await nextMsg();
    const nav1 = (m1.type === 'NAV_CHANGE') ? m1 : m2;
    assert.equal(nav1.type, 'NAV_CHANGE');
    assert.deepEqual(nav1.folderStack, [folderId]);
    assert.equal(nav1.currentFolderName, 'DEV SUITE');
    assert.equal(nav1.buttons[0].id, '__back__');
    assert.equal(nav1.buttons[0].label, 'BACK');

    // Step 2: Reticle act - click Slot 0 Back button to leave folder
    ws.send(JSON.stringify({ type: 'BUTTON_CLICK', buttonId: '__back__' }));
    const m3 = await nextMsg();
    const m4 = await nextMsg();
    const nav2 = (m3.type === 'NAV_CHANGE') ? m3 : m4;
    assert.equal(nav2.type, 'NAV_CHANGE');
    assert.deepEqual(nav2.folderStack, []);
    assert.equal(nav2.currentFolderName, null);
    assert.equal(nav2.buttons[0].label, 'DEV SUITE');

    // Step 3: Re-enter folder
    ws.send(JSON.stringify({ type: 'BUTTON_CLICK', buttonId: 0 }));
    const m5 = await nextMsg();
    const m6 = await nextMsg();
    const nav3 = (m5.type === 'NAV_CHANGE') ? m5 : m6;
    assert.deepEqual(nav3.folderStack, [folderId]);

    // Step 4: Reticle act - click breadcrumb back button (sends LEAVE_FOLDER)
    ws.send(JSON.stringify({ type: 'LEAVE_FOLDER' }));
    const nav4 = await nextMsg();
    assert.equal(nav4.type, 'NAV_CHANGE');
    assert.deepEqual(nav4.folderStack, []);
    assert.equal(nav4.currentFolderName, null);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Reticle Predefined Flow Replay: Onboarding Wizard (onboarding-wizard)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-onboarding-test-'));
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

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(ws);
  await new Promise(resolve => ws.on('open', resolve));

  try {
    // Step 1: Client connects and receives initial state with onboardingCompleted: false
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    assert.equal(initMsg.onboardingCompleted, false);

    // Step 2: Apply starter workspaces (Developer, DevOps, Media)
    ws.send(JSON.stringify({
      type: 'APPLY_STARTER_WORKSPACES',
      workspaceIds: ['developer', 'devops', 'media'],
      mode: 'replace'
    }));

    // Step 3: Server broadcasts STATE_UPDATE with onboardingCompleted: true
    const stateMsg = await nextMsg();
    assert.equal(stateMsg.type, 'STATE_UPDATE');
    assert.equal(stateMsg.onboardingCompleted, true);
    assert.equal(stateMsg.workspaces.length, 3);
    assert.ok(stateMsg.workspaces.some(w => w.id === 'developer'));
    assert.ok(stateMsg.workspaces.some(w => w.id === 'devops'));
    assert.ok(stateMsg.workspaces.some(w => w.id === 'media'));

    // Step 4: Verify disk persistence
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfig.onboardingCompleted, true);
    assert.equal(savedConfig.workspaces.length, 3);

    // Step 5: Test Skip onboarding via COMPLETE_ONBOARDING
    ws.send(JSON.stringify({
      type: 'COMPLETE_ONBOARDING',
      skip: true
    }));
    const ackMsg = await nextMsg();
    assert.equal(ackMsg.type, 'STATE_UPDATE');
    assert.equal(ackMsg.onboardingCompleted, true);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
