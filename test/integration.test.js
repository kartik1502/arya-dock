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

    // DELETE_BUTTON when 1 button remains on Page 1 (and Page 2 exists) prunes Page 1, renumbers Page 2 to Page 1, and stays on pageIndex 0
    ws.send(JSON.stringify({
      type: 'DELETE_BUTTON',
      buttonId: countSuccess.buttons[0].id
    }));
    const delSuccess = await getNextMessage();
    assert.equal(delSuccess.type, 'STATE_UPDATE');
    assert.equal(delSuccess.totalPages, 1);
    assert.equal(delSuccess.pageNumber, 1);
    assert.equal(delSuccess.navigation.pageIndex, 0);
    assert.equal(delSuccess.buttons.length, 5);

    // Deleting a non-existent button returns ERROR
    ws.send(JSON.stringify({
      type: 'DELETE_BUTTON',
      buttonId: 999
    }));
    const notFoundError = await getNextMessage();
    assert.equal(notFoundError.type, 'ERROR');
    assert.equal(notFoundError.message, 'Button not found');

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

test('Integration: 15-tile cap, dynamic new page creation on ADD_BUTTON overflow, and navigation advancement', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-overflow-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  // Seed with a workspace having exactly 14 buttons on Page 1
  const initialButtons = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    label: `KEY ${i + 1}`,
    sublabel: 'TEST',
    icon: '⚡',
    color: '#1c69d4',
    actionType: 'shell',
    command: `echo ${i}`
  }));

  const seedConfig = {
    schemaVersion: 2,
    activeWorkspaceId: 'dev',
    activeProfile: 'dev',
    workspaces: [
      {
        id: 'dev',
        name: 'Development',
        icon: '💻',
        origin: 'user',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: initialButtons
          }
        ]
      }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(seedConfig, null, 2));

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
    assert.equal(initMsg.pageNumber, 1);
    assert.equal(initMsg.totalPages, 1);
    assert.equal(initMsg.buttons.length, 14);

    // 1. Add 15th button -> should fit on current Page 1 without advancing page
    ws.send(JSON.stringify({
      type: 'ADD_BUTTON',
      button: { label: 'KEY 15', actionType: 'shell', command: 'echo 15' }
    }));
    const update1 = await nextMsg();
    assert.equal(update1.type, 'STATE_UPDATE');
    assert.equal(update1.pageNumber, 1, 'Still on Page 1');
    assert.equal(update1.totalPages, 1, 'Still 1 total page');
    assert.equal(update1.buttons.length, 15, 'Page 1 now has 15 tiles (at maximum capacity)');

    // 2. Add 16th button -> Page 1 is full (15 buttons), no subsequent page exists:
    // Should dynamically create Page 2, add button to Page 2, and advance navigation
    ws.send(JSON.stringify({
      type: 'ADD_BUTTON',
      button: { label: 'OVERFLOW KEY 1', actionType: 'shell', command: 'echo overflow' }
    }));
    const update2 = await nextMsg();
    assert.equal(update2.type, 'STATE_UPDATE');
    assert.equal(update2.pageNumber, 2, 'Navigation advanced to newly created Page 2');
    assert.equal(update2.totalPages, 2, 'Total pages expanded to 2');
    assert.equal(update2.navigation.pageIndex, 1, 'navState.pageIndex advanced to 1');
    assert.equal(update2.buttons.length, 1, 'Page 2 contains the newly added overflow button');
    assert.equal(update2.buttons[0].label, 'OVERFLOW KEY 1');

    // 3. Navigate back to Page 1 and trigger overflow with an existing subsequent page that has capacity
    ws.send(JSON.stringify({ type: 'PAGE_PREV' }));
    const prevMsg = await nextMsg();
    assert.equal(prevMsg.type, 'STATE_UPDATE');
    assert.equal(prevMsg.pageNumber, 1);
    assert.equal(prevMsg.buttons.length, 15, 'Page 1 remains full with 15 buttons');

    // Add another button from Page 1 -> should overflow to existing Page 2 (which has capacity: 1 < 15)
    ws.send(JSON.stringify({
      type: 'ADD_BUTTON',
      button: { label: 'OVERFLOW KEY 2', actionType: 'shell', command: 'echo overflow2' }
    }));
    const update3 = await nextMsg();
    assert.equal(update3.type, 'STATE_UPDATE');
    assert.equal(update3.pageNumber, 2, 'Navigated to Page 2 where capacity was available');
    assert.equal(update3.totalPages, 2, 'Total pages remains 2');
    assert.equal(update3.navigation.pageIndex, 1);
    assert.equal(update3.buttons.length, 2, 'Page 2 now has 2 buttons');
    assert.equal(update3.buttons[1].label, 'OVERFLOW KEY 2');

    // 4. Test SET_BUTTONS_COUNT cap and pagination of excess
    // Set tile count on Page 2 to 20 -> should cap Page 2 to 15, and paginate excess 5 to dynamic Page 3
    ws.send(JSON.stringify({ type: 'SET_BUTTONS_COUNT', count: 20 }));
    const countMsg = await nextMsg();
    assert.equal(countMsg.type, 'STATE_UPDATE');
    assert.equal(countMsg.pageNumber, 2, 'Current page remains Page 2');
    assert.equal(countMsg.buttons.length, 15, 'Page 2 capped at MAX_BUTTONS_PER_PAGE (15)');
    assert.equal(countMsg.totalPages, 3, 'Excess 5 tiles paginated to dynamically created Page 3');

    // Navigate to Page 3 and verify it received the 5 excess tiles
    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
    const page3Msg = await nextMsg();
    assert.equal(page3Msg.type, 'STATE_UPDATE');
    assert.equal(page3Msg.pageNumber, 3);
    assert.equal(page3Msg.buttons.length, 5, 'Page 3 contains exactly the 5 excess tiles');

    // 5. Test invalid button rejection on full page: MUST NOT create new page or advance navigation
    // Fill Page 3 up to 15 tiles
    ws.send(JSON.stringify({ type: 'SET_BUTTONS_COUNT', count: 15 }));
    const page3FullMsg = await nextMsg();
    assert.equal(page3FullMsg.type, 'STATE_UPDATE');
    assert.equal(page3FullMsg.buttons.length, 15);
    assert.equal(page3FullMsg.totalPages, 3);

    // Attempt to add an invalid button (invalid color) when Page 3 is full
    ws.send(JSON.stringify({
      type: 'ADD_BUTTON',
      button: { color: 'not-a-hex-color' }
    }));
    const errAddMsg = await nextMsg();
    assert.equal(errAddMsg.type, 'ERROR');
    assert.ok(errAddMsg.message.includes('Invalid color format'));

    // Assert workspace state was NOT corrupted: no phantom Page 4 created, navigation unchanged
    const activeWs = app.getActiveWorkspace();
    assert.equal(activeWs.pages.length, 3, 'No phantom page must be created on rejected ADD_BUTTON');
    const navState = app.getNavState();
    assert.equal(navState.pageIndex, 2, 'Nav state must remain on Page 3 (index 2)');

    // 6. Test SET_BUTTONS_COUNT with count: 16 when a page has 18 buttons:
    // Page must be strictly capped to 15, and exactly 1 tile paginated to subsequent page
    // Temporarily inject 18 unconfigured buttons onto Page 3
    activeWs.pages[2].buttons = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      label: `KEY ${i + 1}`,
      sublabel: 'TEST',
      icon: '⚡',
      color: '#1c69d4',
      actionType: 'shell',
      command: ''
    }));

    ws.send(JSON.stringify({ type: 'SET_BUTTONS_COUNT', count: 16 }));
    const count16Msg = await nextMsg();
    assert.equal(count16Msg.type, 'STATE_UPDATE');
    assert.equal(count16Msg.pageNumber, 3, 'Active page is Page 3');
    assert.equal(count16Msg.buttons.length, 15, 'Page 3 strictly capped to MAX_BUTTONS_PER_PAGE (15)');
    assert.equal(count16Msg.totalPages, 4, 'Excess 1 tile paginated to Page 4');

    // Verify Page 4 has distinct IDs
    assert.equal(activeWs.pages[3].buttons.length, 1);
    const seenP4Ids = new Set(activeWs.pages[3].buttons.map(b => b.id));
    assert.equal(seenP4Ids.size, activeWs.pages[3].buttons.length, 'Page 4 buttons must have distinct IDs');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
