// ==========================================================================
// ARYA DOCK — CLIENT CONTROLLER
// Drag-and-drop app assignment, system application catalog, and telemetry.
// ==========================================================================

let ws = null;
let currentButtons = [];
let installedApps = [];
let isEditMode = false;
let editingButtonId = null;
let pickerTargetButtonId = null;
let selectedAppForPopup = null;
let wakeLock = null;

// Security & Role State
const urlParams = new URLSearchParams(window.location.search);
let pairingToken = urlParams.get('token') || localStorage.getItem('arya_pairing_token') || '';
let editorKey = urlParams.get('editKey') || localStorage.getItem('arya_editor_key') || '';

if (urlParams.get('token')) {
  localStorage.setItem('arya_pairing_token', urlParams.get('token'));
}
if (urlParams.get('editKey')) {
  localStorage.setItem('arya_editor_key', urlParams.get('editKey'));
}

let userRole = 'operator';
let canEdit = false;

// Quick Presets
const PRESETS = [
  {
    name: 'AI Agent',
    command: 'notify-send "Arya Dock" "AI Coding Agent Dispatched" -i dialog-information',
    emoji: '🤖',
    category: 'Development',
    comment: 'Launch AI autonomous coding agent'
  },
  {
    name: 'VS Code',
    command: 'code . || code || echo "Opening Editor"',
    emoji: '💻',
    category: 'Development',
    comment: 'Open current folder in VS Code'
  },
  {
    name: 'Terminal',
    command: 'ptyxis --tab || ptyxis --new-window || gnome-terminal --tab || gnome-terminal || alacritty || kitty || x-terminal-emulator &',
    emoji: '⚡',
    category: 'System',
    comment: 'Open new terminal tab'
  },
  {
    name: 'Web Browser',
    command: 'google-chrome || brave-browser || firefox || xdg-open https://google.com &',
    emoji: '🌐',
    category: 'Network',
    comment: 'Launch default browser'
  },
  {
    name: 'Git Status',
    command: 'notify-send "Git Telemetry" "$(git status --short 2>&1 || echo \"Clean repository\")"',
    emoji: '🌿',
    category: 'Development',
    comment: 'Check git repository status'
  },
  {
    name: 'Test Suite',
    command: 'npm test || pytest || cargo test &',
    emoji: '🧪',
    category: 'Development',
    comment: 'Run project test suite'
  },
  {
    name: 'File Manager',
    command: 'nautilus || xdg-open ~ &',
    emoji: '📁',
    category: 'System',
    comment: 'Open home file manager'
  },
  {
    name: 'Audio Mute',
    command: 'wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle || pactl set-sink-mute @DEFAULT_SINK@ toggle',
    emoji: '🔇',
    category: 'AudioVideo',
    comment: 'Toggle audio output mute'
  },
  {
    name: 'Volume Up',
    command: 'wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+ || pactl set-sink-volume @DEFAULT_SINK@ +5%',
    emoji: '🔊',
    category: 'AudioVideo',
    comment: 'Increase system volume 5%'
  },
  {
    name: 'Volume Down',
    command: 'wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%- || pactl set-sink-volume @DEFAULT_SINK@ -5%',
    emoji: '🔉',
    category: 'AudioVideo',
    comment: 'Decrease system volume 5%'
  },
  {
    name: 'Play / Pause',
    command: 'playerctl play-pause 2>/dev/null || echo "Play/Pause"',
    emoji: '⏯️',
    category: 'AudioVideo',
    comment: 'Toggle media playback'
  },
  {
    name: 'Screenshot',
    command: 'gnome-screenshot -i 2>/dev/null || grim 2>/dev/null || echo "Screenshot"',
    emoji: '📸',
    category: 'Utility',
    comment: 'Interactive area screenshot'
  },
  {
    name: 'Lock PC',
    command: 'loginctl lock-session || gnome-screensaver-command -l',
    emoji: '🔒',
    category: 'System',
    comment: 'Immediately lock workstation'
  }
];

// DOM Elements
const keypadGrid = document.getElementById('keypadGrid');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = connectionStatus.querySelector('.m-status-text');
const pageLabel = document.getElementById('pageLabel');
const pageName = document.getElementById('pageName');
const btnPagePrev = document.getElementById('btnPagePrev');
const btnPageNext = document.getElementById('btnPageNext');
const btnModeM1 = document.getElementById('btnModeM1');
const btnModeM2 = document.getElementById('btnModeM2');
const btnEdit = document.getElementById('btnEdit');
const btnWakeLock = document.getElementById('btnWakeLock');
const btnFullscreen = document.getElementById('btnFullscreen');
const transportMode = document.getElementById('transportMode');

// Tile Dynamic Sizing Elements
const tileCountNum = document.getElementById('tileCountNum');
const btnAddTile = document.getElementById('btnAddTile');
const btnRemoveTile = document.getElementById('btnRemoveTile');
const btnModalDelete = document.getElementById('btnModalDelete');
const tileControls = document.getElementById('tileControls');
const dragBanner = document.getElementById('dragBanner');

// Drawer & Catalog Elements
const btnOpenDrawer = document.getElementById('btnOpenDrawer');
const btnBannerOpenApps = document.getElementById('btnBannerOpenApps');
const appDrawer = document.getElementById('appDrawer');
const btnDrawerClose = document.getElementById('btnDrawerClose');
const appSearchInput = document.getElementById('appSearchInput');
const btnClearSearch = document.getElementById('btnClearSearch');
const categoryTabs = document.getElementById('categoryTabs');
const appsList = document.getElementById('appsList');

// Quick Assign Popup Elements
const assignPopup = document.getElementById('assignPopup');
const popupAppTitle = document.getElementById('popupAppTitle');
const btnPopupClose = document.getElementById('btnPopupClose');
const popupTargetGrid = document.getElementById('popupTargetGrid');

// Edit Modal Elements
const editModal = document.getElementById('editModal');
const btnModalClose = document.getElementById('btnModalClose');
const modalTitle = document.getElementById('modalTitle');
const btnPickFromApps = document.getElementById('btnPickFromApps');
const editIcon = document.getElementById('editIcon');
const editLabel = document.getElementById('editLabel');
const editSublabel = document.getElementById('editSublabel');
const editColor = document.getElementById('editColor');
const editActionType = document.getElementById('editActionType');
const commandGroup = document.getElementById('commandGroup');
const urlGroup = document.getElementById('urlGroup');
const editCommand = document.getElementById('editCommand');
const editTerminalMode = document.getElementById('editTerminalMode');
const editWorkingDir = document.getElementById('editWorkingDir');
const folderSuggestions = document.getElementById('folderSuggestions');
const quickDirChips = document.getElementById('quickDirChips');
const editKeepOpen = document.getElementById('editKeepOpen');
const terminalModeGroup = document.getElementById('terminalModeGroup');
const terminalOptionsRow = document.getElementById('terminalOptionsRow');
const editUrl = document.getElementById('editUrl');
const btnModalTest = document.getElementById('btnModalTest');
const btnModalSave = document.getElementById('btnModalSave');

// Transport detection
function updateTransportDisplay() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    transportMode.textContent = 'USB CABLE (ADB)';
  } else {
    transportMode.textContent = `WIRELESS (${host})`;
  }
}
updateTransportDisplay();

// Haptic feedback
function triggerHaptic(duration = 18) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(duration);
    } catch (e) {}
  }
}

// Clean label formatter to prevent awkward word chopping
function formatAppLabel(name) {
  if (!name) return 'APP';
  let clean = name.replace(/Web Browser/i, 'BROWSER')
                  .replace(/Audio Player/i, 'MUSIC')
                  .replace(/LibreOffice /i, '')
                  .replace(/Text Editor/i, 'EDITOR')
                  .trim();
  if (clean.length > 20) {
    clean = clean.slice(0, 20).trim();
  }
  return clean.toUpperCase();
}

function formatAppSublabel(cat, comment) {
  if (cat && cat !== 'Utility') return cat.toUpperCase().slice(0, 16);
  if (comment) return comment.split(' ')[0].toUpperCase().slice(0, 16);
  return 'APP';
}

function isTerminalCommand(cmd, cat) {
  const lower = ((cmd || '') + ' ' + (cat || '')).toLowerCase();
  return lower.includes('btop') || lower.includes('top') || lower.includes('journalctl') ||
         lower.includes('git') || lower.includes('zsh') || lower.includes('bash') || lower.includes('sh') ||
         lower.includes('python') || lower.includes('npm') || lower.includes('test') ||
         lower.includes('docker') || lower.includes('kubectl') || lower.includes('claude') ||
         lower.includes('term') || lower.includes('ptyxis');
}

// Update Editor UI based on role privilege (Issue #3)
function updateEditorUI() {
  if (!canEdit) {
    if (isEditMode) {
      isEditMode = false;
    }
    if (btnEdit) {
      btnEdit.classList.remove('active');
      btnEdit.style.display = 'none';
    }
    if (tileControls) tileControls.style.display = 'none';
    if (btnOpenDrawer) btnOpenDrawer.style.display = 'none';
    if (dragBanner) dragBanner.style.display = 'none';
  } else {
    if (btnEdit) btnEdit.style.display = '';
    if (tileControls) tileControls.style.display = '';
    if (btnOpenDrawer) btnOpenDrawer.style.display = '';
    if (dragBanner) dragBanner.style.display = '';
  }
}

// Fetch Installed Applications from Server (Issue #4)
async function loadInstalledApplications() {
  try {
    const url = `/api/apps?token=${encodeURIComponent(pairingToken)}`;
    const headers = pairingToken ? { 'Authorization': `Bearer ${pairingToken}` } : {};
    const res = await fetch(url, { headers });
    if (res.ok) {
      installedApps = await res.json();
    }
  } catch (err) {
    console.warn('Could not fetch /api/apps, using presets:', err);
    installedApps = [];
  }
  renderAppCatalog('all');
}

// Fetch Suggested Project Directories (Issue #4)
async function loadSuggestedDirectories() {
  if (!quickDirChips || !folderSuggestions || !canEdit) return;
  try {
    let url = `/api/directories?token=${encodeURIComponent(pairingToken)}`;
    if (editorKey) url += `&editKey=${encodeURIComponent(editorKey)}`;
    const headers = pairingToken ? { 'Authorization': `Bearer ${pairingToken}` } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const dirs = await res.json();
    folderSuggestions.textContent = '';
    quickDirChips.textContent = '';
    dirs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.path;
      opt.label = d.label;
      folderSuggestions.appendChild(opt);

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'm-dir-chip';
      chip.textContent = `📁 ${d.label}`;
      chip.title = d.path;
      chip.addEventListener('click', () => {
        triggerHaptic(15);
        editWorkingDir.value = d.path;
      });
      quickDirChips.appendChild(chip);
    });
  } catch (e) {
    console.warn('Could not load directory suggestions:', e);
  }
}

// Render the App Drawer Cards (Safe DOM creation to prevent XSS - Issue #6)
function renderAppCatalog(filterCategory = 'all', searchQuery = '') {
  appsList.textContent = '';

  let list = [];
  if (filterCategory === 'presets') {
    list = PRESETS;
  } else {
    const combined = [...PRESETS, ...installedApps];
    const seen = new Set();
    list = combined.filter(app => {
      if (seen.has(app.name)) return false;
      seen.add(app.name);
      return true;
    });

    if (filterCategory !== 'all') {
      list = list.filter(app => (app.category || '').toLowerCase().includes(filterCategory.toLowerCase()));
    }
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    list = list.filter(app =>
      app.name.toLowerCase().includes(q) ||
      (app.command || '').toLowerCase().includes(q) ||
      (app.comment || '').toLowerCase().includes(q)
    );
  }

  if (list.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'm-loading-apps';
    emptyMsg.textContent = 'NO MATCHING APPLICATIONS FOUND';
    appsList.appendChild(emptyMsg);
    return;
  }

  list.forEach(app => {
    const card = document.createElement('div');
    card.className = 'm-app-card';
    card.setAttribute('draggable', 'true');

    const appPayload = {
      name: app.name,
      command: app.command,
      icon: app.emoji || '🚀',
      category: app.category || 'Utility'
    };

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(appPayload));
      e.dataTransfer.effectAllowed = 'copy';
      card.style.opacity = '0.5';
    });

    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
    });

    card.addEventListener('click', () => {
      triggerHaptic(15);
      if (pickerTargetButtonId !== null) {
        editIcon.value = appPayload.icon;
        editLabel.value = formatAppLabel(appPayload.name);
        editSublabel.value = formatAppSublabel(appPayload.category, appPayload.comment);
        editActionType.value = 'shell';
        editCommand.value = appPayload.command;
        editTerminalMode.value = isTerminalCommand(appPayload.command, appPayload.category) ? 'tab' : 'background';
        editKeepOpen.checked = true;
        toggleActionFields();
        closeDrawer();
        pickerTargetButtonId = null;
        editLabel.focus();
      } else {
        openAssignPopup(appPayload);
      }
    });

    // Safe DOM construction (Issue #6)
    const iconDiv = document.createElement('div');
    iconDiv.className = 'm-app-icon';
    iconDiv.textContent = app.emoji || '🚀';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'm-app-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'm-app-name';
    nameDiv.textContent = app.name || '';

    const metaDiv = document.createElement('div');
    metaDiv.className = 'm-app-meta';
    metaDiv.textContent = app.comment || app.command || '';

    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(metaDiv);

    const handleDiv = document.createElement('div');
    handleDiv.className = 'm-drag-handle';
    handleDiv.title = 'Drag onto Key';
    handleDiv.textContent = '⠿';

    card.appendChild(iconDiv);
    card.appendChild(infoDiv);
    card.appendChild(handleDiv);

    appsList.appendChild(card);
  });
}

// Category tabs filtering
categoryTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.m-tab');
  if (!tab) return;
  categoryTabs.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  renderAppCatalog(tab.dataset.cat, appSearchInput.value);
});

// Search input handling
appSearchInput.addEventListener('input', () => {
  const activeTab = categoryTabs.querySelector('.m-tab.active');
  const cat = activeTab ? activeTab.dataset.cat : 'all';
  renderAppCatalog(cat, appSearchInput.value);
});

btnClearSearch.addEventListener('click', () => {
  appSearchInput.value = '';
  const activeTab = categoryTabs.querySelector('.m-tab.active');
  const cat = activeTab ? activeTab.dataset.cat : 'all';
  renderAppCatalog(cat, '');
});

// Drawer Open / Close
function openDrawer() {
  if (!canEdit) return;
  appDrawer.classList.remove('hidden');
  appSearchInput.focus();
}

function closeDrawer() {
  appDrawer.classList.add('hidden');
  appDrawer.classList.remove('picker-mode');
  const drawerTitle = appDrawer.querySelector('.m-drawer-title');
  if (drawerTitle) drawerTitle.textContent = 'INSTALLED APPS & PRESETS';
  pickerTargetButtonId = null;
}

btnOpenDrawer.addEventListener('click', openDrawer);
btnBannerOpenApps.addEventListener('click', openDrawer);
btnDrawerClose.addEventListener('click', closeDrawer);

// Quick Assign Popup (Safe DOM creation - Issue #6)
function openAssignPopup(appPayload) {
  if (!canEdit) return;
  selectedAppForPopup = appPayload;
  popupAppTitle.textContent = `ASSIGN "${(appPayload.name || '').toUpperCase()}"`;
  popupTargetGrid.textContent = '';

  currentButtons.forEach((btnData, i) => {
    const btn = document.createElement('button');
    btn.className = 'm-target-btn';
    btn.textContent = btnData.label || `KEY ${i + 1}`;
    btn.addEventListener('click', () => {
      triggerHaptic(25);
      assignAppToButton(btnData.id !== undefined ? btnData.id : i, selectedAppForPopup);
      closeAssignPopup();
      closeDrawer();
    });
    popupTargetGrid.appendChild(btn);
  });

  assignPopup.classList.remove('hidden');
}

function closeAssignPopup() {
  assignPopup.classList.add('hidden');
  selectedAppForPopup = null;
}

btnPopupClose.addEventListener('click', closeAssignPopup);

// Assign App to Key & Push to Server
function assignAppToButton(buttonIndex, app) {
  if (!canEdit) return;
  const colorPalette = ['#0066b1', '#1c69d4', '#e22718', '#0066b1', '#1c69d4', '#e22718', '#2b2b2b', '#1c69d4', '#0066b1'];
  const isCli = isTerminalCommand(app.command, app.category);
  const updatedButton = {
    id: buttonIndex,
    icon: app.icon || '🚀',
    label: formatAppLabel(app.name),
    sublabel: formatAppSublabel(app.category, app.comment),
    color: colorPalette[buttonIndex % colorPalette.length],
    actionType: 'shell',
    command: app.command,
    terminalMode: isCli ? 'tab' : 'background',
    keepOpen: true
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'UPDATE_BUTTON', button: updatedButton }));
  }

  flashButtonAck(buttonIndex);
}

// WebSocket Setup & Lifecycle Management
let pingTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

function updateConnectionUI(state) {
  if (!connectionStatus || !statusText) return;
  if (state === 'connected') {
    connectionStatus.className = 'm-status-pill connected';
    statusText.textContent = canEdit ? 'ONLINE (EDITOR)' : 'ONLINE (OPERATOR)';
  } else if (state === 'connecting') {
    connectionStatus.className = 'm-status-pill connecting';
    statusText.textContent = 'CONNECTING...';
  } else {
    connectionStatus.className = 'm-status-pill disconnected';
    if (!pairingToken) {
      statusText.textContent = 'PAIRING TOKEN REQUIRED (TAP)';
    } else {
      statusText.textContent = reconnectAttempts > 0 ? `RECONNECTING (${reconnectAttempts})...` : 'OFFLINE';
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = Math.min(3000, 1000 + (reconnectAttempts * 500));
  updateConnectionUI('disconnected');
  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

function startHeartbeat() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'PING' }));
      } catch (e) {}
    } else if (!ws || ws.readyState === WebSocket.CLOSED) {
      scheduleReconnect();
    }
  }, 10000);
}

function stopHeartbeat() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    try {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch (e) {}
    ws = null;
  }

  updateConnectionUI('connecting');

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(pairingToken)}`;
  if (editorKey) {
    wsUrl += `&editKey=${encodeURIComponent(editorKey)}`;
  }

  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    console.warn('WebSocket construct error:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    updateConnectionUI('connected');
    startHeartbeat();
  };

  ws.onclose = () => {
    stopHeartbeat();
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.warn('WebSocket error encountered:', err);
    try { ws.close(); } catch (e) {}
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'PONG') return;
      handleServerMessage(data);
    } catch (e) {
      console.error('Error handling message:', e);
    }
  };
}

// Reconnect instantly when user returns to tab / unlocks phone
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
  }
});

window.addEventListener('online', () => {
  connectWebSocket();
});

if (connectionStatus) {
  connectionStatus.addEventListener('click', () => {
    triggerHaptic(15);
    if (!pairingToken) {
      const enteredToken = window.prompt('Enter Pairing Token from PC startup terminal:');
      if (enteredToken) {
        pairingToken = enteredToken.trim();
        localStorage.setItem('arya_pairing_token', pairingToken);
        loadInstalledApplications();
        connectWebSocket();
      }
      return;
    }
    if (!canEdit) {
      const entered = window.prompt('Enter Editor Key to unlock configuration controls:');
      if (entered) {
        editorKey = entered.trim();
        localStorage.setItem('arya_editor_key', editorKey);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'AUTH_EDIT', editKey: editorKey }));
        }
      }
    } else {
      connectWebSocket();
    }
  });
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'INIT':
    case 'STATE_UPDATE':
      if (data.role !== undefined) userRole = data.role;
      if (data.canEdit !== undefined) {
        canEdit = Boolean(data.canEdit);
        updateEditorUI();
        if (canEdit) loadSuggestedDirectories();
      }
      updateActiveModeButtons(data.activeProfileId);
      updatePageInfo(data.pageNumber, data.totalPages, data.pageName);
      renderButtons(data.buttons);
      updateConnectionUI('connected');
      break;

    case 'ROLE_UPDATE':
      userRole = data.role;
      canEdit = Boolean(data.canEdit);
      updateEditorUI();
      if (canEdit) loadSuggestedDirectories();
      updateConnectionUI('connected');
      break;

    case 'BUTTON_ACK':
      flashButtonAck(data.buttonId);
      break;

    case 'ERROR':
      console.warn('[Server Error]', data.message);
      break;
  }
}

function updateActiveModeButtons(activeProfileId) {
  btnModeM1.classList.toggle('active', activeProfileId === 'developer');
  btnModeM2.classList.toggle('active', activeProfileId === 'media');
}

function updatePageInfo(pageNum, totalPages, name) {
  const pStr = String(pageNum).padStart(2, '0');
  const tStr = String(totalPages).padStart(2, '0');
  pageLabel.textContent = `PAGE ${pStr} / ${tStr}`;
  pageName.textContent = name;
}

function getOptimalGridDimensions(count, isLandscape) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  if (count === 3) return isLandscape ? { cols: 3, rows: 1 } : { cols: 1, rows: 3 };
  if (count === 4) return { cols: 2, rows: 2 };
  if (count <= 6) return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
  if (count <= 8) return isLandscape ? { cols: 4, rows: 2 } : { cols: 2, rows: 4 };
  if (count === 9) return { cols: 3, rows: 3 };
  if (count <= 12) return isLandscape ? { cols: 4, rows: 3 } : { cols: 3, rows: 4 };
  if (count <= 15) return isLandscape ? { cols: 5, rows: 3 } : { cols: 3, rows: 5 };
  if (count <= 16) return { cols: 4, rows: 4 };
  if (count <= 20) return isLandscape ? { cols: 5, rows: 4 } : { cols: 4, rows: 5 };

  if (isLandscape) {
    let cols = Math.ceil(Math.sqrt(count * 1.33));
    let rows = Math.ceil(count / cols);
    return { cols, rows };
  } else {
    let rows = Math.ceil(Math.sqrt(count * 1.33));
    let cols = Math.ceil(count / rows);
    return { cols, rows };
  }
}

function updateDynamicGridSizing(totalCount) {
  const isLandscape = window.innerWidth >= window.innerHeight;
  const { cols, rows } = getOptimalGridDimensions(totalCount, isLandscape);

  const ratio = cols / rows;
  const maxAvailHeight = Math.max(240, window.innerHeight - 180);
  const maxAvailWidth = Math.max(240, window.innerWidth - 32);

  let width, height;
  if (ratio >= 1) {
    width = Math.min(maxAvailWidth, maxAvailHeight * ratio, 960);
    height = width / ratio;
    if (height > maxAvailHeight) {
      height = maxAvailHeight;
      width = height * ratio;
    }
  } else {
    height = Math.min(maxAvailHeight, maxAvailWidth / ratio);
    width = height * ratio;
    if (width > maxAvailWidth) {
      width = maxAvailWidth;
      height = width / ratio;
    }
  }

  document.documentElement.style.setProperty('--grid-cols', cols);
  document.documentElement.style.setProperty('--grid-rows', rows);
  document.documentElement.style.setProperty('--bezel-width', `${Math.round(width)}px`);
  document.documentElement.style.setProperty('--bezel-height', `${Math.round(height)}px`);
  document.documentElement.style.setProperty('--bezel-ratio', `${cols} / ${rows}`);
}

// Render Keypad Buttons (Safe DOM creation to prevent XSS - Issue #6)
function renderButtons(buttons) {
  currentButtons = buttons || [];
  const displayCount = (isEditMode && canEdit) ? currentButtons.length + 1 : currentButtons.length;

  if (tileCountNum) {
    tileCountNum.textContent = currentButtons.length;
  }

  updateDynamicGridSizing(Math.max(1, displayCount));
  keypadGrid.textContent = '';

  currentButtons.forEach((btnData, i) => {
    const keyEl = document.createElement('div');
    keyEl.className = `m-lcd-key ${(isEditMode && canEdit) ? 'edit-mode' : ''}`;
    keyEl.dataset.buttonId = btnData.id !== undefined ? btnData.id : i;
    keyEl.style.setProperty('--key-accent', btnData.color || '#1c69d4');

    // Safe DOM construction (Issue #6)
    const iconEl = document.createElement('div');
    iconEl.className = 'm-key-icon';
    iconEl.textContent = btnData.icon || '⚡';

    const labelEl = document.createElement('div');
    labelEl.className = 'm-key-label';
    labelEl.textContent = btnData.label || '';

    const sublabelEl = document.createElement('div');
    sublabelEl.className = 'm-key-sublabel';
    sublabelEl.textContent = btnData.sublabel || '';

    keyEl.appendChild(iconEl);
    keyEl.appendChild(labelEl);
    keyEl.appendChild(sublabelEl);

    // Pointer events for instant low latency clicks
    keyEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      triggerHaptic(20);
      keyEl.classList.add('pressed');

      if (isEditMode && canEdit) {
        openEditModal(btnData);
      } else {
        sendButtonClick(btnData.id);
      }
    });

    const removePressed = () => keyEl.classList.remove('pressed');
    keyEl.addEventListener('pointerup', removePressed);
    keyEl.addEventListener('pointercancel', removePressed);
    keyEl.addEventListener('pointerleave', removePressed);

    // HTML5 Drag & Drop handlers (active only for editors)
    if (canEdit) {
      keyEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        keyEl.classList.add('drag-over');
      });

      keyEl.addEventListener('dragleave', () => {
        keyEl.classList.remove('drag-over');
      });

      keyEl.addEventListener('drop', (e) => {
        e.preventDefault();
        keyEl.classList.remove('drag-over');
        triggerHaptic(30);

        try {
          const raw = e.dataTransfer.getData('application/json');
          if (raw) {
            const app = JSON.parse(raw);
            assignAppToButton(btnData.id !== undefined ? btnData.id : i, app);
          }
        } catch (err) {
          console.error('Drop error:', err);
        }
      });
    }

    keypadGrid.appendChild(keyEl);
  });

  // Render [+ ADD TILE] slot in Edit Mode (if editor)
  if (isEditMode && canEdit) {
    const addKeyEl = document.createElement('div');
    addKeyEl.className = 'm-lcd-key add-tile-btn';

    const addIcon = document.createElement('div');
    addIcon.className = 'm-add-tile-icon';
    addIcon.textContent = '+';

    const addText = document.createElement('div');
    addText.className = 'm-add-tile-text';
    addText.textContent = 'ADD TILE';

    addKeyEl.appendChild(addIcon);
    addKeyEl.appendChild(addText);

    addKeyEl.addEventListener('click', () => {
      triggerHaptic(20);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ADD_BUTTON' }));
      }
    });

    addKeyEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      addKeyEl.classList.add('drag-over');
    });

    addKeyEl.addEventListener('dragleave', () => {
      addKeyEl.classList.remove('drag-over');
    });

    addKeyEl.addEventListener('drop', (e) => {
      e.preventDefault();
      addKeyEl.classList.remove('drag-over');
      triggerHaptic(30);
      try {
        const raw = e.dataTransfer.getData('application/json');
        if (raw) {
          const app = JSON.parse(raw);
          const newButton = {
            icon: app.icon || '🚀',
            label: formatAppLabel(app.name),
            sublabel: formatAppSublabel(app.category, app.comment),
            color: '#1c69d4',
            actionType: 'shell',
            command: app.command
          };
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ADD_BUTTON', button: newButton }));
          }
        }
      } catch (err) {}
    });

    keypadGrid.appendChild(addKeyEl);
  }
}

function sendButtonClick(buttonId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'BUTTON_CLICK', buttonId }));
  }
}

function flashButtonAck(buttonId) {
  const el = keypadGrid.querySelector(`[data-button-id="${buttonId}"]`);
  if (el) {
    el.style.transform = 'scale(0.92)';
    el.style.borderColor = 'var(--m-red)';
    setTimeout(() => {
      el.style.transform = '';
      el.style.borderColor = '';
    }, 120);
  }
}

// Steering Shift Paddles
btnPagePrev.addEventListener('click', () => {
  triggerHaptic(15);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'PAGE_PREV' }));
  }
});

btnPageNext.addEventListener('click', () => {
  triggerHaptic(15);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
  }
});

// Mode buttons (M1 / M2)
btnModeM1.addEventListener('click', () => {
  triggerHaptic(20);
  if (canEdit && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: 'developer' }));
  }
});

btnModeM2.addEventListener('click', () => {
  triggerHaptic(20);
  if (canEdit && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: 'media' }));
  }
});

// Edit Mode Toggle
btnEdit.addEventListener('click', () => {
  if (!canEdit) return;
  isEditMode = !isEditMode;
  btnEdit.classList.toggle('active', isEditMode);
  renderButtons(currentButtons);
});

// Tile Count Adjust Buttons (+ / -) with Data-loss Protection (Issue #10)
if (btnAddTile) {
  btnAddTile.addEventListener('click', () => {
    if (!canEdit) return;
    triggerHaptic(20);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ADD_BUTTON' }));
    }
  });
}

if (btnRemoveTile) {
  btnRemoveTile.addEventListener('click', () => {
    if (!canEdit) return;
    triggerHaptic(20);
    if (currentButtons.length > 1 && ws && ws.readyState === WebSocket.OPEN) {
      const lastBtn = currentButtons[currentButtons.length - 1];
      const isConfigured = Boolean(
        (lastBtn.command && lastBtn.command.trim()) ||
        (lastBtn.url && lastBtn.url.trim()) ||
        (lastBtn.label && !/^KEY\s*\d+$/i.test(lastBtn.label.trim()))
      );

      if (isConfigured) {
        const confirmed = window.confirm(`Remove configured key "${lastBtn.label || 'KEY'}"?`);
        if (!confirmed) return;
      }

      ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: lastBtn.id }));
    }
  });
}

window.addEventListener('resize', () => {
  const count = (isEditMode && canEdit) ? currentButtons.length + 1 : currentButtons.length;
  updateDynamicGridSizing(Math.max(1, count));
});

// Key Configuration Modal
function openEditModal(button) {
  if (!canEdit) return;
  editingButtonId = button.id;
  modalTitle.textContent = `CONFIGURE KEY ${String(button.id + 1).padStart(2, '0')}`;
  editIcon.value = button.icon || '⚡';
  editLabel.value = button.label || '';
  editSublabel.value = button.sublabel || '';
  editColor.value = button.color || '#1c69d4';
  editActionType.value = button.actionType || 'shell';
  editCommand.value = button.command || '';
  editTerminalMode.value = button.terminalMode || 'tab';
  editWorkingDir.value = button.workingDir || '';
  editKeepOpen.checked = button.keepOpen !== false;
  editUrl.value = button.url || '';

  toggleActionFields();
  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
  editingButtonId = null;
}

btnModalClose.addEventListener('click', closeEditModal);

btnPickFromApps.addEventListener('click', () => {
  if (!canEdit) return;
  pickerTargetButtonId = editingButtonId;
  appDrawer.classList.add('picker-mode');
  const drawerTitle = appDrawer.querySelector('.m-drawer-title');
  if (drawerTitle) {
    drawerTitle.textContent = `SELECT APP FOR KEY ${String(editingButtonId + 1).padStart(2, '0')}`;
  }
  openDrawer();
});

editActionType.addEventListener('change', toggleActionFields);

function toggleActionFields() {
  const type = editActionType.value;
  if (type === 'url') {
    commandGroup.classList.add('hidden');
    terminalModeGroup.classList.add('hidden');
    terminalOptionsRow.classList.add('hidden');
    urlGroup.classList.remove('hidden');
  } else if (type === 'shell') {
    commandGroup.classList.remove('hidden');
    terminalModeGroup.classList.remove('hidden');
    terminalOptionsRow.classList.remove('hidden');
    urlGroup.classList.add('hidden');
  } else {
    commandGroup.classList.add('hidden');
    terminalModeGroup.classList.add('hidden');
    terminalOptionsRow.classList.add('hidden');
    urlGroup.classList.add('hidden');
  }
}

btnModalTest.addEventListener('click', () => {
  if (editingButtonId !== null) {
    sendButtonClick(editingButtonId);
  }
});

btnModalDelete.addEventListener('click', () => {
  if (!canEdit || editingButtonId === null) return;
  triggerHaptic(25);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: editingButtonId }));
  }
  closeEditModal();
});

btnModalSave.addEventListener('click', () => {
  if (!canEdit || editingButtonId === null) return;

  const updatedButton = {
    id: editingButtonId,
    icon: editIcon.value.trim() || '⚡',
    label: editLabel.value.trim().toUpperCase() || `KEY ${editingButtonId + 1}`,
    sublabel: editSublabel.value.trim().toUpperCase() || '',
    color: editColor.value,
    actionType: editActionType.value,
    command: editCommand.value.trim(),
    terminalMode: editTerminalMode.value,
    workingDir: editWorkingDir.value.trim(),
    keepOpen: editKeepOpen.checked,
    url: editUrl.value.trim()
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'UPDATE_BUTTON', button: updatedButton }));
  }

  closeEditModal();
});

// Screen Wake Lock
btnWakeLock.addEventListener('click', async () => {
  if ('wakeLock' in navigator) {
    try {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        btnWakeLock.classList.add('active');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
          btnWakeLock.classList.remove('active');
        });
      } else {
        await wakeLock.release();
        wakeLock = null;
        btnWakeLock.classList.remove('active');
      }
    } catch (err) {
      console.warn('Wake Lock error:', err);
    }
  } else {
    alert('Screen Wake Lock is not supported on this browser.');
  }
});

// Fullscreen
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    btnFullscreen.classList.add('active');
  } else {
    document.exitFullscreen().catch(() => {});
    btnFullscreen.classList.remove('active');
  }
});

// Initialize
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadInstalledApplications();
updateEditorUI();
connectWebSocket();
