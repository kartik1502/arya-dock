const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'profiles.json');
const DEFAULT_EXAMPLE_PATH = path.join(__dirname, '..', 'config', 'profiles.example.json');

/**
 * Normalize and resolve working directory paths (e.g. ~/path or $HOME/path).
 */
function resolveWorkingDir(dir) {
  if (!dir || typeof dir !== 'string') return '';
  let resolved = dir.trim();
  if (!resolved) return '';
  if (resolved === '~' || resolved === '$HOME') {
    return os.homedir();
  }
  if (resolved.startsWith('~/') || resolved.startsWith('~\\')) {
    resolved = path.join(os.homedir(), resolved.slice(2));
  } else if (resolved.startsWith('$HOME/') || resolved.startsWith('$HOME\\')) {
    resolved = path.join(os.homedir(), resolved.slice(6));
  }
  return path.resolve(resolved);
}

/**
 * Validate and sanitize button payload against strict schema.
 * Rejects unknown fields, invalid types, and prevents ID mutation.
 */
function validateButton(raw, options = {}) {
  const { isUpdate = false, existingId = null } = options;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Button payload must be a non-null object' };
  }

  // ID validation
  let id;
  if (isUpdate) {
    if (existingId !== null && existingId !== undefined) {
      id = existingId;
    } else if (typeof raw.id === 'number' && Number.isInteger(raw.id) && raw.id >= 0) {
      id = raw.id;
    } else {
      return { valid: false, error: 'Valid button id is required for update' };
    }
  } else {
    if (raw.id !== undefined) {
      if (typeof raw.id !== 'number' || !Number.isInteger(raw.id) || raw.id < 0) {
        return { valid: false, error: 'Button id must be a non-negative integer' };
      }
      id = raw.id;
    }
  }

  // Label validation
  const label = typeof raw.label === 'string' ? raw.label.slice(0, 64) : '';
  const sublabel = typeof raw.sublabel === 'string' ? raw.sublabel.slice(0, 64) : '';
  const icon = typeof raw.icon === 'string' ? raw.icon.slice(0, 16) : '⚡';

  // Color validation (hex format #rrggbb)
  let color = '#1c69d4';
  if (typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)) {
    color = raw.color.toLowerCase();
  }

  // Action type validation
  const ALLOWED_ACTIONS = ['shell', 'media', 'url'];
  const actionType = ALLOWED_ACTIONS.includes(raw.actionType) ? raw.actionType : 'shell';

  // Command validation
  const command = typeof raw.command === 'string' ? raw.command.slice(0, 1024) : '';

  // Terminal mode validation
  const ALLOWED_MODES = ['tab', 'window', 'existing', 'background'];
  const terminalMode = ALLOWED_MODES.includes(raw.terminalMode) ? raw.terminalMode : 'background';

  // Working directory validation
  const workingDir = typeof raw.workingDir === 'string' ? raw.workingDir.slice(0, 512) : '';

  // keepOpen validation
  const keepOpen = raw.keepOpen !== false;

  // URL validation
  let url = '';
  if (typeof raw.url === 'string') {
    url = raw.url.trim().slice(0, 1024);
    if (actionType === 'url' && url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { valid: false, error: 'URL must use http: or https: scheme' };
        }
      } catch (e) {
        return { valid: false, error: 'Invalid URL format' };
      }
    }
  }

  // Media action validation
  const ALLOWED_MEDIA = ['play_pause', 'next', 'prev', 'vol_up', 'vol_down', 'mute'];
  let mediaAction = undefined;
  if (raw.mediaAction && ALLOWED_MEDIA.includes(raw.mediaAction)) {
    mediaAction = raw.mediaAction;
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

  if (mediaAction) {
    cleaned.mediaAction = mediaAction;
  }

  return { valid: true, button: cleaned };
}

/**
 * Load configuration from file, falling back to example template.
 * Throws on corrupted JSON to prevent silent state destruction.
 */
function loadConfig(configPath = DEFAULT_CONFIG_PATH, examplePath = DEFAULT_EXAMPLE_PATH) {
  if (!fs.existsSync(configPath)) {
    if (fs.existsSync(examplePath)) {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(examplePath, configPath);
    } else {
      throw new Error(`Configuration file not found at ${configPath} and example template missing at ${examplePath}`);
    }
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse configuration file at ${configPath}: ${err.message}`);
  }

  if (!config.profiles || Object.keys(config.profiles).length === 0) {
    throw new Error(`Configuration file at ${configPath} has no profiles defined.`);
  }

  return config;
}

/**
 * Atomically save configuration via temp file and rename.
 */
function saveConfigAtomic(configPath = DEFAULT_CONFIG_PATH, configData) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.profiles.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);

  const serialized = JSON.stringify(configData, null, 2);
  fs.writeFileSync(tmpPath, serialized, 'utf-8');
  fs.renameSync(tmpPath, configPath);
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_EXAMPLE_PATH,
  resolveWorkingDir,
  validateButton,
  loadConfig,
  saveConfigAtomic
};
