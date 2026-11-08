'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInitialNavigationState,
  normalizeAppId,
  findWorkspaceForApp,
  navigationReducer
} = require('../lib/navigation');

test('Navigation: createInitialNavigationState default options and custom overrides', () => {
  const defaultState = createInitialNavigationState();
  assert.deepEqual(defaultState, {
    mode: 'auto',
    workspaceId: 'developer',
    pageIndex: 0,
    pinned: false
  });

  const customState = createInitialNavigationState({
    workspaces: [{ id: 'custom-ws' }],
    initialWorkspaceId: 'custom-ws',
    mode: 'manual',
    pageIndex: 2,
    pinned: true
  });
  assert.deepEqual(customState, {
    mode: 'manual',
    workspaceId: 'custom-ws',
    pageIndex: 2,
    pinned: true
  });
});

test('Navigation: normalizeAppId normalizes desktop files, editions, and case', () => {
  assert.equal(normalizeAppId(''), '');
  assert.equal(normalizeAppId(null), '');
  assert.equal(normalizeAppId('org.gnome.Ptyxis.desktop'), 'org.gnome.ptyxis');
  assert.equal(normalizeAppId('google-chrome.desktop'), 'google-chrome');
  assert.equal(normalizeAppId('jetbrains-idea-ce.desktop'), 'jetbrains-idea');
  assert.equal(normalizeAppId('jetbrains-idea-ultimate'), 'jetbrains-idea');
  assert.equal(normalizeAppId('code'), 'code');
});

test('Navigation: findWorkspaceForApp matches normalized application rules', () => {
  const workspaces = [
    {
      id: 'developer',
      name: 'Developer & AI',
      match: { apps: ['code', 'org.gnome.ptyxis', 'jetbrains-idea', 'terminal'] }
    },
    {
      id: 'media',
      name: 'Media Controls',
      match: { apps: ['spotify', 'vlc', 'rhythmbox'] }
    },
    {
      id: 'browser',
      name: 'Web Workflows',
      match: { apps: ['google-chrome', 'firefox'] }
    }
  ];

  assert.equal(findWorkspaceForApp(workspaces, 'org.gnome.Ptyxis.desktop'), 'developer');
  assert.equal(findWorkspaceForApp(workspaces, 'jetbrains-idea-ce.desktop'), 'developer');
  assert.equal(findWorkspaceForApp(workspaces, 'code'), 'developer');
  assert.equal(findWorkspaceForApp(workspaces, 'Spotify.desktop'), 'media');
  assert.equal(findWorkspaceForApp(workspaces, 'google-chrome'), 'browser');
  assert.equal(findWorkspaceForApp(workspaces, 'unknown-app'), null);
  assert.equal(findWorkspaceForApp([], 'code'), null);
  assert.equal(findWorkspaceForApp(workspaces, null), null);
});

test('Navigation Reducer: pure function invariance (does not mutate state)', () => {
  const state = Object.freeze({
    mode: 'auto',
    workspaceId: 'developer',
    pageIndex: 0,
    pinned: false
  });

  const next1 = navigationReducer(state, { type: 'USER_SELECT', workspaceId: 'media' });
  assert.notEqual(next1, state);
  assert.equal(state.workspaceId, 'developer', 'Original state must remain untouched');
  assert.equal(next1.workspaceId, 'media');

  const next2 = navigationReducer(state, { type: 'PIN' });
  assert.equal(state.pinned, false);
  assert.equal(next2.pinned, true);
});

test('Navigation Reducer: USER_SELECT switches workspace, updates pageIndex, sets manual mode', () => {
  const state = {
    mode: 'auto',
    workspaceId: 'developer',
    pageIndex: 1,
    pinned: false
  };

  // Switching workspace resets pageIndex to 0
  const switched = navigationReducer(state, { type: 'USER_SELECT', workspaceId: 'media' });
  assert.equal(switched.workspaceId, 'media');
  assert.equal(switched.pageIndex, 0);
  assert.equal(switched.mode, 'manual');
  assert.equal(switched.pinned, false);

  // Selecting same workspace preserves pageIndex
  const sameWs = navigationReducer(state, { type: 'USER_SELECT', workspaceId: 'developer' });
  assert.equal(sameWs.workspaceId, 'developer');
  assert.equal(sameWs.pageIndex, 1);
  assert.equal(sameWs.mode, 'manual');

  // Explicit pageIndex specified
  const explicitPage = navigationReducer(state, { type: 'USER_SELECT', workspaceId: 'developer', pageIndex: 3 });
  assert.equal(explicitPage.pageIndex, 3);
  assert.equal(explicitPage.mode, 'manual');

  // Bounds checking with context.totalPages
  const bounded = navigationReducer(state, { type: 'USER_SELECT', workspaceId: 'developer', pageIndex: 99 }, { totalPages: 2 });
  assert.equal(bounded.pageIndex, 1);
});

test('Navigation Reducer: CONTEXT_CHANGED follows context when unpinned, ignored when pinned', () => {
  const unpinnedState = {
    mode: 'auto',
    workspaceId: 'developer',
    pageIndex: 1,
    pinned: false
  };

  const workspaces = [
    { id: 'developer', match: { apps: ['code'] } },
    { id: 'media', match: { apps: ['spotify'] } }
  ];

  // Unpinned: switching from developer to media
  const switched = navigationReducer(
    unpinnedState,
    { type: 'CONTEXT_CHANGED', appId: 'spotify' },
    { workspaces }
  );
  assert.equal(switched.workspaceId, 'media');
  assert.equal(switched.pageIndex, 0);
  assert.equal(switched.mode, 'auto');

  // Directly via matchedWorkspaceId
  const direct = navigationReducer(
    unpinnedState,
    { type: 'CONTEXT_CHANGED', matchedWorkspaceId: 'media' },
    { workspaces }
  );
  assert.equal(direct.workspaceId, 'media');
  assert.equal(direct.pageIndex, 0);

  // Unmatched application remains on current workspace
  const unmatched = navigationReducer(
    unpinnedState,
    { type: 'CONTEXT_CHANGED', appId: 'gnome-calculator' },
    { workspaces }
  );
  assert.equal(unmatched.workspaceId, 'developer');

  // PINNED: active workspace is locked, ignores context change
  const pinnedState = {
    mode: 'manual',
    workspaceId: 'developer',
    pageIndex: 1,
    pinned: true
  };

  const pinnedResult = navigationReducer(
    pinnedState,
    { type: 'CONTEXT_CHANGED', appId: 'spotify' },
    { workspaces }
  );
  assert.equal(pinnedResult.workspaceId, 'developer', 'Pinned state must NOT change workspace on context switch');
  assert.equal(pinnedResult.pageIndex, 1);
  assert.equal(pinnedResult.pinned, true);
});

test('Navigation Reducer: PIN and UNPIN transitions', () => {
  const state = {
    mode: 'auto',
    workspaceId: 'developer',
    pageIndex: 0,
    pinned: false
  };

  // PIN locks to current workspace
  const pinned = navigationReducer(state, { type: 'PIN' });
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.mode, 'manual');

  // Second PIN is a no-op
  const pinnedAgain = navigationReducer(pinned, { type: 'PIN' });
  assert.equal(pinnedAgain, pinned);

  // UNPIN restores auto mode
  const unpinned = navigationReducer(pinned, { type: 'UNPIN' });
  assert.equal(unpinned.pinned, false);
  assert.equal(unpinned.mode, 'auto');

  // Second UNPIN is a no-op
  const unpinnedAgain = navigationReducer(unpinned, { type: 'UNPIN' });
  assert.equal(unpinnedAgain, unpinned);
});

test('Navigation Reducer: WORKSPACE_DELETED fallback', () => {
  const state = {
    mode: 'manual',
    workspaceId: 'custom-workspace',
    pageIndex: 2,
    pinned: true
  };

  const workspaces = [
    { id: 'developer', name: 'Dev' },
    { id: 'custom-workspace', name: 'Custom' }
  ];

  // Deleting an unrelated workspace does not change active state
  const unaffected = navigationReducer(
    state,
    { type: 'WORKSPACE_DELETED', workspaceId: 'other-ws' },
    { workspaces }
  );
  assert.equal(unaffected, state);

  // Deleting the currently active workspace triggers fallback
  const fallback = navigationReducer(
    state,
    { type: 'WORKSPACE_DELETED', workspaceId: 'custom-workspace' },
    { workspaces }
  );
  assert.equal(fallback.workspaceId, 'developer');
  assert.equal(fallback.pageIndex, 0);
  assert.equal(fallback.pinned, false);
  assert.equal(fallback.mode, 'auto');

  // Explicit fallbackWorkspaceId override
  const customFallback = navigationReducer(
    state,
    { type: 'WORKSPACE_DELETED', workspaceId: 'custom-workspace', fallbackWorkspaceId: 'media' },
    { workspaces }
  );
  assert.equal(customFallback.workspaceId, 'media');
});

test('Navigation Reducer: PAGE_PREV and PAGE_NEXT cyclic wrapping', () => {
  const state = {
    mode: 'auto',
    workspaceId: 'developer',
    pageIndex: 0,
    pinned: false
  };

  // PAGE_NEXT from 0 with 3 pages -> 1
  const p1 = navigationReducer(state, { type: 'PAGE_NEXT', totalPages: 3 });
  assert.equal(p1.pageIndex, 1);

  // PAGE_NEXT from 1 with 3 pages -> 2
  const p2 = navigationReducer(p1, { type: 'PAGE_NEXT', totalPages: 3 });
  assert.equal(p2.pageIndex, 2);

  // PAGE_NEXT from 2 with 3 pages wraps back to 0
  const p0 = navigationReducer(p2, { type: 'PAGE_NEXT', totalPages: 3 });
  assert.equal(p0.pageIndex, 0);

  // PAGE_PREV from 0 with 3 pages wraps to 2
  const prevWrapped = navigationReducer(state, { type: 'PAGE_PREV', totalPages: 3 });
  assert.equal(prevWrapped.pageIndex, 2);

  // PAGE_PREV from 2 with 3 pages -> 1
  const prev1 = navigationReducer(prevWrapped, { type: 'PAGE_PREV', totalPages: 3 });
  assert.equal(prev1.pageIndex, 1);

  // Single page does not change index from 0
  const singleNext = navigationReducer(state, { type: 'PAGE_NEXT', totalPages: 1 });
  assert.equal(singleNext.pageIndex, 0);
  const singlePrev = navigationReducer(state, { type: 'PAGE_PREV', totalPages: 1 });
  assert.equal(singlePrev.pageIndex, 0);
});

test('Navigation Reducer: unknown action returns state unchanged', () => {
  const state = { mode: 'auto', workspaceId: 'developer', pageIndex: 0, pinned: false };
  assert.equal(navigationReducer(state, { type: 'UNKNOWN_ACTION' }), state);
  assert.equal(navigationReducer(state, null), state);
  assert.equal(navigationReducer(state, {}), state);
});
