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
  const { isUpdate = false, existingId = null, existingButton = null } = options;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
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
    } else {
      return { valid: false, error: 'Valid button id is required for update' };
    }
  } else {
    if (input.id !== undefined) {
      if (typeof input.id !== 'number' || !Number.isInteger(input.id) || input.id < 0) {
        return { valid: false, error: 'Button id must be a non-negative integer' };
      }
      id = input.id;
    }
  }

  // Label validation
  let label = '';
  if (input.label !== undefined) {
    if (typeof input.label !== 'string') {
      return { valid: false, error: 'Button label must be a string' };
    }
    label = input.label.slice(0, 64);
  }

  // Sublabel validation
  let sublabel = '';
  if (input.sublabel !== undefined) {
    if (typeof input.sublabel !== 'string') {
      return { valid: false, error: 'Button sublabel must be a string' };
    }
    sublabel = input.sublabel.slice(0, 64);
  }

  // Icon validation
  let icon = '⚡';
  if (input.icon !== undefined) {
    if (typeof input.icon !== 'string') {
      return { valid: false, error: 'Button icon must be a string' };
    }
    icon = input.icon.slice(0, 16);
  }

  // Color validation (hex format #rrggbb)
  let color = '#1c69d4';
  if (input.color !== undefined) {
    if (typeof input.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
      return { valid: false, error: 'Invalid color format: must be #rrggbb hex' };
    }
    color = input.color.toLowerCase();
  }

  // Action type validation
  const ALLOWED_ACTIONS = ['shell', 'media', 'url'];
  let actionType = 'shell';
  if (input.actionType !== undefined) {
    if (!ALLOWED_ACTIONS.includes(input.actionType)) {
      return { valid: false, error: `Invalid actionType: must be one of ${ALLOWED_ACTIONS.join(', ')}` };
    }
    actionType = input.actionType;
  }

  // Command validation
  let command = '';
  if (input.command !== undefined) {
    if (typeof input.command !== 'string') {
      return { valid: false, error: 'Button command must be a string' };
    }
    command = input.command.slice(0, 1024);
  }

  // Terminal mode validation
  const ALLOWED_MODES = ['tab', 'window', 'existing', 'background'];
  let terminalMode = 'background';
  if (input.terminalMode !== undefined) {
    if (!ALLOWED_MODES.includes(input.terminalMode)) {
      return { valid: false, error: `Invalid terminalMode: must be one of ${ALLOWED_MODES.join(', ')}` };
    }
    terminalMode = input.terminalMode;
  }

  // Working directory validation
  let workingDir = '';
  if (input.workingDir !== undefined) {
    if (typeof input.workingDir !== 'string') {
      return { valid: false, error: 'Button workingDir must be a string' };
    }
    workingDir = input.workingDir.slice(0, 512);
  }

  // keepOpen validation
  let keepOpen = true;
  if (input.keepOpen !== undefined) {
    if (typeof input.keepOpen !== 'boolean') {
      return { valid: false, error: 'Button keepOpen must be a boolean' };
    }
    keepOpen = input.keepOpen;
  }

  // URL validation
  let url = '';
  if (input.url !== undefined) {
    if (typeof input.url !== 'string') {
      return { valid: false, error: 'Button url must be a string' };
    }
    url = input.url.trim().slice(0, 1024);
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, error: 'URL must use http: or https: scheme' };
      }
    } catch (e) {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  // Media action validation
  const ALLOWED_MEDIA = ['play_pause', 'next', 'prev', 'vol_up', 'vol_down', 'mute'];
  let mediaAction = undefined;
  if (input.mediaAction !== undefined && input.mediaAction !== null && input.mediaAction !== '') {
    if (!ALLOWED_MEDIA.includes(input.mediaAction)) {
      return { valid: false, error: `Invalid mediaAction: must be one of ${ALLOWED_MEDIA.join(', ')}` };
    }
    mediaAction = input.mediaAction;
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

  if (actionType === 'media' && mediaAction) {
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
