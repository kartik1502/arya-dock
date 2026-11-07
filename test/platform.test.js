'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const platform = require('../platform');
const { createServer } = require('../server');
const { buildActionCommand } = require('../lib/terminal');

const rootDir = path.resolve(__dirname, '..');

test('Platform: interface exposes adapters for linux, darwin, and fake', () => {
  const linux = platform.getPlatform('linux');
  assert.equal(linux.name, 'linux');
  assert.equal(linux.isSupported, true);
  assert.equal(typeof linux.getDefaultShell, 'function');
  assert.equal(typeof linux.getDefaultTerminal, 'function');
  assert.equal(typeof linux.getMediaCommand, 'function');
  assert.equal(typeof linux.getMediaFallbackCommand, 'function');
  assert.equal(typeof linux.getUrlCommand, 'function');
  assert.equal(typeof linux.getApplicationDirectories, 'function');
  assert.equal(typeof linux.capabilities, 'function');

  // Verify Linux adapter outputs
  const mediaVol = linux.getMediaCommand('vol_up');
  assert.ok(mediaVol && mediaVol.bin);
  const mediaFallback = linux.getMediaFallbackCommand('vol_up');
  assert.ok(mediaFallback && mediaFallback.bin);
  const linuxUrl = linux.getUrlCommand('https://example.com');
  assert.ok(linuxUrl && linuxUrl.bin && linuxUrl.args.includes('https://example.com'));
  const linuxDirs = linux.getApplicationDirectories();
  assert.ok(Array.isArray(linuxDirs) && linuxDirs.length > 0);

  // Darwin adapter
  const darwin = platform.getPlatform('darwin');
  assert.equal(darwin.name, 'darwin');
  assert.equal(darwin.isSupported, true);
  const darwinUrl = darwin.getUrlCommand('https://example.com');
  assert.equal(darwinUrl.bin, 'open');
  assert.equal(darwin.getMediaFallbackCommand('vol_up'), null);

  // Fake adapter
  const fake = platform.getPlatform('fake');
  assert.equal(fake.name, 'fake');
  assert.equal(fake.isSupported, true);
  assert.equal(fake.getDefaultShell(), '/bin/fake-sh');
  assert.equal(fake.getDefaultTerminal().name, 'fake-terminal');
  assert.equal(fake.getUrlCommand('https://example.com').bin, 'fake-browser-bin');
  assert.equal(fake.getMediaCommand('vol_up').bin, 'fake-media-bin');
});

test('Platform: selecting an unsupported platform yields a clear startup message, not a crash', () => {
  const warnings = [];
  const unsupported = platform.getPlatform('unsupported-os', {
    logger: (msg) => warnings.push(msg)
  });

  // Must not throw or crash
  assert.ok(unsupported);
  assert.equal(unsupported.name, 'unsupported-os');
  assert.equal(unsupported.isSupported, false);
  assert.match(unsupported.statusMessage, /Platform 'unsupported-os' is not supported/i);

  // Warning was surfaced
  assert.ok(warnings.length > 0);
  assert.match(warnings[0], /Platform 'unsupported-os' is not supported/i);

  // Degraded methods return safe fallbacks
  assert.equal(unsupported.getMediaCommand('vol_up'), null);
  assert.equal(unsupported.getMediaFallbackCommand('vol_up'), null);
  assert.equal(unsupported.getUrlCommand('https://example.com'), null);
  assert.deepEqual(unsupported.getApplicationDirectories(), []);
  assert.equal(unsupported.capabilities().media, false);

  // Starting server with an unsupported platform outputs clear message and runs without crash
  const serverWarnings = [];
  const serverInstance = createServer({
    platform: 'unsupported-os',
    logger: (msg) => serverWarnings.push(msg),
    silent: false
  });

  try {
    assert.ok(serverInstance);
    assert.equal(serverInstance.platform.isSupported, false);
    assert.ok(serverWarnings.some(w => /Platform 'unsupported-os' is not supported/i.test(w)));
  } finally {
    serverInstance.close();
    platform.resetPlatform();
  }
});

test('Platform: server runs with a fake adapter without real OS access', () => {
  const fakeAdapter = platform.adapters.fake.createFakeAdapter({
    shell: '/custom/fake-shell',
    terminal: { name: 'mock-term', path: '/usr/bin/mock-term' },
    applicationDirectories: ['/mock/apps']
  });

  const serverInstance = createServer({
    platformAdapter: fakeAdapter
  });

  try {
    assert.equal(serverInstance.platform.name, 'fake');
    assert.equal(serverInstance.platform.isSupported, true);

    // Verify command builder utilizes fake adapter
    const mediaCmd = buildActionCommand({
      id: 1,
      actionType: 'media',
      mediaAction: 'vol_up'
    });
    assert.equal(mediaCmd.bin, 'fake-media-bin');
    assert.ok(fakeAdapter.calls.getMediaCommand.includes('vol_up'));

    const urlCmd = buildActionCommand({
      id: 2,
      actionType: 'url',
      url: 'https://example.com'
    });
    assert.equal(urlCmd.bin, 'fake-browser-bin');
    assert.ok(fakeAdapter.calls.getUrlCommand.includes('https://example.com/'));
  } finally {
    serverInstance.close();
    // Reset active platform back to default
    platform.resetPlatform();
  }
});

test('Platform: no file outside platform/ references restricted platform-specific strings', () => {
  const selfRelPath = path.relative(rootDir, __filename);
  const restrictedTokens = [
    ['process', 'platform'].join('.'),
    ['xdg', 'open'].join('-'),
    ['player', 'ctl'].join(''),
    ['wp', 'ctl'].join(''),
    ['/usr', 'share', 'applications'].join('/')
  ];

  const restrictedPatterns = restrictedTokens.map(token => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isBoundary = /^[a-zA-Z0-9_]/.test(token);
    const pattern = isBoundary ? `\\b${escaped}\\b` : escaped;
    return { name: token, regex: new RegExp(pattern) };
  });

  const targetDirs = ['lib', 'public', 'scripts', 'test', 'config', 'docs'];
  const allFiles = ['server.js', 'README.md', 'BACKLOG.md'];

  function collectFiles(dir) {
    const full = path.join(rootDir, dir);
    if (!fs.existsSync(full)) return;
    const entries = fs.readdirSync(full, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          collectFiles(rel);
        }
      } else if (entry.isFile()) {
        allFiles.push(rel);
      }
    }
  }

  for (const dir of targetDirs) {
    collectFiles(dir);
  }

  const violations = [];

  for (const file of allFiles) {
    if (file.startsWith('platform/') || file.startsWith('platform\\') || file === selfRelPath || file === 'test/platform.test.js') {
      continue;
    }
    const fullPath = path.join(rootDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const pattern of restrictedPatterns) {
      if (pattern.regex.test(content)) {
        violations.push(`${file} matches restricted token "${pattern.name}"`);
      }
    }
  }

  assert.deepEqual(violations, [], `Expected zero platform violations outside platform/, found:\n${violations.join('\n')}`);
});
