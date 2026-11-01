const fs = require('fs');
const path = require('path');
const os = require('os');

let cachedApps = null;

function getAppEmoji(name, category, execCmd) {
  const lower = (name + ' ' + (category || '') + ' ' + execCmd).toLowerCase();
  if (lower.includes('code') || lower.includes('dev') || lower.includes('studio') || lower.includes('git')) return '💻';
  if (lower.includes('term') || lower.includes('bash') || lower.includes('zsh') || lower.includes('shell') || lower.includes('ptyxis')) return '⚡';
  if (lower.includes('chrome') || lower.includes('brave') || lower.includes('firefox') || lower.includes('browser') || lower.includes('web')) return '🌐';
  if (lower.includes('calc')) return '🧮';
  if (lower.includes('file') || lower.includes('nautilus') || lower.includes('folder')) return '📁';
  if (lower.includes('music') || lower.includes('audio') || lower.includes('sound') || lower.includes('player') || lower.includes('spotify')) return '🎵';
  if (lower.includes('video') || lower.includes('camera') || lower.includes('photo') || lower.includes('snapshot')) return '🎥';
  if (lower.includes('monitor') || lower.includes('top') || lower.includes('task') || lower.includes('system') || lower.includes('stats')) return '📊';
  if (lower.includes('clock') || lower.includes('time') || lower.includes('calendar')) return '📅';
  if (lower.includes('setting') || lower.includes('config') || lower.includes('control')) return '⚙️';
  if (lower.includes('text') || lower.includes('note') || lower.includes('doc') || lower.includes('edit')) return '📝';
  if (lower.includes('mail') || lower.includes('email') || lower.includes('message') || lower.includes('chat')) return '💬';
  if (lower.includes('box') || lower.includes('vm') || lower.includes('docker') || lower.includes('virt')) return '📦';
  return '🚀';
}

function getInstalledApplications(forceRefresh = false) {
  if (cachedApps && !forceRefresh) {
    return cachedApps;
  }

  const dirs = [
    '/usr/share/applications',
    path.join(process.env.HOME || '', '.local/share/applications')
  ];
  const apps = [];
  const seen = new Set();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.desktop')) continue;
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          if (content.includes('NoDisplay=true') || content.includes('Type=Link')) continue;

          const nameMatch = content.match(/^Name=([^\r\n]+)/m);
          const execMatch = content.match(/^Exec=([^\r\n]+)/m);
          const iconMatch = content.match(/^Icon=([^\r\n]+)/m);
          const catMatch = content.match(/^Categories=([^\r\n]+)/m);
          const commentMatch = content.match(/^Comment=([^\r\n]+)/m);

          if (nameMatch && execMatch) {
            const name = nameMatch[1].trim();
            if (seen.has(name)) continue;
            seen.add(name);

            // Clean exec command placeholders
            let execCmd = execMatch[1].replace(/%[uUfFdiDknm]/g, '').trim();
            const category = catMatch ? catMatch[1].split(';').filter(Boolean)[0] : 'Utility';
            const iconEmoji = getAppEmoji(name, category, execCmd);

            apps.push({
              id: file.replace('.desktop', ''),
              name,
              command: execCmd,
              iconName: iconMatch ? iconMatch[1].trim() : 'application-x-executable',
              emoji: iconEmoji,
              category,
              comment: commentMatch ? commentMatch[1].trim() : ''
            });
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  cachedApps = apps.sort((a, b) => a.name.localeCompare(b.name));
  return cachedApps;
}

/**
 * Discover safe workspace directories for auto-complete.
 * Does not contain hardcoded personal repository paths.
 */
function getSuggestedProjectDirs(customDirs = []) {
  const home = os.homedir();
  const dirs = [];
  const seen = new Set();

  function addDir(label, fullPath) {
    if (!fullPath || !fs.existsSync(fullPath)) return;
    try {
      const resolved = path.resolve(fullPath);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      const displayPath = resolved.startsWith(home) ? '~' + resolved.slice(home.length) : resolved;
      dirs.push({ label, path: displayPath, fullPath: resolved });
    } catch (e) {}
  }

  // Generic base directories
  addDir('Home (~)', home);
  const docPath = path.join(home, 'Documents');
  addDir('Documents', docPath);
  const projPath = path.join(home, 'Projects');
  addDir('Projects', projPath);
  addDir('Arya Dock', path.join(__dirname, '..'));

  // Custom directories provided via config
  if (Array.isArray(customDirs)) {
    for (const item of customDirs) {
      if (item && item.path) {
        addDir(item.label || path.basename(item.path), item.path);
      }
    }
  }

  // Scan subdirectories in ~/Documents and ~/Projects (1 level deep)
  for (const parent of [docPath, projPath]) {
    try {
      if (fs.existsSync(parent)) {
        const entries = fs.readdirSync(parent, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            addDir(entry.name, path.join(parent, entry.name));
          }
        }
      }
    } catch (e) {}
  }

  return dirs;
}

module.exports = {
  getInstalledApplications,
  getSuggestedProjectDirs,
  getAppEmoji
};
