'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_BUTTONS_PER_PAGE,
  ALLOWED_CATEGORIES,
  classifyButton,
  isKnownDesktopCommand,
  formatCategoryName,
  getCategoryProjection
} = require('../lib/segregation');
const { validateButton, validateWorkspace } = require('../lib/config');

test('Segregation: Schema validation extensions in lib/config.js', () => {
  // 1. Button categoryOverride and isApplication validation
  const btnValid = {
    id: 0,
    label: 'TEST',
    actionType: 'shell',
    command: 'code .',
    isApplication: true,
    categoryOverride: 'application'
  };
  const resValid = validateButton(btnValid);
  assert.equal(resValid.valid, true);
  assert.equal(resValid.button.isApplication, true);
  assert.equal(resValid.button.categoryOverride, 'application');

  // Category override case normalization and whitespace trimming
  const btnTrim = validateButton({ id: 1, label: 'TRIM', categoryOverride: '  TERMINAL  ' });
  assert.equal(btnTrim.valid, true);
  assert.equal(btnTrim.button.categoryOverride, 'terminal');

  // Rejection of invalid categoryOverride
  const btnInvalid = validateButton({ id: 2, label: 'BAD', categoryOverride: 'unsupported_cat' });
  assert.equal(btnInvalid.valid, false);
  assert.ok(btnInvalid.error.includes('Invalid categoryOverride'));

  // Repair mode sanitizes invalid categoryOverride to null
  const btnRepaired = validateButton({ id: 3, label: 'REPAIR', categoryOverride: 'bad' }, { repair: true });
  assert.equal(btnRepaired.valid, true);
  assert.equal(btnRepaired.button.categoryOverride, null);

  // 2. Workspace segregation whitelisting
  const wsValid = {
    id: 'dev',
    name: 'Dev',
    segregation: { enabled: true },
    pages: [{ pageNumber: 1, buttons: [] }]
  };
  const wsRes = validateWorkspace(wsValid, { repair: false });
  assert.equal(wsRes.valid, true);
  assert.deepEqual(wsRes.workspace.segregation, { enabled: true });

  // Default segregation when omitted
  const wsDefault = validateWorkspace({ id: 'dev2', name: 'Dev2', pages: [{ buttons: [] }] });
  assert.equal(wsDefault.valid, true);
  assert.deepEqual(wsDefault.workspace.segregation, { enabled: false });
});

test('Segregation: Classification Engine pure rule-based evaluation', () => {
  // 1. Explicit override takes absolute precedence
  assert.equal(classifyButton({ actionType: 'media', categoryOverride: 'terminal' }), 'terminal');
  assert.equal(classifyButton({ actionType: 'url', categoryOverride: 'application' }), 'application');
  assert.equal(classifyButton({ actionType: 'shell', terminalMode: 'tab', categoryOverride: 'url' }), 'url');
  assert.equal(classifyButton({ actionType: 'shell', categoryOverride: ' MEDIA ' }), 'media');

  // 2. Dedicated media action
  assert.equal(classifyButton({ actionType: 'media', mediaAction: 'play_pause' }), 'media');

  // 3. Web URL action
  assert.equal(classifyButton({ actionType: 'url', url: 'https://example.com' }), 'url');

  // 4. Shell actions
  // Interactive shells (tab, window, existing) -> terminal
  assert.equal(classifyButton({ actionType: 'shell', command: 'htop', terminalMode: 'tab' }), 'terminal');
  assert.equal(classifyButton({ actionType: 'shell', command: 'btop', terminalMode: 'window' }), 'terminal');
  assert.equal(classifyButton({ actionType: 'shell', command: 'zsh', terminalMode: 'existing' }), 'terminal');

  // Background shell with isApplication: true -> application
  assert.equal(classifyButton({ actionType: 'shell', command: 'my-custom-tool', terminalMode: 'background', isApplication: true }), 'application');

  // Background shell with known desktop binary -> application
  assert.equal(classifyButton({ actionType: 'shell', command: 'google-chrome https://docs.google.com', terminalMode: 'background' }), 'application');
  assert.equal(classifyButton({ actionType: 'shell', command: 'code /home/user/project', terminalMode: 'background' }), 'application');
  assert.equal(classifyButton({ actionType: 'shell', command: 'slack', terminalMode: 'background' }), 'application');
  assert.equal(classifyButton({ actionType: 'shell', command: 'spotify', terminalMode: 'background' }), 'application');

  // Background shell with CLI developer script -> terminal
  assert.equal(classifyButton({ actionType: 'shell', command: 'git pull origin main', terminalMode: 'background' }), 'terminal');
  assert.equal(classifyButton({ actionType: 'shell', command: 'docker compose up -d', terminalMode: 'background' }), 'terminal');
  assert.equal(classifyButton({ actionType: 'shell', command: 'cargo test --release', terminalMode: 'background' }), 'terminal');

  // Fallbacks
  assert.equal(classifyButton(null), 'terminal');
  assert.equal(classifyButton({}), 'terminal');
  assert.equal(classifyButton({ actionType: 'custom_future_action' }), 'terminal');
});

test('Segregation: isKnownDesktopCommand and formatCategoryName helpers', () => {
  assert.equal(isKnownDesktopCommand('firefox'), true);
  assert.equal(isKnownDesktopCommand('Firefox https://mozilla.org'), true);
  assert.equal(isKnownDesktopCommand('vlc movie.mp4'), true);
  assert.equal(isKnownDesktopCommand('git status'), false);
  assert.equal(isKnownDesktopCommand('npm test'), false);
  assert.equal(isKnownDesktopCommand(''), false);
  assert.equal(isKnownDesktopCommand(null), false);

  assert.equal(formatCategoryName('terminal'), 'Terminal');
  assert.equal(formatCategoryName('application'), 'Application');
  assert.equal(formatCategoryName('url'), 'URL');
  assert.equal(formatCategoryName('media'), 'Media');
  assert.equal(formatCategoryName('custom'), 'Custom');
});

test('Segregation: View Projection and 15-tile page chunking', () => {
  const sampleWorkspace = {
    id: 'developer',
    name: 'Developer Cockpit',
    pages: [
      {
        pageNumber: 1,
        name: 'Page 1',
        buttons: [
          { id: 0, label: 'Term 1', actionType: 'shell', terminalMode: 'tab', command: 'bash' },
          { id: 1, label: 'App 1', actionType: 'shell', terminalMode: 'background', isApplication: true, command: 'app' },
          { id: 2, label: 'Web 1', actionType: 'url', url: 'https://github.com' },
          { id: 3, label: 'Media 1', actionType: 'media', mediaAction: 'play_pause' }
        ]
      },
      {
        pageNumber: 2,
        name: 'Page 2',
        buttons: [
          { id: 0, label: 'Term 2', actionType: 'shell', terminalMode: 'tab', command: 'zsh' },
          { id: 1, label: 'Term 3', actionType: 'shell', terminalMode: 'window', command: 'tmux' }
        ]
      }
    ]
  };

  // Lens: 'all' returns canonical pages directly
  const allProjection = getCategoryProjection(sampleWorkspace, 'all');
  assert.equal(allProjection.length, 2);
  assert.equal(allProjection[0].buttons.length, 4);
  assert.equal(allProjection[1].buttons.length, 2);

  // Lens: 'terminal' filters terminal buttons across both pages (Term 1, Term 2, Term 3)
  const termProjection = getCategoryProjection(sampleWorkspace, 'terminal');
  assert.equal(termProjection.length, 1);
  assert.equal(termProjection[0].pageNumber, 1);
  assert.equal(termProjection[0].name, 'Terminal 1');
  assert.equal(termProjection[0].category, 'terminal');
  assert.equal(termProjection[0].buttons.length, 3);
  assert.deepEqual(termProjection[0].buttons.map(b => b.label), ['Term 1', 'Term 2', 'Term 3']);

  // Lens: 'application' has 1 button
  const appProjection = getCategoryProjection(sampleWorkspace, 'application');
  assert.equal(appProjection.length, 1);
  assert.equal(appProjection[0].name, 'Application 1');
  assert.equal(appProjection[0].buttons.length, 1);
  assert.equal(appProjection[0].buttons[0].label, 'App 1');

  // Lens: zero matches returns a single placeholder page with 0 buttons
  const emptyWorkspace = { id: 'empty', pages: [{ buttons: [] }] };
  const emptyMedia = getCategoryProjection(emptyWorkspace, 'media');
  assert.equal(emptyMedia.length, 1);
  assert.equal(emptyMedia[0].name, 'Media 1');
  assert.equal(emptyMedia[0].category, 'media');
  assert.equal(emptyMedia[0].buttons.length, 0);

  // 15-tile capacity overflow test: 18 terminal buttons chunk into Page 1 (15) and Page 2 (3)
  const manyButtons = [];
  for (let i = 0; i < 18; i++) {
    manyButtons.push({
      id: i,
      label: `CLI ${i}`,
      actionType: 'shell',
      terminalMode: 'tab',
      command: `echo ${i}`
    });
  }
  const overflowWorkspace = {
    id: 'overflow-test',
    pages: [{ pageNumber: 1, buttons: manyButtons }]
  };

  const overflowProjection = getCategoryProjection(overflowWorkspace, 'terminal');
  assert.equal(overflowProjection.length, 2);
  assert.equal(overflowProjection[0].pageNumber, 1);
  assert.equal(overflowProjection[0].name, 'Terminal 1');
  assert.equal(overflowProjection[0].buttons.length, 15); // Capped at MAX_BUTTONS_PER_PAGE
  assert.equal(overflowProjection[1].pageNumber, 2);
  assert.equal(overflowProjection[1].name, 'Terminal 2');
  assert.equal(overflowProjection[1].buttons.length, 3); // Excess 3 tiles
});

test('Segregation: Mathematical losslessness & non-mutation invariant', () => {
  const originalPages = [
    {
      pageNumber: 1,
      name: 'Custom Page Alpha',
      buttons: [
        { id: 0, label: 'A', actionType: 'shell', terminalMode: 'tab' },
        { id: 1, label: 'B', actionType: 'url', url: 'https://example.com' }
      ]
    }
  ];
  const workspace = { id: 'test', name: 'Test', pages: originalPages };
  const snapshotBefore = JSON.stringify(workspace);

  // Projecting through multiple lenses
  getCategoryProjection(workspace, 'terminal');
  getCategoryProjection(workspace, 'url');
  getCategoryProjection(workspace, 'application');
  getCategoryProjection(workspace, 'media');
  getCategoryProjection(workspace, 'all');

  const snapshotAfter = JSON.stringify(workspace);
  // Guarantee 100% zero-mutation invariant
  assert.equal(snapshotBefore, snapshotAfter, 'Workspace backing store must not be mutated by projection');
});
