'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let cachedShell = null;
let cachedTerminal = null;

function detectShell() {
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) {
    return process.env.SHELL;
  }
  try {
    const userShell = os.userInfo().shell;
    if (userShell && fs.existsSync(userShell)) return userShell;
  } catch (e) {}
  if (fs.existsSync('/usr/bin/zsh')) return '/usr/bin/zsh';
  if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
  if (fs.existsSync('/bin/bash')) return '/bin/bash';
  return '/bin/sh';
}

function findInPath(binName) {
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const full = path.join(dir, binName);
    try {
      if (fs.existsSync(full)) {
        const stat = fs.statSync(full);
        if (stat.isFile() && (stat.mode & 0o111)) {
          return full;
        }
      }
    } catch (e) {}
  }
  return null;
}

function detectTerminal() {
  if (process.env.TERMINAL) {
    const resolved = findInPath(process.env.TERMINAL) || (fs.existsSync(process.env.TERMINAL) ? process.env.TERMINAL : null);
    if (resolved) {
      return { name: path.basename(resolved), path: resolved };
    }
  }

  const candidates = [
    'ptyxis',
    'gnome-terminal',
    'konsole',
    'xfce4-terminal',
    'alacritty',
    'kitty',
    'foot',
    'wezterm',
    'x-terminal-emulator',
    'xterm'
  ];

  for (const term of candidates) {
    const found = findInPath(term);
    if (found) {
      return { name: term, path: found };
    }
  }

  return { name: 'ptyxis', path: '/usr/bin/ptyxis' };
}

const mediaCommands = {
  play_pause: ['playerctl', ['play-pause']],
  next: ['playerctl', ['next']],
  prev: ['playerctl', ['previous']],
  vol_up: ['wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%+']],
  vol_down: ['wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%-']],
  mute: ['wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle']]
};

module.exports = {
  name: 'linux',
  isSupported: true,

  getDefaultShell() {
    if (!cachedShell) {
      cachedShell = detectShell();
    }
    return cachedShell;
  },

  getDefaultTerminal() {
    if (!cachedTerminal) {
      cachedTerminal = detectTerminal();
    }
    return cachedTerminal;
  },

  getMediaCommand(action) {
    if (action && Object.prototype.hasOwnProperty.call(mediaCommands, action)) {
      return {
        bin: mediaCommands[action][0],
        args: mediaCommands[action][1],
        options: { stdio: 'ignore', detached: true },
        mediaFallback: action
      };
    }
    return null;
  },

  getMediaFallbackCommand(action) {
    if (action === 'vol_up' || action === 'vol_down' || action === 'mute') {
      const fallbackArgs = action === 'vol_up' ? ['set-sink-volume', '@DEFAULT_SINK@', '+5%']
                         : action === 'vol_down' ? ['set-sink-volume', '@DEFAULT_SINK@', '-5%']
                         : ['set-sink-mute', '@DEFAULT_SINK@', 'toggle'];
      return {
        bin: 'pactl',
        args: fallbackArgs,
        options: { stdio: 'ignore', detached: true }
      };
    }
    return null;
  },

  getUrlCommand(url) {
    return {
      bin: 'xdg-open',
      args: [url],
      options: { stdio: 'ignore', detached: true }
    };
  },

  getApplicationDirectories() {
    const home = process.env.HOME || os.homedir();
    return [
      '/usr/share/applications',
      '/usr/local/share/applications',
      path.join(home, '.local/share/applications'),
      '/var/lib/flatpak/exports/share/applications',
      path.join(home, '.local/share/flatpak/exports/share/applications')
    ];
  },

  capabilities() {
    return {
      activeWindow: true,
      media: true,
      applications: true
    };
  },

  getActiveWindow() {
    return null;
  }
};
