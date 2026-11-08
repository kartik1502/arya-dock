'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

let cachedShell = null;
let cachedTerminal = null;

function detectShell() {
  const envShell = process.env.SHELL;
  if (envShell && typeof envShell === 'string' && path.isAbsolute(envShell) && /^[\w./-]+$/.test(envShell) && !envShell.includes('..')) {
    try {
      if (fs.existsSync(envShell)) return envShell;
    } catch (e) {}
  }
  try {
    const userShell = os.userInfo().shell;
    if (userShell && typeof userShell === 'string' && path.isAbsolute(userShell) && /^[\w./-]+$/.test(userShell) && !userShell.includes('..')) {
      if (fs.existsSync(userShell)) return userShell;
    }
  } catch (e) {}
  if (fs.existsSync('/usr/bin/zsh')) return '/usr/bin/zsh';
  if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
  if (fs.existsSync('/bin/bash')) return '/bin/bash';
  return '/bin/sh';
}

function findInPath(binName) {
  if (!binName || typeof binName !== 'string' || !/^[\w.-]+$/.test(binName)) return null;
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir || !path.isAbsolute(dir) || dir.includes('..')) continue;
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
  const envTerm = process.env.TERMINAL;
  if (envTerm && typeof envTerm === 'string' && /^[\w./-]+$/.test(envTerm) && !envTerm.includes('..')) {
    const base = path.basename(envTerm).toLowerCase();
    if (!['sh', 'bash', 'zsh', 'dash', 'csh', 'tcsh', 'fish'].includes(base)) {
      const resolved = findInPath(envTerm) || (path.isAbsolute(envTerm) && fs.existsSync(envTerm) ? envTerm : null);
      if (resolved) {
        return { name: path.basename(resolved), path: resolved };
      }
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
    const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    const hasTool = Boolean(findInPath('busctl') || findInPath('xprop'));
    return {
      activeWindow: hasDisplay && hasTool,
      media: true,
      applications: true
    };
  },

  getActiveWindow() {
    return getActiveWindow();
  },

  createActiveWindowStream(onChange, onError) {
    return createActiveWindowStream(onChange, onError);
  }
};

function getActiveWindowWayland() {
  return new Promise((resolve) => {
    const busctlBin = findInPath('busctl');
    if (!busctlBin) return resolve(null);

    execFile(busctlBin, [
      '--user',
      '--json=short',
      'call',
      'org.gnome.Shell.Introspect',
      '/org/gnome/Shell/Introspect',
      'org.gnome.Shell.Introspect',
      'GetWindows'
    ], { timeout: 400, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      try {
        const parsed = JSON.parse(stdout);
        const windows = parsed?.data?.[0];
        if (!windows || typeof windows !== 'object') return resolve(null);

        for (const winId of Object.keys(windows)) {
          const props = windows[winId];
          if (props?.['has-focus']?.data === true) {
            const rawAppId = props['app-id']?.data || props['wm-class']?.data || null;
            const wmClass = props['wm-class']?.data || undefined;
            if (rawAppId) {
              return resolve({ appId: rawAppId, wmClass });
            }
          }
        }
        return resolve(null);
      } catch (e) {
        return resolve(null);
      }
    });
  });
}

function getActiveWindowX11() {
  return new Promise((resolve) => {
    const xpropBin = findInPath('xprop');
    if (!xpropBin) return resolve(null);

    execFile(xpropBin, ['-root', '32x', '\t$0', '_NET_ACTIVE_WINDOW'], { timeout: 400 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const winMatch = stdout.match(/_NET_ACTIVE_WINDOW\s+0x([0-9a-fA-F]+)/);
      if (!winMatch || parseInt(winMatch[1], 16) === 0) {
        return resolve(null);
      }
      const winId = '0x' + winMatch[1];
      if (!/^0x[0-9a-fA-F]+$/.test(winId)) {
        return resolve(null);
      }

      execFile(xpropBin, ['-id', winId, 'WM_CLASS'], { timeout: 400 }, (clsErr, clsStdout) => {
        if (clsErr || !clsStdout) return resolve(null);
        const clsMatch = clsStdout.match(/WM_CLASS\(STRING\)\s*=\s*"([^"]+)",\s*"([^"]+)"/);
        if (clsMatch) {
          const wmClass = clsMatch[2] || clsMatch[1];
          return resolve({ appId: wmClass, wmClass });
        }
        return resolve(null);
      });
    });
  });
}

async function getActiveWindow() {
  const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  const isWayland = sessionType === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY);

  if (isWayland) {
    const waylandApp = await getActiveWindowWayland();
    if (waylandApp) return waylandApp;
  }
  return await getActiveWindowX11();
}

function createActiveWindowStream(onChange, onError) {
  let stopped = false;
  let pollTimer = null;
  let xpropProcess = null;
  let debounceTimer = null;
  let isQueryRunning = false;
  let consecutiveFailures = 0;
  let lastEmittedAppId = null;

  const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  const isWayland = sessionType === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY);
  const xpropBin = findInPath('xprop');

  // If X11 display is available and not pure Wayland, try persistent xprop -spy stream
  if (!isWayland && xpropBin && process.env.DISPLAY) {
    try {
      xpropProcess = spawn(xpropBin, ['-spy', '-root', '_NET_ACTIVE_WINDOW'], {
        stdio: ['ignore', 'pipe', 'ignore']
      });

      let buffer = '';
      xpropProcess.stdout.on('data', (chunk) => {
        if (stopped) return;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const match = line.match(/_NET_ACTIVE_WINDOW(?:\(WINDOW\))?\s*[:=]\s*(?:window id #\s*)?0x([0-9a-fA-F]+)/i);
          if (match && parseInt(match[1], 16) !== 0) {
            const winId = '0x' + match[1];
            if (!/^0x[0-9a-fA-F]+$/.test(winId)) continue;

            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              if (stopped) return;
              execFile(xpropBin, ['-id', winId, 'WM_CLASS'], { timeout: 300 }, (clsErr, clsStdout) => {
                if (stopped || clsErr || !clsStdout) return;
                const clsMatch = clsStdout.match(/WM_CLASS\(STRING\)\s*=\s*"([^"]+)",\s*"([^"]+)"/);
                if (clsMatch) {
                  const wmClass = clsMatch[2] || clsMatch[1];
                  if (wmClass && wmClass !== lastEmittedAppId) {
                    lastEmittedAppId = wmClass;
                    onChange(wmClass);
                  }
                }
              });
            }, 150);
          }
        }
      });

      xpropProcess.on('error', (err) => {
        if (!stopped && typeof onError === 'function') onError(err);
      });

      xpropProcess.on('exit', () => {
        xpropProcess = null;
      });

      return {
        stop() {
          stopped = true;
          if (debounceTimer) clearTimeout(debounceTimer);
          if (xpropProcess) {
            try { xpropProcess.kill('SIGKILL'); } catch (e) {}
            xpropProcess = null;
          }
        }
      };
    } catch (e) {
      // Fall through to polling
    }
  }

  // Polling loop (Wayland or X11 fallback)
  const poll = async () => {
    if (stopped) return;
    if (isQueryRunning) {
      pollTimer = setTimeout(poll, 250);
      return;
    }

    isQueryRunning = true;
    try {
      const res = await getActiveWindow();
      consecutiveFailures = 0;
      if (!stopped && res?.appId && res.appId !== lastEmittedAppId) {
        lastEmittedAppId = res.appId;
        onChange(res.appId);
      }
    } catch (err) {
      consecutiveFailures++;
      if (typeof onError === 'function') onError(err);
    } finally {
      isQueryRunning = false;
      if (!stopped) {
        const interval = consecutiveFailures >= 3 ? 5000 : 500;
        pollTimer = setTimeout(poll, interval);
      }
    }
  };

  poll();

  return {
    stop() {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollTimer) clearTimeout(pollTimer);
    }
  };
}
