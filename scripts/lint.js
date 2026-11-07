#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const targetDirs = ['lib', 'platform', 'public', 'test', 'scripts'];
const filesToCheck = [];

const rootServer = path.join(rootDir, 'server.js');
if (fs.existsSync(rootServer)) {
  filesToCheck.push('server.js');
}

function scanDir(dirRelative) {
  const fullDir = path.join(rootDir, dirRelative);
  if (!fs.existsSync(fullDir)) return;
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = path.join(dirRelative, entry.name);
    if (entry.isDirectory()) {
      scanDir(relPath);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      filesToCheck.push(relPath);
    }
  }
}

for (const dir of targetDirs) {
  scanDir(dir);
}

let failed = 0;
for (const file of filesToCheck) {
  const fullPath = path.join(rootDir, file);
  try {
    execFileSync(process.execPath, ['--check', fullPath], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
  } catch (err) {
    failed++;
    console.error(`Syntax error in ${file}:`);
    if (err.stderr) {
      console.error(err.stderr.toString().trim());
    }
  }
}

if (failed > 0) {
  console.error(`\n❌ Lint check failed: ${failed} file(s) with syntax errors.`);
  process.exit(1);
} else {
  console.log(`✔ Lint check passed: ${filesToCheck.length} JavaScript files validated.`);
}
