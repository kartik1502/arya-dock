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

test('Integration: WebSocket authentication, Origin check, operator and editor roles', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-integ-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  // Start server with mockClientIp as remote IP
  const app = createServer({
    configPath,
    authPath,
    mockClientIp: '192.168.1.150'
  });
  const server = app.server;

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;
  const editorKey = app.credentials.editorKey;

  try {
    // 1. Connection without token must be rejected
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('error', (err) => {
        assert.ok(err.message.includes('401') || err.message.includes('Unexpected server response'));
        resolve();
      });
      ws.on('open', () => {
        assert.fail('Should not connect without pairing token');
      });
    });

    // 2. Connection with invalid token must be rejected
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=invalid_token`);
      ws.on('error', (err) => {
        assert.ok(err.message.includes('401') || err.message.includes('Unexpected server response'));
        resolve();
      });
      ws.on('open', () => {
        assert.fail('Should not connect with invalid pairing token');
      });
    });

    // 3. Connection with foreign Origin must be rejected with 403
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
        headers: { Origin: 'https://evil.example' }
      });
      ws.on('error', (err) => {
        assert.ok(err.message.includes('403') || err.message.includes('Unexpected server response'));
        resolve();
      });
      ws.on('open', () => {
        assert.fail('Should not connect with evil origin');
      });
    });

    // 4. Remote connection with valid token and query-string editKey connects as operator (query editKey is ignored)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}&editKey=${editorKey}`, {
      headers: { Origin: `http://127.0.0.1:${port}` }
    });

    const getNextMessage = createMessageQueue(ws);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Receive INIT message - role must still be operator because query-string editKey is rejected
    const initMsg = await getNextMessage();
    assert.equal(initMsg.type, 'INIT');
    assert.equal(initMsg.role, 'operator');
    assert.equal(initMsg.canEdit, false);

    // Operator attempting UPDATE_BUTTON must be rejected
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: { id: 0, label: 'MALICIOUS EDIT', command: 'whoami' }
    }));

    const errorMsg = await getNextMessage();
    assert.equal(errorMsg.type, 'ERROR');
    assert.ok(errorMsg.message.includes('editor privilege required'));

    // Operator sends AUTH_EDIT with correct editorKey
    ws.send(JSON.stringify({
      type: 'AUTH_EDIT',
      editKey: editorKey
    }));

    const roleMsg = await getNextMessage();
    assert.equal(roleMsg.type, 'ROLE_UPDATE');
    assert.equal(roleMsg.role, 'editor');
    assert.equal(roleMsg.canEdit, true);

    // Now as Editor, UPDATE_BUTTON succeeds
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: { id: 0, label: 'AUTHORIZED EDIT', command: 'echo hello', color: '#10b981' }
    }));

    const stateUpdate = await getNextMessage();
    assert.equal(stateUpdate.type, 'STATE_UPDATE');
    const updatedBtn = stateUpdate.buttons.find(b => b.id === 0);
    assert.equal(updatedBtn.label, 'AUTHORIZED EDIT');
    assert.equal(updatedBtn.command, 'echo hello');
    assert.equal(updatedBtn.color, '#10b981');

    // Partial update preserves existing fields without wiping command or color
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: { id: 0, label: 'PARTIAL ONLY' }
    }));

    const partialState = await getNextMessage();
    assert.equal(partialState.type, 'STATE_UPDATE');
    const partialBtn = partialState.buttons.find(b => b.id === 0);
    assert.equal(partialBtn.label, 'PARTIAL ONLY');
    assert.equal(partialBtn.command, 'echo hello'); // Preserved!
    assert.equal(partialBtn.color, '#10b981');     // Preserved!

    // Partial update using top-level buttonId without button.id
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      buttonId: 0,
      button: { label: 'VIA BUTTON_ID' }
    }));
    const topIdState = await getNextMessage();
    assert.equal(topIdState.type, 'STATE_UPDATE');
    const topIdBtn = topIdState.buttons.find(b => b.id === 0);
    assert.equal(topIdBtn.label, 'VIA BUTTON_ID');
    assert.equal(topIdBtn.command, 'echo hello'); // Still preserved!

    // Non-object button update payload is rejected
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      buttonId: 0,
      button: 'not-an-object'
    }));
    const nonObjError = await getNextMessage();
    assert.equal(nonObjError.type, 'ERROR');
    assert.ok(nonObjError.message.includes('non-null object'));

    // Garbage type update (e.g. invalid color and command object) is rejected and config preserved
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: { id: 0, color: 'not-hex', command: { injection: true } }
    }));

    const garbageError = await getNextMessage();
    assert.equal(garbageError.type, 'ERROR');
    assert.ok(garbageError.message.includes('color') || garbageError.message.includes('command'));

    // Verify current button state is unchanged by the rejected garbage update
    const currentBtn = app.getConfig().profiles.developer.pages[0].buttons.find(b => b.id === 0);
    assert.equal(currentBtn.label, 'VIA BUTTON_ID');
    assert.equal(currentBtn.command, 'echo hello');
    assert.equal(currentBtn.color, '#10b981');

    // Button click yields BUTTON_ACK
    ws.send(JSON.stringify({
      type: 'BUTTON_CLICK',
      buttonId: 0
    }));

    const ackMsg = await getNextMessage();
    assert.equal(ackMsg.type, 'BUTTON_ACK');
    assert.equal(ackMsg.buttonId, 0);

    // SET_BUTTONS_COUNT attempting to truncate configured buttons without force must be rejected
    ws.send(JSON.stringify({
      type: 'SET_BUTTONS_COUNT',
      count: 1
    }));
    const countReject = await getNextMessage();
    assert.equal(countReject.type, 'ERROR');
    assert.ok(countReject.message.includes('force: true'));

    // SET_BUTTONS_COUNT with force: true succeeds
    ws.send(JSON.stringify({
      type: 'SET_BUTTONS_COUNT',
      count: 1,
      force: true
    }));
    const countSuccess = await getNextMessage();
    assert.equal(countSuccess.type, 'STATE_UPDATE');
    assert.equal(countSuccess.buttons.length, 1);

    // SET_BUTTONS_COUNT to expand tile count generates placeholders with keepOpen: true
    ws.send(JSON.stringify({
      type: 'SET_BUTTONS_COUNT',
      count: 2
    }));
    const countExpanded = await getNextMessage();
    assert.equal(countExpanded.type, 'STATE_UPDATE');
    assert.equal(countExpanded.buttons.length, 2);
    const newPlaceholder = countExpanded.buttons[1];
    assert.equal(newPlaceholder.keepOpen, true);

    // Reduce back to 1 for delete test
    ws.send(JSON.stringify({
      type: 'SET_BUTTONS_COUNT',
      count: 1,
      force: true
    }));
    await getNextMessage();

    // DELETE_BUTTON when only 1 button remains must be rejected
    ws.send(JSON.stringify({
      type: 'DELETE_BUTTON',
      buttonId: countSuccess.buttons[0].id
    }));
    const delReject = await getNextMessage();
    assert.equal(delReject.type, 'ERROR');
    assert.ok(delReject.message.includes('Cannot delete the last remaining button'));

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Integration: Multi-client synchronized deck paging', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-multi-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const app = createServer({ configPath, authPath });
  const server = app.server;

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = app.credentials.pairingToken;

  try {
    const wsClientA = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
      headers: { Origin: `http://127.0.0.1:${port}` }
    });
    const wsClientB = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
      headers: { Origin: `http://127.0.0.1:${port}` }
    });

    const getMsgA = createMessageQueue(wsClientA);
    const getMsgB = createMessageQueue(wsClientB);

    await Promise.all([
      new Promise(r => wsClientA.on('open', r)),
      new Promise(r => wsClientB.on('open', r))
    ]);

    // Both receive INIT
    const initA = await getMsgA();
    const initB = await getMsgB();
    assert.equal(initA.pageNumber, 1);
    assert.equal(initB.pageNumber, 1);

    // Client A changes page to next
    wsClientA.send(JSON.stringify({ type: 'PAGE_NEXT' }));

    // Both clients receive STATE_UPDATE with synchronized new page
    const updateA = await getMsgA();
    const updateB = await getMsgB();
    assert.equal(updateA.type, 'STATE_UPDATE');
    assert.equal(updateB.type, 'STATE_UPDATE');
    assert.equal(updateA.pageNumber, 2);
    assert.equal(updateB.pageNumber, 2);

    wsClientA.close();
    wsClientB.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
