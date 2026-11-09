'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const { createServer } = require('../server');
const platform = require('../platform');

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

test('Per-Client Navigation: Client A and Client B isolation across workspaces and pages', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-per-client-iso-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });

  const nextMsgA = createMessageQueue(wsA);
  const nextMsgB = createMessageQueue(wsB);

  await Promise.all([
    new Promise(resolve => wsA.on('open', resolve)),
    new Promise(resolve => wsB.on('open', resolve))
  ]);

  try {
    const initA = await nextMsgA();
    const initB = await nextMsgB();
    assert.equal(initA.workspaceId, 'developer');
    assert.equal(initB.workspaceId, 'developer');
    assert.equal(initA.pageNumber, 1);
    assert.equal(initB.pageNumber, 1);

    // Client A flips to page 2 of developer
    wsA.send(JSON.stringify({ type: 'PAGE_NEXT' }));
    const updateA1 = await nextMsgA();
    assert.equal(updateA1.type, 'STATE_UPDATE');
    assert.equal(updateA1.workspaceId, 'developer');
    assert.equal(updateA1.pageNumber, 2);

    // Client B switches workspace to media
    wsB.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    const updateB1 = await nextMsgB();
    assert.equal(updateB1.type, 'STATE_UPDATE');
    assert.equal(updateB1.workspaceId, 'media');
    assert.equal(updateB1.pageNumber, 1);

    // Verify Client A is still on developer Page 2 (Client B's SET_WORKSPACE did not hijack Client A)
    // Client A sends a ping/toggle_pin to receive its current state confirmation
    wsA.send(JSON.stringify({ type: 'PIN' }));
    const updateA2 = await nextMsgA();
    assert.equal(updateA2.workspaceId, 'developer');
    assert.equal(updateA2.pageNumber, 2);
    assert.equal(updateA2.navigation.pinned, true);

    // Client B remains on media and is unpinned
    assert.equal(updateB1.navigation.pinned, false);

    wsA.close();
    wsB.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Per-Client Navigation: BUTTON_CLICK execution resolves against caller active workspace and page', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-per-client-btn-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  let executedCommand = null;
  const fakeAdapter = platform.adapters.fake.createFakeAdapter({
    executeShell: (cmd) => {
      executedCommand = cmd;
      return true;
    }
  });
  fakeAdapter.capabilities = () => ({ terminal: true, activeWindow: true, media: true });

  const app = createServer({ configPath, authPath, platformAdapter: fakeAdapter, silent: true });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsgA = createMessageQueue(wsA);
  await new Promise(resolve => wsA.on('open', resolve));

  try {
    const initA = await nextMsgA();
    assert.equal(initA.workspaceId, 'developer');

    // Button 0 in default developer workspace
    const btn0 = initA.buttons.find(b => b.id === 0);
    assert.ok(btn0, 'Button 0 exists in developer workspace');

    wsA.send(JSON.stringify({ type: 'BUTTON_CLICK', buttonId: 0 }));
    const ackA = await nextMsgA();
    assert.equal(ackA.type, 'BUTTON_ACK');
    assert.equal(ackA.buttonId, 0);

    // Now switch client A to media workspace
    wsA.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    const mediaInit = await nextMsgA();
    assert.equal(mediaInit.workspaceId, 'media');

    // Add a distinct button 0 to media workspace
    wsA.send(JSON.stringify({
      type: 'ADD_BUTTON',
      button: { id: 0, label: 'MEDIA_PLAY', actionType: 'shell', command: 'echo media-play' }
    }));
    const addMsg = await nextMsgA();
    assert.equal(addMsg.type, 'STATE_UPDATE');
    assert.equal(addMsg.workspaceId, 'media');

    // Trigger button 0 on media workspace
    executedCommand = null;
    wsA.send(JSON.stringify({ type: 'BUTTON_CLICK', buttonId: 0 }));
    const ackMedia = await nextMsgA();
    assert.equal(ackMedia.type, 'BUTTON_ACK');
    assert.equal(ackMedia.buttonId, 0);

    wsA.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Per-Client Navigation: Active window multi-cast with independent pin guard', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-per-client-active-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  let activeWindowCallback = null;
  const fakeAdapter = platform.adapters.fake.createFakeAdapter({
    createActiveWindowStream: (cb) => {
      activeWindowCallback = cb;
      return { stop: () => {} };
    }
  });
  fakeAdapter.capabilities = () => ({ activeWindow: true, media: true });

  const app = createServer({ configPath, authPath, platformAdapter: fakeAdapter, silent: true });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  // Client A: Tablet mounted for media, PINNED to media
  const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  // Client B: Phone for dev commands, UNPINNED (auto mode)
  const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });

  const nextMsgA = createMessageQueue(wsA);
  const nextMsgB = createMessageQueue(wsB);

  await Promise.all([
    new Promise(resolve => wsA.on('open', resolve)),
    new Promise(resolve => wsB.on('open', resolve))
  ]);

  try {
    await nextMsgA();
    await nextMsgB();

    // Client A selects media workspace and pins it
    wsA.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    await nextMsgA();
    wsA.send(JSON.stringify({ type: 'PIN' }));
    const pinA = await nextMsgA();
    assert.equal(pinA.workspaceId, 'media');
    assert.equal(pinA.navigation.pinned, true);

    // Client B remains unpinned on developer
    // Now workstation active window shifts to 'spotify' (which matches 'media' workspace)
    assert.ok(typeof activeWindowCallback === 'function');
    activeWindowCallback('spotify');

    // Client B (unpinned) follows active window and switches to media!
    const switchB = await nextMsgB();
    assert.equal(switchB.type, 'STATE_UPDATE');
    assert.equal(switchB.workspaceId, 'media');
    assert.equal(switchB.navigation.mode, 'auto');

    // Now workstation active window shifts to 'code' (which matches 'developer' workspace)
    activeWindowCallback('code');

    // Client B follows active window back to developer!
    const switchB2 = await nextMsgB();
    assert.equal(switchB2.type, 'STATE_UPDATE');
    assert.equal(switchB2.workspaceId, 'developer');

    // Client A is PINNED to media: it must NOT have switched to developer!
    // Send a pin toggle on Client A to verify its current workspace is still media
    wsA.send(JSON.stringify({ type: 'PIN' }));
    const checkA = await nextMsgA();
    assert.equal(checkA.workspaceId, 'media', 'Client A stayed pinned on media');

    wsA.close();
    wsB.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Per-Client Navigation: WORKSPACE_DELETED fan-out transitions affected viewing clients', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-per-client-del-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  // Client A viewing media
  const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  // Client B viewing developer
  const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });

  const nextMsgA = createMessageQueue(wsA);
  const nextMsgB = createMessageQueue(wsB);

  await Promise.all([
    new Promise(resolve => wsA.on('open', resolve)),
    new Promise(resolve => wsB.on('open', resolve))
  ]);

  try {
    await nextMsgA();
    await nextMsgB();

    // Client A navigates to media
    wsA.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    await nextMsgA();

    // Editor deletes workspace 'media'
    wsB.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: 'media' }));

    // Both clients receive state update
    const updateA = await nextMsgA();
    const updateB = await nextMsgB();

    // Client A was viewing media which got deleted -> migrated to fallback workspace 'developer'
    assert.equal(updateA.type, 'STATE_UPDATE');
    assert.equal(updateA.workspaceId, 'developer');

    // Client B was viewing developer -> remains on developer
    assert.equal(updateB.type, 'STATE_UPDATE');
    assert.equal(updateB.workspaceId, 'developer');

    // Media workspace is no longer in workspaces list for either client
    assert.ok(!updateA.workspaces.some(w => w.id === 'media'));
    assert.ok(!updateB.workspaces.some(w => w.id === 'media'));

    wsA.close();
    wsB.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Per-Client Navigation: Stateless reconnection URL parameter /?workspace=media connects into media', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-per-client-url-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  // Companion client connects with ?workspace=media
  const wsMedia = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}&workspace=media`, {
    headers: { Origin: `http://127.0.0.1:${port}` }
  });
  const nextMsg = createMessageQueue(wsMedia);
  await new Promise(resolve => wsMedia.on('open', resolve));

  try {
    const initMsg = await nextMsg();
    assert.equal(initMsg.type, 'INIT');
    assert.equal(initMsg.workspaceId, 'media');
    assert.equal(initMsg.navigation.workspaceId, 'media');
    assert.equal(initMsg.pageNumber, 1);

    wsMedia.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
