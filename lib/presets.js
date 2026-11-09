'use strict';

const fs = require('fs');
const path = require('path');
const { getInstalledApplications, getSuggestedProjectDirs } = require('./apps');

// Strict Enum Allowlist to prevent prototype pollution
const ALLOWED_STARTER_IDS = Object.freeze(['developer', 'devops', 'media', 'system']);

// Static Catalog Presets (Consolidated Single Source of Truth)
const STATIC_PRESETS = Object.freeze([
  { id: 'ai-agent', name: 'AI Coding Agent', icon: '🤖', color: '#6366f1', actionType: 'shell', command: 'claude || ollama run codellama', terminalMode: 'tab', category: 'development' },
  { id: 'vs-code', name: 'VS Code', icon: '💻', color: '#1c69d4', actionType: 'shell', command: 'code .', terminalMode: 'tab', category: 'development' },
  { id: 'terminal', name: 'Terminal Tab', icon: '⚡', color: '#1c69d4', actionType: 'shell', command: 'ptyxis --tab || gnome-terminal --tab || alacritty || kitty &', terminalMode: 'tab', category: 'system' },
  { id: 'browser', name: 'Web Browser', icon: '🌐', color: '#3b82f6', actionType: 'shell', command: 'google-chrome || brave-browser || firefox &', terminalMode: 'background', category: 'network' },
  { id: 'git-status', name: 'Git Status', icon: '🌿', color: '#10b981', actionType: 'shell', command: 'git status', terminalMode: 'tab', category: 'development' },
  { id: 'lazydocker', name: 'LazyDocker', icon: '⚡', color: '#10b981', actionType: 'shell', command: 'lazydocker || lzd', terminalMode: 'tab', category: 'devops' },
  { id: 'k9s', name: 'K9s Kubernetes', icon: '☸️', color: '#326ce5', actionType: 'shell', command: 'k9s', terminalMode: 'tab', category: 'devops' },
  { id: 'sys-stats', name: 'System Monitor', icon: '📊', color: '#8b5cf6', actionType: 'shell', command: 'btop || htop', terminalMode: 'tab', category: 'system' },
  { id: 'media-play', name: 'Play / Pause', icon: '⏯️', color: '#10b981', actionType: 'media', mediaAction: 'play_pause', category: 'media' },
  { id: 'mute-audio', name: 'Mute Audio', icon: '🔇', color: '#ef4444', actionType: 'media', mediaAction: 'mute', category: 'media' },
  { id: 'vol-up', name: 'Volume +5%', icon: '🔊', color: '#3b82f6', actionType: 'media', mediaAction: 'vol_up', category: 'media' },
  { id: 'vol-down', name: 'Volume -5%', icon: '🔉', color: '#3b82f6', actionType: 'media', mediaAction: 'vol_down', category: 'media' }
]);

// 60-Second In-Memory Memoization & Single-Flight Coalescing
let memoizedDetection = null;
let memoizedExpiry = 0;
let inFlightScanPromise = null;
const CACHE_TTL_MS = 60 * 1000;

function isBinaryInPath(binaryName, customPathEnv = null) {
  if (!binaryName || typeof binaryName !== 'string') return false;
  const pathEnv = (customPathEnv !== null) ? customPathEnv : (process.env.PATH || '');
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const fullPath = path.join(dir, binaryName);
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return true;
    } catch (_) {}
  }
  return false;
}

async function detectHostEcosystem(options = {}) {
  const { forceRefresh = false, customPathEnv = null } = options;
  const now = Date.now();

  if (!forceRefresh && memoizedDetection && now < memoizedExpiry && customPathEnv === null) {
    return memoizedDetection;
  }

  if (inFlightScanPromise && customPathEnv === null) {
    return inFlightScanPromise;
  }

  const scanPromise = (async () => {
    try {
      const detectedTools = [];
      const toolCatalog = [
        { id: 'code', name: 'VS Code', binary: 'code', category: 'development', icon: '💻', color: '#1c69d4' },
        { id: 'claude', name: 'Claude Code', binary: 'claude', category: 'development', icon: '🤖', color: '#6366f1' },
        { id: 'docker', name: 'Docker', binary: 'docker', category: 'devops', icon: '🐳', color: '#0db7ed' },
        { id: 'lazydocker', name: 'LazyDocker', binary: 'lazydocker', category: 'devops', icon: '⚡', color: '#10b981' },
        { id: 'kubectl', name: 'Kubectl', binary: 'kubectl', category: 'devops', icon: '☸️', color: '#326ce5' },
        { id: 'k9s', name: 'K9s', binary: 'k9s', category: 'devops', icon: '🐶', color: '#38bdf8' },
        { id: 'btop', name: 'Btop Monitor', binary: 'btop', category: 'system', icon: '📊', color: '#8b5cf6' },
        { id: 'htop', name: 'Htop Monitor', binary: 'htop', category: 'system', icon: '📈', color: '#10b981' },
        { id: 'git', name: 'Git CLI', binary: 'git', category: 'development', icon: '🌿', color: '#f05032' },
        { id: 'cargo', name: 'Rust Cargo', binary: 'cargo', category: 'development', icon: '🦀', color: '#e43716' },
        { id: 'python3', name: 'Python 3', binary: 'python3', category: 'development', icon: '🐍', color: '#3776ab' },
        { id: 'node', name: 'Node.js', binary: 'node', category: 'development', icon: '💚', color: '#539e43' },
        { id: 'gh', name: 'GitHub CLI', binary: 'gh', category: 'development', icon: '🐙', color: '#24292e' },
        { id: 'spotify', name: 'Spotify', binary: 'spotify', category: 'media', icon: '🎵', color: '#1ed760' }
      ];

      for (const item of toolCatalog) {
        if (isBinaryInPath(item.binary, customPathEnv)) {
          detectedTools.push(item);
        }
      }

      const desktopApps = getInstalledApplications(forceRefresh);
      const suggestedDirs = getSuggestedProjectDirs();

      const result = {
        timestamp: now,
        detectedTools,
        desktopAppsCount: desktopApps.length,
        suggestedDirsCount: suggestedDirs.length,
        hasDetectedTools: detectedTools.length > 0
      };

      if (customPathEnv === null) {
        memoizedDetection = result;
        memoizedExpiry = Date.now() + CACHE_TTL_MS;
      }
      return result;
    } finally {
      if (customPathEnv === null) {
        inFlightScanPromise = null;
      }
    }
  })();

  if (customPathEnv === null) {
    inFlightScanPromise = scanPromise;
  }
  return scanPromise;
}

function chunkArray(items, size = 15) {
  if (!Array.isArray(items)) return [];
  const chunkSize = Math.max(1, size || 15);
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [[]];
}

function generateCuratedWorkspaces(selectedIds, detectedEcosystem = {}) {
  const sanitizedIds = (Array.isArray(selectedIds) ? selectedIds : [])
    .filter(id => ALLOWED_STARTER_IDS.includes(id));

  // Baseline Fallback: Ensure at least 'developer' exists
  if (sanitizedIds.length === 0) {
    sanitizedIds.push('developer');
  }

  const generated = [];

  for (const wsId of sanitizedIds) {
    if (wsId === 'developer') {
      const devButtons = [];
      let idCounter = 0;
      const tools = detectedEcosystem.detectedTools || [];
      const devTools = tools.filter(t => t.category === 'development' || t.category === 'system');

      if (devTools.length > 0) {
        for (const t of devTools) {
          devButtons.push({
            id: idCounter++,
            label: t.name.toUpperCase(),
            sublabel: 'CLI / DEV',
            icon: t.icon,
            color: t.color,
            actionType: 'shell',
            command: t.binary,
            terminalMode: 'tab',
            workingDir: '',
            keepOpen: true,
            url: '',
            isApplication: false,
            categoryOverride: null
          });
        }
      } else {
        devButtons.push(
          { id: idCounter++, label: 'TERMINAL', sublabel: 'SHELL', icon: '⚡', color: '#1c69d4', actionType: 'shell', command: 'bash', terminalMode: 'tab', workingDir: '', keepOpen: true, url: '' },
          { id: idCounter++, label: 'GIT STATUS', sublabel: 'REPO', icon: '🌿', color: '#10b981', actionType: 'shell', command: 'git status', terminalMode: 'tab', workingDir: '', keepOpen: true, url: '' },
          { id: idCounter++, label: 'SYSTEM INFO', sublabel: 'UNAME', icon: '📊', color: '#8b5cf6', actionType: 'shell', command: 'uname -a', terminalMode: 'tab', workingDir: '', keepOpen: true, url: '' }
        );
      }

      const buttonPages = chunkArray(devButtons, 15);
      generated.push({
        id: 'developer',
        name: 'Developer Cockpit',
        icon: '💻',
        origin: 'user',
        folders: [],
        match: { apps: ['code', 'jetbrains-idea', 'org.gnome.ptyxis', 'alacritty', 'kitty', 'terminal'] },
        segregation: { enabled: false },
        pages: buttonPages.map((btns, idx) => ({
          pageNumber: idx + 1,
          name: idx === 0 ? 'Core Tools' : `Tools (Page ${idx + 1})`,
          buttons: btns
        }))
      });
    }

    if (wsId === 'devops') {
      const devopsButtons = [
        { id: 0, label: 'CONTAINERS', sublabel: 'DOCKER', icon: '🐳', color: '#0db7ed', actionType: 'shell', command: 'docker ps', terminalMode: 'tab', workingDir: '', keepOpen: true, url: '' },
        { id: 1, label: 'K8S CONTEXT', sublabel: 'KUBECTL', icon: '☸️', color: '#326ce5', actionType: 'shell', command: 'kubectl config current-context', terminalMode: 'tab', workingDir: '', keepOpen: true, url: '' },
        { id: 2, label: 'DEV LOGS', sublabel: 'JOURNAL', icon: '📜', color: '#64748b', actionType: 'shell', command: 'journalctl -f -n 50', terminalMode: 'tab', workingDir: '', keepOpen: true, url: '' }
      ];
      generated.push({
        id: 'devops',
        name: 'DevOps & Cloud',
        icon: '⚡',
        origin: 'user',
        folders: [],
        match: { apps: ['docker', 'kubectl', 'k9s', 'lazydocker'] },
        segregation: { enabled: false },
        pages: [{ pageNumber: 1, name: 'Cloud & Cluster', buttons: devopsButtons }]
      });
    }

    if (wsId === 'media') {
      const mediaButtons = [
        { id: 0, label: 'MUTE', sublabel: 'TOGGLE', icon: '🔇', color: '#ef4444', actionType: 'media', mediaAction: 'mute' },
        { id: 1, label: 'VOL DOWN', sublabel: '5% DOWN', icon: '🔉', color: '#3b82f6', actionType: 'media', mediaAction: 'vol_down' },
        { id: 2, label: 'VOL UP', sublabel: '5% UP', icon: '🔊', color: '#3b82f6', actionType: 'media', mediaAction: 'vol_up' },
        { id: 3, label: 'PLAY/PAUSE', sublabel: 'MEDIA', icon: '⏯️', color: '#10b981', actionType: 'media', mediaAction: 'play_pause' },
        { id: 4, label: 'SCREENSHOT', sublabel: 'AREA', icon: '📸', color: '#f97316', actionType: 'shell', command: 'gnome-screenshot -i 2>/dev/null || grim 2>/dev/null', terminalMode: 'background', workingDir: '', keepOpen: false, url: '' },
        { id: 5, label: 'LOCK PC', sublabel: 'LOCK', icon: '🔒', color: '#ef4444', actionType: 'shell', command: 'loginctl lock-session', terminalMode: 'background', workingDir: '', keepOpen: false, url: '' }
      ];
      generated.push({
        id: 'media',
        name: 'Media & Telemetry',
        icon: '🎵',
        origin: 'user',
        folders: [],
        match: { apps: ['spotify', 'vlc', 'rhythmbox'] },
        segregation: { enabled: false },
        pages: [{ pageNumber: 1, name: 'Controls', buttons: mediaButtons }]
      });
    }

    if (wsId === 'system') {
      const systemButtons = [
        { id: 0, label: 'BTOP STATS', sublabel: 'MONITOR', icon: '📊', color: '#8b5cf6', actionType: 'shell', command: 'btop || htop || top', terminalMode: 'tab', workingDir: '', keepOpen: true, url: '' },
        { id: 1, label: 'TERMINAL', sublabel: 'TAB', icon: '⚡', color: '#1c69d4', actionType: 'shell', command: 'ptyxis --tab || gnome-terminal --tab || alacritty &', terminalMode: 'background', workingDir: '', keepOpen: true, url: '' },
        { id: 2, label: 'FILES', sublabel: 'HOME', icon: '📁', color: '#3b82f6', actionType: 'shell', command: 'nautilus ~ 2>/dev/null || thunar ~ 2>/dev/null &', terminalMode: 'background', workingDir: '', keepOpen: false, url: '' },
        { id: 3, label: 'SCREENSHOT', sublabel: 'CAPTURE', icon: '📸', color: '#f97316', actionType: 'shell', command: 'gnome-screenshot -i 2>/dev/null || grim 2>/dev/null', terminalMode: 'background', workingDir: '', keepOpen: false, url: '' },
        { id: 4, label: 'LOCK SCREEN', sublabel: 'LOCK', icon: '🔒', color: '#ef4444', actionType: 'shell', command: 'loginctl lock-session', terminalMode: 'background', workingDir: '', keepOpen: false, url: '' }
      ];
      generated.push({
        id: 'system',
        name: 'System Utilities',
        icon: '⚙️',
        origin: 'user',
        folders: [],
        match: { apps: ['gnome-system-monitor', 'btop', 'htop', 'baobab'] },
        segregation: { enabled: false },
        pages: [{ pageNumber: 1, name: 'System Tools', buttons: systemButtons }]
      });
    }
  }

  return generated;
}

// Reset cache helper for unit tests
function _clearDetectionCacheForTest() {
  memoizedDetection = null;
  memoizedExpiry = 0;
  inFlightScanPromise = null;
}

module.exports = {
  ALLOWED_STARTER_IDS,
  STATIC_PRESETS,
  isBinaryInPath,
  detectHostEcosystem,
  generateCuratedWorkspaces,
  chunkArray,
  _clearDetectionCacheForTest
};
