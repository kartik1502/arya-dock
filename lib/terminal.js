const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { resolveWorkingDir } = require('./config');

let cachedShell = null;
let cachedTerminal = null;

/**
 * Automatically detect user default shell once.
 */
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

function getDefaultShell() {
  if (!cachedShell) {
    cachedShell = detectShell();
  }
  return cachedShell;
}

/**
 * Scan PATH to find executable without blocking repeatedly.
 */
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

/**
 * Automatically detect installed terminal emulator once.
 */
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

function getDefaultTerminal() {
  if (!cachedTerminal) {
    cachedTerminal = detectTerminal();
  }
  return cachedTerminal;
}

/**
 * Safely quote a string for POSIX shell single quotes: 'foo'\''bar'
 */
function quoteForShell(str) {
  if (!str) return "''";
  return "'" + String(str).replace(/'/g, "'\\''") + "'";
}

/**
 * Pure function: build execution command specification { bin, args, options, innerScript, mediaFallback }
 * Handles specific CLI flags for all supported terminal emulators.
 */
function buildActionCommand(button, overrides = {}) {
  if (!button || !button.actionType) return null;

  const defaultShell = overrides.shell || getDefaultShell();
  const shellName = path.basename(defaultShell);
  const detectedTerm = overrides.terminal || getDefaultTerminal();
  const resolvedDir = resolveWorkingDir(button.workingDir);
  const safeTitle = button.label || 'Arya Dock';

  const commonEnv = {
    ...process.env,
    DISABLE_UPDATE_PROMPT: 'true',
    POWERLEVEL9K_INSTANT_PROMPT: 'quiet'
  };

  const hasDir = resolvedDir && (overrides.ignoreDirExists || fs.existsSync(resolvedDir));
  const spawnOpts = {
    cwd: hasDir ? resolvedDir : undefined,
    env: commonEnv,
    detached: true,
    stdio: 'ignore'
  };

  switch (button.actionType) {
    case 'shell': {
      const mode = button.terminalMode || 'background';
      const cmd = (button.command || '').trim();
      const isPureShellLaunch = !cmd || ['bash', 'zsh', 'sh', '$shell', 'shell', 'terminal'].includes(cmd.toLowerCase());

      if (mode === 'background') {
        const shellArgs = isPureShellLaunch ? ['-i', '-l'] : ['-i', '-l', '-c', cmd];
        return {
          bin: defaultShell,
          args: shellArgs,
          options: spawnOpts
        };
      }

      // Terminal modes (tab, window, existing)
      let innerScript = '';
      if (isPureShellLaunch) {
        innerScript = `exec ${quoteForShell(defaultShell)} -l`;
      } else {
        innerScript = cmd;
        if (button.keepOpen !== false) {
          innerScript += `; echo ""; echo -e "\\033[1;34m[Arya Dock]\\033[0m Command completed. Session interactive (${shellName})."; exec ${quoteForShell(defaultShell)} -l`;
        }
      }

      const termName = (detectedTerm.name || '').toLowerCase();
      const bin = detectedTerm.path || detectedTerm.name || 'xterm';
      const terminalArgs = [];

      if (termName === 'ptyxis') {
        if (mode === 'tab') terminalArgs.push('--tab');
        else if (mode === 'window') terminalArgs.push('--new-window');
        if (hasDir) terminalArgs.push('-d', resolvedDir);
        terminalArgs.push('-T', safeTitle, '--', defaultShell, '-i', '-l', '-c', innerScript);
      } else if (termName === 'gnome-terminal') {
        if (mode === 'tab') terminalArgs.push('--tab');
        else if (mode === 'window') terminalArgs.push('--window');
        terminalArgs.push(`--title=${safeTitle}`);
        if (hasDir) terminalArgs.push(`--working-directory=${resolvedDir}`);
        terminalArgs.push('--', defaultShell, '-i', '-l', '-c', innerScript);
      } else if (termName === 'konsole') {
        if (mode === 'tab') terminalArgs.push('--new-tab');
        if (hasDir) terminalArgs.push('--workdir', resolvedDir);
        terminalArgs.push('-e', defaultShell, '-i', '-l', '-c', innerScript);
      } else if (termName === 'alacritty') {
        terminalArgs.push('--title', safeTitle);
        if (hasDir) terminalArgs.push('--working-directory', resolvedDir);
        terminalArgs.push('-e', defaultShell, '-i', '-l', '-c', innerScript);
      } else if (termName === 'kitty') {
        terminalArgs.push('-T', safeTitle);
        if (hasDir) terminalArgs.push('--directory', resolvedDir);
        terminalArgs.push(defaultShell, '-i', '-l', '-c', innerScript);
      } else if (termName === 'wezterm') {
        terminalArgs.push('start');
        if (hasDir) terminalArgs.push('--cwd', resolvedDir);
        terminalArgs.push('--', defaultShell, '-i', '-l', '-c', innerScript);
      } else if (termName === 'xfce4-terminal') {
        if (mode === 'tab') terminalArgs.push('--tab');
        else if (mode === 'window') terminalArgs.push('--window');
        terminalArgs.push(`--title=${safeTitle}`);
        if (hasDir) terminalArgs.push(`--working-directory=${resolvedDir}`);
        terminalArgs.push('-x', defaultShell, '-i', '-l', '-c', innerScript);
      } else if (termName === 'foot') {
        terminalArgs.push('-T', safeTitle);
        if (hasDir) terminalArgs.push('-D', resolvedDir);
        terminalArgs.push(defaultShell, '-i', '-l', '-c', innerScript);
      } else if (termName === 'xterm') {
        terminalArgs.push('-T', safeTitle);
        terminalArgs.push('-e', defaultShell, '-i', '-l', '-c', innerScript);
      } else {
        // Generic fallback for any other terminal emulator
        terminalArgs.push('-T', safeTitle);
        terminalArgs.push('-e', defaultShell, '-i', '-l', '-c', innerScript);
      }

      return {
        bin,
        args: terminalArgs,
        options: spawnOpts,
        innerScript,
        rawCommand: isPureShellLaunch ? '' : cmd
      };
    }

    case 'media': {
      const action = button.mediaAction;
      const mediaCommands = {
        play_pause: ['playerctl', ['play-pause']],
        next: ['playerctl', ['next']],
        prev: ['playerctl', ['previous']],
        vol_up: ['wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%+']],
        vol_down: ['wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%-']],
        mute: ['wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle']]
      };

      if (action && mediaCommands[action]) {
        return {
          bin: mediaCommands[action][0],
          args: mediaCommands[action][1],
          options: { stdio: 'ignore', detached: true },
          mediaFallback: action
        };
      } else if (button.command) {
        return {
          bin: defaultShell,
          args: ['-i', '-l', '-c', button.command],
          options: spawnOpts
        };
      }
      return null;
    }

    case 'url': {
      if (!button.url) return null;
      try {
        const parsed = new URL(button.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          console.error(`[Arya Dock] Rejected URL with unsafe protocol: ${parsed.protocol}`);
          return null;
        }
        const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
        return {
          bin: opener,
          args: [parsed.href],
          options: { stdio: 'ignore', detached: true }
        };
      } catch (err) {
        console.error(`[Arya Dock] Invalid URL dispatch attempt: ${button.url}`);
        return null;
      }
    }

    default:
      return null;
  }
}

/**
 * Execute an action using spawn with argument arrays for safe execution.
 */
function executeAction(button) {
  if (!button || !button.actionType) return;

  const defaultShell = getDefaultShell();
  const shellName = path.basename(defaultShell);
  const resolvedDir = resolveWorkingDir(button.workingDir);
  console.log(`[Arya Dock] Triggered Button [${button.id}] '${button.label}': ${button.actionType} (${button.terminalMode || 'background'})${resolvedDir ? ` in ${resolvedDir}` : ''} via ${shellName}`);

  const actionCmd = buildActionCommand(button);
  if (!actionCmd || !actionCmd.bin) return;

  try {
    const child = spawn(actionCmd.bin, actionCmd.args, actionCmd.options);
    child.on('error', (err) => {
      console.error(`[Execution Error] ${err.message}`);
      if (actionCmd.rawCommand) {
        console.warn('[Arya Dock] Attempting fallback to background shell');
        const fallback = spawn(defaultShell, ['-i', '-l', '-c', actionCmd.rawCommand], actionCmd.options);
        fallback.on('error', (e) => console.error(`[Fallback Spawn Error] ${e.message}`));
        fallback.unref();
      } else if (actionCmd.mediaFallback) {
        const action = actionCmd.mediaFallback;
        const fallbackCmd = action === 'vol_up' ? ['set-sink-volume', '@DEFAULT_SINK@', '+5%']
                          : action === 'vol_down' ? ['set-sink-volume', '@DEFAULT_SINK@', '-5%']
                          : ['set-sink-mute', '@DEFAULT_SINK@', 'toggle'];
        const fb = spawn('pactl', fallbackCmd, { stdio: 'ignore', detached: true });
        fb.on('error', (e) => console.error(`[Media pactl Error] ${e.message}`));
        fb.unref();
      }
    });
    child.unref();
  } catch (err) {
    console.error(`[Terminal Spawn Exception] ${err.message}`);
  }
}

module.exports = {
  getDefaultShell,
  getDefaultTerminal,
  quoteForShell,
  buildActionCommand,
  executeAction
};
