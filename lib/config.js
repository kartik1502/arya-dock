const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Normalize and resolve configuration file paths.
 */
function resolveConfigPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const trimmed = filePath.trim();
  if (!trimmed || /[\x00-\x1f\x7f]/.test(trimmed)) return '';
  const home = os.homedir();
  if (trimmed === '~' || trimmed === '$HOME') {
    return home;
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(home, trimmed.slice(2));
  } else if (trimmed.startsWith('$HOME/') || trimmed.startsWith('$HOME\\')) {
    return path.join(home, trimmed.slice(6));
  }
  return path.resolve(trimmed);
}

/**
 * Normalize and resolve working directory paths (e.g. ~/path or $HOME/path).
 * Rejects control characters and shell metacharacters for security.
 */
function resolveWorkingDir(dir) {
  if (!dir || typeof dir !== 'string') return '';
  let resolved = dir.trim();
  if (!resolved || /[\x00-\x1f\x7f]/.test(resolved) || /[;&|`<>^"'\n\r]/.test(resolved)) return '';
  const home = os.homedir();
  if (resolved === '~' || resolved === '$HOME') {
    return home;
  }
  if (resolved.startsWith('~/') || resolved.startsWith('~\\')) {
    resolved = path.join(home, resolved.slice(2));
  } else if (resolved.startsWith('$HOME/') || resolved.startsWith('$HOME\\')) {
    resolved = path.join(home, resolved.slice(6));
  }
  return path.resolve(resolved);
}

const LEGACY_CONFIG_PATH = path.join(__dirname, '..', 'config', 'profiles.json');
const LEGACY_AUTH_PATH = path.join(__dirname, '..', 'config', 'auth.json');
const DEFAULT_EXAMPLE_PATH = path.join(__dirname, '..', 'config', 'profiles.example.json');
const DEFAULT_MAX_BACKUPS = 5;
const MAX_BUTTONS_PER_PAGE = 15;
let saveCounter = 0;

/**
 * Helper to check if a directory (or its closest existing ancestor) is writable.
 */
function isWritable(p) {
  let cur = p;
  while (cur) {
    if (fs.existsSync(cur)) {
      try {
        fs.accessSync(cur, fs.constants.W_OK);
        return true;
      } catch (_) {
        return false;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

/**
 * Determine the default user configuration directory outside the repository.
 * Follows XDG Base Directory Specification on Linux / Unix, supporting
 * ARYA_HOME and XDG_CONFIG_HOME environment overrides.
 * Falls back to repository config if user directory is non-writable (e.g. read-only HOME in sandbox/container).
 */
function getDefaultUserConfigDir() {
  if (process.env.ARYA_HOME) {
    const customHome = resolveConfigPath(process.env.ARYA_HOME);
    if (customHome) return customHome;
  }
  if (process.env.XDG_CONFIG_HOME) {
    const xdgHome = resolveConfigPath(process.env.XDG_CONFIG_HOME);
    if (xdgHome) return path.join(xdgHome, 'arya-dock');
  }
  if (os.platform() === 'win32' && process.env.APPDATA) {
    const appData = resolveConfigPath(process.env.APPDATA);
    if (appData) return path.join(appData, 'arya-dock');
  }

  const standardUserDir = path.join(os.homedir(), '.config', 'arya-dock');
  if (!isWritable(standardUserDir) && isWritable(path.join(__dirname, '..', 'config'))) {
    return path.join(__dirname, '..', 'config');
  }

  return standardUserDir;
}

/**
 * Determine the default configuration file path for profiles.json.
 */
function getDefaultConfigPath() {
  if (process.env.CONFIG_PATH) {
    const p = resolveConfigPath(process.env.CONFIG_PATH);
    if (p) return p;
  }
  return path.join(getDefaultUserConfigDir(), 'profiles.json');
}

/**
 * Automatically migrate legacy repository config and auth files to the user directory on first boot without data loss.
 */
function migrateLegacyConfigAndAuth(options = {}) {
  const targetConfigPath = options.configPath || getDefaultConfigPath();
  const targetAuthPath = options.authPath || (typeof options.getDefaultAuthPath === 'function' ? options.getDefaultAuthPath() : (process.env.AUTH_PATH ? resolveConfigPath(process.env.AUTH_PATH) : path.join(getDefaultUserConfigDir(), 'auth.json')));
  const legacyConfigPath = options.legacyConfigPath || LEGACY_CONFIG_PATH;
  const legacyAuthPath = options.legacyAuthPath || LEGACY_AUTH_PATH;
  const logger = options.logger || console.log;

  let migratedConfig = false;
  let migratedAuth = false;

  // Migrate profiles.json if target does not exist and legacy exists outside target
  if (!fs.existsSync(targetConfigPath) && fs.existsSync(legacyConfigPath)) {
    if (path.resolve(targetConfigPath) !== path.resolve(legacyConfigPath)) {
      try {
        const targetDir = path.dirname(targetConfigPath);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(legacyConfigPath, targetConfigPath);
        migratedConfig = true;
        if (!options.silent) {
          logger(`[Arya Dock] Migrated legacy configuration from ${legacyConfigPath} to ${targetConfigPath}`);
        }
      } catch (err) {
        if (!options.silent) {
          console.warn(`[Arya Dock Warning] Could not migrate configuration to ${targetConfigPath}: ${err.message}`);
        }
      }
    }
  }

  // Migrate auth.json if target does not exist and legacy exists outside target
  if (!fs.existsSync(targetAuthPath) && fs.existsSync(legacyAuthPath)) {
    if (path.resolve(targetAuthPath) !== path.resolve(legacyAuthPath)) {
      try {
        const targetDir = path.dirname(targetAuthPath);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(legacyAuthPath, targetAuthPath);
        try {
          fs.chmodSync(targetAuthPath, 0o600);
        } catch (_) {}
        migratedAuth = true;
        if (!options.silent) {
          logger(`[Arya Dock] Migrated legacy credentials from ${legacyAuthPath} to ${targetAuthPath}`);
        }
      } catch (err) {
        if (!options.silent) {
          console.warn(`[Arya Dock Warning] Could not migrate credentials to ${targetAuthPath}: ${err.message}`);
        }
      }
    }
  }

  return { migratedConfig, migratedAuth };
}

/**
 * Retrieve all timestamped backup files for a given config path, sorted newest first.
 */
function getBackups(configPath) {
  const resolved = resolveConfigPath(configPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) return [];

  const base = path.basename(resolved);
  const entries = fs.readdirSync(dir);
  const backups = [];

  for (const file of entries) {
    if (file === `${base}.bak` || file.startsWith(`${base}.bak.`)) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          let timeVal = Math.floor(stat.mtimeMs);
          let counterVal = 0;
          let timestamp = stat.mtimeMs;

          const match = file.match(/^.*\.bak\.(\d+)(?:-(\d+))?$/);
          if (match) {
            timeVal = parseInt(match[1], 10);
            if (timeVal < 1e11) {
              timeVal *= 1000;
            }
            counterVal = match[2] ? parseInt(match[2], 10) : 0;
            timestamp = timeVal;
          }

          backups.push({
            path: fullPath,
            filename: file,
            mtimeMs: timestamp,
            timeVal,
            counterVal
          });
        }
      } catch (_) {}
    }
  }

  backups.sort((a, b) => {
    if (b.timeVal !== a.timeVal) {
      return b.timeVal - a.timeVal;
    }
    if (b.counterVal !== a.counterVal) {
      return b.counterVal - a.counterVal;
    }
    if (b.mtimeMs !== a.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return b.filename.localeCompare(a.filename);
  });

  return backups;
}

/**
 * Rotate timestamped backups, keeping only the newest maxBackups.
 */
function rotateBackups(configPath, maxBackups = DEFAULT_MAX_BACKUPS) {
  const backups = getBackups(configPath);
  const timestamped = backups.filter(b => b.filename.startsWith(`${path.basename(configPath)}.bak.`));
  const limit = Math.max(0, typeof maxBackups === 'number' && Number.isInteger(maxBackups) ? maxBackups : DEFAULT_MAX_BACKUPS);
  if (timestamped.length <= limit) return [];

  const removed = [];
  const excess = timestamped.slice(limit);
  for (const b of excess) {
    try {
      fs.unlinkSync(b.path);
      removed.push(b.path);
    } catch (_) {}
  }
  return removed;
}

/**
 * Validate and sanitize button payload against strict schema.
 * Rejects unknown fields, invalid types, and prevents ID mutation.
 * When options.repair is true, repairs invalid values to safe defaults.
 */
function validateButton(raw, options = {}) {
  const {
    isUpdate = false,
    existingId = null,
    existingButton = null,
    repair = false,
    defaultId = 0
  } = options;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (repair) {
      const fallbackId = (typeof defaultId === 'number' && defaultId >= 0) ? defaultId : 0;
      return {
        valid: true,
        button: {
          id: fallbackId,
          label: `KEY ${fallbackId + 1}`,
          sublabel: '',
          icon: '⚡',
          color: '#1c69d4',
          actionType: 'shell',
          command: '',
          terminalMode: 'background',
          workingDir: '',
          keepOpen: true,
          url: ''
        }
      };
    }
    return { valid: false, error: 'Button payload must be a non-null object' };
  }

  const effectiveExistingId = (existingId !== null && existingId !== undefined)
    ? existingId
    : (existingButton && existingButton.id !== undefined ? existingButton.id : null);

  // If existingButton provided, merge raw onto it while strictly locking id to effectiveExistingId
  const input = existingButton
    ? { ...existingButton, ...raw, ...(effectiveExistingId !== null ? { id: effectiveExistingId } : {}) }
    : raw;

  // ID validation
  let id;
  if (isUpdate) {
    if (effectiveExistingId !== null) {
      id = effectiveExistingId;
    } else if (typeof input.id === 'number' && Number.isInteger(input.id) && input.id >= 0) {
      id = input.id;
    } else if (repair) {
      id = (typeof defaultId === 'number' && defaultId >= 0) ? defaultId : 0;
    } else {
      return { valid: false, error: 'Valid button id is required for update' };
    }
  } else {
    if (input.id !== undefined) {
      if (typeof input.id !== 'number' || !Number.isInteger(input.id) || input.id < 0) {
        if (repair) {
          id = (typeof defaultId === 'number' && defaultId >= 0) ? defaultId : 0;
        } else {
          return { valid: false, error: 'Button id must be a non-negative integer' };
        }
      } else {
        id = input.id;
      }
    } else {
      id = (typeof defaultId === 'number' && defaultId >= 0) ? defaultId : 0;
    }
  }

  // Label validation
  let label = '';
  if (input.label !== undefined) {
    if (typeof input.label !== 'string') {
      if (repair) {
        label = String(input.label || '').slice(0, 64);
      } else {
        return { valid: false, error: 'Button label must be a string' };
      }
    } else {
      label = input.label.slice(0, 64);
    }
  }

  // Sublabel validation
  let sublabel = '';
  if (input.sublabel !== undefined) {
    if (typeof input.sublabel !== 'string') {
      if (repair) {
        sublabel = String(input.sublabel || '').slice(0, 64);
      } else {
        return { valid: false, error: 'Button sublabel must be a string' };
      }
    } else {
      sublabel = input.sublabel.slice(0, 64);
    }
  }

  // Icon validation
  let icon = '⚡';
  if (input.icon !== undefined) {
    if (typeof input.icon !== 'string') {
      if (repair) {
        icon = '⚡';
      } else {
        return { valid: false, error: 'Button icon must be a string' };
      }
    } else {
      icon = input.icon.slice(0, 16);
    }
  }

  // Color validation (hex format #rrggbb)
  let color = '#1c69d4';
  if (input.color !== undefined) {
    if (typeof input.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
      if (repair) {
        color = '#1c69d4';
      } else {
        return { valid: false, error: 'Invalid color format: must be #rrggbb hex' };
      }
    } else {
      color = input.color.toLowerCase();
    }
  }

  // Action type validation
  const ALLOWED_ACTIONS = ['shell', 'media', 'url'];
  let actionType = 'shell';
  if (input.actionType !== undefined) {
    if (!ALLOWED_ACTIONS.includes(input.actionType)) {
      if (repair) {
        actionType = 'shell';
      } else {
        return { valid: false, error: `Invalid actionType: must be one of ${ALLOWED_ACTIONS.join(', ')}` };
      }
    } else {
      actionType = input.actionType;
    }
  }

  // Command validation
  let command = '';
  if (input.command !== undefined) {
    if (typeof input.command !== 'string') {
      if (repair) {
        command = String(input.command || '').slice(0, 1024);
      } else {
        return { valid: false, error: 'Button command must be a string' };
      }
    } else {
      command = input.command.slice(0, 1024);
    }
  }

  // Terminal mode validation
  const ALLOWED_MODES = ['tab', 'window', 'existing', 'background'];
  let terminalMode = 'background';
  if (input.terminalMode !== undefined) {
    if (!ALLOWED_MODES.includes(input.terminalMode)) {
      if (repair) {
        terminalMode = 'background';
      } else {
        return { valid: false, error: `Invalid terminalMode: must be one of ${ALLOWED_MODES.join(', ')}` };
      }
    } else {
      terminalMode = input.terminalMode;
    }
  }

  // Working directory validation
  let workingDir = '';
  if (input.workingDir !== undefined) {
    if (typeof input.workingDir !== 'string') {
      if (repair) {
        workingDir = '';
      } else {
        return { valid: false, error: 'Button workingDir must be a string' };
      }
    } else {
      workingDir = input.workingDir.slice(0, 512);
    }
  }

  // keepOpen validation
  let keepOpen = true;
  if (input.keepOpen !== undefined) {
    if (typeof input.keepOpen !== 'boolean') {
      if (repair) {
        keepOpen = true;
      } else {
        return { valid: false, error: 'Button keepOpen must be a boolean' };
      }
    } else {
      keepOpen = input.keepOpen;
    }
  }

  // URL validation
  let url = '';
  if (input.url !== undefined) {
    if (typeof input.url !== 'string') {
      if (repair) {
        url = '';
      } else {
        return { valid: false, error: 'Button url must be a string' };
      }
    } else {
      url = input.url.trim().slice(0, 1024);
    }
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        if (repair) {
          url = '';
        } else {
          return { valid: false, error: 'URL must use http: or https: scheme' };
        }
      }
    } catch (e) {
      if (repair) {
        url = '';
      } else {
        return { valid: false, error: 'Invalid URL format' };
      }
    }
  }

  // Media action validation
  const ALLOWED_MEDIA = ['play_pause', 'next', 'prev', 'vol_up', 'vol_down', 'mute'];
  let mediaAction = undefined;
  if (input.mediaAction !== undefined && input.mediaAction !== null && input.mediaAction !== '') {
    if (!ALLOWED_MEDIA.includes(input.mediaAction)) {
      if (repair) {
        mediaAction = undefined;
      } else {
        return { valid: false, error: `Invalid mediaAction: must be one of ${ALLOWED_MEDIA.join(', ')}` };
      }
    } else {
      mediaAction = input.mediaAction;
    }
  }

  const cleaned = {
    id,
    label,
    sublabel,
    icon,
    color,
    actionType,
    command,
    terminalMode,
    workingDir,
    keepOpen,
    url
  };

  if (actionType === 'media') {
    if (!mediaAction) {
      if (repair) {
        mediaAction = 'play_pause';
      } else {
        return { valid: false, error: 'Valid mediaAction is required when actionType is media' };
      }
    }
    cleaned.mediaAction = mediaAction;
    cleaned.command = '';
  }

  return { valid: true, button: cleaned };
}

const CURRENT_SCHEMA_VERSION = 2;

/**
 * Validate and sanitize workspace object against schema.
 * Supports repair mode for hand-edited configurations.
 */
function validateWorkspace(raw, options = {}) {
  const { repair = false, defaultId = 'workspace' } = options;
  const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (repair) {
      return {
        valid: true,
        workspace: {
          id: defaultId,
          name: defaultId,
          icon: '⚡',
          pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }],
          origin: 'user',
          match: { apps: [] }
        }
      };
    }
    return { valid: false, error: 'Workspace must be a non-null object' };
  }

  // ID validation
  let id = '';
  if (typeof raw.id === 'string' && raw.id.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(raw.id)) {
    const trimmed = raw.id.trim();
    if (dangerousKeys.has(trimmed)) {
      if (repair) {
        id = defaultId;
      } else {
        return { valid: false, error: 'Workspace id cannot be a reserved prototype property' };
      }
    } else {
      id = trimmed;
    }
  } else if (repair) {
    id = defaultId;
  } else {
    return { valid: false, error: 'Workspace id must be a non-empty string' };
  }

  // Name validation
  let name = id;
  if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
    name = raw.name.trim().slice(0, 64);
  } else if (repair) {
    name = id;
  } else {
    return { valid: false, error: 'Workspace name must be a non-empty string' };
  }

  // Icon validation
  let icon = '⚡';
  if (typeof raw.icon === 'string' && raw.icon.trim().length > 0) {
    icon = raw.icon.trim().slice(0, 16);
  } else if (repair) {
    icon = id === 'developer' ? '💻' : (id === 'media' ? '🎵' : '⚡');
  } else if (raw.icon !== undefined) {
    return { valid: false, error: 'Workspace icon must be a string' };
  }

  // Origin validation ('builtin' | 'user')
  let origin = 'user';
  if (raw.origin === 'builtin' || raw.origin === 'user') {
    origin = raw.origin;
  } else if (repair) {
    origin = (id === 'developer' || id === 'media') ? 'builtin' : 'user';
  } else if (raw.origin !== undefined) {
    return { valid: false, error: "Workspace origin must be 'builtin' or 'user'" };
  }

  // Match validation
  let match = { apps: [] };
  if (raw.match && typeof raw.match === 'object' && !Array.isArray(raw.match)) {
    const rawApps = Array.isArray(raw.match.apps)
      ? raw.match.apps
      : (Array.isArray(raw.match.app) ? raw.match.app : null);

    if (rawApps === null) {
      if (!repair && (raw.match.apps !== undefined || raw.match.app !== undefined)) {
        return { valid: false, error: 'Workspace match apps must be an array' };
      }
      match = { apps: [] };
    } else {
      if (!repair && rawApps.some(a => typeof a !== 'string')) {
        return { valid: false, error: 'Workspace match apps elements must be strings' };
      }
      match = {
        apps: rawApps
          .filter(a => typeof a === 'string' && a.trim().length > 0)
          .map(a => a.trim().toLowerCase())
      };
    }
  } else if (repair) {
    if (id === 'developer') {
      match = { apps: ['code', 'jetbrains-idea', 'org.gnome.ptyxis', 'alacritty', 'kitty', 'terminal'] };
    } else if (id === 'media') {
      match = { apps: ['spotify', 'vlc', 'rhythmbox'] };
    } else {
      match = { apps: [] };
    }
  } else if (raw.match !== undefined) {
    return { valid: false, error: 'Workspace match must be an object with apps list' };
  }

  // Pages validation
  let pages = [];
  if (Array.isArray(raw.pages) && raw.pages.length > 0) {
    if (!repair) {
      for (let i = 0; i < raw.pages.length; i++) {
        const p = raw.pages[i];
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          return { valid: false, error: `Invalid page at index ${i}: must be a non-null object` };
        }
        if (p.buttons !== undefined && !Array.isArray(p.buttons)) {
          return { valid: false, error: `Invalid page at index ${i}: buttons must be an array` };
        }
      }
      pages = raw.pages;
    } else {
      pages = raw.pages.map((p, i) => {
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          return { pageNumber: i + 1, name: `Page ${i + 1}`, buttons: [] };
        }
        return {
          pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : (i + 1),
          name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 64) : `Page ${i + 1}`,
          buttons: Array.isArray(p.buttons) ? p.buttons : []
        };
      });
    }
  } else if (repair) {
    pages = [{ pageNumber: 1, name: 'Page 1', buttons: [] }];
  } else {
    return { valid: false, error: 'Workspace pages must be a non-empty array' };
  }

  return {
    valid: true,
    workspace: {
      id,
      name,
      icon,
      pages,
      origin,
      match
    }
  };
}

/**
 * Migration pure functions, one per version step.
 */
function migrateV0ToV1(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return config;
  }
  return {
    ...config,
    schemaVersion: 1
  };
}

/**
 * Migration pure function converting Schema v1 (profiles dictionary)
 * into Schema v2 (first-class workspaces array).
 */
function migrateV1ToV2(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return config;
  }

  const workspaces = [];
  const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);

  if (Array.isArray(config.workspaces) && config.workspaces.length > 0) {
    for (const ws of config.workspaces) {
      if (ws && typeof ws === 'object' && !dangerousKeys.has(ws.id)) {
        workspaces.push(JSON.parse(JSON.stringify(ws)));
      }
    }
  } else if (config.profiles && typeof config.profiles === 'object' && !Array.isArray(config.profiles)) {
    for (const [id, prof] of Object.entries(config.profiles)) {
      if (dangerousKeys.has(id)) continue;
      if (!prof || typeof prof !== 'object' || Array.isArray(prof)) continue;
      const isBuiltin = id === 'developer' || id === 'media';
      const defaultIcon = id === 'developer' ? '💻' : (id === 'media' ? '🎵' : '⚡');
      const defaultMatch = id === 'developer'
        ? { apps: ['code', 'jetbrains-idea', 'org.gnome.ptyxis', 'alacritty', 'kitty', 'terminal'] }
        : (id === 'media' ? { apps: ['spotify', 'vlc', 'rhythmbox'] } : { apps: [] });

      const clonedPages = Array.isArray(prof.pages)
        ? JSON.parse(JSON.stringify(prof.pages))
        : [{ pageNumber: 1, name: 'Page 1', buttons: [] }];

      workspaces.push({
        id,
        name: typeof prof.name === 'string' && prof.name.trim() ? prof.name.trim() : (id === 'developer' ? 'Developer & AI Workflows' : (id === 'media' ? 'Media & Audio Controls' : id)),
        icon: typeof prof.icon === 'string' && prof.icon.trim() ? prof.icon.trim() : defaultIcon,
        pages: clonedPages,
        origin: prof.origin || (isBuiltin ? 'builtin' : 'user'),
        match: prof.match && typeof prof.match === 'object' ? JSON.parse(JSON.stringify(prof.match)) : defaultMatch
      });
    }
  }

  if (workspaces.length === 0) {
    workspaces.push(
      {
        id: 'developer',
        name: 'Developer & AI Workflows',
        icon: '💻',
        pages: [{ pageNumber: 1, name: 'AI & Core Tools', buttons: [] }],
        origin: 'builtin',
        match: { apps: ['code', 'jetbrains-idea', 'org.gnome.ptyxis', 'alacritty', 'kitty', 'terminal'] }
      },
      {
        id: 'media',
        name: 'Media & Audio Controls',
        icon: '🎵',
        pages: [{ pageNumber: 1, name: 'Sound & Media', buttons: [] }],
        origin: 'builtin',
        match: { apps: ['spotify', 'vlc', 'rhythmbox'] }
      }
    );
  }

  let activeWorkspaceId = config.activeWorkspaceId || config.activeWorkspace || config.activeProfile;
  if (!activeWorkspaceId || !workspaces.some(w => w.id === activeWorkspaceId)) {
    activeWorkspaceId = workspaces[0].id;
  }

  // Backwards compatibility: maintain profiles dictionary and activeProfile
  const profiles = {};
  for (const ws of workspaces) {
    profiles[ws.id] = {
      name: ws.name,
      icon: ws.icon,
      pages: ws.pages,
      origin: ws.origin,
      match: ws.match
    };
  }

  return {
    ...config,
    schemaVersion: 2,
    activeWorkspaceId,
    activeProfile: activeWorkspaceId,
    workspaces,
    profiles
  };
}

const MIGRATIONS = {
  1: migrateV0ToV1,
  2: migrateV1ToV2
};

/**
 * Migrate configuration object sequentially up to CURRENT_SCHEMA_VERSION.
 */
function migrateConfig(config) {
  const initialVersion = (typeof config.schemaVersion === 'number' && Number.isInteger(config.schemaVersion))
    ? config.schemaVersion
    : 0;

  if (initialVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version ${initialVersion}. Maximum supported version is ${CURRENT_SCHEMA_VERSION}.`);
  }

  let current = config;
  let v = initialVersion;
  while (v < CURRENT_SCHEMA_VERSION) {
    const nextVersion = v + 1;
    const migrationFn = Object.prototype.hasOwnProperty.call(MIGRATIONS, nextVersion) ? MIGRATIONS[nextVersion] : null;
    if (typeof migrationFn === 'function') {
      current = migrationFn(current);
    } else {
      current.schemaVersion = nextVersion;
    }
    v = nextVersion;
  }

  if (initialVersion === 0) {
    Object.defineProperty(current, '_legacyMigrated', {
      value: true,
      writable: true,
      enumerable: false,
      configurable: true
    });
  }

  return current;
}

/**
 * Load configuration from file, falling back to legacy repo migration or example template.
 * Validates profiles structure and schemaVersion, repairing hand-edited buttons.
 * Emits clear diagnostic warnings for invalid tiles naming profile, page, and tile.
 * Automatically recovers from the newest valid backup if corrupted or truncated.
 * Throws on corrupted JSON when no valid backup exists to prevent silent state destruction.
 */
function loadConfig(configPath = getDefaultConfigPath(), examplePath = DEFAULT_EXAMPLE_PATH, options = {}) {
  const resolvedConfigPath = resolveConfigPath(configPath);
  const resolvedExamplePath = resolveConfigPath(examplePath);

  // If resolvedConfigPath does not exist, check for legacy migration or example copy
  if (!fs.existsSync(resolvedConfigPath)) {
    const legacyPath = options.legacyConfigPath || LEGACY_CONFIG_PATH;
    const shouldMigrate = options.migrateLegacy !== false && fs.existsSync(legacyPath) && path.resolve(resolvedConfigPath) !== path.resolve(legacyPath);
    if (shouldMigrate) {
      const dir = path.dirname(resolvedConfigPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(legacyPath, resolvedConfigPath);
      const logFn = options.logger || console.log;
      if (!options.silent) {
        logFn(`[Arya Dock] Migrated legacy configuration from ${legacyPath} to ${resolvedConfigPath}`);
      }
    } else if (fs.existsSync(resolvedExamplePath)) {
      const dir = path.dirname(resolvedConfigPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(resolvedExamplePath, resolvedConfigPath);
    } else {
      throw new Error(`Configuration file not found at ${resolvedConfigPath} and example template missing at ${resolvedExamplePath}`);
    }
  }

  let raw = '';
  try {
    raw = fs.readFileSync(resolvedConfigPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read configuration file at ${resolvedConfigPath}: ${err.message}`);
  }

  const warnings = [];
  function emitWarning(msg) {
    warnings.push(msg);
    if (typeof options.onWarning === 'function') {
      options.onWarning(msg);
    } else if (typeof options.logger === 'function') {
      options.logger(msg);
    } else if (!options.silent) {
      console.warn(msg);
    }
  }

  let config = null;
  let parseError = null;

  try {
    if (!raw.trim()) {
      throw new Error('Unexpected end of JSON input');
    }
    config = JSON.parse(raw);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error(`Configuration file at ${resolvedConfigPath} must be a JSON object.`);
    }
    const hasWorkspaces = Array.isArray(config.workspaces) && config.workspaces.length > 0;
    const hasProfiles = config.profiles && typeof config.profiles === 'object' && !Array.isArray(config.profiles) && Object.keys(config.profiles).length > 0;
    if (!hasWorkspaces && !hasProfiles) {
      throw new Error(`Configuration file at ${resolvedConfigPath} has no workspaces or profiles defined.`);
    }
  } catch (err) {
    parseError = err;
  }

  // Corrupted / truncated auto-recovery from newest valid backup
  if (parseError) {
    const backups = getBackups(resolvedConfigPath);
    let recoveredBackupPath = null;
    let recoveredConfig = null;

    for (const b of backups) {
      try {
        const backupRaw = fs.readFileSync(b.path, 'utf-8');
        const candidate = JSON.parse(backupRaw);
        const candHasWs = candidate && Array.isArray(candidate.workspaces) && candidate.workspaces.length > 0;
        const candHasProf = candidate && candidate.profiles && typeof candidate.profiles === 'object' && !Array.isArray(candidate.profiles) && Object.keys(candidate.profiles).length > 0;
        if (candHasWs || candHasProf) {
          recoveredConfig = candidate;
          recoveredBackupPath = b.path;
          break;
        }
      } catch (_) {
        // Backup corrupted, continue trying next backup
      }
    }

    if (recoveredConfig && recoveredBackupPath) {
      const warnMsg = `[Arya Dock] WARNING: Configuration file at ${resolvedConfigPath} is corrupted or truncated (${parseError.message}). Auto-recovering from newest valid backup: ${recoveredBackupPath}`;
      emitWarning(warnMsg);

      if (raw.trim().length > 0) {
        try {
          fs.copyFileSync(resolvedConfigPath, `${resolvedConfigPath}.corrupted.${Date.now()}`);
        } catch (_) {}
      }

      try {
        fs.copyFileSync(recoveredBackupPath, resolvedConfigPath);
      } catch (_) {}

      config = recoveredConfig;
      Object.defineProperty(config, '_recoveredFromBackup', {
        value: recoveredBackupPath,
        writable: true,
        enumerable: false,
        configurable: true
      });
    } else {
      throw new Error(`Failed to parse configuration file at ${resolvedConfigPath}: ${parseError.message}`);
    }
  }

  // Strip dangerous prototype pollution properties before migration
  for (const dangerousKey of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(config, dangerousKey)) {
      delete config[dangerousKey];
    }
    if (config.profiles && Object.prototype.hasOwnProperty.call(config.profiles, dangerousKey)) {
      delete config.profiles[dangerousKey];
    }
  }

  // Schema version enforcement and migration
  if (config.schemaVersion === undefined || config.schemaVersion === null) {
    config = migrateConfig(config);
  } else if (typeof config.schemaVersion === 'number') {
    if (!Number.isInteger(config.schemaVersion) || config.schemaVersion < 0) {
      throw new Error('Invalid schemaVersion: must be a non-negative integer');
    }
    if (config.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported schema version ${config.schemaVersion}. Maximum supported version is ${CURRENT_SCHEMA_VERSION}.`);
    }
    if (config.schemaVersion < CURRENT_SCHEMA_VERSION) {
      config = migrateConfig(config);
    }
  } else {
    throw new Error('Invalid schemaVersion: must be a number');
  }

  // Ensure workspaces array is populated
  if (!Array.isArray(config.workspaces) || config.workspaces.length === 0) {
    if (config.profiles && typeof config.profiles === 'object' && Object.keys(config.profiles).length > 0) {
      config = migrateV1ToV2(config);
    } else {
      throw new Error(`Configuration file at ${resolvedConfigPath} has no workspaces defined.`);
    }
  }

  // Strip dangerous prototype pollution properties from config and profiles dictionary
  for (const dangerousKey of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(config, dangerousKey)) {
      delete config[dangerousKey];
    }
    if (config.profiles && Object.prototype.hasOwnProperty.call(config.profiles, dangerousKey)) {
      delete config.profiles[dangerousKey];
    }
  }

  // Validate and repair workspaces, pages, and buttons on load
  const validatedWorkspaces = [];
  const seenWorkspaceIds = new Set();

  for (let wIdx = 0; wIdx < config.workspaces.length; wIdx++) {
    const rawWs = config.workspaces[wIdx];
    const wsDefaultId = `workspace-${wIdx + 1}`;
    const wsValidation = validateWorkspace(rawWs, { repair: true, defaultId: wsDefaultId });
    const ws = wsValidation.workspace;

    if (seenWorkspaceIds.has(ws.id)) {
      emitWarning(`[Arya Dock Warning] Duplicate workspace id "${ws.id}". Reassigning to "${ws.id}-${wIdx}".`);
      ws.id = `${ws.id}-${wIdx}`;
    }
    seenWorkspaceIds.add(ws.id);

    // Validate pages
    if (!Array.isArray(ws.pages) || ws.pages.length === 0) {
      emitWarning(`[Arya Dock Warning] Workspace "${ws.id}" has no valid pages. Resetting to default page.`);
      ws.pages = [{ pageNumber: 1, name: 'Page 1', buttons: [] }];
    }

    for (let pIdx = 0; pIdx < ws.pages.length; pIdx++) {
      const page = ws.pages[pIdx];
      if (!page || typeof page !== 'object' || Array.isArray(page)) {
        emitWarning(`[Arya Dock Warning] Invalid page at index ${pIdx} in workspace "${ws.id}". Resetting.`);
        ws.pages[pIdx] = { pageNumber: pIdx + 1, name: `Page ${pIdx + 1}`, buttons: [] };
        continue;
      }
      if (typeof page.pageNumber !== 'number') {
        page.pageNumber = pIdx + 1;
      }
      if (typeof page.name !== 'string') {
        page.name = `Page ${pIdx + 1}`;
      }
      if (!Array.isArray(page.buttons)) {
        page.buttons = [];
      }

      if (page.buttons.length > MAX_BUTTONS_PER_PAGE) {
        emitWarning(`[Arya Dock Warning] Profile "${ws.id}", page ${page.pageNumber} has ${page.buttons.length} buttons, capped to maximum ${MAX_BUTTONS_PER_PAGE}.`);
        page.buttons = page.buttons.slice(0, MAX_BUTTONS_PER_PAGE);
      }

      const seenIds = new Set();
      let nextAvailableId = 0;
      for (let bIdx = 0; bIdx < page.buttons.length; bIdx++) {
        while (seenIds.has(nextAvailableId)) {
          nextAvailableId++;
        }
        const rawBtn = page.buttons[bIdx];

        // Strict validation check to detect issues and surface clear diagnostic messages
        const strictCheck = validateButton(rawBtn, {
          isUpdate: false,
          repair: false,
          defaultId: nextAvailableId
        });

        const isDuplicateId = rawBtn && typeof rawBtn === 'object' && rawBtn.id !== undefined && seenIds.has(rawBtn.id);

        if (!strictCheck.valid || isDuplicateId) {
          const reason = !strictCheck.valid
            ? strictCheck.error
            : `Duplicate button id ${rawBtn.id}`;
          const tileId = (rawBtn && typeof rawBtn === 'object' && rawBtn.id !== undefined)
            ? rawBtn.id
            : bIdx;
          const warnMsg = `[Arya Dock Warning] Invalid button in profile "${ws.id}", page ${page.pageNumber}, tile ${bIdx} (id: ${tileId}): ${reason}. Repaired to safe default.`;
          emitWarning(warnMsg);
        }

        const validation = validateButton(rawBtn, { repair: true, defaultId: nextAvailableId });
        const btn = validation.button;
        if (seenIds.has(btn.id)) {
          btn.id = nextAvailableId;
        }
        seenIds.add(btn.id);
        page.buttons[bIdx] = btn;
      }
    }

    validatedWorkspaces.push(ws);
  }

  config.workspaces = validatedWorkspaces;

  // Ensure activeWorkspaceId points to a valid workspace
  if (!config.activeWorkspaceId || !config.workspaces.some(w => w.id === config.activeWorkspaceId)) {
    config.activeWorkspaceId = config.workspaces[0].id;
  }
  config.activeProfile = config.activeWorkspaceId;

  // Synchronize profiles dictionary for backwards compatibility
  const syncedProfiles = {};
  for (const ws of config.workspaces) {
    syncedProfiles[ws.id] = {
      name: ws.name,
      icon: ws.icon,
      pages: ws.pages,
      origin: ws.origin,
      match: ws.match
    };
  }
  config.profiles = syncedProfiles;

  Object.defineProperty(config, '_warnings', {
    value: warnings,
    writable: true,
    enumerable: false,
    configurable: true
  });

  return config;
}

/**
 * Atomically save configuration via temp file and rename.
 * Writes a backup (.bak) on the first save of a migrated legacy config.
 */
/**
 * Atomically save configuration via temp file and rename.
 * Writes a backup (.bak) on the first save of a migrated legacy config.
 * Creates timestamped backups and rotates them up to maxBackups.
 */
function saveConfigAtomic(configPath = getDefaultConfigPath(), configData, options = {}) {
  const resolvedConfigPath = resolveConfigPath(configPath);
  const dir = path.dirname(resolvedConfigPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const maxBackups = (typeof options.maxBackups === 'number' && options.maxBackups >= 0)
    ? options.maxBackups
    : DEFAULT_MAX_BACKUPS;

  // Backup creation on first save of a legacy/migrated config
  let needsBackup = !!(configData && configData._legacyMigrated);
  if (!needsBackup && fs.existsSync(resolvedConfigPath)) {
    try {
      const existingRaw = fs.readFileSync(resolvedConfigPath, 'utf-8');
      const existingJson = JSON.parse(existingRaw);
      if (existingJson && typeof existingJson === 'object' && !Array.isArray(existingJson)) {
        if (typeof existingJson.schemaVersion !== 'number' || existingJson.schemaVersion === 0) {
          needsBackup = true;
        }
      }
    } catch (_) {
      // Ignore unparseable files
    }
  }

  if (needsBackup && fs.existsSync(resolvedConfigPath)) {
    const backupPath = options.backupPath || `${resolvedConfigPath}.bak`;
    fs.copyFileSync(resolvedConfigPath, backupPath);
    if (configData && configData._legacyMigrated) {
      configData._legacyMigrated = false;
    }
  }

  // Create timestamped backup before overwriting existing valid configuration
  if (fs.existsSync(resolvedConfigPath) && options.createBackup !== false && maxBackups > 0) {
    try {
      const existingRaw = fs.readFileSync(resolvedConfigPath, 'utf-8');
      const existingJson = JSON.parse(existingRaw);
      if (existingJson && typeof existingJson === 'object' && !Array.isArray(existingJson) && existingJson.profiles && typeof existingJson.profiles === 'object' && !Array.isArray(existingJson.profiles) && Object.keys(existingJson.profiles).length > 0) {
        saveCounter = (saveCounter + 1) % 100000;
        const timestampedBackupPath = `${resolvedConfigPath}.bak.${Date.now()}-${saveCounter}`;
        fs.copyFileSync(resolvedConfigPath, timestampedBackupPath);
        rotateBackups(resolvedConfigPath, maxBackups);
      }
    } catch (_) {
      // Do not backup unparseable files
    }
  }

  const tmpPath = path.join(dir, `.profiles.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);

  if (configData && typeof configData === 'object' && !Array.isArray(configData)) {
    if (typeof configData.schemaVersion !== 'number') {
      configData.schemaVersion = CURRENT_SCHEMA_VERSION;
    }
    // Synchronize backwards-compatible profiles if workspaces exist
    if (Array.isArray(configData.workspaces)) {
      if (!configData.activeWorkspaceId && configData.workspaces.length > 0) {
        configData.activeWorkspaceId = configData.workspaces[0].id;
      }
      configData.activeProfile = configData.activeWorkspaceId;
      const syncedProfiles = {};
      const reservedKeys = new Set(['__proto__', 'constructor', 'prototype']);
      for (const ws of configData.workspaces) {
        if (ws && ws.id && !reservedKeys.has(ws.id)) {
          syncedProfiles[ws.id] = {
            name: ws.name,
            icon: ws.icon,
            pages: ws.pages,
            origin: ws.origin,
            match: ws.match
          };
        }
      }
      configData.profiles = syncedProfiles;
    }
  }

  const serialized = JSON.stringify(configData, null, 2);
  try {
    fs.writeFileSync(tmpPath, serialized, 'utf-8');
    fs.renameSync(tmpPath, resolvedConfigPath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_EXAMPLE_PATH,
  LEGACY_CONFIG_PATH,
  LEGACY_AUTH_PATH,
  MAX_BUTTONS_PER_PAGE,
  getDefaultUserConfigDir,
  getDefaultConfigPath,
  migrateLegacyConfigAndAuth,
  getBackups,
  rotateBackups,
  resolveConfigPath,
  resolveWorkingDir,
  validateButton,
  validateWorkspace,
  migrateV0ToV1,
  migrateV1ToV2,
  migrateConfig,
  loadConfig,
  saveConfigAtomic
};

Object.defineProperty(module.exports, 'DEFAULT_CONFIG_PATH', {
  get: () => getDefaultConfigPath(),
  enumerable: true
});
