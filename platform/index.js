'use strict';

const linux = require('./linux');
const darwin = require('./darwin');
const fake = require('./fake');

const ADAPTERS = {
  linux,
  darwin,
  fake
};

function createDegradedAdapter(name, warningMessage) {
  return {
    name: String(name),
    isSupported: false,
    statusMessage: warningMessage,
    getDefaultShell() {
      return '/bin/sh';
    },
    getDefaultTerminal() {
      return { name: 'unsupported', path: '/bin/sh' };
    },
    getMediaCommand() {
      return null;
    },
    getMediaFallbackCommand() {
      return null;
    },
    getUrlCommand() {
      return null;
    },
    getApplicationDirectories() {
      return [];
    },
    capabilities() {
      return {
        activeWindow: false,
        media: false,
        applications: false
      };
    },
    getActiveWindow() {
      return null;
    }
  };
}

let activePlatform = null;

function getPlatform(name, options = {}) {
  if (name && typeof name === 'object' && name.name && typeof name.getDefaultShell === 'function') {
    return name;
  }

  const platformName = name !== undefined ? name : (process.env.ARYA_PLATFORM || process.platform);
  const key = String(platformName || '').toLowerCase();

  if (ADAPTERS[key]) {
    return ADAPTERS[key];
  }

  const warningMsg = `[Arya Dock] Warning: Selected platform '${platformName}' is not supported. Platform-specific features (media controls, desktop app indexing, active window tracking) will be disabled.`;
  if (!options.silent) {
    if (typeof options.logger === 'function') {
      options.logger(warningMsg);
    } else {
      console.warn(warningMsg);
    }
  }

  return createDegradedAdapter(platformName, warningMsg);
}

function setPlatform(platform, options = {}) {
  activePlatform = getPlatform(platform, options);
  return activePlatform;
}

function getActivePlatform() {
  if (!activePlatform) {
    activePlatform = getPlatform(undefined, { silent: false });
  }
  return activePlatform;
}

function resetPlatform() {
  activePlatform = null;
}

module.exports = {
  getPlatform,
  setPlatform,
  getActivePlatform,
  resetPlatform,
  createDegradedAdapter,
  adapters: ADAPTERS
};
