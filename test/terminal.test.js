const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  quoteForShell,
  buildTerminalCommand,
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

test('Terminal: buildTerminalCommand handles tricky characters and executes safely', () => {
  const defaultShell = getDefaultShell();

  // Test nasty path with spaces, single quotes, and dollar sign
  const nastyDir = "/tmp/arya-test-dir with 'quotes' and $dollar";
  try {
    fs.mkdirSync(nastyDir, { recursive: true });
    const cmd = buildTerminalCommand('pwd', 'background', 'My Title', nastyDir);

    assert.ok(cmd.includes(defaultShell));
    assert.ok(cmd.includes('cd '));

    // Actually execute the built command to verify shell syntax and path resolution
    const output = execSync(cmd, { encoding: 'utf-8' });
    assert.ok(output.includes(nastyDir));
  } finally {
    if (fs.existsSync(nastyDir)) fs.rmdirSync(nastyDir);
  }

  // Tab mode with quotes and dollar in title
  const tabCmd = buildTerminalCommand('git status', 'tab', 'Git "Quoted" & $VAR Title', '/tmp/repo', true);
  assert.ok(tabCmd.includes('--tab') || tabCmd.includes('-e'));
  // Title quotes and dollar sign must be preserved inside safe shell quotes without injection
  assert.ok(tabCmd.includes("'Git \"Quoted\" & $VAR Title'"));

  // Pure shell launches
  const pureBash = buildTerminalCommand('bash', 'background');
  assert.equal(pureBash, 'bash');
  const pureZsh = buildTerminalCommand('zsh', 'background');
  assert.equal(pureZsh, 'zsh');
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
