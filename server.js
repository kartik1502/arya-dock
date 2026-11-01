const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn, execSync } = require('child_process');
const WebSocket = require('ws');
const qrcode = require('qrcode-terminal');

const PORT = process.env.PORT || 3333;
const CONFIG_PATH = path.join(__dirname, 'config', 'profiles.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Load configurations
let appConfig = {};
try {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  appConfig = JSON.parse(raw);
} catch (err) {
  console.error('Failed to load profiles.json, using defaults:', err.message);
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(appConfig, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save profiles.json:', err.message);
  }
}

// Find local IPv4 addresses (Wi-Fi, USB Tethering, Ethernet)
function getNetworkInterfaces() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    if (name.startsWith('docker') || name.startsWith('br-') || name.startsWith('veth') || name.startsWith('virbr')) continue;
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        let type = 'LAN / Ethernet';
        const lower = name.toLowerCase();
        if (lower.startsWith('wl')) {
          type = 'Wi-Fi';
        } else if (lower.includes('usb') || lower.includes('rndis') || /^enp\d+s\d+f\d+u\d+/.test(lower) || lower.startsWith('enx')) {
          type = 'USB Cable Tethering';
        } else if (lower.includes('bt') || lower.includes('pan')) {
          type = 'Bluetooth Network';
        }
        results.push({ name, address: net.address, type });
      }
    }
  }
  return results.sort((a, b) => {
    if (a.type.includes('USB')) return -1;
    if (b.type.includes('USB')) return 1;
    if (a.type.includes('Wi-Fi')) return -1;
    if (b.type.includes('Wi-Fi')) return 1;
    return 0;
  });
}

// Map system app categories and names to clean visual emojis
function getAppEmoji(name, category, execCmd) {
  const lower = (name + ' ' + (category || '') + ' ' + execCmd).toLowerCase();
  if (lower.includes('code') || lower.includes('dev') || lower.includes('studio') || lower.includes('git')) return '💻';
  if (lower.includes('term') || lower.includes('bash') || lower.includes('zsh') || lower.includes('shell') || lower.includes('ptyxis')) return '⚡';
  if (lower.includes('chrome') || lower.includes('brave') || lower.includes('firefox') || lower.includes('browser') || lower.includes('web')) return '🌐';
  if (lower.includes('calc')) return '🧮';
  if (lower.includes('file') || lower.includes('nautilus') || lower.includes('folder')) return '📁';
  if (lower.includes('music') || lower.includes('audio') || lower.includes('sound') || lower.includes('player') || lower.includes('spotify')) return '🎵';
  if (lower.includes('video') || lower.includes('camera') || lower.includes('photo') || lower.includes('snapshot')) return '🎥';
  if (lower.includes('monitor') || lower.includes('top') || lower.includes('task') || lower.includes('system') || lower.includes('stats')) return '📊';
  if (lower.includes('clock') || lower.includes('time') || lower.includes('calendar')) return '📅';
  if (lower.includes('setting') || lower.includes('config') || lower.includes('control')) return '⚙️';
  if (lower.includes('text') || lower.includes('note') || lower.includes('doc') || lower.includes('edit')) return '📝';
  if (lower.includes('mail') || lower.includes('email') || lower.includes('message') || lower.includes('chat')) return '💬';
  if (lower.includes('box') || lower.includes('vm') || lower.includes('docker') || lower.includes('virt')) return '📦';
  return '🚀';
}

// Discover and parse installed Linux desktop applications
function getInstalledApplications() {
  const dirs = [
    '/usr/share/applications',
    path.join(process.env.HOME || '', '.local/share/applications')
  ];
  const apps = [];
  const seen = new Set();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.desktop')) continue;
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          if (content.includes('NoDisplay=true') || content.includes('Type=Link')) continue;
          
          const nameMatch = content.match(/^Name=([^\r\n]+)/m);
          const execMatch = content.match(/^Exec=([^\r\n]+)/m);
          const iconMatch = content.match(/^Icon=([^\r\n]+)/m);
          const catMatch = content.match(/^Categories=([^\r\n]+)/m);
          const commentMatch = content.match(/^Comment=([^\r\n]+)/m);

          if (nameMatch && execMatch) {
            const name = nameMatch[1].trim();
            if (seen.has(name)) continue;
            seen.add(name);

            // Clean exec command: remove %u, %U, %f, %F, etc.
            let execCmd = execMatch[1].replace(/%[uUfFdiDknm]/g, '').trim();
            const category = catMatch ? catMatch[1].split(';').filter(Boolean)[0] : 'Utility';
            const iconEmoji = getAppEmoji(name, category, execCmd);

            apps.push({
              id: file.replace('.desktop', ''),
              name,
              command: execCmd,
              iconName: iconMatch ? iconMatch[1].trim() : 'application-x-executable',
              emoji: iconEmoji,
              category,
              comment: commentMatch ? commentMatch[1].trim() : ''
            });
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

// Cached installed apps
let cachedInstalledApps = null;

// Simple Static File HTTP Server
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];

  // API Route: Return list of installed system applications
  if (reqPath === '/api/apps') {
    if (!cachedInstalledApps) {
      cachedInstalledApps = getInstalledApplications();
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(cachedInstalledApps));
    return;
  }

  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

let currentPageIndex = 0;

function getActiveProfile() {
  const pId = appConfig.activeProfile || 'developer';
  return appConfig.profiles[pId] || Object.values(appConfig.profiles)[0];
}

function getCurrentPage() {
  const profile = getActiveProfile();
  if (!profile.pages || profile.pages.length === 0) return { buttons: [] };
  if (currentPageIndex >= profile.pages.length) currentPageIndex = 0;
  if (currentPageIndex < 0) currentPageIndex = profile.pages.length - 1;
  return profile.pages[currentPageIndex];
}

function broadcastState() {
  const profile = getActiveProfile();
  const page = getCurrentPage();
  const payload = JSON.stringify({
    type: 'STATE_UPDATE',
    activeProfileId: appConfig.activeProfile,
    profileName: profile.name,
    pageNumber: currentPageIndex + 1,
    totalPages: profile.pages ? profile.pages.length : 1,
    pageName: page.name || `Page ${currentPageIndex + 1}`,
    buttons: page.buttons || []
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Automatically detect the user's default shell (zsh, bash, etc.)
function getDefaultShell() {
  const envShell = process.env.SHELL;
  if (envShell && fs.existsSync(envShell)) return envShell;
  try {
    const userShell = os.userInfo().shell;
    if (userShell && fs.existsSync(userShell)) return userShell;
  } catch (e) {}
  if (fs.existsSync('/usr/bin/zsh')) return '/usr/bin/zsh';
  if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
  if (fs.existsSync('/bin/bash')) return '/bin/bash';
  return '/bin/sh';
}

// Automatically detect the system's installed default terminal emulator
function getDefaultTerminal() {
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
    try {
      const p = execSync(`which ${term} 2>/dev/null`, { encoding: 'utf-8' }).trim();
      if (p) return { name: term, path: p };
    } catch (e) {}
  }
  return { name: 'ptyxis', path: '/usr/bin/ptyxis' };
}

// Build command wrapper based on target terminal execution mode
function buildTerminalCommand(command = '', mode = 'background', title = 'Arya Dock', workingDir = '', keepOpen = true) {
  const defaultShell = getDefaultShell();
  const shellName = path.basename(defaultShell);
  const detectedTerm = getDefaultTerminal();

  let cmd = (command || '').trim();
  const isPureShellLaunch = !cmd || ['bash', 'zsh', 'sh', '$shell', 'shell', 'terminal'].includes(cmd.toLowerCase());

  if (mode === 'background' || !mode) {
    if (isPureShellLaunch) return command;
    const escaped = cmd.replace(/"/g, '\\"');
    return `env DISABLE_UPDATE_PROMPT=true "${defaultShell}" -i -l -c "${escaped}"`;
  }

  let innerScript = '';
  if (isPureShellLaunch) {
    innerScript = `exec "${defaultShell}" -l`;
  } else {
    innerScript = cmd;
    if (keepOpen) {
      innerScript += `; echo ""; echo -e "\\033[1;34m[Arya Dock]\\033[0m Command completed. Session interactive (${shellName})."; exec "${defaultShell}" -l`;
    }
  }

  const escapedInner = innerScript.replace(/"/g, '\\"');
  const safeTitle = (title || 'Arya Dock').replace(/"/g, '');
  const ptyxisDir = workingDir ? `-d "${workingDir}"` : '';
  const gnomeDir = workingDir ? `--working-directory="${workingDir}"` : '';
  const konsoleDir = workingDir ? `--workdir "${workingDir}"` : '';
  const genericDir = workingDir ? `--working-directory "${workingDir}"` : '';

  // Use interactive login shell (-i -l) with Oh My Zsh update prompt bypass so aliases (e.g. lzd, spr, vus), PATH and functions are fully loaded
  const shellCommand = `env DISABLE_UPDATE_PROMPT=true "${defaultShell}" -i -l -c "${escapedInner}"`;

  if (mode === 'tab') {
    // Open in terminal as a new tab
    if (detectedTerm.name === 'ptyxis') {
      return `ptyxis --tab ${ptyxisDir} -T "${safeTitle}" -- ${shellCommand} || ptyxis ${ptyxisDir} -T "${safeTitle}" -- ${shellCommand}`;
    } else if (detectedTerm.name === 'gnome-terminal') {
      return `gnome-terminal --tab --title="${safeTitle}" ${gnomeDir} -- ${shellCommand}`;
    } else if (detectedTerm.name === 'konsole') {
      return `konsole --new-tab ${konsoleDir} -e ${shellCommand}`;
    } else {
      return `ptyxis --tab ${ptyxisDir} -T "${safeTitle}" -- ${shellCommand} || ` +
             `gnome-terminal --tab --title="${safeTitle}" ${gnomeDir} -- ${shellCommand} || ` +
             `konsole --new-tab ${konsoleDir} -e ${shellCommand} || ` +
             `ptyxis ${ptyxisDir} -T "${safeTitle}" -- ${shellCommand}`;
    }
  } else if (mode === 'window') {
    // Open in new standalone terminal window
    if (detectedTerm.name === 'ptyxis') {
      return `ptyxis --new-window ${ptyxisDir} -T "${safeTitle}" -- ${shellCommand}`;
    } else if (detectedTerm.name === 'gnome-terminal') {
      return `gnome-terminal --title="${safeTitle}" ${gnomeDir} -- ${shellCommand}`;
    } else if (detectedTerm.name === 'alacritty') {
      return `alacritty --title "${safeTitle}" ${genericDir} -e ${shellCommand}`;
    } else if (detectedTerm.name === 'kitty') {
      return `kitty --title "${safeTitle}" ${workingDir ? `--directory "${workingDir}"` : ''} ${shellCommand}`;
    } else if (detectedTerm.name === 'konsole') {
      return `konsole ${konsoleDir} -e ${shellCommand}`;
    } else {
      return `ptyxis --new-window ${ptyxisDir} -T "${safeTitle}" -- ${shellCommand} || ` +
             `gnome-terminal --title="${safeTitle}" ${gnomeDir} -- ${shellCommand} || ` +
             `alacritty --title "${safeTitle}" ${genericDir} -e ${shellCommand} || ` +
             `kitty --title "${safeTitle}" ${shellCommand} || ` +
             `konsole ${konsoleDir} -e ${shellCommand} || ` +
             `xterm -title "${safeTitle}" -e ${shellCommand}`;
    }
  } else if (mode === 'existing') {
    // Run in active / existing terminal
    return `ptyxis ${ptyxisDir} -T "${safeTitle}" -- ${shellCommand} || ` +
           `ptyxis --tab ${ptyxisDir} -T "${safeTitle}" -- ${shellCommand} || ` +
           `gnome-terminal --title="${safeTitle}" ${gnomeDir} -- ${shellCommand}`;
  }

  return command;
}

// Action Dispatcher
function executeAction(button) {
  if (!button || !button.actionType) return;

  const defaultShell = getDefaultShell();
  const shellName = path.basename(defaultShell);
  console.log(`[Arya Dock] Triggered Button [${button.id}] '${button.label}': ${button.actionType} (${button.terminalMode || 'background'}) via ${shellName}`);

  switch (button.actionType) {
    case 'shell': {
      const finalCommand = buildTerminalCommand(
        button.command !== undefined ? button.command : '',
        button.terminalMode || 'background',
        button.label || 'Arya Dock',
        button.workingDir || '',
        button.keepOpen !== false
      );
      const execOptions = {
        env: {
          ...process.env,
          DISABLE_UPDATE_PROMPT: 'true'
        },
        shell: defaultShell
      };
      if (button.workingDir && fs.existsSync(button.workingDir)) {
        execOptions.cwd = button.workingDir;
      }
      exec(finalCommand, execOptions, (error, stdout, stderr) => {
        if (error) console.error(`[Exec Error]: ${error.message}`);
        if (stdout) console.log(`[Exec Output]: ${stdout.trim()}`);
      });
      break;
    }

    case 'media':
      // Media actions via wpctl / pactl / playerctl
      const mediaMap = {
        'play_pause': 'playerctl play-pause || echo "play-pause"',
        'next': 'playerctl next || echo "next"',
        'prev': 'playerctl previous || echo "prev"',
        'vol_up': 'wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+ || pactl set-sink-volume @DEFAULT_SINK@ +5%',
        'vol_down': 'wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%- || pactl set-sink-volume @DEFAULT_SINK@ -5%',
        'mute': 'wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle || pactl set-sink-mute @DEFAULT_SINK@ toggle'
      };
      const cmd = mediaMap[button.mediaAction] || button.command;
      if (cmd) exec(cmd);
      break;

    case 'url':
      if (button.url) {
        exec(`xdg-open "${button.url}" || open "${button.url}"`);
      }
      break;

    default:
      console.log(`Unhandled action type: ${button.actionType}`);
  }
}

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[Arya Dock] Client connected from ${clientIp}`);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Send initial state
  const profile = getActiveProfile();
  const page = getCurrentPage();
  ws.send(JSON.stringify({
    type: 'INIT',
    profiles: Object.entries(appConfig.profiles).map(([id, p]) => ({ id, name: p.name })),
    activeProfileId: appConfig.activeProfile,
    pageNumber: currentPageIndex + 1,
    totalPages: profile.pages ? profile.pages.length : 1,
    pageName: page.name || `Page ${currentPageIndex + 1}`,
    buttons: page.buttons || []
  }));

  ws.on('message', (message) => {
    ws.isAlive = true;
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'BUTTON_CLICK': {
          const page = getCurrentPage();
          const button = page.buttons.find(b => b.id === data.buttonId);
          if (button) {
            executeAction(button);
            ws.send(JSON.stringify({ type: 'BUTTON_ACK', buttonId: data.buttonId, status: 'ok' }));
          }
          break;
        }

        case 'PAGE_PREV': {
          const profile = getActiveProfile();
          currentPageIndex = (currentPageIndex - 1 + profile.pages.length) % profile.pages.length;
          broadcastState();
          break;
        }

        case 'PAGE_NEXT': {
          const profile = getActiveProfile();
          currentPageIndex = (currentPageIndex + 1) % profile.pages.length;
          broadcastState();
          break;
        }

        case 'SET_PROFILE': {
          if (appConfig.profiles[data.profileId]) {
            appConfig.activeProfile = data.profileId;
            currentPageIndex = 0;
            saveConfig();
            broadcastState();
          }
          break;
        }

        case 'UPDATE_BUTTON': {
          const page = getCurrentPage();
          const idx = page.buttons.findIndex(b => b.id === data.button.id);
          if (idx !== -1) {
            page.buttons[idx] = { ...page.buttons[idx], ...data.button };
            saveConfig();
            broadcastState();
          }
          break;
        }

        case 'ADD_BUTTON': {
          const page = getCurrentPage();
          const newId = page.buttons.length > 0 ? Math.max(...page.buttons.map(b => b.id)) + 1 : 0;
          const newButton = {
            id: newId,
            label: data.button?.label || `KEY ${newId + 1}`,
            sublabel: data.button?.sublabel || 'SHORTCUT',
            icon: data.button?.icon || '⚡',
            color: data.button?.color || '#1c69d4',
            actionType: data.button?.actionType || 'shell',
            command: data.button?.command || ''
          };
          page.buttons.push(newButton);
          saveConfig();
          broadcastState();
          break;
        }

        case 'DELETE_BUTTON': {
          const page = getCurrentPage();
          const idx = page.buttons.findIndex(b => b.id === data.buttonId);
          if (idx !== -1) {
            page.buttons.splice(idx, 1);
            saveConfig();
            broadcastState();
          }
          break;
        }

        case 'SET_BUTTONS_COUNT': {
          const page = getCurrentPage();
          const targetCount = Math.max(1, Math.min(24, parseInt(data.count, 10) || 9));
          const currentCount = page.buttons.length;
          if (targetCount > currentCount) {
            const defaultColors = ['#0066b1', '#1c69d4', '#e22718', '#2b2b2b'];
            for (let i = currentCount; i < targetCount; i++) {
              const newId = page.buttons.length > 0 ? Math.max(...page.buttons.map(b => b.id)) + 1 : 0;
              page.buttons.push({
                id: newId,
                label: `KEY ${newId + 1}`,
                sublabel: 'EMPTY',
                icon: '◻️',
                color: defaultColors[i % defaultColors.length],
                actionType: 'shell',
                command: ''
              });
            }
          } else if (targetCount < currentCount) {
            page.buttons = page.buttons.slice(0, targetCount);
          }
          saveConfig();
          broadcastState();
          break;
        }

        case 'PING': {
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
        }
      }
    } catch (e) {
      console.error('WebSocket message parsing error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[Arya Dock] Client disconnected (${clientIp})`);
  });
});

// Periodic ping heartbeat to prevent NAT dropouts and reap dead sockets
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[Arya Dock] Terminating unresponsive client socket');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  const interfaces = getNetworkInterfaces();
  const primaryIp = interfaces.length > 0 ? interfaces[0].address : 'localhost';
  const qrTarget = interfaces.find(i => i.type.includes('Wi-Fi')) || interfaces[0];
  const qrUrl = qrTarget ? `http://${qrTarget.address}:${PORT}` : `http://localhost:${PORT}`;

  console.log('\n========================================================');
  console.log('            🚀 ARYA DOCK - VIRTUAL KEYPAD CONSOLE           ');
  console.log('========================================================\n');
  console.log(`  🖥️  PC Web App:            http://localhost:${PORT}`);
  
  const defaultShell = getDefaultShell();
  const defaultTerminal = getDefaultTerminal();
  console.log(`  🐚  System Shell:          ${defaultShell} (${path.basename(defaultShell)})`);
  console.log(`  ⚡  Terminal Emulator:     ${defaultTerminal.path} (${defaultTerminal.name})`);
  
  interfaces.forEach(iface => {
    const icon = iface.type.includes('USB') ? '🔌' : (iface.type.includes('Wi-Fi') ? '📱' : '🌐');
    console.log(`  ${icon}  ${iface.type} (${iface.name}): http://${iface.address}:${PORT}`);
  });
  
  console.log('\n--- CONNECTION MODES ---');
  console.log('• USB CABLE: Turn on "USB Tethering" on your phone and open the USB link above.');
  console.log('• WI-FI / BLUETOOTH: Connect phone to same Wi-Fi and open Wi-Fi link or scan QR code below:');
  
  try {
    qrcode.generate(qrUrl, { small: true });
  } catch (e) {
    // ignore
  }

  console.log('========================================================\n');
});
