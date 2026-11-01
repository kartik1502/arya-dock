const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
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
 * Pure function: build shell / terminal command string representation.
 */
function buildTerminalCommand(command = '', mode = 'background', title = 'Arya Dock', workingDir = '', keepOpen = true) {
  const defaultShell = getDefaultShell();
  const shellName = path.basename(defaultShell);
  const detectedTerm = getDefaultTerminal();
  const resolvedDir = resolveWorkingDir(workingDir);

  const cmd = (command || '').trim();
  const isPureShellLaunch = !cmd || ['bash', 'zsh', 'sh', '$shell', 'shell', 'terminal'].includes(cmd.toLowerCase());

  if (mode === 'background' || !mode) {
    if (isPureShellLaunch) return command;
    const cdCmd = resolvedDir ? `cd ${quoteForShell(resolvedDir)} && ` : '';
    const script = `${cdCmd}${cmd}`;
    return `env POWERLEVEL9K_INSTANT_PROMPT=quiet DISABLE_UPDATE_PROMPT=true "${defaultShell}" -i -l -c ${quoteForShell(script)}`;
  }

  let innerScript = '';
  const cdPrefix = resolvedDir ? `cd ${quoteForShell(resolvedDir)} && ` : '';

  if (isPureShellLaunch) {
    innerScript = resolvedDir ? `cd ${quoteForShell(resolvedDir)} && exec "${defaultShell}" -l` : `exec "${defaultShell}" -l`;
  } else {
    innerScript = `${cdPrefix}${cmd}`;
    if (keepOpen) {
      innerScript += `; echo ""; echo -e "\\033[1;34m[Arya Dock]\\033[0m Command completed. Session interactive (${shellName})."; exec "${defaultShell}" -l`;
    }
  }

  const quotedTitle = quoteForShell(title || 'Arya Dock');
  const ptyxisDir = resolvedDir ? `-d ${quoteForShell(resolvedDir)}` : '';
  const gnomeDir = resolvedDir ? `--working-directory=${quoteForShell(resolvedDir)}` : '';
  const konsoleDir = resolvedDir ? `--workdir ${quoteForShell(resolvedDir)}` : '';
  const genericDir = resolvedDir ? `--working-directory ${quoteForShell(resolvedDir)}` : '';

  const shellCommand = `env POWERLEVEL9K_INSTANT_PROMPT=quiet DISABLE_UPDATE_PROMPT=true "${defaultShell}" -i -l -c ${quoteForShell(innerScript)}`;

  if (mode === 'tab') {
    if (detectedTerm.name === 'ptyxis') {
      return `ptyxis --tab ${ptyxisDir} -T ${quotedTitle} -- ${shellCommand}`;
    } else if (detectedTerm.name === 'gnome-terminal') {
      return `gnome-terminal --tab --title=${quotedTitle} ${gnomeDir} -- ${shellCommand}`;
    } else if (detectedTerm.name === 'konsole') {
      return `konsole --new-tab ${konsoleDir} -e ${shellCommand}`;
    } else {
      return `ptyxis --tab ${ptyxisDir} -T ${quotedTitle} -- ${shellCommand} || ` +
             `gnome-terminal --tab --title=${quotedTitle} ${gnomeDir} -- ${shellCommand}`;
    }
  } else if (mode === 'window') {
    if (detectedTerm.name === 'ptyxis') {
      return `ptyxis --new-window ${ptyxisDir} -T ${quotedTitle} -- ${shellCommand}`;
    } else if (detectedTerm.name === 'gnome-terminal') {
      return `gnome-terminal --title=${quotedTitle} ${gnomeDir} -- ${shellCommand}`;
    } else if (detectedTerm.name === 'alacritty') {
      return `alacritty --title ${quotedTitle} ${genericDir} -e ${shellCommand}`;
    } else if (detectedTerm.name === 'kitty') {
      return `kitty --title ${quotedTitle} ${resolvedDir ? `--directory ${quoteForShell(resolvedDir)}` : ''} ${shellCommand}`;
    } else if (detectedTerm.name === 'konsole') {
      return `konsole ${konsoleDir} -e ${shellCommand}`;
    } else {
      return `ptyxis --new-window ${ptyxisDir} -T ${quotedTitle} -- ${shellCommand} || ` +
             `gnome-terminal --title=${quotedTitle} ${gnomeDir} -- ${shellCommand}`;
    }
  } else if (mode === 'existing') {
    return `ptyxis ${ptyxisDir} -T ${quotedTitle} -- ${shellCommand} || ` +
           `gnome-terminal --title=${quotedTitle} ${gnomeDir} -- ${shellCommand}`;
  }

  return command;
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

  const commonEnv = {
    ...process.env,
    DISABLE_UPDATE_PROMPT: 'true',
    POWERLEVEL9K_INSTANT_PROMPT: 'quiet'
  };

  const spawnOpts = {
    cwd: (resolvedDir && fs.existsSync(resolvedDir)) ? resolvedDir : undefined,
    env: commonEnv,
    detached: true,
    stdio: 'ignore'
  };

  switch (button.actionType) {
    case 'shell': {
      const mode = button.terminalMode || 'background';
      const cmd = (button.command || '').trim();
      const detectedTerm = getDefaultTerminal();
      const safeTitle = (button.label || 'Arya Dock');
      const isPureShellLaunch = !cmd || ['bash', 'zsh', 'sh', '$shell', 'shell', 'terminal'].includes(cmd.toLowerCase());

      if (mode === 'background') {
        const shellArgs = isPureShellLaunch ? ['-i', '-l'] : ['-i', '-l', '-c', cmd];
        const child = spawn(defaultShell, shellArgs, spawnOpts);
        child.on('error', (err) => console.error(`[Shell Background Error] ${err.message}`));
        child.unref();
      } else {
        let innerScript = '';
        if (isPureShellLaunch) {
          innerScript = `exec "${defaultShell}" -l`;
        } else {
          innerScript = cmd;
          if (button.keepOpen !== false) {
            innerScript += `; echo ""; echo -e "\\033[1;34m[Arya Dock]\\033[0m Command completed. Session interactive (${shellName})."; exec "${defaultShell}" -l`;
          }
        }

        const terminalArgs = [];
        if (detectedTerm.name === 'ptyxis') {
          if (mode === 'tab') terminalArgs.push('--tab');
          else if (mode === 'window') terminalArgs.push('--new-window');
          if (resolvedDir && fs.existsSync(resolvedDir)) {
            terminalArgs.push('-d', resolvedDir);
          }
          terminalArgs.push('-T', safeTitle, '--', defaultShell, '-i', '-l', '-c', innerScript);
        } else if (detectedTerm.name === 'gnome-terminal') {
          if (mode === 'tab') terminalArgs.push('--tab');
          else if (mode === 'window') terminalArgs.push('--window');
          terminalArgs.push(`--title=${safeTitle}`);
          if (resolvedDir && fs.existsSync(resolvedDir)) {
            terminalArgs.push(`--working-directory=${resolvedDir}`);
          }
          terminalArgs.push('--', defaultShell, '-i', '-l', '-c', innerScript);
        } else if (detectedTerm.name === 'alacritty') {
          terminalArgs.push('--title', safeTitle);
          if (resolvedDir && fs.existsSync(resolvedDir)) {
            terminalArgs.push('--working-directory', resolvedDir);
          }
          terminalArgs.push('-e', defaultShell, '-i', '-l', '-c', innerScript);
        } else if (detectedTerm.name === 'konsole') {
          if (mode === 'tab') terminalArgs.push('--new-tab');
          if (resolvedDir && fs.existsSync(resolvedDir)) {
            terminalArgs.push('--workdir', resolvedDir);
          }
          terminalArgs.push('-e', defaultShell, '-i', '-l', '-c', innerScript);
        } else {
          // Generic terminal fallback
          terminalArgs.push('-T', safeTitle, '--', defaultShell, '-i', '-l', '-c', innerScript);
        }

        try {
          const child = spawn(detectedTerm.path || detectedTerm.name, terminalArgs, spawnOpts);
          child.on('error', (err) => {
            console.error(`[Terminal Spawn Error] ${err.message}. Trying shell fallback.`);
            const fallback = spawn(defaultShell, ['-i', '-l', '-c', innerScript], spawnOpts);
            fallback.on('error', (e) => console.error(`[Fallback Spawn Error] ${e.message}`));
            fallback.unref();
          });
          child.unref();
        } catch (err) {
          console.error(`[Terminal Spawn Exception] ${err.message}`);
        }
      }
      break;
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
        const [bin, args] = mediaCommands[action];
        const child = spawn(bin, args, { stdio: 'ignore', detached: true });
        child.on('error', () => {
          // Fallback to pactl if wpctl failed
          const fallbackCmd = action === 'vol_up' ? ['set-sink-volume', '@DEFAULT_SINK@', '+5%']
                            : action === 'vol_down' ? ['set-sink-volume', '@DEFAULT_SINK@', '-5%']
                            : ['set-sink-mute', '@DEFAULT_SINK@', 'toggle'];
          const fb = spawn('pactl', fallbackCmd, { stdio: 'ignore', detached: true });
          fb.on('error', (e) => console.error(`[Media pactl Error] ${e.message}`));
          fb.unref();
        });
        child.unref();
      } else if (button.command) {
        const child = spawn(defaultShell, ['-i', '-l', '-c', button.command], spawnOpts);
        child.on('error', (err) => console.error(`[Media Command Error] ${err.message}`));
        child.unref();
      }
      break;
    }

    case 'url': {
      if (!button.url) return;
      try {
        const parsed = new URL(button.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          console.error(`[Arya Dock] Rejected URL with unsafe protocol: ${parsed.protocol}`);
          return;
        }
        const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
        const child = spawn(opener, [parsed.href], { stdio: 'ignore', detached: true });
        child.on('error', (err) => console.error(`[URL Launch Error] ${err.message}`));
        child.unref();
      } catch (err) {
        console.error(`[Arya Dock] Invalid URL dispatch attempt: ${button.url}`);
      }
      break;
    }

    default:
      console.log(`[Arya Dock] Unhandled action type: ${button.actionType}`);
  }
}

module.exports = {
  getDefaultShell,
  getDefaultTerminal,
  quoteForShell,
  buildTerminalCommand,
  executeAction
};
