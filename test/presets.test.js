'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  ALLOWED_STARTER_IDS,
  STATIC_PRESETS,
  isBinaryInPath,
  detectHostEcosystem,
  generateCuratedWorkspaces,
  chunkArray,
  _clearDetectionCacheForTest
} = require('../lib/presets');
const { validateWorkspace } = require('../lib/config');

test('Presets: Static presets catalog integrity and schema compliance', () => {
  assert.ok(Array.isArray(STATIC_PRESETS));
  assert.ok(STATIC_PRESETS.length >= 10);
  assert.deepEqual(ALLOWED_STARTER_IDS, ['developer', 'devops', 'media', 'system']);

  for (const preset of STATIC_PRESETS) {
    assert.ok(preset.id && typeof preset.id === 'string');
    assert.ok(preset.name && typeof preset.name === 'string');
    assert.ok(preset.icon && typeof preset.icon === 'string');
    assert.ok(preset.actionType && ['shell', 'media', 'url'].includes(preset.actionType));
    assert.ok(preset.category && typeof preset.category === 'string');
  }
});

test('Presets: chunkArray partitioning helper', () => {
  assert.deepEqual(chunkArray([]), [[]]);
  assert.deepEqual(chunkArray(null), []);

  const items = Array.from({ length: 35 }, (_, i) => ({ id: i }));
  const chunks = chunkArray(items, 15);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 15);
  assert.equal(chunks[1].length, 15);
  assert.equal(chunks[2].length, 5);

  // Default size is 15
  const defaultChunks = chunkArray(items);
  assert.equal(defaultChunks.length, 3);
});

test('Presets: isBinaryInPath detects binaries and respects custom PATH', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-bin-test-'));
  try {
    const fakeBin = path.join(tmpDir, 'custom-tool');
    fs.writeFileSync(fakeBin, '#!/bin/sh\necho hi', { mode: 0o755 });

    // Detects when present in custom PATH
    assert.equal(isBinaryInPath('custom-tool', tmpDir), true);
    // Returns false when absent
    assert.equal(isBinaryInPath('nonexistent-binary-xyz', tmpDir), false);
    // Returns false on empty or non-string inputs
    assert.equal(isBinaryInPath('', tmpDir), false);
    assert.equal(isBinaryInPath(null, tmpDir), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Presets: detectHostEcosystem memoization cache and single-flight coalescing', async () => {
  _clearDetectionCacheForTest();

  // First call runs fresh
  const res1 = await detectHostEcosystem();
  assert.ok(res1 && typeof res1 === 'object');
  assert.ok(typeof res1.timestamp === 'number');
  assert.ok(Array.isArray(res1.detectedTools));

  // Second call returns cached result
  const res2 = await detectHostEcosystem();
  assert.equal(res2.timestamp, res1.timestamp);
  assert.strictEqual(res2, res1);

  // Single-flight coalescing under parallel invocation
  _clearDetectionCacheForTest();
  const [par1, par2] = await Promise.all([
    detectHostEcosystem(),
    detectHostEcosystem()
  ]);
  assert.strictEqual(par1, par2);

  // forceRefresh resets cache
  const resRefreshed = await detectHostEcosystem({ forceRefresh: true });
  assert.ok(resRefreshed.timestamp >= res1.timestamp);
});

test('Presets: generateCuratedWorkspaces produces Schema v2 compliant workspaces', () => {
  const mockDetected = {
    detectedTools: [
      { id: 'code', name: 'VS Code', binary: 'code', category: 'development', icon: '💻', color: '#1c69d4' },
      { id: 'claude', name: 'Claude Code', binary: 'claude', category: 'development', icon: '🤖', color: '#6366f1' },
      { id: 'git', name: 'Git CLI', binary: 'git', category: 'development', icon: '🌿', color: '#f05032' },
      { id: 'docker', name: 'Docker', binary: 'docker', category: 'devops', icon: '🐳', color: '#0db7ed' },
      { id: 'btop', name: 'Btop Monitor', binary: 'btop', category: 'system', icon: '📊', color: '#8b5cf6' }
    ]
  };

  const workspaces = generateCuratedWorkspaces(['developer', 'devops', 'media', 'system'], mockDetected);
  assert.equal(workspaces.length, 4);

  for (const ws of workspaces) {
    // Schema v2 compliance validation
    const validation = validateWorkspace(ws, { repair: false });
    assert.equal(validation.valid, true, `Workspace ${ws.id} must pass validateWorkspace`);
    assert.equal(ws.origin, 'user');
    assert.ok(Array.isArray(ws.folders));
    assert.ok(Array.isArray(ws.match.apps));
    assert.ok(Array.isArray(ws.pages));
    assert.ok(ws.pages.length >= 1);

    for (const page of ws.pages) {
      assert.ok(page.buttons.length <= 15, `Page ${page.pageNumber} must have <= 15 buttons`);
    }
  }

  // Verify 'developer' workspace contains detected tools
  const devWs = workspaces.find(w => w.id === 'developer');
  assert.equal(devWs.pages[0].buttons[0].label, 'VS CODE');
  assert.equal(devWs.pages[0].buttons[1].label, 'CLAUDE CODE');
});

test('Presets: generateCuratedWorkspaces 15-tile page partitioning with high-density tools', () => {
  // Generate 25 tools to test multi-page chunking
  const highDensityTools = Array.from({ length: 25 }, (_, i) => ({
    id: `tool-${i}`,
    name: `Dev Tool ${i + 1}`,
    binary: `tool${i + 1}`,
    category: 'development',
    icon: '⚡',
    color: '#1c69d4'
  }));

  const workspaces = generateCuratedWorkspaces(['developer'], { detectedTools: highDensityTools });
  assert.equal(workspaces.length, 1);
  const devWs = workspaces[0];

  assert.equal(devWs.pages.length, 2, '25 tools must partition into 2 pages');
  assert.equal(devWs.pages[0].buttons.length, 15, 'Page 1 must have exactly 15 buttons');
  assert.equal(devWs.pages[1].buttons.length, 10, 'Page 2 must have remaining 10 buttons');

  // Both pages must pass validation
  const validation = validateWorkspace(devWs, { repair: false });
  assert.equal(validation.valid, true);
});

test('Presets: generateCuratedWorkspaces headless/container zero-tool baseline fallback', () => {
  // 0 tools detected
  const workspaces = generateCuratedWorkspaces(['developer'], { detectedTools: [] });
  assert.equal(workspaces.length, 1);
  const devWs = workspaces[0];

  assert.equal(devWs.pages.length, 1);
  assert.ok(devWs.pages[0].buttons.length >= 3, 'Must seed default terminal, git, uname tools');
  assert.equal(devWs.pages[0].buttons[0].label, 'TERMINAL');

  const validation = validateWorkspace(devWs, { repair: false });
  assert.equal(validation.valid, true);
});

test('Presets: generateCuratedWorkspaces prototype pollution resistance and input sanitization', () => {
  const maliciousInput = ['__proto__', 'constructor', 'prototype', 'toString', 'developer'];
  const workspaces = generateCuratedWorkspaces(maliciousInput, {});

  // Only 'developer' from the allowlist must be processed
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].id, 'developer');

  // Prototype must not be polluted
  assert.equal(Object.prototype.developer, undefined);
  assert.equal({}.developer, undefined);
});
