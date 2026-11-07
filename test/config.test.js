const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  CURRENT_SCHEMA_VERSION,
  migrateV0ToV1,
  migrateConfig,
  resolveWorkingDir,
  validateButton,
  loadConfig,
  saveConfigAtomic
} = require('../lib/config');

test('Config: resolveWorkingDir path expansions', () => {
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
