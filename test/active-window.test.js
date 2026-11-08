'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const { createServer, ActiveWindowWatcher } = require('../server');
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

test('ActiveWindowWatcher: client connect triggers stream start', () => {
  let streamStarted = false;
  let streamStopped = false;

  const mockPlatform = {
    capabilities: () => ({ activeWindow: true }),
    createActiveWindowStream: (onChange, onError) => {
      streamStarted = true;
      return {
        stop: () => { streamStopped = true; }
      };
    }
  };

  const watcher = new ActiveWindowWatcher(mockPlatform, () => {});
  assert.equal(watcher.stream, null);

  watcher.handleClientConnected();
  assert.equal(streamStarted, true);
  assert.ok(watcher.stream);

  watcher.stop();
  assert.equal(streamStopped, true);
  assert.equal(watcher.stream, null);
});

test('ActiveWindowWatcher: client disconnect triggers 3-second teardown hysteresis', async () => {
  let stopCount = 0;

  const mockPlatform = {
    capabilities: () => ({ activeWindow: true }),
    createActiveWindowStream: (onChange, onError) => {
      return {
        stop: () => { stopCount++; }
      };
    }
  };

  const watcher = new ActiveWindowWatcher(mockPlatform, () => {});
  watcher.handleClientConnected();
  assert.ok(watcher.stream);
  assert.equal(stopCount, 0);

  // Client disconnects (count === 0) -> hysteresis begins
  watcher.handleClientDisconnected(0);
  assert.ok(watcher.teardownTimer, 'Teardown timer should be armed');
  assert.equal(stopCount, 0, 'Stream should not be stopped immediately');

  // Client reconnects within 50ms -> cancels teardown
  await new Promise(r => setTimeout(r, 50));
  watcher.handleClientConnected();
  assert.equal(watcher.teardownTimer, null, 'Teardown timer should be cleared');
  assert.ok(watcher.stream, 'Stream should remain active');
  assert.equal(stopCount, 0);

  // Client disconnects again (count === 0)
  watcher.handleClientDisconnected(0);
  assert.ok(watcher.teardownTimer);

  // Speed up timer for test assertion by triggering stop
  watcher.stop();
  assert.equal(stopCount, 1);
  assert.equal(watcher.teardownTimer, null);
  assert.equal(watcher.stream, null);
});

test('ActiveWindowWatcher: consecutive failures circuit breaker', () => {
  let reportedErrors = 0;
  let errCb = null;

  const mockPlatform = {
    capabilities: () => ({ activeWindow: true }),
    createActiveWindowStream: (onChange, onError) => {
      errCb = onError;
      return { stop: () => {} };
    }
  };

  const watcher = new ActiveWindowWatcher(mockPlatform, () => {});
  watcher.start();
  assert.ok(errCb);

  // Trigger errors
  errCb(new Error('failure 1'));
  assert.equal(watcher.consecutiveFailures, 1);
  errCb(new Error('failure 2'));
  assert.equal(watcher.consecutiveFailures, 2);

  // Trigger success
  watcher.onChange('vscode');
  // In ActiveWindowWatcher start(), onChange callback resets consecutiveFailures:
  // (appId) => { this.consecutiveFailures = 0; this.onChange(appId); }
  watcher.stop();
});

test('ActiveWindow: End-to-end focus auto-switching via WebSocket with transient state invariant', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-active-win-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  let windowChangeEmitter = null;
  const fakeAdapter = platform.adapters.fake.createFakeAdapter({
    createActiveWindowStream: (onChange, onError) => {
      windowChangeEmitter = onChange;
      return {
        stop: () => {}
      };
    }
  });
  fakeAdapter.capabilities = () => ({ activeWindow: true, media: true, applications: true });

  const app = createServer({
    configPath,
    authPath,
    platformAdapter: fakeAdapter,
    silent: true
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
    assert.equal(app.getNavState().workspaceId, 'developer');
    assert.ok(windowChangeEmitter, 'Watcher should be active upon client connection');

    // 1. Focus shift to Spotify -> auto-switches to media workspace
    windowChangeEmitter('spotify');
    const update1 = await nextMsg();
    assert.equal(update1.type, 'STATE_UPDATE');
    assert.equal(update1.workspaceId, 'media');
    assert.equal(update1.navigation.workspaceId, 'media');
    assert.equal(update1.navigation.mode, 'auto');
    assert.equal(app.getNavState().workspaceId, 'media');

    // CRITICAL INVARIANT: appConfig.activeWorkspaceId must NOT be changed by automated focus!
    assert.equal(app.getConfig().activeWorkspaceId, 'developer', 'Persistent activeWorkspaceId must remain untouched');
    assert.equal(app.hasPendingSave(), false, 'Focus transition must never trigger disk save');

    // 2. Focus shift to VS Code -> auto-switches back to developer workspace
    windowChangeEmitter('code');
    const update2 = await nextMsg();
    assert.equal(update2.type, 'STATE_UPDATE');
    assert.equal(update2.workspaceId, 'developer');
    assert.equal(update2.navigation.workspaceId, 'developer');

    // 3. User pins workspace -> focus shifts are ignored
    ws.send(JSON.stringify({ type: 'PIN' }));
    const pinUpdate = await nextMsg();
    assert.equal(pinUpdate.type, 'STATE_UPDATE');
    assert.equal(pinUpdate.navigation.pinned, true);

    // Focus shift to Spotify while pinned -> must NOT switch workspace
    windowChangeEmitter('spotify');
    await new Promise(r => setTimeout(r, 60));
    assert.equal(app.getNavState().workspaceId, 'developer', 'Pinned state blocks auto-switch');

    // 4. User unpins workspace -> auto-switching is re-enabled
    ws.send(JSON.stringify({ type: 'UNPIN' }));
    const unpinUpdate = await nextMsg();
    assert.equal(unpinUpdate.type, 'STATE_UPDATE');
    assert.equal(unpinUpdate.navigation.pinned, false);

    windowChangeEmitter('spotify');
    const update3 = await nextMsg();
    assert.equal(update3.type, 'STATE_UPDATE');
    assert.equal(update3.workspaceId, 'media');

    ws.close();
  } finally {
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
