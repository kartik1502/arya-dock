'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { createServer } = require('../server');
const {
  validateButton,
  generateSafeFolderId,
  validateWorkspace
} = require('../lib/config');

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

async function getNextPair(nextMsg) {
  const m1 = await nextMsg();
  const m2 = await nextMsg();
  const navMsg = (m1.type === 'NAV_CHANGE' || m1.type === 'STATE_UPDATE') ? m1 : m2;
  const ackMsg = (m1.type === 'BUTTON_ACK') ? m1 : m2;
  return { navMsg, ackMsg, m1, m2 };
}

test('Folder Navigation: validateButton schema enforcement for actionType: folder', () => {
  const validBtn = {
    id: 0,
    label: 'DEV TOOLS',
    icon: '📁',
    color: '#1c69d4',
    actionType: 'folder',
    folderId: 'f-dev-tools'
  };
  const resValid = validateButton(validBtn);
  assert.equal(resValid.valid, true);
  assert.equal(resValid.button.actionType, 'folder');
  assert.equal(resValid.button.folderId, 'f-dev-tools');

  // Missing folderId
  const missingFolderId = {
    id: 1,
    label: 'NO FOLDER ID',
    actionType: 'folder'
  };
  const resMissing = validateButton(missingFolderId);
  assert.equal(resMissing.valid, false);
  assert.match(resMissing.error, /invalid folderId/i);

  // Invalid folderId format
  const invalidFolderId = {
    id: 2,
    label: 'BAD SLUG',
    actionType: 'folder',
    folderId: 'bad folder!@#'
  };
  const resInvalid = validateButton(invalidFolderId);
  assert.equal(resInvalid.valid, false);
  assert.match(resInvalid.error, /invalid folderId/i);
});

test('Folder Navigation: generateSafeFolderId pure helper', () => {
  const existingFolders = [
    { id: 'f-tools', name: 'Tools' },
    { id: 'f-tools-2', name: 'Tools 2' }
  ];

  // Safe slug conversion and collision avoidance
  const id1 = generateSafeFolderId('Tools', existingFolders);
  assert.equal(id1, 'f-tools-3');

  // Diacritics stripping and normalization
  const id2 = generateSafeFolderId('Café Münster', []);
  assert.equal(id2, 'f-cafe-munster');

  // Prototype pollution resilience
  const id3 = generateSafeFolderId('__proto__', []);
  assert.equal(id3.startsWith('f-'), true);
  assert.notEqual(id3, '__proto__');
  assert.notEqual(id3, 'constructor');

  // Empty string fallback
  const id4 = generateSafeFolderId('', []);
  assert.equal(id4.startsWith('f-folder'), true);
});

test('Folder Navigation: validateWorkspace with folders schema', () => {
  const rawWs = {
    id: 'ws-test',
    name: 'Test Workspace',
    pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }],
    folders: [
      {
        id: 'f-tools',
        name: 'Tools Sub-Deck',
        buttons: Array.from({ length: 20 }, (_, i) => ({
          id: i,
          label: `TOOL ${i + 1}`,
          actionType: 'shell',
          command: `echo tool ${i + 1}`
        }))
      }
    ]
  };

  // Strict mode rejects > 14 buttons
  const strictValidation = validateWorkspace(rawWs, { repair: false });
  assert.equal(strictValidation.valid, false);
  assert.match(strictValidation.error, /exceeds maximum 14 buttons/i);

  // Repair mode caps at 14 buttons
  const repairedValidation = validateWorkspace(rawWs, { repair: true });
  assert.equal(repairedValidation.valid, true);
  assert.ok(Array.isArray(repairedValidation.workspace.folders));
  assert.equal(repairedValidation.workspace.folders.length, 1);
  const folder = repairedValidation.workspace.folders[0];
  assert.equal(folder.id, 'f-tools');
  assert.equal(folder.buttons.length, 14);
  assert.equal(folder.buttons[0].label, 'TOOL 1');
  assert.equal(folder.buttons[13].label, 'TOOL 14');
});

test('Folder Navigation: WebSocket end-to-end sub-deck navigation and Back button', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-folder-integ-'));
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
    assert.deepEqual(initMsg.folderStack, []);
    assert.equal(initMsg.currentFolderName, null);

    // 1. Create a folder button on the active workspace
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
    const folderTile = updateMsg.buttons.find(b => b && b.id === 0);
    assert.equal(folderTile.actionType, 'folder');
    assert.ok(folderTile.folderId, 'Folder button must have auto-provisioned folderId');

    // 2. Click folder button to ENTER folder
    ws.send(JSON.stringify({
      type: 'BUTTON_CLICK',
      buttonId: 0
    }));

    // Expect NAV_CHANGE and BUTTON_ACK
    const { navMsg, ackMsg } = await getNextPair(nextMsg);
    assert.equal(ackMsg.type, 'BUTTON_ACK');
    assert.equal(ackMsg.buttonId, 0);

    assert.equal(navMsg.type, 'NAV_CHANGE');
    assert.deepEqual(navMsg.folderStack, [folderTile.folderId]);
    assert.equal(navMsg.currentFolderName, 'DEV SUITE');
    assert.equal(navMsg.canGoBack, true);

    // Verify Slot 0 Back button
    assert.ok(navMsg.buttons.length >= 1, 'Folder must display Slot 0 back button');
    const backBtn = navMsg.buttons[0];
    assert.equal(backBtn.id, '__back__');
    assert.equal(backBtn.actionType, 'folder_back');
    assert.equal(backBtn.isSystem, true);
    assert.equal(backBtn.icon, '⬅️');

    // 3. Click Slot 0 Back button to LEAVE folder
    ws.send(JSON.stringify({
      type: 'BUTTON_CLICK',
      buttonId: '__back__'
    }));

    const { navMsg: rootNavMsg, ackMsg: ackBack } = await getNextPair(nextMsg);
    assert.equal(ackBack.type, 'BUTTON_ACK');
    assert.equal(ackBack.buttonId, '__back__');

    assert.equal(rootNavMsg.type, 'NAV_CHANGE');
    assert.deepEqual(rootNavMsg.folderStack, []);
    assert.equal(rootNavMsg.currentFolderName, null);
    assert.equal(rootNavMsg.canGoBack, false);

    // 4. Test LEAVE_FOLDER direct message
    ws.send(JSON.stringify({
      type: 'BUTTON_CLICK',
      buttonId: 0
    }));
    await getNextPair(nextMsg); // consume NAV_CHANGE + BUTTON_ACK

    ws.send(JSON.stringify({ type: 'LEAVE_FOLDER' }));
    const leaveNavMsg = await nextMsg();
    assert.equal(leaveNavMsg.type, 'NAV_CHANGE');
    assert.deepEqual(leaveNavMsg.folderStack, []);

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Folder Navigation: Multi-client navigation independence', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-folder-multi-'));
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
    const initA = await nextMsgA(); // INIT A
    const initB = await nextMsgB(); // INIT B
    assert.deepEqual(initA.folderStack, []);
    assert.deepEqual(initB.folderStack, []);

    // Setup folder button
    wsA.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: {
        id: 0,
        label: 'FOLDER SUITE',
        actionType: 'folder'
      }
    }));

    const updateA = await nextMsgA();
    const updateB = await nextMsgB();
    assert.equal(updateA.type, 'STATE_UPDATE');
    assert.equal(updateB.type, 'STATE_UPDATE');
    const folderId = updateA.buttons[0].folderId;

    // Client A enters folder
    wsA.send(JSON.stringify({
      type: 'BUTTON_CLICK',
      buttonId: 0
    }));

    const { navMsg: navA } = await getNextPair(nextMsgA);
    assert.equal(navA.type, 'NAV_CHANGE');
    assert.deepEqual(navA.folderStack, [folderId]);
    assert.equal(navA.buttons[0].id, '__back__');

    // Client B must remain on root deck without receiving NAV_CHANGE
    wsB.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: {
        id: 1,
        label: 'ROOT TILE',
        actionType: 'shell',
        command: 'echo hello'
      }
    }));

    const bUpdate = await nextMsgB();
    assert.equal(bUpdate.type, 'STATE_UPDATE');
    assert.deepEqual(bUpdate.folderStack, []);
    assert.notEqual(bUpdate.buttons[0].id, '__back__');

    wsA.close();
    wsB.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Folder Navigation: Container mutation containment, 14-tile capacity ceiling, and Slot 0 immunity', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-folder-mutations-'));
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

    // Create folder button
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: {
        id: 0,
        label: 'SUB-DECK',
        actionType: 'folder'
      }
    }));
    await nextMsg(); // STATE_UPDATE

    // Enter folder
    ws.send(JSON.stringify({ type: 'BUTTON_CLICK', buttonId: 0 }));
    const { navMsg } = await getNextPair(nextMsg);
    assert.equal(navMsg.buttons[0].id, '__back__');

    // Add buttons inside the folder up to capacity (max 14 user buttons)
    for (let i = 0; i < 14; i++) {
      ws.send(JSON.stringify({
        type: 'ADD_BUTTON',
        button: {
          label: `INNER ${i + 1}`,
          actionType: 'shell',
          command: `echo inner ${i + 1}`
        }
      }));
      const state = await nextMsg();
      assert.equal(state.type, 'STATE_UPDATE');
      assert.equal(state.currentFolderName, 'SUB-DECK');
      // Total displayed buttons = 1 Back tile + (i + 1) inner buttons
      assert.equal(state.buttons.length, i + 2);
    }

    // Attempting to add a 15th button inside folder must be rejected
    ws.send(JSON.stringify({
      type: 'ADD_BUTTON',
      button: {
        label: 'EXCESS TILE',
        actionType: 'shell',
        command: 'echo excess'
      }
    }));
    const errCapacity = await nextMsg();
    assert.equal(errCapacity.type, 'ERROR');
    assert.equal(errCapacity.code, 'FOLDER_CAPACITY_REACHED');

    // Slot 0 Edit Mode Immunity: Attempting to update '__back__' must be rejected
    ws.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: {
        id: '__back__',
        label: 'HACKED BACK'
      }
    }));
    const errMutateBack = await nextMsg();
    assert.equal(errMutateBack.type, 'ERROR');
    assert.equal(errMutateBack.code, 'CANNOT_MUTATE_SYSTEM_BUTTON');

    // Slot 0 Edit Mode Immunity: Attempting to delete '__back__' must be rejected
    ws.send(JSON.stringify({
      type: 'DELETE_BUTTON',
      buttonId: '__back__'
    }));
    const errDeleteBack = await nextMsg();
    assert.equal(errDeleteBack.type, 'ERROR');
    assert.equal(errDeleteBack.code, 'CANNOT_MUTATE_SYSTEM_BUTTON');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Folder Navigation: Cascade deletion and zombie client reconciliation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-folder-cascade-'));
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
    await nextMsgA(); // INIT A
    await nextMsgB(); // INIT B

    // Create folder button
    wsA.send(JSON.stringify({
      type: 'UPDATE_BUTTON',
      button: {
        id: 0,
        label: 'CASCADE TARGET',
        actionType: 'folder'
      }
    }));

    await nextMsgA(); // STATE_UPDATE A
    await nextMsgB(); // STATE_UPDATE B

    // Client A enters folder
    wsA.send(JSON.stringify({ type: 'BUTTON_CLICK', buttonId: 0 }));
    const { navMsg: navA } = await getNextPair(nextMsgA);
    assert.equal(navA.canGoBack, true);

    // Client B deletes the folder button from the root deck
    wsB.send(JSON.stringify({
      type: 'DELETE_BUTTON',
      buttonId: 0
    }));

    // Client A's zombie folderStack is reconciled back to root deck
    const reconcileA = await nextMsgA();
    assert.equal(reconcileA.type, 'STATE_UPDATE');
    assert.deepEqual(reconcileA.folderStack, []);
    assert.equal(reconcileA.currentFolderName, null);
    assert.equal(reconcileA.canGoBack, false);

    const updateB = await nextMsgB();
    assert.equal(updateB.type, 'STATE_UPDATE');

    wsA.close();
    wsB.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
