const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');
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
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        let type = 'LAN / Wi-Fi';
        if (name.includes('usb') || name.includes('rndis')) type = 'USB Cable Tethering';
        else if (name.includes('bt') || name.includes('pan')) type = 'Bluetooth Network';
        results.push({ name, address: net.address, type });
      }
    }
  }
  return results;
}

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
      'Cache-Control': 'no-cache',
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

// Action Dispatcher
function executeAction(button) {
  if (!button || !button.actionType) return;

  console.log(`[Arya Dock] Triggered Button [${button.id}] '${button.label}': ${button.actionType}`);

  switch (button.actionType) {
    case 'shell':
      if (button.command) {
        exec(button.command, (error, stdout, stderr) => {
          if (error) console.error(`[Exec Error]: ${error.message}`);
          if (stdout) console.log(`[Exec Output]: ${stdout.trim()}`);
        });
      }
      break;

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

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  const interfaces = getNetworkInterfaces();
  const primaryIp = interfaces.length > 0 ? interfaces[0].address : 'localhost';
  const mobileUrl = `http://${primaryIp}:${PORT}`;

  console.log('\n========================================================');
  console.log('            🚀 ARYA DOCK - VIRTUAL KEYPAD CONSOLE           ');
  console.log('========================================================\n');
  console.log(`  🖥️  PC Web App:       http://localhost:${PORT}`);
  console.log(`  📱 Mobile App (Wi-Fi): ${mobileUrl}`);
  
  console.log('\n--- HOW TO CONNECT VIA CABLE (USB) ---');
  console.log('1. Connect phone via USB cable and run:');
  console.log(`   adb reverse tcp:${PORT} tcp:${PORT}`);
  console.log(`   Then open in mobile browser: http://localhost:${PORT}`);
  console.log('2. OR turn on "USB Tethering" on phone and connect to host IP.\n');

  console.log('--- HOW TO CONNECT VIA BLUETOOTH / WI-FI ---');
  console.log('Scan the QR code below on your phone:');
  
  try {
    qrcode.generate(mobileUrl, { small: true });
  } catch (e) {
    // ignore
  }

  console.log('========================================================\n');
});
