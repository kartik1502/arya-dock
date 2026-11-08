const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CONFIG_PATH,
  DEFAULT_EXAMPLE_PATH,
  LEGACY_CONFIG_PATH,
  LEGACY_AUTH_PATH,
  getDefaultUserConfigDir,
  getDefaultConfigPath,
  migrateLegacyConfigAndAuth,
  getBackups,
  rotateBackups,
  resolveConfigPath,
  resolveWorkingDir,
  validateButton,
  migrateV0ToV1,
  migrateConfig,
  loadConfig,
  saveConfigAtomic
} = require('../lib/config');

const {
  loadOrCreateAuth,
  getDefaultAuthPath,
  getDefaultAuthDir
} = require('../lib/auth');

const { createServer } = require('../server');

test('Config: resolveConfigPath path expansions and validation', () => {
  const home = os.homedir();

  assert.equal(resolveConfigPath(''), '');
  assert.equal(resolveConfigPath('   '), '');
  assert.equal(resolveConfigPath('~'), home);
  assert.equal(resolveConfigPath('$HOME'), home);
  assert.equal(resolveConfigPath('~/config/profiles.json'), path.join(home, 'config/profiles.json'));
  assert.equal(resolveConfigPath('$HOME/config/profiles.json'), path.join(home, 'config/profiles.json'));
  assert.equal(resolveConfigPath('/etc/profiles.json'), path.resolve('/etc/profiles.json'));
  assert.equal(resolveConfigPath('profiles.json'), path.resolve('profiles.json'));
  assert.equal(resolveConfigPath('path/with\0null'), '');
  assert.equal(resolveConfigPath('path/with\nnewline'), '');
});

test('Config: resolveWorkingDir path expansions and shell metacharacter rejection', () => {
  const home = os.homedir();

  assert.equal(resolveWorkingDir(''), '');
  assert.equal(resolveWorkingDir('   '), '');
  assert.equal(resolveWorkingDir('~'), home);
  assert.equal(resolveWorkingDir('$HOME'), home);
  assert.equal(resolveWorkingDir('~/projects/app'), path.join(home, 'projects/app'));
  assert.equal(resolveWorkingDir('$HOME/workspace/dock'), path.join(home, 'workspace/dock'));
  assert.equal(resolveWorkingDir('/absolute/path'), path.resolve('/absolute/path'));
  assert.equal(resolveWorkingDir('relative/path'), path.resolve('relative/path'));
  assert.equal(resolveWorkingDir('path/with\0null'), '');
  assert.equal(resolveWorkingDir('path/with\nnewline'), '');

  // Rejects shell metacharacters and command injection attempts
  assert.equal(resolveWorkingDir('/path/with;rm -rf /'), '');
  assert.equal(resolveWorkingDir('/path/with|cmd'), '');
  assert.equal(resolveWorkingDir('/path/with&bg'), '');
  assert.equal(resolveWorkingDir('/path/with`sub`'), '');
  assert.equal(resolveWorkingDir('/path/with"quotes"'), '');
  assert.equal(resolveWorkingDir("/path/with'single'"), '');
  assert.equal(resolveWorkingDir('/path/with>redirect'), '');
  assert.equal(resolveWorkingDir('/path/with<input'), '');
});

test('Config: validateButton schema enforcement', () => {
  // Valid button creation
  const res1 = validateButton({
    id: 0,
    label: 'TEST BUTTON',
    sublabel: 'SUB',
    icon: '⚡',
    color: '#1c69d4',
    actionType: 'shell',
    command: 'git status',
    terminalMode: 'tab',
    workingDir: '~/repo',
    keepOpen: true
  });
  assert.equal(res1.valid, true);
  assert.equal(res1.button.label, 'TEST BUTTON');
  assert.equal(res1.button.color, '#1c69d4');

  // Drops unknown / extraneous fields
  const res2 = validateButton({
    id: 1,
    label: 'CLEAN',
    unknownProperty: 'should be dropped',
    maliciousPayload: { injection: true }
  });
  assert.equal(res2.valid, true);
  assert.equal(res2.button.unknownProperty, undefined);
  assert.equal(res2.button.maliciousPayload, undefined);

  // Rejects non-objects
  assert.equal(validateButton(null).valid, false);
  assert.equal(validateButton('string').valid, false);
  assert.equal(validateButton([1, 2, 3]).valid, false);

  // Update mode preserves existing ID and prevents ID tampering
  const resUpdate = validateButton(
    { id: 999, label: 'TAMPERED ID' },
    { isUpdate: true, existingId: 5 }
  );
  assert.equal(resUpdate.valid, true);
  assert.equal(resUpdate.button.id, 5); // Must remain 5

  // ID is locked to existingButton.id even if existingId option omitted
  const resTamper = validateButton(
    { id: 999, label: 'TAMPERED' },
    { isUpdate: true, existingButton: { id: 7, label: 'ORIGINAL' } }
  );
  assert.equal(resTamper.valid, true);
  assert.equal(resTamper.button.id, 7); // Must remain 7

  // URL action validates http/https scheme
  const resUrlValid = validateButton({
    id: 2,
    actionType: 'url',
    url: 'https://github.com'
  });
  assert.equal(resUrlValid.valid, true);

  const resUrlInvalid = validateButton({
    id: 2,
    actionType: 'url',
    url: 'javascript:alert(1)'
  });
  assert.equal(resUrlInvalid.valid, false);

  // URL scheme is validated regardless of actionType (prevents javascript: smuggling)
  const resUrlShellSmuggle = validateButton({
    id: 3,
    actionType: 'shell',
    url: 'javascript:alert(2)'
  });
  assert.equal(resUrlShellSmuggle.valid, false);

  // Reject garbage types with clear error
  assert.equal(validateButton({ label: 12345 }).valid, false);
  assert.equal(validateButton({ color: 'red' }).valid, false);
  assert.equal(validateButton({ color: '#123' }).valid, false);
  assert.equal(validateButton({ actionType: 'bogus' }).valid, false);
  assert.equal(validateButton({ command: { evil: true } }).valid, false);
  assert.equal(validateButton({ terminalMode: 'invalid' }).valid, false);
  assert.equal(validateButton({ keepOpen: 'yes' }).valid, false);
  assert.equal(validateButton({ workingDir: 999 }).valid, false);
  assert.equal(validateButton({ mediaAction: 'bogus_media' }).valid, false);
  assert.equal(validateButton({ actionType: 'media' }).valid, false);
  assert.equal(validateButton({ actionType: 'media', mediaAction: 'play_pause' }).valid, true);

  // Partial update merges onto existing button and preserves unedited fields
  const existingButton = {
    id: 1,
    label: 'LAZY DOCKER',
    sublabel: 'CONTAINERS',
    icon: '⚡',
    color: '#10b981',
    actionType: 'shell',
    command: 'lzd',
    terminalMode: 'tab',
    workingDir: '~/docker-repo',
    keepOpen: true
  };

  const partialUpdate = { id: 1, label: 'UPDATED LABEL' };
  const resPartial = validateButton(partialUpdate, {
    isUpdate: true,
    existingId: 1,
    existingButton
  });

  assert.equal(resPartial.valid, true);
  assert.equal(resPartial.button.id, 1);
  assert.equal(resPartial.button.label, 'UPDATED LABEL');
  assert.equal(resPartial.button.sublabel, 'CONTAINERS');
  assert.equal(resPartial.button.command, 'lzd');
  assert.equal(resPartial.button.color, '#10b981');
  assert.equal(resPartial.button.terminalMode, 'tab');
  assert.equal(resPartial.button.workingDir, '~/docker-repo');
  assert.equal(resPartial.button.keepOpen, true);

  // Partial update with garbage types on existing button is rejected without corrupting
  const partialGarbage = { id: 1, color: 'not-a-color', command: 12345 };
  const resGarbage = validateButton(partialGarbage, {
    isUpdate: true,
    existingId: 1,
    existingButton
  });
  assert.equal(resGarbage.valid, false);
  assert.ok(resGarbage.error);
});

test('Config: atomic persistence and error handling', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-config-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const examplePath = path.join(tmpDir, 'profiles.example.json');

  try {
    // Write an example file
    const exampleData = {
      activeProfile: 'developer',
      profiles: {
        developer: { name: 'Dev', pages: [{ buttons: [] }] }
      }
    };
    fs.writeFileSync(examplePath, JSON.stringify(exampleData, null, 2));

    // When configPath is missing, loadConfig copies examplePath
    assert.equal(fs.existsSync(configPath), false);
    const loaded = loadConfig(configPath, examplePath);
    assert.equal(fs.existsSync(configPath), true);
    assert.equal(loaded.activeProfile, 'developer');

    // Corrupted config throws instead of continuing silently with {}
    fs.writeFileSync(configPath, '{ invalid json content ...');
    assert.throws(() => {
      loadConfig(configPath, examplePath);
    }, /Failed to parse/);

    // Atomic write saves cleanly without leaving temp files
    saveConfigAtomic(configPath, exampleData);
    const reloaded = loadConfig(configPath, examplePath);
    assert.equal(reloaded.activeProfile, 'developer');
    assert.equal(reloaded.schemaVersion, 1);
    const remainingTemp = fs.readdirSync(tmpDir).filter(f => f.startsWith('.profiles.'));
    assert.equal(remainingTemp.length, 0);

    // Hand-edited profiles.json with invalid/missing fields is safely repaired on load
    const handEdited = {
      schemaVersion: 1,
      activeProfile: 'custom',
      profiles: {
        custom: {
          name: 'Custom Profile',
          pages: [
            {
              pageNumber: 1,
              name: 'Page 1',
              buttons: [
                {
                  id: 0,
                  label: 'CORRUPTED COLOR',
                  color: 'not-hex-code',
                  actionType: 'media',
                  mediaAction: 'mute',
                  command: 'dead echo',
                  keepOpen: 'not-a-boolean',
                  url: 'javascript:alert(1)',
                  extraneousField: 'remove-me'
                },
                {
                  id: 'invalid-id-type',
                  label: 12345
                }
              ]
            }
          ]
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(handEdited, null, 2));
    const repairedConfig = loadConfig(configPath, examplePath);
    assert.equal(repairedConfig.schemaVersion, 1);
    assert.equal(repairedConfig.activeProfile, 'custom');
    const pageButtons = repairedConfig.profiles.custom.pages[0].buttons;
    assert.equal(pageButtons.length, 2);

    // Button 0 has invalid color repaired to default hex, dead command cleared for mediaAction, keepOpen defaulted to true, url cleared
    const b0 = pageButtons[0];
    assert.equal(b0.color, '#1c69d4');
    assert.equal(b0.command, '');
    assert.equal(b0.mediaAction, 'mute');
    assert.equal(b0.keepOpen, true);
    assert.equal(b0.url, '');
    assert.equal(b0.extraneousField, undefined);

    // Button 1 with non-number ID and number label is safely repaired
    const b1 = pageButtons[1];
    assert.equal(typeof b1.id, 'number');
    assert.equal(b1.label, '12345');

    // Duplicate button IDs in hand-edited profiles are repaired to distinct unique IDs
    const duplicateIdConfig = {
      schemaVersion: 1,
      activeProfile: 'dupes',
      profiles: {
        dupes: {
          name: 'Duplicates',
          pages: [
            {
              pageNumber: 1,
              name: 'Page 1',
              buttons: [
                { id: 0, label: 'BTN 0' },
                { id: 0, label: 'BTN 0 COPY' },
                { id: 1, label: 'BTN 1' },
                { id: 1, label: 'BTN 1 COPY' }
              ]
            }
          ]
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(duplicateIdConfig, null, 2));
    const dedupedConfig = loadConfig(configPath, examplePath);
    const dedupedButtons = dedupedConfig.profiles.dupes.pages[0].buttons;
    assert.equal(dedupedButtons.length, 4);
    const ids = dedupedButtons.map(b => b.id);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, 4, 'All button IDs on a page must be distinct');

    // Excessive buttons (>24) are safely capped to 24
    const excessiveButtons = Array.from({ length: 30 }, (_, i) => ({ id: i, label: `BTN ${i}` }));
    duplicateIdConfig.profiles.dupes.pages[0].buttons = excessiveButtons;
    fs.writeFileSync(configPath, JSON.stringify(duplicateIdConfig, null, 2));
    const cappedConfig = loadConfig(configPath, examplePath);
    assert.equal(cappedConfig.profiles.dupes.pages[0].buttons.length, 24);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Schema: CURRENT_SCHEMA_VERSION is 1 and migrations are pure functions', () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 1);

  // Pure function migration v0 -> v1
  const v0Config = {
    activeProfile: 'developer',
    profiles: {
      developer: { name: 'Developer', pages: [{ buttons: [] }] }
    }
  };
  const v1Config = migrateV0ToV1(v0Config);
  assert.equal(v1Config.schemaVersion, 1);
  assert.equal(v0Config.schemaVersion, undefined, 'Original object should not be mutated by pure migration');

  // migrateConfig handles missing schemaVersion as v0
  const migrated = migrateConfig(v0Config);
  assert.equal(migrated.schemaVersion, 1);
});

test('Schema: loads legacy v0 config and writes backup on first save', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-schema-legacy-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const backupPath = path.join(tmpDir, 'profiles.json.bak');
  const examplePath = path.join(tmpDir, 'profiles.example.json');

  try {
    // Write a legacy v0 config file (no schemaVersion)
    const legacyConfig = {
      activeProfile: 'legacy',
      profiles: {
        legacy: {
          name: 'Legacy Profile',
          pages: [
            {
              pageNumber: 1,
              name: 'Page 1',
              buttons: [{ id: 0, label: 'LEGACY TILE', color: '#1c69d4', actionType: 'shell', command: 'echo legacy' }]
            }
          ]
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(legacyConfig, null, 2));

    // Load legacy config: should migrate in memory to CURRENT_SCHEMA_VERSION
    const loaded = loadConfig(configPath, examplePath);
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.activeProfile, 'legacy');
    assert.equal(fs.existsSync(backupPath), false, 'Backup should not be written until first save');

    // First save: must create backup copy (.bak) before writing migrated config
    saveConfigAtomic(configPath, loaded);
    assert.equal(fs.existsSync(backupPath), true, 'Backup copy (.bak) must exist after first save');

    // Verify backup content matches the original legacy content (without schemaVersion)
    const backupRaw = fs.readFileSync(backupPath, 'utf-8');
    const backupJson = JSON.parse(backupRaw);
    assert.equal(backupJson.schemaVersion, undefined);
    assert.equal(backupJson.activeProfile, 'legacy');

    // Verify current file now contains schemaVersion 1
    const currentRaw = fs.readFileSync(configPath, 'utf-8');
    const currentJson = JSON.parse(currentRaw);
    assert.equal(currentJson.schemaVersion, 1);

    // Modify and save again: should not overwrite existing backup
    const backupStatBefore = fs.statSync(backupPath);
    currentJson.profiles.legacy.name = 'Updated Profile Name';
    saveConfigAtomic(configPath, currentJson);

    const backupStatAfter = fs.statSync(backupPath);
    assert.equal(backupStatBefore.mtimeMs, backupStatAfter.mtimeMs, 'Second save must not recreate or overwrite backup');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Schema: rejects future unsupported schemaVersion greater than CURRENT_SCHEMA_VERSION', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-schema-future-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const examplePath = path.join(tmpDir, 'profiles.example.json');

  try {
    // Write future schemaVersion 99
    const futureConfig = {
      schemaVersion: 99,
      activeProfile: 'developer',
      profiles: {
        developer: { name: 'Developer', pages: [{ buttons: [] }] }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(futureConfig, null, 2));

    assert.throws(() => {
      loadConfig(configPath, examplePath);
    }, /Unsupported schema version 99\. Maximum supported version is 1\./);

    // Also test negative or non-integer schemaVersion
    fs.writeFileSync(configPath, JSON.stringify({ ...futureConfig, schemaVersion: -1 }, null, 2));
    assert.throws(() => {
      loadConfig(configPath, examplePath);
    }, /Invalid schemaVersion: must be a non-negative integer/);

    fs.writeFileSync(configPath, JSON.stringify({ ...futureConfig, schemaVersion: 1.5 }, null, 2));
    assert.throws(() => {
      loadConfig(configPath, examplePath);
    }, /Invalid schemaVersion: must be a non-negative integer/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Schema: diagnostic warnings identify profile, page, and tile on invalid buttons', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-schema-warning-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const examplePath = path.join(tmpDir, 'profiles.example.json');

  try {
    const invalidConfig = {
      schemaVersion: 1,
      activeProfile: 'work',
      profiles: {
        work: {
          name: 'Work Profile',
          pages: [
            {
              pageNumber: 1,
              name: 'Page 1',
              buttons: [
                { id: 0, label: 'VALID', actionType: 'shell', command: 'uptime' },
                { id: 1, label: 'BAD COLOR', color: 'blue-invalid' },
                { id: 2, label: 'BAD URL', actionType: 'url', url: 'javascript:void(0)' }
              ]
            }
          ]
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

    const capturedWarnings = [];
    const loaded = loadConfig(configPath, examplePath, {
      onWarning: (msg) => capturedWarnings.push(msg)
    });

    assert.equal(loaded.schemaVersion, 1);
    assert.equal(capturedWarnings.length, 2);

    // Warning 1: tile 1 (BAD COLOR)
    assert.match(capturedWarnings[0], /profile "work"/);
    assert.match(capturedWarnings[0], /page 1/);
    assert.match(capturedWarnings[0], /tile 1/);
    assert.match(capturedWarnings[0], /id: 1/);
    assert.match(capturedWarnings[0], /Invalid color format/);

    // Warning 2: tile 2 (BAD URL)
    assert.match(capturedWarnings[1], /profile "work"/);
    assert.match(capturedWarnings[1], /page 1/);
    assert.match(capturedWarnings[1], /tile 2/);
    assert.match(capturedWarnings[1], /id: 2/);
    assert.match(capturedWarnings[1], /URL must use http: or https: scheme/);

    // Both bad tiles are repaired
    assert.equal(loaded.profiles.work.pages[0].buttons[1].color, '#1c69d4');
    assert.equal(loaded.profiles.work.pages[0].buttons[2].url, '');

    // _warnings property on config matches captured warnings
    assert.deepEqual(loaded._warnings, capturedWarnings);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Config: ignores prototype pollution keys in profiles dictionary', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-proto-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const examplePath = path.join(tmpDir, 'profiles.example.json');

  try {
    const raw = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      activeProfile: 'valid',
      profiles: {
        __proto__: { polluted: true },
        constructor: { name: 'exploit' },
        prototype: { name: 'exploit2' },
        valid: {
          name: 'Valid Profile',
          pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }]
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(raw));
    const loaded = loadConfig(configPath, examplePath);
    assert.equal(loaded.activeProfile, 'valid');
    assert.equal(Object.prototype.hasOwnProperty.call(loaded.profiles, 'constructor'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded.profiles, 'prototype'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(loaded.profiles, '__proto__'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Config & Auth: Environment overrides (CONFIG_PATH, AUTH_PATH, ARYA_HOME, XDG_CONFIG_HOME)', () => {
  const origEnv = { ...process.env };
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-env-test-'));

  try {
    delete process.env.CONFIG_PATH;
    delete process.env.AUTH_PATH;
    delete process.env.ARYA_HOME;
    delete process.env.XDG_CONFIG_HOME;

    // 1. ARYA_HOME override
    const customAryaHome = path.join(tmpHome, 'custom-dock');
    process.env.ARYA_HOME = customAryaHome;
    assert.equal(getDefaultUserConfigDir(), customAryaHome);
    assert.equal(getDefaultConfigPath(), path.join(customAryaHome, 'profiles.json'));
    assert.equal(getDefaultAuthPath(), path.join(customAryaHome, 'auth.json'));
    assert.equal(require('../lib/config').DEFAULT_CONFIG_PATH, path.join(customAryaHome, 'profiles.json'));
    assert.equal(require('../lib/auth').DEFAULT_AUTH_PATH, path.join(customAryaHome, 'auth.json'));

    // 2. XDG_CONFIG_HOME override (ARYA_HOME takes precedence over XDG)
    const customXdg = path.join(tmpHome, 'xdg');
    process.env.XDG_CONFIG_HOME = customXdg;
    assert.equal(getDefaultUserConfigDir(), customAryaHome);

    delete process.env.ARYA_HOME;
    assert.equal(getDefaultUserConfigDir(), path.join(customXdg, 'arya-dock'));
    assert.equal(getDefaultConfigPath(), path.join(customXdg, 'arya-dock', 'profiles.json'));
    assert.equal(getDefaultAuthPath(), path.join(customXdg, 'arya-dock', 'auth.json'));

    // 3. Exact file overrides CONFIG_PATH and AUTH_PATH take highest precedence
    const customConfig = path.join(tmpHome, 'standalone', 'my-profiles.json');
    const customAuth = path.join(tmpHome, 'standalone', 'my-auth.json');
    process.env.CONFIG_PATH = customConfig;
    process.env.AUTH_PATH = customAuth;
    assert.equal(getDefaultConfigPath(), customConfig);
    assert.equal(getDefaultAuthPath(), customAuth);
  } finally {
    process.env = origEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('Config & Auth: Fresh install seeds template and generates credentials with 0600 mode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-fresh-install-'));
  const targetConfig = path.join(tmpDir, 'user-dir', 'profiles.json');
  const targetAuth = path.join(tmpDir, 'user-dir', 'auth.json');
  const dummyLegacyConfig = path.join(tmpDir, 'nonexistent', 'profiles.json');
  const dummyLegacyAuth = path.join(tmpDir, 'nonexistent', 'auth.json');

  try {
    assert.equal(fs.existsSync(targetConfig), false);
    assert.equal(fs.existsSync(targetAuth), false);

    // Fresh loadConfig with no legacy config seeds from DEFAULT_EXAMPLE_PATH
    const loadedConfig = loadConfig(targetConfig, DEFAULT_EXAMPLE_PATH, {
      legacyConfigPath: dummyLegacyConfig,
      silent: true
    });
    assert.equal(fs.existsSync(targetConfig), true);
    assert.equal(loadedConfig.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.ok(loadedConfig.profiles.developer);

    // Fresh loadOrCreateAuth generates credentials and enforces 0600 mode
    const loadedAuth = loadOrCreateAuth(targetAuth, {
      legacyAuthPath: dummyLegacyAuth,
      silent: true
    });
    assert.equal(fs.existsSync(targetAuth), true);
    assert.ok(loadedAuth.pairingToken && loadedAuth.pairingToken.length === 32);
    assert.ok(loadedAuth.editorKey && loadedAuth.editorKey.length === 32);

    const stat = fs.statSync(targetAuth);
    if (os.platform() !== 'win32') {
      assert.equal(stat.mode & 0o777, 0o600, 'Credentials file must have 0600 permissions');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Config & Auth: Legacy repo migration on first boot preserves data and sets 0600 mode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-migration-test-'));
  const legacyDir = path.join(tmpDir, 'legacy-repo', 'config');
  const legacyConfig = path.join(legacyDir, 'profiles.json');
  const legacyAuth = path.join(legacyDir, 'auth.json');

  const userDir = path.join(tmpDir, 'user-config', 'arya-dock');
  const targetConfig = path.join(userDir, 'profiles.json');
  const targetAuth = path.join(userDir, 'auth.json');

  fs.mkdirSync(legacyDir, { recursive: true });

  const customProfileData = {
    schemaVersion: 1,
    activeProfile: 'migrated',
    profiles: {
      migrated: {
        name: 'Migrated Profiles',
        pages: [{ pageNumber: 1, name: 'P1', buttons: [{ id: 0, label: 'SAVED WORKSPACE KEY' }] }]
      }
    }
  };
  fs.writeFileSync(legacyConfig, JSON.stringify(customProfileData, null, 2));

  const customAuthData = {
    pairingToken: 'migrated_pairing_token_1234567890',
    editorKey: 'migrated_editor_key_123456789012'
  };
  fs.writeFileSync(legacyAuth, JSON.stringify(customAuthData, null, 2), { mode: 0o644 });

  try {
    assert.equal(fs.existsSync(targetConfig), false);
    assert.equal(fs.existsSync(targetAuth), false);

    const logs = [];
    const migration = migrateLegacyConfigAndAuth({
      configPath: targetConfig,
      authPath: targetAuth,
      legacyConfigPath: legacyConfig,
      legacyAuthPath: legacyAuth,
      logger: (msg) => logs.push(msg),
      silent: false
    });

    assert.equal(migration.migratedConfig, true);
    assert.equal(migration.migratedAuth, true);
    assert.equal(fs.existsSync(targetConfig), true);
    assert.equal(fs.existsSync(targetAuth), true);

    // Verify data was preserved completely
    const reloadedConfig = loadConfig(targetConfig, DEFAULT_EXAMPLE_PATH, { silent: true });
    assert.equal(reloadedConfig.activeProfile, 'migrated');
    assert.equal(reloadedConfig.profiles.migrated.pages[0].buttons[0].label, 'SAVED WORKSPACE KEY');

    const reloadedAuth = loadOrCreateAuth(targetAuth, { silent: true });
    assert.equal(reloadedAuth.pairingToken, 'migrated_pairing_token_1234567890');
    assert.equal(reloadedAuth.editorKey, 'migrated_editor_key_123456789012');

    if (os.platform() !== 'win32') {
      const stat = fs.statSync(targetAuth);
      assert.equal(stat.mode & 0o777, 0o600, 'Migrated credentials file must have 0600 mode');
    }

    // Subsequent migration invocation is a no-op and returns false
    const secondMigration = migrateLegacyConfigAndAuth({
      configPath: targetConfig,
      authPath: targetAuth,
      legacyConfigPath: legacyConfig,
      legacyAuthPath: legacyAuth,
      silent: true
    });
    assert.equal(secondMigration.migratedConfig, false);
    assert.equal(secondMigration.migratedAuth, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Persistence: Timestamped backup rotation retains newest N backups and prunes excess', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-backup-rot-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');

  const baseConfig = {
    schemaVersion: 1,
    activeProfile: 'profile_0',
    profiles: {
      profile_0: { name: 'P0', pages: [{ buttons: [] }] }
    }
  };

  try {
    saveConfigAtomic(configPath, baseConfig, { maxBackups: 3, createBackup: false });

    // Perform 6 updates with maxBackups set to 3
    for (let i = 1; i <= 6; i++) {
      const updated = {
        schemaVersion: 1,
        activeProfile: `profile_${i}`,
        profiles: {
          [`profile_${i}`]: { name: `P${i}`, pages: [{ buttons: [] }] }
        }
      };
      saveConfigAtomic(configPath, updated, { maxBackups: 3 });
    }

    const backups = getBackups(configPath);
    // Pure timestamped backups matching profiles.json.bak.<ts>
    const timestampedBackups = backups.filter(b => b.filename.startsWith('profiles.json.bak.'));
    assert.equal(timestampedBackups.length, 3, 'Must retain exactly maxBackups (3) newest timestamped backups');

    // The newest backup should contain the snapshot from step 5 (profile_5)
    const newestRaw = fs.readFileSync(timestampedBackups[0].path, 'utf-8');
    const newestJson = JSON.parse(newestRaw);
    assert.equal(newestJson.activeProfile, 'profile_5');

    // Calling rotateBackups with maxBackups: 1 prunes down to 1
    const pruned = rotateBackups(configPath, 1);
    assert.equal(pruned.length, 2);
    const remaining = getBackups(configPath).filter(b => b.filename.startsWith('profiles.json.bak.'));
    assert.equal(remaining.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Persistence: Auto-recovery from corrupted or truncated config file using newest valid backup', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-autorecover-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');

  const goodConfig1 = {
    schemaVersion: 1,
    activeProfile: 'v1_stable',
    profiles: {
      v1_stable: { name: 'V1', pages: [{ buttons: [{ id: 0, label: 'STABLE V1 TILE' }] }] }
    }
  };

  const goodConfig2 = {
    schemaVersion: 1,
    activeProfile: 'v2_stable',
    profiles: {
      v2_stable: { name: 'V2', pages: [{ buttons: [{ id: 0, label: 'STABLE V2 TILE' }] }] }
    }
  };

  try {
    saveConfigAtomic(configPath, goodConfig1, { maxBackups: 3, createBackup: false });
    saveConfigAtomic(configPath, goodConfig2, { maxBackups: 3 });

    // Ensure a backup was created with v1_stable
    const initialBackups = getBackups(configPath);
    assert.ok(initialBackups.length > 0);

    // Corrupt main config file with truncated / invalid JSON
    fs.writeFileSync(configPath, '{"schemaVersion": 1, "activeProfile": "corrupted", "profiles": { TRUNCATED ...');

    const warnings = [];
    const recovered = loadConfig(configPath, DEFAULT_EXAMPLE_PATH, {
      logger: (msg) => warnings.push(msg),
      silent: false
    });

    assert.equal(recovered.activeProfile, 'v1_stable');
    assert.equal(recovered.profiles.v1_stable.pages[0].buttons[0].label, 'STABLE V1 TILE');

    // Check warning message was logged
    assert.ok(warnings.some(w => /corrupted or truncated/i.test(w) && /Auto-recovering from newest valid backup/i.test(w)));

    // Verify corrupted file snapshot was preserved for forensics
    const corruptedFiles = fs.readdirSync(tmpDir).filter(f => f.includes('.corrupted.'));
    assert.ok(corruptedFiles.length >= 1, 'Corrupted file must be preserved for analysis');

    // Also test zero-byte truncated file recovery
    fs.writeFileSync(configPath, '');
    const recoveredEmpty = loadConfig(configPath, DEFAULT_EXAMPLE_PATH, { silent: true });
    assert.equal(recoveredEmpty.activeProfile, 'v1_stable');

    // Test corrupted config with zero valid backups throws descriptive error
    const allBackups = getBackups(configPath);
    for (const b of allBackups) {
      fs.unlinkSync(b.path);
    }
    fs.writeFileSync(configPath, '{ totally broken json ...');
    assert.throws(() => {
      loadConfig(configPath, DEFAULT_EXAMPLE_PATH, { silent: true });
    }, /Failed to parse configuration file/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Persistence: Debounced saves batch multiple rapid mutations and flush on shutdown', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arya-debounce-test-'));
  const configPath = path.join(tmpDir, 'profiles.json');
  const authPath = path.join(tmpDir, 'auth.json');

  const initialConfig = {
    schemaVersion: 1,
    activeProfile: 'developer',
    profiles: {
      developer: {
        name: 'Developer',
        pages: [
          {
            pageNumber: 1,
            name: 'Page 1',
            buttons: [{ id: 0, label: 'ORIGINAL LABEL', actionType: 'shell', command: 'uptime' }]
          }
        ]
      }
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2));

  const serverInstance = createServer({
    configPath,
    authPath,
    debounceMs: 150,
    maxBackups: 3,
    silent: true,
    registerSignalHandlers: false
  });

  try {
    // Perform rapid successive saves
    for (let i = 1; i <= 5; i++) {
      serverInstance.getConfig().profiles.developer.pages[0].buttons[0].label = `RAPID ${i}`;
      serverInstance.saveConfig();
    }

    assert.equal(serverInstance.hasPendingSave(), true);

    // Read live file before debounce window elapses: should still have original content
    const rawBeforeFlush = fs.readFileSync(configPath, 'utf-8');
    assert.ok(rawBeforeFlush.includes('ORIGINAL LABEL'));
    assert.ok(!rawBeforeFlush.includes('RAPID 5'));

    // Manual or shutdown flush
    serverInstance.flushConfig();
    assert.equal(serverInstance.hasPendingSave(), false);

    const rawAfterFlush = fs.readFileSync(configPath, 'utf-8');
    assert.ok(rawAfterFlush.includes('RAPID 5'));

    // Test shutdown flush on instance close
    serverInstance.getConfig().profiles.developer.pages[0].buttons[0].label = 'FINAL CLOSE FLUSH';
    serverInstance.saveConfig();
    assert.equal(serverInstance.hasPendingSave(), true);

    await new Promise(resolve => serverInstance.close(resolve));
    assert.equal(serverInstance.hasPendingSave(), false);

    const rawAfterClose = fs.readFileSync(configPath, 'utf-8');
    assert.ok(rawAfterClose.includes('FINAL CLOSE FLUSH'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
