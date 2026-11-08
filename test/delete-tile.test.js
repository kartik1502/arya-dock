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
    return new Promise((resolve) => {
      waiter = resolve;
    });
  };
}

test('Tile Deletion: Deleting the only button on a 1-page workspace leaves 1 page with 0 buttons', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-del-1page-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const initialConfig = {
    schemaVersion: 2,
    activeWorkspaceId: 'default',
    workspaces: [
      {
        id: 'default',
        name: 'Default',
        icon: '⚡',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: [
              { id: 42, label: 'SOLE TILE', color: '#1c69d4', actionType: 'shell', command: '' }
            ]
          }
        ]
      }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

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
    assert.equal(initMsg.totalPages, 1);
    assert.equal(initMsg.buttons.length, 1);
    assert.equal(initMsg.buttons[0].id, 42);

    // Delete the only button
    ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: 42 }));
    const updateMsg = await nextMsg();
    assert.equal(updateMsg.type, 'STATE_UPDATE');
    assert.equal(updateMsg.totalPages, 1);
    assert.equal(updateMsg.pageNumber, 1);
    assert.equal(updateMsg.buttons.length, 0, 'Page retained with 0 buttons');

    // Verify workspace in-memory state
    const wsObj = app.getActiveWorkspace();
    assert.equal(wsObj.pages.length, 1);
    assert.equal(wsObj.pages[0].buttons.length, 0);

    // Verify persistence after flush
    app.flushConfig();
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(diskConfig.workspaces[0].pages.length, 1);
    assert.equal(diskConfig.workspaces[0].pages[0].buttons.length, 0);
    assert.equal(diskConfig.profiles.default.pages[0].buttons.length, 0);
  } finally {
    ws.close();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Tile Deletion: Deleting the only button on Page 2 removes Page 2 and navigates to Page 1', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-del-p2-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const initialConfig = {
    schemaVersion: 2,
    activeWorkspaceId: 'default',
    workspaces: [
      {
        id: 'default',
        name: 'Default',
        icon: '⚡',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: [
              { id: 1, label: 'TILE 1', color: '#1c69d4', actionType: 'shell', command: '' },
              { id: 2, label: 'TILE 2', color: '#1c69d4', actionType: 'shell', command: '' }
            ]
          },
          {
            pageNumber: 2,
            name: 'Page 2',
            buttons: [
              { id: 99, label: 'PAGE 2 ONLY', color: '#0066b1', actionType: 'shell', command: '' }
            ]
          }
        ]
      }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

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
    assert.equal(initMsg.totalPages, 2);
    assert.equal(initMsg.pageNumber, 1);

    // Navigate to Page 2
    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
    const p2Msg = await nextMsg();
    assert.equal(p2Msg.type, 'STATE_UPDATE');
    assert.equal(p2Msg.pageNumber, 2);
    assert.equal(p2Msg.buttons.length, 1);
    assert.equal(p2Msg.buttons[0].id, 99);

    // Delete the only button on Page 2
    ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: 99 }));
    const delMsg = await nextMsg();
    assert.equal(delMsg.type, 'STATE_UPDATE');
    assert.equal(delMsg.totalPages, 1, 'Total pages reduced to 1');
    assert.equal(delMsg.pageNumber, 1, 'Active page transitioned to Page 1');
    assert.equal(delMsg.buttons.length, 2, 'Buttons from Page 1 are active');
    assert.equal(delMsg.navigation.pageIndex, 0);

    // Verify workspace in-memory state
    const wsObj = app.getActiveWorkspace();
    assert.equal(wsObj.pages.length, 1);
    assert.equal(wsObj.pages[0].pageNumber, 1);
    const navState = app.getNavState();
    assert.equal(navState.pageIndex, 0);

    // Verify persistence
    app.flushConfig();
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(diskConfig.workspaces[0].pages.length, 1);
    assert.equal(diskConfig.workspaces[0].pages[0].buttons.length, 2);
    assert.equal(diskConfig.profiles.default.pages.length, 1);
  } finally {
    ws.close();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Tile Deletion: Deleting the only button on Page 1 when Page 2 exists removes former Page 1, renumbers former Page 2 to Page 1, and stays on pageIndex 0', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-del-p1-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const initialConfig = {
    schemaVersion: 2,
    activeWorkspaceId: 'default',
    workspaces: [
      {
        id: 'default',
        name: 'Default',
        icon: '⚡',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: [
              { id: 10, label: 'SOLE TILE ON P1', color: '#1c69d4', actionType: 'shell', command: '' }
            ]
          },
          {
            pageNumber: 2,
            name: 'Page 2',
            buttons: [
              { id: 20, label: 'P2 TILE A', color: '#0066b1', actionType: 'shell', command: '' },
              { id: 21, label: 'P2 TILE B', color: '#e22718', actionType: 'shell', command: '' }
            ]
          }
        ]
      }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

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
    assert.equal(initMsg.totalPages, 2);
    assert.equal(initMsg.pageNumber, 1);
    assert.equal(initMsg.buttons.length, 1);
    assert.equal(initMsg.buttons[0].id, 10);

    // Delete the only button on Page 1
    ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: 10 }));
    const delMsg = await nextMsg();
    assert.equal(delMsg.type, 'STATE_UPDATE');
    assert.equal(delMsg.totalPages, 1, 'Total pages pruned to 1');
    assert.equal(delMsg.pageNumber, 1, 'Current page is 1');
    assert.equal(delMsg.navigation.pageIndex, 0, 'PageIndex remains 0');
    assert.equal(delMsg.buttons.length, 2, 'Buttons from former Page 2 are now on Page 1');
    assert.equal(delMsg.buttons[0].id, 20);
    assert.equal(delMsg.buttons[1].id, 21);

    // Verify workspace in-memory state
    const wsObj = app.getActiveWorkspace();
    assert.equal(wsObj.pages.length, 1);
    assert.equal(wsObj.pages[0].pageNumber, 1, 'Former Page 2 was renumbered to pageNumber 1');
    assert.equal(wsObj.pages[0].name, 'Page 1');
    const navState = app.getNavState();
    assert.equal(navState.pageIndex, 0);

    // Verify persistence
    app.flushConfig();
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(diskConfig.workspaces[0].pages.length, 1);
    assert.equal(diskConfig.workspaces[0].pages[0].pageNumber, 1);
    assert.equal(diskConfig.workspaces[0].pages[0].buttons.length, 2);
    assert.equal(diskConfig.profiles.default.pages.length, 1);
    assert.equal(diskConfig.profiles.default.pages[0].pageNumber, 1);
  } finally {
    ws.close();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Tile Deletion: Deleting the only button on Page 2 when 3 pages exist removes Page 2, renumbers Page 3 to Page 2, and navigates to Page 1', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-del-middle-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const initialConfig = {
    schemaVersion: 2,
    activeWorkspaceId: 'default',
    workspaces: [
      {
        id: 'default',
        name: 'Default',
        icon: '⚡',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: [{ id: 1, label: 'P1 TILE', color: '#1c69d4', actionType: 'shell', command: '' }]
          },
          {
            pageNumber: 2,
            name: 'Page 2',
            buttons: [{ id: 2, label: 'P2 SOLE TILE', color: '#0066b1', actionType: 'shell', command: '' }]
          },
          {
            pageNumber: 3,
            name: 'Page 3',
            buttons: [{ id: 3, label: 'P3 TILE', color: '#e22718', actionType: 'shell', command: '' }]
          }
        ]
      }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

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

    // Navigate to Page 2 (index 1)
    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
    const p2Msg = await nextMsg();
    assert.equal(p2Msg.pageNumber, 2);
    assert.equal(p2Msg.buttons[0].id, 2);

    // Delete the only button on Page 2 using data.button.id
    ws.send(JSON.stringify({ type: 'DELETE_BUTTON', button: { id: 2 } }));
    const delMsg = await nextMsg();
    assert.equal(delMsg.type, 'STATE_UPDATE');
    assert.equal(delMsg.totalPages, 2, 'Pruned to 2 pages');
    assert.equal(delMsg.pageNumber, 1, 'Navigated to previous page (Page 1)');
    assert.equal(delMsg.navigation.pageIndex, 0);
    assert.equal(delMsg.buttons[0].id, 1);

    // Verify remaining Page 2 (former Page 3)
    const wsObj = app.getActiveWorkspace();
    assert.equal(wsObj.pages.length, 2);
    assert.equal(wsObj.pages[0].pageNumber, 1);
    assert.equal(wsObj.pages[1].pageNumber, 2);
    assert.equal(wsObj.pages[1].buttons[0].id, 3);
  } finally {
    ws.close();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Tile Deletion: Operator privilege enforcement on DELETE_BUTTON', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-del-sec-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const initialConfig = {
    schemaVersion: 2,
    activeWorkspaceId: 'default',
    workspaces: [
      {
        id: 'default',
        name: 'Default',
        icon: '⚡',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: [
              { id: 0, label: 'KEY 1', color: '#1c69d4', actionType: 'shell', command: '' }
            ]
          }
        ]
      }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

  // Use mockClientIp remote IP so it is assigned operator role
  const app = createServer({ configPath, authPath, mockClientIp: '192.168.1.99' });
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
    assert.equal(initMsg.role, 'operator');
    assert.equal(initMsg.canEdit, false);

    // Operator attempt to delete button must be rejected
    ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: 0 }));
    const errMsg = await nextMsg();
    assert.equal(errMsg.type, 'ERROR');
    assert.ok(errMsg.message.includes('Unauthorized: editor privilege required'));

    // Verify button was NOT deleted
    const wsObj = app.getActiveWorkspace();
    assert.equal(wsObj.pages[0].buttons.length, 1);
  } finally {
    ws.close();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Tile Deletion: Deleting sole tile to 0 buttons then ADD_BUTTON re-adds tile cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-del-readd-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const initialConfig = {
    schemaVersion: 2,
    activeWorkspaceId: 'default',
    workspaces: [
      {
        id: 'default',
        name: 'Default',
        icon: '⚡',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: [
              { id: 7, label: 'ONLY ONE', color: '#1c69d4', actionType: 'shell', command: '' }
            ]
          }
        ]
      }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

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

    // Delete the only tile
    ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: 7 }));
    const delMsg = await nextMsg();
    assert.equal(delMsg.type, 'STATE_UPDATE');
    assert.equal(delMsg.buttons.length, 0);

    // Add a tile back to the empty page
    ws.send(JSON.stringify({ type: 'ADD_BUTTON' }));
    const addMsg = await nextMsg();
    assert.equal(addMsg.type, 'STATE_UPDATE');
    assert.equal(addMsg.buttons.length, 1);
    assert.equal(addMsg.buttons[0].id, 0);
    assert.equal(addMsg.buttons[0].label, 'KEY 1');

    app.flushConfig();
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(diskConfig.workspaces[0].pages[0].buttons.length, 1);
  } finally {
    ws.close();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Tile Deletion: Custom page names preserved during page pruning and renumbering', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-del-customname-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const initialConfig = {
    schemaVersion: 2,
    activeWorkspaceId: 'default',
    workspaces: [
      {
        id: 'default',
        name: 'Default',
        icon: '⚡',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: [{ id: 10, label: 'P1 TILE', color: '#1c69d4', actionType: 'shell', command: '' }]
          },
          {
            pageNumber: 2,
            name: 'Page 2',
            buttons: [{ id: 20, label: 'P2 TILE', color: '#0066b1', actionType: 'shell', command: '' }]
          },
          {
            pageNumber: 3,
            name: 'Custom Controls',
            buttons: [{ id: 30, label: 'CUSTOM TILE', color: '#e22718', actionType: 'shell', command: '' }]
          }
        ]
      }
    ]
  };
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

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

    // Navigate to Page 2
    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
    await nextMsg();

    // Delete the sole tile on Page 2
    ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: 20 }));
    const delMsg = await nextMsg();
    assert.equal(delMsg.type, 'STATE_UPDATE');
    assert.equal(delMsg.totalPages, 2);
    assert.equal(delMsg.pageNumber, 1);

    // Verify in-memory workspace
    const wsObj = app.getActiveWorkspace();
    assert.equal(wsObj.pages.length, 2);
    assert.equal(wsObj.pages[0].pageNumber, 1);
    assert.equal(wsObj.pages[0].name, 'Page 1');
    assert.equal(wsObj.pages[1].pageNumber, 2);
    assert.equal(wsObj.pages[1].name, 'Custom Controls', 'Custom page name must be preserved');
  } finally {
    ws.close();
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
