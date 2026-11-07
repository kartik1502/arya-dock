const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const {
  quoteForShell,
  buildActionCommand,
  getDefaultShell,
  getDefaultTerminal
} = require('../lib/terminal');

test('Terminal: quoteForShell safely escapes arbitrary strings', () => {
  assert.equal(quoteForShell(''), "''");
  assert.equal(quoteForShell('simple'), "'simple'");
  assert.equal(quoteForShell('has spaces'), "'has spaces'");
  assert.equal(quoteForShell("has 'single' quotes"), "'has '\\''single'\\'' quotes'");
  assert.equal(quoteForShell('has $VAR and `cmd` and $(sub)'), "'has $VAR and `cmd` and $(sub)'");
  assert.equal(quoteForShell('path/with/\\backslash'), "'path/with/\\backslash'");
});

test('Terminal: buildActionCommand builds valid CLI arguments for all supported terminals', () => {
  const defaultShell = getDefaultShell();
  const testDir = '/tmp/arya-test-repo';

  // 1. Background mode execution
  const bgCmd = buildActionCommand({
    id: 1,
    actionType: 'shell',
    command: 'git status',
    terminalMode: 'background',
    workingDir: testDir
  }, { ignoreDirExists: true });

  assert.equal(bgCmd.bin, defaultShell);
  assert.deepEqual(bgCmd.args, ['-i', '-l', '-c', 'git status']);
  assert.equal(bgCmd.options.cwd, testDir);

  // Pure shell background launch
  const pureBash = buildActionCommand({
    id: 2,
    actionType: 'shell',
    command: 'bash',
    terminalMode: 'background'
  });
  assert.deepEqual(pureBash.args, ['-i', '-l']);

  // 2. Terminal Emulators: CLI flags verification
  const testButton = {
    id: 3,
    label: 'Test "Title" & $VAR',
    actionType: 'shell',
    command: 'htop',
    terminalMode: 'tab',
    workingDir: testDir,
    keepOpen: true
  };

  // Ptyxis: --tab, -d dir, -T title, -- shell -i -l -c script
  const ptyxisCmd = buildActionCommand(testButton, {
    terminal: { name: 'ptyxis', path: '/usr/bin/ptyxis' },
    ignoreDirExists: true
  });
  assert.equal(ptyxisCmd.bin, '/usr/bin/ptyxis');
  assert.equal(ptyxisCmd.rawCommand, 'htop');
  assert.ok(ptyxisCmd.innerScript.includes(quoteForShell(defaultShell)));
  assert.ok(ptyxisCmd.args.includes('--tab'));
  assert.ok(ptyxisCmd.args.includes('-d'));
  assert.ok(ptyxisCmd.args.includes('-T'));
  const ptyxisTitleIdx = ptyxisCmd.args.indexOf('-T');
  assert.equal(ptyxisCmd.args[ptyxisTitleIdx + 1], 'Test "Title" & $VAR');
  assert.ok(ptyxisCmd.args.includes('--'));

  // Verify terminal title strips newlines and control characters
  const uncleanTitleBtn = {
    id: 99,
    label: 'Bad\nTitle\0With\rChars',
    actionType: 'shell',
    command: 'true',
    terminalMode: 'tab'
  };
  const sanitizedCmd = buildActionCommand(uncleanTitleBtn, {
    terminal: { name: 'ptyxis', path: '/usr/bin/ptyxis' }
  });
  const sanitizedTitleIdx = sanitizedCmd.args.indexOf('-T');
  assert.equal(sanitizedCmd.args[sanitizedTitleIdx + 1], 'Bad Title With Chars');

  // Gnome-Terminal: --tab, --title=title, --working-directory=dir, -- shell -i -l -c script
  const gnomeCmd = buildActionCommand(testButton, {
    terminal: { name: 'gnome-terminal', path: '/usr/bin/gnome-terminal' },
    ignoreDirExists: true
  });
  assert.equal(gnomeCmd.bin, '/usr/bin/gnome-terminal');
  assert.ok(gnomeCmd.args.includes('--tab'));
  assert.ok(gnomeCmd.args.some(a => a.startsWith('--title=')));
  assert.ok(gnomeCmd.args.some(a => a.startsWith('--working-directory=')));
  assert.ok(gnomeCmd.args.includes('--'));

  // Konsole: --new-tab, --workdir dir, -e shell -i -l -c script
  const konsoleCmd = buildActionCommand(testButton, {
    terminal: { name: 'konsole', path: '/usr/bin/konsole' },
    ignoreDirExists: true
  });
  assert.equal(konsoleCmd.bin, '/usr/bin/konsole');
  assert.ok(konsoleCmd.args.includes('--new-tab'));
  assert.ok(konsoleCmd.args.includes('--workdir'));
  assert.ok(konsoleCmd.args.includes('-e'));

  // Alacritty: --title title, --working-directory dir, -e shell -i -l -c script
  const alacrittyCmd = buildActionCommand(testButton, {
    terminal: { name: 'alacritty', path: '/usr/bin/alacritty' },
    ignoreDirExists: true
  });
  assert.equal(alacrittyCmd.bin, '/usr/bin/alacritty');
  assert.ok(alacrittyCmd.args.includes('--title'));
  assert.ok(alacrittyCmd.args.includes('--working-directory'));
  assert.ok(alacrittyCmd.args.includes('-e'));

  // Kitty: -T title, --directory dir, shell -i -l -c script (no -e, no --)
  const kittyCmd = buildActionCommand(testButton, {
    terminal: { name: 'kitty', path: '/usr/bin/kitty' },
    ignoreDirExists: true
  });
  assert.equal(kittyCmd.bin, '/usr/bin/kitty');
  assert.ok(kittyCmd.args.includes('-T'));
  assert.ok(kittyCmd.args.includes('--directory'));
  assert.ok(!kittyCmd.args.includes('-e'));
  assert.ok(!kittyCmd.args.includes('--'));

  // Wezterm: start, --cwd dir, -- shell -i -l -c script
  const weztermCmd = buildActionCommand(testButton, {
    terminal: { name: 'wezterm', path: '/usr/bin/wezterm' },
    ignoreDirExists: true
  });
  assert.equal(weztermCmd.bin, '/usr/bin/wezterm');
  assert.equal(weztermCmd.args[0], 'start');
  assert.ok(weztermCmd.args.includes('--cwd'));
  assert.ok(weztermCmd.args.includes('--'));

  // Xfce4-Terminal: --tab, --title=title, --working-directory=dir, -x shell -i -l -c script
  const xfceCmd = buildActionCommand(testButton, {
    terminal: { name: 'xfce4-terminal', path: '/usr/bin/xfce4-terminal' },
    ignoreDirExists: true
  });
  assert.equal(xfceCmd.bin, '/usr/bin/xfce4-terminal');
  assert.ok(xfceCmd.args.includes('--tab'));
  assert.ok(xfceCmd.args.some(a => a.startsWith('--title=')));
  assert.ok(xfceCmd.args.includes('-x'));

  // Foot: -T title, -D dir, shell -i -l -c script
  const footCmd = buildActionCommand(testButton, {
    terminal: { name: 'foot', path: '/usr/bin/foot' },
    ignoreDirExists: true
  });
  assert.equal(footCmd.bin, '/usr/bin/foot');
  assert.ok(footCmd.args.includes('-T'));
  assert.ok(footCmd.args.includes('-D'));

  // Xterm: -T title, -e shell -i -l -c script
  const xtermCmd = buildActionCommand(testButton, {
    terminal: { name: 'xterm', path: '/usr/bin/xterm' },
    ignoreDirExists: true
  });
  assert.equal(xtermCmd.bin, '/usr/bin/xterm');
  assert.ok(xtermCmd.args.includes('-T'));
  assert.ok(xtermCmd.args.includes('-e'));
  assert.ok(!xtermCmd.args.includes('--'));

  // Generic / unknown terminal fallback: -T title, -e shell -i -l -c script
  const genericCmd = buildActionCommand(testButton, {
    terminal: { name: 'unknown-terminal', path: '/usr/bin/unknown-terminal' },
    ignoreDirExists: true
  });
  assert.equal(genericCmd.bin, '/usr/bin/unknown-terminal');
  assert.ok(genericCmd.args.includes('-T'));
  assert.ok(genericCmd.args.includes('-e'));
  assert.ok(!genericCmd.args.includes('--'));

  // 3. Media Actions
  const mediaCmd = buildActionCommand({
    id: 4,
    actionType: 'media',
    mediaAction: 'vol_up'
  });
  const platform = require('../platform');
  const expectedMedia = platform.getActivePlatform().getMediaCommand('vol_up');
  assert.equal(mediaCmd.bin, expectedMedia.bin);
  assert.deepEqual(mediaCmd.args, expectedMedia.args);

  // 4. URL Actions
  const urlCmd = buildActionCommand({
    id: 5,
    actionType: 'url',
    url: 'https://github.com'
  });
  const expectedUrl = platform.getActivePlatform().getUrlCommand('https://github.com/');
  assert.equal(urlCmd.bin, expectedUrl.bin);
  assert.deepEqual(urlCmd.args, expectedUrl.args);

  // URL security scheme validation
  const badUrlCmd = buildActionCommand({
    id: 6,
    actionType: 'url',
    url: 'javascript:alert(1)'
  });
  assert.equal(badUrlCmd, null);
});

test('Terminal: executeAction handles spawn errors gracefully without uncaught exceptions', () => {
  const { executeAction } = require('../lib/terminal');
  // Attempting to execute an action with non-existent command or URL should not throw
  assert.doesNotThrow(() => {
    executeAction({
      id: 99,
      label: 'Bad Action',
      actionType: 'url',
      url: 'https://127.0.0.1:9999/bad-url'
    });
  });
  assert.doesNotThrow(() => {
    executeAction({
      id: 99,
      label: 'Bad Action',
      actionType: 'media',
      mediaAction: 'mute'
    });
  });
});

test('Terminal: getDefaultShell and getDefaultTerminal return valid paths', () => {
  const shell = getDefaultShell();
  assert.ok(shell && typeof shell === 'string');
  assert.ok(shell.startsWith('/'));

  const term = getDefaultTerminal();
  assert.ok(term && typeof term === 'object');
  assert.ok(term.name && term.path);
});
