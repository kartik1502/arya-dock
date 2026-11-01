const fs = require('fs');
const path = require('path');
const os = require('os');

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

const DEFAULT_CONFIG_PATH = process.env.CONFIG_PATH
  ? resolveWorkingDir(process.env.CONFIG_PATH)
  : path.join(__dirname, '..', 'config', 'profiles.json');
const DEFAULT_EXAMPLE_PATH = path.join(__dirname, '..', 'config', 'profiles.example.json');

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

/**
 * Load configuration from file, falling back to example template.
 * Validates profiles structure and schemaVersion, repairing hand-edited buttons.
 * Throws on corrupted JSON or invalid profile structure to prevent silent state destruction.
 */
function loadConfig(configPath = DEFAULT_CONFIG_PATH, examplePath = DEFAULT_EXAMPLE_PATH) {
  const resolvedConfigPath = resolveWorkingDir(configPath);
  const resolvedExamplePath = resolveWorkingDir(examplePath);

  if (!fs.existsSync(resolvedConfigPath)) {
    if (fs.existsSync(resolvedExamplePath)) {
      const dir = path.dirname(resolvedConfigPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(resolvedExamplePath, resolvedConfigPath);
    } else {
      throw new Error(`Configuration file not found at ${resolvedConfigPath} and example template missing at ${resolvedExamplePath}`);
    }
  }

  const raw = fs.readFileSync(resolvedConfigPath, 'utf-8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse configuration file at ${resolvedConfigPath}: ${err.message}`);
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Configuration file at ${resolvedConfigPath} must be a JSON object.`);
  }

  // Schema version enforcement
  if (typeof config.schemaVersion !== 'number') {
    config.schemaVersion = 1;
  }

  if (!config.profiles || typeof config.profiles !== 'object' || Array.isArray(config.profiles) || Object.keys(config.profiles).length === 0) {
    throw new Error(`Configuration file at ${resolvedConfigPath} has no profiles defined.`);
  }

  // Ensure activeProfile points to a valid profile
  if (!config.activeProfile || !config.profiles[config.activeProfile]) {
    config.activeProfile = Object.keys(config.profiles)[0];
  }

  // Validate and repair profiles, pages, and buttons on load
  for (const [profileId, profile] of Object.entries(config.profiles)) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      config.profiles[profileId] = { name: profileId, pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }] };
      continue;
    }
    if (typeof profile.name !== 'string') {
      profile.name = profileId;
    }
    if (!Array.isArray(profile.pages) || profile.pages.length === 0) {
      profile.pages = [{ pageNumber: 1, name: 'Page 1', buttons: [] }];
    }

    for (let pIdx = 0; pIdx < profile.pages.length; pIdx++) {
      const page = profile.pages[pIdx];
      if (!page || typeof page !== 'object' || Array.isArray(page)) {
        profile.pages[pIdx] = { pageNumber: pIdx + 1, name: `Page ${pIdx + 1}`, buttons: [] };
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

      if (page.buttons.length > 24) {
        page.buttons = page.buttons.slice(0, 24);
      }

      const seenIds = new Set();
      let nextAvailableId = 0;
      for (let bIdx = 0; bIdx < page.buttons.length; bIdx++) {
        while (seenIds.has(nextAvailableId)) {
          nextAvailableId++;
        }
        const rawBtn = page.buttons[bIdx];
        const validation = validateButton(rawBtn, { repair: true, defaultId: nextAvailableId });
        const btn = validation.button;
        if (seenIds.has(btn.id)) {
          btn.id = nextAvailableId;
        }
        seenIds.add(btn.id);
        page.buttons[bIdx] = btn;
      }
    }
  }

  return config;
}

/**
 * Atomically save configuration via temp file and rename.
 */
function saveConfigAtomic(configPath = DEFAULT_CONFIG_PATH, configData) {
  const resolvedConfigPath = resolveWorkingDir(configPath);
  const dir = path.dirname(resolvedConfigPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.profiles.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);

  if (configData && typeof configData === 'object' && !Array.isArray(configData)) {
    if (typeof configData.schemaVersion !== 'number') {
      configData.schemaVersion = 1;
    }
  }

  const serialized = JSON.stringify(configData, null, 2);
  fs.writeFileSync(tmpPath, serialized, 'utf-8');
  fs.renameSync(tmpPath, resolvedConfigPath);
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_EXAMPLE_PATH,
  resolveWorkingDir,
  validateButton,
  loadConfig,
  saveConfigAtomic
};
