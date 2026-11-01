'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('Lint: scripts/lint.js validates codebase syntax with zero errors', () => {
  const lintScript = path.resolve(__dirname, '..', 'scripts', 'lint.js');
  assert.ok(fs.existsSync(lintScript), 'scripts/lint.js should exist');

  const output = execFileSync(process.execPath, [lintScript], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.match(output, /✔ Lint check passed/);
});

test('Lint: scripts/lint.js catches syntax errors in source files', () => {
  const lintScript = path.resolve(__dirname, '..', 'scripts', 'lint.js');
  const tempFile = path.resolve(__dirname, '..', 'lib', '_temp_broken_syntax.js');

  try {
    fs.writeFileSync(tempFile, 'const invalidSyntax = {;');
    assert.throws(() => {
      execFileSync(process.execPath, [lintScript], {
        cwd: path.resolve(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe']
      });
    }, (err) => {
      return err.status === 1;
    });
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});
