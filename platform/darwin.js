'use strict';

const path = require('path');
const os = require('os');

module.exports = {
  name: 'darwin',
  isSupported: true,

  getDefaultShell() {
    return process.env.SHELL || '/bin/zsh';
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
