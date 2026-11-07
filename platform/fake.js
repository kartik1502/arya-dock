'use strict';

function createFakeAdapter(overrides = {}) {
  const calls = {
    getMediaCommand: [],
    getUrlCommand: [],
    getApplicationDirectories: [],
    getDefaultShell: [],
    getDefaultTerminal: []
  };

  return {
    name: 'fake',
    isSupported: true,
    calls,

    getDefaultShell() {
      calls.getDefaultShell.push(Date.now());
      return overrides.shell || '/bin/fake-sh';
    },

    getDefaultTerminal() {
      calls.getDefaultTerminal.push(Date.now());
      return overrides.terminal || { name: 'fake-terminal', path: '/usr/bin/fake-terminal' };
    },

    getMediaCommand(action) {
      calls.getMediaCommand.push(action);
      if (overrides.getMediaCommand) return overrides.getMediaCommand(action);
      return {
        bin: 'fake-media-bin',
        args: [action],
        options: { stdio: 'ignore', detached: true },
        mediaFallback: action
      };
    },

    getMediaFallbackCommand(action) {
      calls.getMediaFallbackCommand = calls.getMediaFallbackCommand || [];
      calls.getMediaFallbackCommand.push(action);
      if (overrides.getMediaFallbackCommand) return overrides.getMediaFallbackCommand(action);
      return null;
    },

    getUrlCommand(url) {
      calls.getUrlCommand.push(url);
      if (overrides.getUrlCommand) return overrides.getUrlCommand(url);
      return {
        bin: 'fake-browser-bin',
        args: [url],
        options: { stdio: 'ignore', detached: true }
      };
    },

    getApplicationDirectories() {
      calls.getApplicationDirectories.push(Date.now());
      return overrides.applicationDirectories || ['/fake/applications'];
    },

    capabilities() {
      return {
        activeWindow: false,
        media: true,
        applications: true,
        ...(overrides.capabilities || {})
      };
    },

    getActiveWindow() {
      return overrides.activeWindow || { app: 'fake-app', wmClass: 'fake-class' };
    }
  };
}

const defaultFake = createFakeAdapter();
defaultFake.createFakeAdapter = createFakeAdapter;

module.exports = defaultFake;
