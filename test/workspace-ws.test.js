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
      pinned: false
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

test('Workspace & Navigation WebSocket Integration: Operator privilege enforcement on SET_WORKSPACE', async () => {
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

    // Operator attempting SET_WORKSPACE must be rejected
    ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    const errorMsg = await nextMsg();
    assert.equal(errorMsg.type, 'ERROR');
    assert.ok(errorMsg.message.includes('editor privilege required'));

    // Operator attempting WORKSPACE_DELETED must also be rejected
    ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'media' }));
    const errorDel = await nextMsg();
    assert.equal(errorDel.type, 'ERROR');
    assert.ok(errorDel.message.includes('editor privilege required'));

    // But operator CAN toggle PIN and navigate pages
    ws.send(JSON.stringify({ type: 'PIN' }));
    const pinUpdate = await nextMsg();
    assert.equal(pinUpdate.navigation.pinned, true);

    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
    const pageUpdate = await nextMsg();
    assert.equal(pageUpdate.pageNumber, 2);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Workspace & Navigation WebSocket Integration: WORKSPACE_DELETED by editor removes workspace', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-ws-del-integ-'));
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

    // Delete media workspace
    ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'media' }));
    const update = await nextMsg();
    assert.equal(update.type, 'STATE_UPDATE');
    assert.equal(update.workspaces.length, 1);
    assert.equal(update.workspaces[0].id, 'developer');

    // Attempting to delete the last remaining workspace must be rejected
    ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'developer' }));
    const errorMsg = await nextMsg();
    assert.equal(errorMsg.type, 'ERROR');
    assert.match(errorMsg.message, /Cannot delete the last remaining workspace/);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
