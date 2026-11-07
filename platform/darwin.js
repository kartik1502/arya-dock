'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
  name: 'darwin',
  isSupported: true,

  getDefaultShell() {
    const envShell = process.env.SHELL;
    if (envShell && typeof envShell === 'string' && path.isAbsolute(envShell) && /^[\w./-]+$/.test(envShell) && !envShell.includes('..')) {
      try {
        if (fs.existsSync(envShell)) return envShell;
      } catch (e) {}
    }
    return '/bin/zsh';
  },

  getDefaultTerminal() {
    return {
      name: 'Terminal',
      path: '/System/Applications/Utilities/Terminal.app'
    };
  },

  getMediaCommand(/* action */) {
    return null;
  },

  getMediaFallbackCommand(/* action */) {
    return null;
  },

  getUrlCommand(url) {
    return {
      bin: 'open',
      args: [url],
      options: { stdio: 'ignore', detached: true }
    };
  },

  getApplicationDirectories() {
    const home = process.env.HOME || os.homedir();
    return [
      '/Applications',
      path.join(home, 'Applications'),
      '/System/Applications'
    ];
  },

  capabilities() {
    return {
      activeWindow: false,
      media: false,
      applications: true
    };
  },

  getActiveWindow() {
    return null;
  }
};
