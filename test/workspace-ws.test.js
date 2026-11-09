'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { createServer } = require('../server');

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

test('Workspace & Navigation WebSocket Integration: INIT payload and SET_WORKSPACE', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-ws-integ-'));
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
    // 1. INIT carries first-class workspace & navigation state
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    assert.ok(Array.isArray(initMsg.workspaces), 'Must include workspaces array');
    assert.ok(initMsg.workspaces.length >= 2, 'Must include at least dev and media workspaces');
    assert.equal(initMsg.workspaceId, 'developer');
    assert.deepEqual(initMsg.navigation, {
      mode: 'auto',
      workspaceId: 'developer',
      pageIndex: 0,
      pinned: false,
      folderStack: []
    });

    // Backwards compatibility properties
    assert.equal(initMsg.activeProfileId, 'developer');
    assert.equal(initMsg.pageNumber, 1);
    assert.ok(Array.isArray(initMsg.profiles));

    // 2. SET_WORKSPACE switches active workspace and broadcasts STATE_UPDATE
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    const update1 = await nextMsg();
    assert.equal(update1.type, 'STATE_UPDATE');
    assert.equal(update1.workspaceId, 'media');
    assert.equal(update1.activeProfileId, 'media');
    assert.equal(update1.navigation.workspaceId, 'media');
    assert.equal(update1.navigation.mode, 'manual');
    assert.equal(update1.navigation.pinned, false);

    // 3. SET_PROFILE backwards compatibility works identically
    ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: 'developer' }));
    const update2 = await nextMsg();
    assert.equal(update2.type, 'STATE_UPDATE');
    assert.equal(update2.workspaceId, 'developer');
    assert.equal(update2.navigation.workspaceId, 'developer');

    // 4. Invalid workspace ID yields error
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'nonexistent-workspace' }));
    const errorMsg = await nextMsg();
    assert.equal(errorMsg.type, 'ERROR');
    assert.ok(errorMsg.message.includes('not found'));

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Workspace & Navigation WebSocket Integration: PIN, UNPIN, and CONTEXT_CHANGED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-pin-integ-'));
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
    await nextMsg(); // consume INIT

    // 1. PIN locks workspace
    ws.send(JSON.stringify({ type: 'PIN' }));
    const pinUpdate = await nextMsg();
    assert.equal(pinUpdate.type, 'STATE_UPDATE');
    assert.equal(pinUpdate.navigation.pinned, true);
    assert.equal(pinUpdate.navigation.mode, 'manual');

    // 2. CONTEXT_CHANGED when pinned is ignored
    ws.send(JSON.stringify({ type: 'CONTEXT_CHANGED', matchedWorkspaceId: 'media' }));
    // Wait briefly to ensure no update is broadcast
    await new Promise(r => setTimeout(r, 60));
    assert.equal(app.getNavState().workspaceId, 'developer', 'Pinned state must block context change');

    // 3. UNPIN unlocks workspace and restores auto mode
    ws.send(JSON.stringify({ type: 'UNPIN' }));
    const unpinUpdate = await nextMsg();
    assert.equal(unpinUpdate.type, 'STATE_UPDATE');
    assert.equal(unpinUpdate.navigation.pinned, false);
    assert.equal(unpinUpdate.navigation.mode, 'auto');

    // 4. CONTEXT_CHANGED when unpinned switches active workspace
    ws.send(JSON.stringify({ type: 'CONTEXT_CHANGED', matchedWorkspaceId: 'media' }));
    const ctxUpdate = await nextMsg();
    assert.equal(ctxUpdate.type, 'STATE_UPDATE');
    assert.equal(ctxUpdate.workspaceId, 'media');
    assert.equal(ctxUpdate.navigation.workspaceId, 'media');
    assert.equal(ctxUpdate.navigation.mode, 'auto');

    // 5. TOGGLE_PIN toggles state
    ws.send(JSON.stringify({ type: 'TOGGLE_PIN' }));
    const toggle1 = await nextMsg();
    assert.equal(toggle1.navigation.pinned, true);

    ws.send(JSON.stringify({ type: 'TOGGLE_PIN' }));
    const toggle2 = await nextMsg();
    assert.equal(toggle2.navigation.pinned, false);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Workspace & Navigation WebSocket Integration: Operator local navigation & mutation protection', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-ws-role-integ-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({
    configPath,
    authPath,
    mockClientIp: '192.168.1.188' // remote operator
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
    const init = await nextMsg();
    assert.equal(init.role, 'operator');
    assert.equal(init.canEdit, false);

    // Operator can switch their companion deck view to media without mutating server disk config
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    const wsUpdate = await nextMsg();
    assert.equal(wsUpdate.type, 'STATE_UPDATE');
    assert.equal(wsUpdate.workspaceId, 'media');
    assert.equal(wsUpdate.canEdit, false);
    // Server disk/default workspace was NOT mutated by operator navigation
    assert.notEqual(app.getConfig().activeWorkspaceId, 'media');

    // Operator attempting CREATE_WORKSPACE must be rejected
    ws.send(JSON.stringify({ type: 'CREATE_WORKSPACE', name: 'Hacker Deck' }));
    const errorCreate = await nextMsg();
    assert.equal(errorCreate.type, 'ERROR');
    assert.equal(errorCreate.code, 'EDITOR_REQUIRED');

    // Operator attempting UPDATE_WORKSPACE must be rejected
    ws.send(JSON.stringify({ type: 'UPDATE_WORKSPACE', workspaceId: 'developer', name: 'Pwned' }));
    const errorUpdate = await nextMsg();
    assert.equal(errorUpdate.type, 'ERROR');
    assert.equal(errorUpdate.code, 'EDITOR_REQUIRED');

    // Operator attempting destructive WORKSPACE_DELETED must be rejected
    ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'media' }));
    const errorDel = await nextMsg();
    assert.equal(errorDel.type, 'ERROR');
    assert.ok(errorDel.message.includes('editor privilege required'));

    // Operator CAN toggle PIN and navigate pages
    ws.send(JSON.stringify({ type: 'PIN' }));
    const pinUpdate = await nextMsg();
    assert.equal(pinUpdate.navigation.pinned, true);

    // Switch back to developer workspace (which has 2 pages in default template)
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'developer' }));
    const devUpdate = await nextMsg();
    assert.equal(devUpdate.type, 'STATE_UPDATE');
    assert.equal(devUpdate.workspaceId, 'developer');

    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
    const pageUpdate = await nextMsg();
    assert.equal(pageUpdate.pageNumber, 2);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Workspace & Navigation WebSocket Integration: CREATE_WORKSPACE, UPDATE_WORKSPACE, and WORKSPACE_DELETED lifecycle', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-ws-lifecycle-integ-'));
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
    const init = await nextMsg(); // INIT
    assert.equal(init.workspaces.length, 2);
    assert.deepEqual(init.workspaces.map(w => w.id), ['developer', 'media']);

    // 1. Built-in workspaces cannot be deleted
    ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'developer' }));
    const errDelBuiltin1 = await nextMsg();
    assert.equal(errDelBuiltin1.type, 'ERROR');
    assert.equal(errDelBuiltin1.code, 'BUILTIN_IMMUTABLE');

    ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'media' }));
    const errDelBuiltin2 = await nextMsg();
    assert.equal(errDelBuiltin2.type, 'ERROR');
    assert.equal(errDelBuiltin2.code, 'BUILTIN_IMMUTABLE');

    // 2. CREATE_WORKSPACE creates user workspace, safe slug, and syncs host navigation
    ws.send(JSON.stringify({
      type: 'CREATE_WORKSPACE',
      name: 'DevOps Cockpit',
      icon: '🚀',
      matchApps: ['kubectl', 'docker', 'k9s']
    }));
    const updateCreated = await nextMsg();
    assert.equal(updateCreated.type, 'STATE_UPDATE');
    assert.equal(updateCreated.workspaces.length, 3);
    const createdWs = updateCreated.workspaces.find(w => w.name === 'DevOps Cockpit');
    assert.ok(createdWs, 'New workspace must be projected');
    assert.equal(createdWs.id, 'ws-devops-cockpit');
    assert.equal(createdWs.icon, '🚀');
    assert.equal(createdWs.origin, 'user');
    assert.deepEqual(createdWs.match.apps, ['kubectl', 'docker', 'k9s']);
    assert.equal(updateCreated.workspaceId, 'ws-devops-cockpit');
    assert.equal(updateCreated.navigation.workspaceId, 'ws-devops-cockpit');

    // Verify disk persistence immediately synchronized
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(savedConfig.workspaces.some(w => w.id === 'ws-devops-cockpit'));
    assert.ok(savedConfig.profiles['ws-devops-cockpit'], 'Profile dictionary must be synchronized');
    assert.equal(savedConfig.activeWorkspaceId, 'ws-devops-cockpit');

    // 3. UPDATE_WORKSPACE updates name, icon, and match apps
    ws.send(JSON.stringify({
      type: 'UPDATE_WORKSPACE',
      workspaceId: 'ws-devops-cockpit',
      name: 'DevOps & Cloud',
      icon: '☁️',
      matchApps: ['kubectl', 'helm']
    }));
    const updatePatched = await nextMsg();
    assert.equal(updatePatched.type, 'STATE_UPDATE');
    const patchedWs = updatePatched.workspaces.find(w => w.id === 'ws-devops-cockpit');
    assert.equal(patchedWs.name, 'DevOps & Cloud');
    assert.equal(patchedWs.icon, '☁️');
    assert.deepEqual(patchedWs.match.apps, ['kubectl', 'helm']);

    // 4. WORKSPACE_DELETED on user workspace removes it, cleans profiles, and falls back
    ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'ws-devops-cockpit' }));
    const updateDeleted = await nextMsg();
    assert.equal(updateDeleted.type, 'STATE_UPDATE');
    assert.equal(updateDeleted.workspaces.length, 2);
    assert.ok(!updateDeleted.workspaces.some(w => w.id === 'ws-devops-cockpit'));
    assert.equal(updateDeleted.workspaceId, 'developer');

    // Verify disk sync cleaned up profile
    const savedConfigAfterDel = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(!savedConfigAfterDel.profiles['ws-devops-cockpit']);
    assert.equal(savedConfigAfterDel.activeWorkspaceId, 'developer');

    // 5. Attempting to delete non-existent workspace returns WORKSPACE_NOT_FOUND
    ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'ws-nonexistent' }));
    const errNotFound = await nextMsg();
    assert.equal(errNotFound.type, 'ERROR');
    assert.equal(errNotFound.code, 'WORKSPACE_NOT_FOUND');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Workspace & Navigation: Prototype pollution injection rejection on TOGGLE_SEGREGATION, SET_WORKSPACE, and WORKSPACE_DELETED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-proto-integ-'));
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
    await nextMsg(); // INIT

    for (const evilKey of ['__proto__', 'constructor', 'prototype']) {
      // 1. TOGGLE_SEGREGATION injection attempt
      ws.send(JSON.stringify({ type: 'TOGGLE_SEGREGATION', workspaceId: evilKey, enabled: true }));
      const errSeg = await nextMsg();
      assert.equal(errSeg.type, 'ERROR');
      assert.match(errSeg.message, /Invalid workspace id/);
      assert.equal(Object.prototype.segregation, undefined, 'Object.prototype must NOT be polluted');

      // 2. SET_WORKSPACE injection attempt
      ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: evilKey }));
      const errWs = await nextMsg();
      assert.equal(errWs.type, 'ERROR');
      assert.match(errWs.message, /Invalid workspace id/);

      // 3. SET_PROFILE injection attempt
      ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: evilKey }));
      const errProf = await nextMsg();
      assert.equal(errProf.type, 'ERROR');
      assert.match(errProf.message, /Invalid profile id/);

      // 4. WORKSPACE_DELETED injection attempt
      ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: evilKey }));
      const errDel = await nextMsg();
      assert.equal(errDel.type, 'ERROR');
      assert.match(errDel.message, /Invalid workspace id/);

      // 5. UPDATE_WORKSPACE injection attempt
      ws.send(JSON.stringify({ type: 'UPDATE_WORKSPACE', workspaceId: evilKey, name: 'Evil' }));
      const errUpd = await nextMsg();
      assert.equal(errUpd.type, 'ERROR');
      assert.equal(errUpd.code, 'INVALID_WORKSPACE_ID');
    }

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
