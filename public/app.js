// ==========================================================================
// ARYA DOCK — CLIENT CONTROLLER
// Drag-and-drop app assignment, system application catalog, and telemetry.
// ==========================================================================

let ws = null;
let currentButtons = [];
let installedApps = [];
let isEditMode = false;
let editingButtonId = null;
let editingButtonFolderId = null;
let pickerTargetButtonId = null;
let selectedAppForPopup = null;
let wakeLock = null;

// Security & Role State
const urlParams = new URLSearchParams(window.location.search);
let pairingToken = urlParams.get('token') || localStorage.getItem('arya_pairing_token') || '';
let editorKey = localStorage.getItem('arya_editor_key') || '';

if (urlParams.get('token')) {
  localStorage.setItem('arya_pairing_token', urlParams.get('token'));
}

// Scrub sensitive token and editKey from URL bar and browser history
if (urlParams.has('token') || urlParams.has('editKey')) {
  try {
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch (e) {}
}

let userRole = 'operator';
let canEdit = false;

// Quick Presets (Clean, safe examples; updated dynamically from /api/presets/catalog)
let PRESETS = [
  {
    name: 'AI Agent',
    command: 'echo "Tip: Configure AI coding agent command in tile settings"',
    emoji: '🤖',
    category: 'Development',
    comment: 'Launch AI autonomous coding agent'
  },
  {
    name: 'VS Code',
    command: 'code',
    emoji: '💻',
    category: 'Development',
    comment: 'Open VS Code'
  },
  {
    name: 'Terminal',
    command: 'ptyxis --tab || gnome-terminal --tab || alacritty || kitty || x-terminal-emulator &',
    emoji: '⚡',
    category: 'System',
    comment: 'Open new terminal tab'
  },
  {
    name: 'Web Browser',
    command: 'google-chrome || brave-browser || firefox &',
    emoji: '🌐',
    category: 'Network',
    comment: 'Launch default browser'
  },
  {
    name: 'Git Status',
    command: 'git status',
    emoji: '🌿',
    category: 'Development',
    comment: 'Check git repository status'
  },
  {
    name: 'Test Suite',
    command: 'npm test || pytest || cargo test',
    emoji: '🧪',
    category: 'Development',
    comment: 'Run project test suite'
  },
  {
    name: 'File Manager',
    command: 'nautilus ~ &',
    emoji: '📁',
    category: 'System',
    comment: 'Open home file manager'
  },
  {
    name: 'Audio Mute',
    command: 'pactl set-sink-mute @DEFAULT_SINK@ toggle || amixer set Master toggle',
    emoji: '🔇',
    category: 'AudioVideo',
    comment: 'Toggle audio output mute'
  },
  {
    name: 'Volume Up',
    command: 'pactl set-sink-volume @DEFAULT_SINK@ +5% || amixer set Master 5%+',
    emoji: '🔊',
    category: 'AudioVideo',
    comment: 'Increase system volume 5%'
  },
  {
    name: 'Volume Down',
    command: 'pactl set-sink-volume @DEFAULT_SINK@ -5% || amixer set Master 5%-',
    emoji: '🔉',
    category: 'AudioVideo',
    comment: 'Decrease system volume 5%'
  },
  {
    name: 'Play / Pause',
    command: 'echo "Toggle playback"',
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
const workspaceSelector = document.getElementById('workspaceSelector');
const btnModeM1 = document.getElementById('btnModeM1');
const btnModeM2 = document.getElementById('btnModeM2');
const navStatusBadge = document.getElementById('navStatusBadge');
const navModeDot = document.getElementById('navModeDot');
const navModeText = document.getElementById('navModeText');
const btnPinWorkspace = document.getElementById('btnPinWorkspace');
const pinIcon = document.getElementById('pinIcon');
const btnEdit = document.getElementById('btnEdit');
const btnWakeLock = document.getElementById('btnWakeLock');
const btnFullscreen = document.getElementById('btnFullscreen');
const transportMode = document.getElementById('transportMode');

// Workspaces and Navigation State (Epic E3)
let currentWorkspaces = [];
let navigationState = { mode: 'auto', workspaceId: 'developer', pageIndex: 0, pinned: false };

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

// Unlock Modal Elements
const unlockModal = document.getElementById('unlockModal');
const btnUnlockModalClose = document.getElementById('btnUnlockModalClose');
const btnUnlockCancel = document.getElementById('btnUnlockCancel');
const btnUnlockSubmit = document.getElementById('btnUnlockSubmit');
const inputEditorKey = document.getElementById('inputEditorKey');
const unlockModalError = document.getElementById('unlockModalError');

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
const editCategory = document.getElementById('editCategory');
const btnWorkspaceSettings = document.getElementById('btnWorkspaceSettings');
const workspaceSettingsModal = document.getElementById('workspaceSettingsModal');
const btnSettingsModalClose = document.getElementById('btnSettingsModalClose');
const btnSettingsModalDone = document.getElementById('btnSettingsModalDone');
const toggleSegregation = document.getElementById('toggleSegregation');
const btnAddWorkspace = document.getElementById('btnAddWorkspace');
const workspaceListContainer = document.getElementById('workspaceListContainer');
const wsFormTitle = document.getElementById('wsFormTitle');
const inputWsId = document.getElementById('inputWsId');
const inputWsName = document.getElementById('inputWsName');
const inputWsIcon = document.getElementById('inputWsIcon');
const inputWsMatchApps = document.getElementById('inputWsMatchApps');
const workspaceSettingsError = document.getElementById('workspaceSettingsError');
const workspaceSettingsSuccess = document.getElementById('workspaceSettingsSuccess');
const btnExportConfig = document.getElementById('btnExportConfig');
const btnImportConfig = document.getElementById('btnImportConfig');
const inputImportFile = document.getElementById('inputImportFile');
const btnCreateWorkspace = document.getElementById('btnCreateWorkspace');
const btnSaveWorkspaceEdit = document.getElementById('btnSaveWorkspaceEdit');
const btnCancelWorkspaceEdit = document.getElementById('btnCancelWorkspaceEdit');
const deckBreadcrumb = document.getElementById('deckBreadcrumb');
const btnBreadcrumbBack = document.getElementById('btnBreadcrumbBack');
const breadcrumbPath = document.getElementById('breadcrumbPath');
const categoryLensStrip = document.getElementById('categoryLensStrip');
let currentFolderStack = [];
let currentFolderName = null;
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

// Onboarding Wizard Elements & State (Epic E4-1 & E4-3)
let hasAutoOpenedWizard = false;
let currentWizardStep = 1;
let detectedEcosystemData = null;
const onboardingWizardModal = document.getElementById('onboardingWizardModal');
const wizardTitle = document.getElementById('wizardTitle');
const btnWizardClose = document.getElementById('btnWizardClose');
const wizardOperatorNotice = document.getElementById('wizardOperatorNotice');
const btnWizardUnlockEditor = document.getElementById('btnWizardUnlockEditor');
const stepDot1 = document.getElementById('stepDot1');
const stepDot2 = document.getElementById('stepDot2');
const stepDot3 = document.getElementById('stepDot3');
const stepLine1 = document.getElementById('stepLine1');
const stepLine2 = document.getElementById('stepLine2');
const wizardStepDetect = document.getElementById('wizardStepDetect');
const wizardDetectSummary = document.getElementById('wizardDetectSummary');
const wizardDetectSpinner = document.getElementById('wizardDetectSpinner');
const wizardDetectGrid = document.getElementById('wizardDetectGrid');
const wizardStepWorkspaces = document.getElementById('wizardStepWorkspaces');
const checkWsDev = document.getElementById('checkWsDev');
const checkWsDevops = document.getElementById('checkWsDevops');
const checkWsMedia = document.getElementById('checkWsMedia');
const checkWsSys = document.getElementById('checkWsSys');
const wizardStepFinish = document.getElementById('wizardStepFinish');
const wizardFinishSummary = document.getElementById('wizardFinishSummary');
const btnWizardSkip = document.getElementById('btnWizardSkip');
const btnWizardPrev = document.getElementById('btnWizardPrev');
const btnWizardNext = document.getElementById('btnWizardNext');
const btnWizardApply = document.getElementById('btnWizardApply');
const btnOpenWizard = document.getElementById('btnOpenWizard');

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
      btnEdit.style.display = '';
      btnEdit.innerHTML = '<span class="m-tool-icon">🔒</span>';
      btnEdit.title = 'Unlock Editor Mode (Enter Editor Key)';
    }
    if (tileControls) tileControls.style.display = 'none';
    if (btnOpenDrawer) btnOpenDrawer.style.display = 'none';
    if (dragBanner) dragBanner.style.display = 'none';
    if (btnAddWorkspace) btnAddWorkspace.style.display = 'none';
    if (btnExportConfig) btnExportConfig.disabled = true;
    if (btnImportConfig) btnImportConfig.disabled = true;
  } else {
    if (btnEdit) {
      btnEdit.style.display = '';
      btnEdit.innerHTML = '<span class="m-tool-icon">✏️</span>';
      btnEdit.title = 'Toggle Edit Mode';
    }
    if (tileControls) tileControls.style.display = '';
    if (btnOpenDrawer) btnOpenDrawer.style.display = '';
    if (dragBanner) dragBanner.style.display = '';
    if (btnAddWorkspace) btnAddWorkspace.style.display = '';
    if (btnExportConfig) btnExportConfig.disabled = false;
    if (btnImportConfig) btnImportConfig.disabled = false;
  }
}

// Fetch Static Presets Catalog from Server (Single Source of Truth, E4-1 & E4-3)
async function loadPresetsCatalog() {
  try {
    const url = pairingToken ? `/api/presets/catalog?token=${encodeURIComponent(pairingToken)}` : '/api/presets/catalog';
    const headers = {};
    if (pairingToken) headers['Authorization'] = `Bearer ${pairingToken}`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.presets) && data.presets.length > 0) {
        PRESETS = data.presets.map(p => ({
          name: p.name,
          command: p.command || '',
          emoji: p.icon || '🚀',
          icon: p.icon || '🚀',
          color: p.color || '#1c69d4',
          actionType: p.actionType || 'shell',
          mediaAction: p.mediaAction || null,
          terminalMode: p.terminalMode || 'tab',
          category: formatPresetCategory(p.category || 'Development'),
          comment: p.comment || p.command || ''
        }));
        renderAppCatalog('all');
      }
    }
  } catch (err) {
    console.warn('Could not fetch /api/presets/catalog, using static fallback:', err);
  }
}

function formatPresetCategory(cat) {
  if (!cat) return 'Development';
  const c = String(cat).toLowerCase();
  if (c === 'development' || c === 'dev') return 'Development';
  if (c === 'network' || c === 'web') return 'Network';
  if (c === 'system' || c === 'sys') return 'System';
  if (c === 'audiovideo' || c === 'media') return 'AudioVideo';
  if (c === 'devops') return 'Development';
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

// Fetch Installed Applications from Server (Issue #4, E4-2)
async function loadInstalledApplications() {
  loadPresetsCatalog();
  try {
    const url = pairingToken ? `/api/apps?token=${encodeURIComponent(pairingToken)}` : '/api/apps';
    const headers = {};
    if (pairingToken) headers['Authorization'] = `Bearer ${pairingToken}`;
    if (editorKey) headers['X-Editor-Key'] = editorKey;
    const res = await fetch(url, { headers });
    if (res.ok) {
      installedApps = await res.json();
    } else {
      installedApps = [];
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
    const url = pairingToken ? `/api/directories?token=${encodeURIComponent(pairingToken)}` : '/api/directories';
    const headers = {};
    if (pairingToken) headers['Authorization'] = `Bearer ${pairingToken}`;
    if (editorKey) headers['X-Editor-Key'] = editorKey;
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
      category: app.category || 'Utility',
      isApplication: !isTerminalCommand(app.command, app.category)
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
    isApplication: !isCli,
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
  const searchParams = new URLSearchParams(window.location.search);
  const requestedWorkspace = searchParams.get('workspace') || searchParams.get('profile');
  let wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(pairingToken)}`;
  if (requestedWorkspace) {
    wsUrl += `&workspace=${encodeURIComponent(requestedWorkspace)}`;
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
    if (editorKey) {
      ws.send(JSON.stringify({ type: 'AUTH_EDIT', editKey: editorKey }));
    }
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

// Lens & Segregation Projection State
let activeLens = 'all';
let virtualSubPageIndex = 0;
let cachedAllButtons = [];
let cachedCanonicalButtons = [];
let cachedCanonicalPageNum = 1;
let cachedCanonicalTotalPages = 1;
let cachedCanonicalPageName = 'Page 1';
let currentWorkspaceSegregation = { enabled: false };

const ALLOWED_LENS_CATEGORIES = ['terminal', 'application', 'url', 'media'];
const KNOWN_DESKTOP_BINARIES = [
  'google-chrome', 'chrome', 'firefox', 'brave', 'chromium',
  'code', 'cursor', 'subl', 'gedit',
  'slack', 'discord', 'telegram-desktop', 'spotify',
  'gimp', 'inkscape', 'vlc', 'obs', 'steam'
];

function isKnownDesktopCommand(command) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim().toLowerCase();
  return KNOWN_DESKTOP_BINARIES.some(b => cmd === b || cmd.startsWith(b + ' '));
}

function classifyClientButton(button) {
  if (!button || typeof button !== 'object') return 'terminal';
  if (typeof button.categoryOverride === 'string') {
    const override = button.categoryOverride.trim().toLowerCase();
    if (ALLOWED_LENS_CATEGORIES.includes(override)) return override;
  }
  if (button.actionType === 'media') return 'media';
  if (button.actionType === 'url') return 'url';
  if (button.actionType === 'shell') {
    if (['tab', 'window', 'existing'].includes(button.terminalMode)) return 'terminal';
    if (button.isApplication === true) return 'application';
    if (isKnownDesktopCommand(button.command)) return 'application';
    return 'terminal';
  }
  return 'terminal';
}

function formatCategoryName(category) {
  switch (category) {
    case 'terminal': return 'Terminal';
    case 'application': return 'Application';
    case 'url': return 'URL';
    case 'media': return 'Media';
    default:
      if (!category || typeof category !== 'string') return 'Category';
      return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

function renderKeypadState() {
  if (activeLens === 'all') {
    updatePageInfo(cachedCanonicalPageNum, cachedCanonicalTotalPages, cachedCanonicalPageName);
    renderButtons(cachedCanonicalButtons);
    return;
  }

  const matchingButtons = cachedAllButtons.filter(b => classifyClientButton(b) === activeLens);
  const totalVirtualPages = Math.max(1, Math.ceil(matchingButtons.length / 15));
  virtualSubPageIndex = Math.max(0, Math.min(virtualSubPageIndex, totalVirtualPages - 1));

  const startIdx = virtualSubPageIndex * 15;
  const currentChunk = matchingButtons.slice(startIdx, startIdx + 15);

  const subPageNum = virtualSubPageIndex + 1;
  const catName = formatCategoryName(activeLens);
  updatePageInfo(subPageNum, totalVirtualPages, `${catName} ${subPageNum}`);
  renderButtons(currentChunk);
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'INIT':
    case 'STATE_UPDATE':
    case 'NAV_CHANGE': {
      if (data.role !== undefined) userRole = data.role;
      if (data.canEdit !== undefined) {
        canEdit = Boolean(data.canEdit);
        updateEditorUI();
        if (canEdit) {
          loadSuggestedDirectories();
          loadInstalledApplications();
        }
      }

      const activeWsId = data.workspaceId || data.activeWorkspaceId || data.activeProfileId || 'developer';

      if (data.navigation) {
        updateNavigationUI(data.navigation);
      } else {
        updateNavigationUI({
          mode: 'manual',
          workspaceId: activeWsId,
          pageIndex: (data.pageNumber || 1) - 1,
          pinned: false
        });
      }

      currentFolderStack = Array.isArray(data.folderStack) ? data.folderStack : [];
      currentFolderName = data.currentFolderName || null;

      if (deckBreadcrumb) {
        if (currentFolderStack.length > 0) {
          deckBreadcrumb.classList.remove('hidden');
          if (breadcrumbPath) {
            const wsName = data.workspaceName || activeWsId;
            breadcrumbPath.textContent = `${wsName} > 📁 ${currentFolderName || 'Folder'}`;
          }
        } else {
          deckBreadcrumb.classList.add('hidden');
        }
      }

      if (categoryLensStrip) {
        if (currentFolderStack.length > 0) {
          categoryLensStrip.style.display = 'none';
        } else {
          categoryLensStrip.style.display = '';
        }
      }

      const inFolder = currentFolderStack.length > 0;
      if (inFolder) {
        activeLens = 'all';
      }
      if (btnPagePrev) {
        btnPagePrev.disabled = inFolder;
        btnPagePrev.classList.toggle('disabled', inFolder);
      }
      if (btnPageNext) {
        btnPageNext.disabled = inFolder;
        btnPageNext.classList.toggle('disabled', inFolder);
      }

      if (Array.isArray(data.workspaces) && data.workspaces.length > 0) {
        currentWorkspaces = data.workspaces;
      } else if (Array.isArray(data.profiles) && data.profiles.length > 0) {
        currentWorkspaces = data.profiles.map(p => ({
          id: p.id,
          name: p.name,
          icon: p.id === 'developer' ? '💻' : (p.id === 'media' ? '🎵' : '⚡'),
          origin: 'builtin'
        }));
      } else if (currentWorkspaces.length === 0) {
        currentWorkspaces = [
          { id: 'developer', name: 'Developer & AI Workflows', icon: '💻', origin: 'builtin' },
          { id: 'media', name: 'Media & Audio Controls', icon: '🎵', origin: 'builtin' }
        ];
      }

      cachedCanonicalButtons = data.buttons || [];
      cachedAllButtons = Array.isArray(data.allButtons) && data.allButtons.length > 0
        ? data.allButtons
        : (data.buttons || []);
      cachedCanonicalPageNum = data.pageNumber || 1;
      cachedCanonicalTotalPages = data.totalPages || 1;
      cachedCanonicalPageName = data.pageName || `Page ${cachedCanonicalPageNum}`;

      if (data.segregation) {
        currentWorkspaceSegregation = data.segregation;
        if (toggleSegregation) {
          toggleSegregation.checked = Boolean(currentWorkspaceSegregation.enabled);
        }
      }

      renderWorkspaces(currentWorkspaces, activeWsId);
      updateActiveModeButtons(activeWsId);
      if (workspaceSettingsModal && !workspaceSettingsModal.classList.contains('hidden')) {
        renderWorkspaceList();
      }
      renderKeypadState();
      updateConnectionUI('connected');

      // First-run automatic onboarding launch
      if (data.onboardingCompleted === false && !hasAutoOpenedWizard) {
        hasAutoOpenedWizard = true;
        openOnboardingWizard(1);
      }
      break;
    }

    case 'ROLE_UPDATE':
      userRole = data.role;
      canEdit = Boolean(data.canEdit);
      updateEditorUI();
      if (canEdit) {
        if (unlockModal) unlockModal.classList.add('hidden');
        if (unlockModalError) {
          unlockModalError.style.display = 'none';
          unlockModalError.textContent = '';
        }
        if (wizardOperatorNotice) {
          wizardOperatorNotice.classList.add('hidden');
        }
        if (onboardingWizardModal && !onboardingWizardModal.classList.contains('hidden') && currentWizardStep === 1) {
          fetchHostEcosystem();
        }
        loadSuggestedDirectories();
        loadInstalledApplications();
        loadPresetsCatalog();
      }
      updateConnectionUI('connected');
      break;

    case 'BUTTON_ACK':
      flashButtonAck(data.buttonId);
      break;

    case 'ERROR':
      console.warn('[Server Error]', data.message);
      if (unlockModal && !unlockModal.classList.contains('hidden') && unlockModalError) {
        unlockModalError.textContent = data.message || 'Authentication failed';
        unlockModalError.style.display = 'block';
      }
      if (workspaceSettingsModal && !workspaceSettingsModal.classList.contains('hidden') && workspaceSettingsError) {
        workspaceSettingsError.textContent = data.message || 'Operation failed';
        workspaceSettingsError.style.display = 'block';
      }
      break;
  }
}

function updateNavigationUI(nav) {
  if (!nav) return;
  navigationState = nav;
  if (navStatusBadge && navModeDot && navModeText) {
    navStatusBadge.classList.remove('auto', 'manual', 'pinned');
    navModeDot.classList.remove('auto', 'manual', 'pinned');

    if (nav.pinned) {
      navStatusBadge.classList.add('pinned');
      navModeDot.classList.add('pinned');
      navModeText.textContent = 'PINNED';
      navStatusBadge.title = 'Workspace Pinned (Context auto-switch locked)';
    } else if (nav.mode === 'auto') {
      navStatusBadge.classList.add('auto');
      navModeDot.classList.add('auto');
      navModeText.textContent = 'AUTO';
      navStatusBadge.title = 'Automatic Navigation (Follows active desktop application)';
    } else {
      navStatusBadge.classList.add('manual');
      navModeDot.classList.add('manual');
      navModeText.textContent = 'MANUAL';
      navStatusBadge.title = 'Manual Navigation (Workspace selected by user)';
    }
  }

  if (btnPinWorkspace) {
    btnPinWorkspace.classList.toggle('pinned', Boolean(nav.pinned));
    btnPinWorkspace.classList.toggle('active', Boolean(nav.pinned));
    btnPinWorkspace.title = nav.pinned ? 'Unpin Workspace (Restore Auto-Switching)' : 'Pin Workspace (Lock to Current Workspace)';
  }
}

let renderedWorkspacesSignature = '';

function renderWorkspaces(workspaces, activeWorkspaceId) {
  if (!workspaceSelector) return;
  if (!Array.isArray(workspaces) || workspaces.length === 0) return;

  const newSig = workspaces.map(w => `${w.id}:${w.name}:${w.icon}`).join('|');
  const existingButtons = workspaceSelector.querySelectorAll('.m-mode-btn');
  if (newSig === renderedWorkspacesSignature && existingButtons.length === workspaces.length) {
    updateActiveModeButtons(activeWorkspaceId);
    return;
  }

  renderedWorkspacesSignature = newSig;
  workspaceSelector.textContent = '';

  workspaces.forEach((wsItem, idx) => {
    const btn = document.createElement('button');
    btn.className = 'm-mode-btn';
    btn.dataset.workspace = wsItem.id;
    btn.dataset.profile = wsItem.id;

    if (wsItem.id === activeWorkspaceId) {
      btn.classList.add('active');
    }

    let modeLabel = '';
    let modeSub = '';

    if (wsItem.id === 'developer') {
      btn.id = 'btnModeM1';
      modeLabel = 'M1';
      modeSub = 'DEV COCKPIT';
      btn.setAttribute('aria-label', 'DEV COCKPIT');
    } else if (wsItem.id === 'media') {
      btn.id = 'btnModeM2';
      modeLabel = 'M2';
      modeSub = 'MEDIA & TELEMETRY';
      btn.setAttribute('aria-label', 'MEDIA & TELEMETRY');
    } else {
      btn.id = `btnWorkspace_${wsItem.id}`;
      modeLabel = wsItem.icon || `M${idx + 1}`;
      modeSub = (wsItem.name || wsItem.id).toUpperCase();
      btn.setAttribute('aria-label', (wsItem.name || wsItem.id).toUpperCase());
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'm-mode-label';
    labelSpan.textContent = modeLabel;

    const subSpan = document.createElement('span');
    subSpan.className = 'm-mode-sub';
    subSpan.textContent = modeSub;

    btn.appendChild(labelSpan);
    btn.appendChild(subSpan);

    btn.addEventListener('click', () => {
      triggerHaptic(20);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: wsItem.id }));
      }
    });

    workspaceSelector.appendChild(btn);
  });
}

function updateActiveModeButtons(activeWorkspaceId) {
  if (!workspaceSelector) return;
  const buttons = workspaceSelector.querySelectorAll('.m-mode-btn');
  buttons.forEach(btn => {
    const wsId = btn.dataset.workspace || btn.dataset.profile;
    const isActive = (wsId === activeWorkspaceId);
    btn.classList.toggle('active', isActive);
    if (isActive && typeof btn.scrollIntoView === 'function') {
      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  });
}

function updatePageInfo(pageNum, totalPages, name) {
  const pStr = String(pageNum).padStart(2, '0');
  const tStr = String(totalPages).padStart(2, '0');
  pageLabel.textContent = `PAGE ${pStr} / ${tStr}`;
  pageName.textContent = name;
  const deckStatusPage = document.getElementById('deckStatusPage');
  if (deckStatusPage) {
    deckStatusPage.textContent = `PAGE ${pageNum}/${totalPages}`;
  }
}

function getOptimalGridDimensions(count, isLandscape) {
  const num = typeof count === 'number' && !Number.isNaN(count) ? count : 1;
  const clamped = Math.max(1, Math.min(15, num));
  if (clamped <= 1) return { cols: 1, rows: 1 };
  if (clamped === 2) return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  if (clamped === 3) return isLandscape ? { cols: 3, rows: 1 } : { cols: 1, rows: 3 };
  if (clamped === 4) return { cols: 2, rows: 2 };
  if (clamped <= 6) return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
  if (clamped <= 8) return isLandscape ? { cols: 4, rows: 2 } : { cols: 2, rows: 4 };
  if (clamped === 9) return { cols: 3, rows: 3 };
  if (clamped <= 12) return isLandscape ? { cols: 4, rows: 3 } : { cols: 3, rows: 4 };
  return isLandscape ? { cols: 5, rows: 3 } : { cols: 3, rows: 5 };
}

function updateDynamicGridSizing(totalCount) {
  const isLandscape = window.innerWidth >= window.innerHeight;
  const { cols, rows } = getOptimalGridDimensions(totalCount, isLandscape);

  document.documentElement.style.setProperty('--grid-cols', cols);
  document.documentElement.style.setProperty('--grid-rows', rows);
  document.documentElement.style.setProperty('--bezel-width', '100%');
  document.documentElement.style.setProperty('--bezel-height', '100%');
  document.documentElement.style.setProperty('--bezel-ratio', `${cols} / ${rows}`);
}

// Render Keypad Buttons (Safe DOM creation to prevent XSS - Issue #6)
function renderButtons(buttons) {
  currentButtons = buttons || [];
  const showAddTile = (isEditMode && canEdit && currentButtons.length < 15);
  const displayCount = showAddTile ? currentButtons.length + 1 : currentButtons.length;

  if (tileCountNum) {
    tileCountNum.textContent = currentButtons.length;
  }

  updateDynamicGridSizing(Math.max(1, displayCount));
  keypadGrid.textContent = '';

  if (currentButtons.length === 0 && !showAddTile) {
    const emptyWrap = document.createElement('div');
    emptyWrap.className = 'm-keypad-empty-state';

    const iconEl = document.createElement('div');
    iconEl.className = 'm-keypad-empty-icon';
    iconEl.textContent = '⚡';

    const titleEl = document.createElement('div');
    titleEl.className = 'm-keypad-empty-title';
    titleEl.textContent = 'NO SHORTCUTS CONFIGURED';

    const descEl = document.createElement('div');
    descEl.className = 'm-keypad-empty-desc';
    descEl.textContent = canEdit
      ? 'This workspace is empty. Add your first shortcut from the catalog or presets to get started.'
      : 'This companion workspace has no shortcuts configured yet.';

    emptyWrap.appendChild(iconEl);
    emptyWrap.appendChild(titleEl);
    emptyWrap.appendChild(descEl);

    if (canEdit) {
      const addBtn = document.createElement('button');
      addBtn.className = 'm-keypad-empty-btn';
      addBtn.id = 'btnEmptyAddShortcut';
      addBtn.textContent = '+ ADD FIRST SHORTCUT';
      addBtn.addEventListener('click', () => {
        triggerHaptic(25);
        if (typeof openDrawer === 'function') {
          openDrawer();
        } else if (btnOpenDrawer) {
          btnOpenDrawer.click();
        }
      });
      emptyWrap.appendChild(addBtn);
    }

    keypadGrid.appendChild(emptyWrap);
    return;
  }

  currentButtons.forEach((btnData, i) => {
    const isBackTile = (btnData.id === '__back__' || btnData.actionType === 'folder_back');
    const keyEl = document.createElement('div');
    keyEl.className = `m-lcd-key ${(isEditMode && canEdit && !isBackTile) ? 'edit-mode' : ''} ${isBackTile ? 'm-back-tile' : ''}`;
    keyEl.dataset.buttonId = btnData.id !== undefined ? btnData.id : i;
    if (isBackTile) {
      keyEl.dataset.isBack = 'true';
    }
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

      if (isBackTile) {
        sendButtonClick('__back__');
      } else if (isEditMode && canEdit) {
        openEditModal(btnData);
      } else {
        sendButtonClick(btnData.id);
      }
    });

    const removePressed = () => keyEl.classList.remove('pressed');
    keyEl.addEventListener('pointerup', removePressed);
    keyEl.addEventListener('pointercancel', removePressed);
    keyEl.addEventListener('pointerleave', removePressed);

    // HTML5 Drag & Drop handlers (active only for editors and non-back tiles)
    if (canEdit && !isBackTile) {
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

  // Render [+ ADD TILE] slot in Edit Mode (if editor and under max capacity)
  if (showAddTile) {
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
          const isCli = isTerminalCommand(app.command, app.category);
          const newButton = {
            icon: app.icon || '🚀',
            label: formatAppLabel(app.name),
            sublabel: formatAppSublabel(app.category, app.comment),
            color: '#1c69d4',
            actionType: 'shell',
            command: app.command,
            terminalMode: isCli ? 'tab' : 'background',
            isApplication: !isCli
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
  if (currentFolderStack.length > 0) return;
  triggerHaptic(15);
  if (activeLens !== 'all') {
    if (virtualSubPageIndex > 0) {
      virtualSubPageIndex--;
      renderKeypadState();
    }
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'PAGE_PREV' }));
  }
});

btnPageNext.addEventListener('click', () => {
  if (currentFolderStack.length > 0) return;
  triggerHaptic(15);
  if (activeLens !== 'all') {
    const matchingButtons = cachedAllButtons.filter(b => classifyClientButton(b) === activeLens);
    const totalVirtualPages = Math.max(1, Math.ceil(matchingButtons.length / 15));
    if (virtualSubPageIndex < totalVirtualPages - 1) {
      virtualSubPageIndex++;
      renderKeypadState();
    }
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'PAGE_NEXT' }));
  }
});

// Folder Breadcrumb Back Button
if (btnBreadcrumbBack) {
  btnBreadcrumbBack.addEventListener('click', () => {
    triggerHaptic(15);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'LEAVE_FOLDER' }));
    }
  });
}

// Workspace & Pin Navigation buttons (E3)
if (btnModeM1) {
  btnModeM1.addEventListener('click', () => {
    triggerHaptic(20);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'developer' }));
    }
  });
}

if (btnModeM2) {
  btnModeM2.addEventListener('click', () => {
    triggerHaptic(20);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: 'media' }));
    }
  });
}

if (btnPinWorkspace) {
  btnPinWorkspace.addEventListener('click', () => {
    triggerHaptic(15);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: navigationState.pinned ? 'UNPIN' : 'PIN' }));
    }
  });
}

if (navStatusBadge) {
  navStatusBadge.style.cursor = 'pointer';
  navStatusBadge.addEventListener('click', () => {
    triggerHaptic(15);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: navigationState.pinned ? 'UNPIN' : 'PIN' }));
    }
  });
}

// Unlock Editor Modal Functions
function openUnlockModal() {
  if (unlockModal && inputEditorKey) {
    if (unlockModalError) {
      unlockModalError.style.display = 'none';
      unlockModalError.textContent = '';
    }
    inputEditorKey.value = editorKey || '';
    unlockModal.classList.remove('hidden');
    setTimeout(() => inputEditorKey.focus(), 50);
  } else {
    const entered = window.prompt('Enter Editor Key to unlock configuration controls:');
    if (entered) {
      editorKey = entered.trim();
      localStorage.setItem('arya_editor_key', editorKey);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'AUTH_EDIT', editKey: editorKey }));
      }
    }
  }
}

function submitUnlockKey() {
  if (!inputEditorKey) return;
  const key = inputEditorKey.value.trim();
  if (!key) {
    if (unlockModalError) {
      unlockModalError.textContent = 'Please enter an editor key.';
      unlockModalError.style.display = 'block';
    }
    return;
  }
  editorKey = key;
  localStorage.setItem('arya_editor_key', editorKey);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'AUTH_EDIT', editKey: editorKey }));
  }
}

if (btnUnlockSubmit) {
  btnUnlockSubmit.addEventListener('click', submitUnlockKey);
}
if (inputEditorKey) {
  inputEditorKey.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitUnlockKey();
  });
}
if (btnUnlockModalClose) {
  btnUnlockModalClose.addEventListener('click', () => {
    if (unlockModal) unlockModal.classList.add('hidden');
  });
}
if (btnUnlockCancel) {
  btnUnlockCancel.addEventListener('click', () => {
    if (unlockModal) unlockModal.classList.add('hidden');
  });
}

// Edit Mode Toggle & Editor Unlock
btnEdit.addEventListener('click', () => {
  triggerHaptic(15);
  if (!canEdit) {
    openUnlockModal();
    return;
  }
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

  btnAddTile.addEventListener('dragover', (e) => {
    if (!canEdit) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    btnAddTile.classList.add('drag-over');
  });

  btnAddTile.addEventListener('dragleave', () => {
    btnAddTile.classList.remove('drag-over');
  });

  btnAddTile.addEventListener('drop', (e) => {
    if (!canEdit) return;
    e.preventDefault();
    btnAddTile.classList.remove('drag-over');
    triggerHaptic(30);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw) {
        const app = JSON.parse(raw);
        const isCli = isTerminalCommand(app.command, app.category);
        const newButton = {
          icon: app.icon || '🚀',
          label: formatAppLabel(app.name),
          sublabel: formatAppSublabel(app.category, app.comment),
          color: '#1c69d4',
          actionType: 'shell',
          command: app.command,
          terminalMode: isCli ? 'tab' : 'background',
          isApplication: !isCli
        };
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ADD_BUTTON', button: newButton }));
        }
      }
    } catch (err) {}
  });
}

if (btnRemoveTile) {
  btnRemoveTile.addEventListener('click', () => {
    if (!canEdit) return;
    triggerHaptic(20);
    const candidateButtons = currentButtons.filter(b => b && b.id !== '__back__' && b.actionType !== 'folder_back');
    if (candidateButtons.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const lastBtn = candidateButtons[candidateButtons.length - 1];
      const isConfigured = Boolean(
        (lastBtn.command && lastBtn.command.trim()) ||
        (lastBtn.url && lastBtn.url.trim()) ||
        (lastBtn.actionType === 'folder') ||
        (lastBtn.label && !/^KEY\s*\d+$/i.test(lastBtn.label.trim()))
      );

      if (isConfigured) {
        const itemType = lastBtn.actionType === 'folder' ? 'folder' : 'key';
        const confirmed = window.confirm(`Remove configured ${itemType} "${lastBtn.label || 'KEY'}"?`);
        if (!confirmed) return;
      }

      ws.send(JSON.stringify({ type: 'DELETE_BUTTON', buttonId: lastBtn.id }));
    }
  });
}

window.addEventListener('resize', () => {
  const showAddTile = (isEditMode && canEdit && currentButtons.length < 15);
  const count = showAddTile ? currentButtons.length + 1 : currentButtons.length;
  updateDynamicGridSizing(Math.max(1, count));
});

// Key Configuration Modal
function openEditModal(button) {
  if (!canEdit) return;
  if (button.id === '__back__' || button.actionType === 'folder_back') return;
  editingButtonId = button.id;
  editingButtonFolderId = button.folderId || null;
  modalTitle.textContent = `CONFIGURE KEY ${String(button.id + 1).padStart(2, '0')}`;
  editIcon.value = button.icon || (button.actionType === 'folder' ? '📁' : '⚡');
  editLabel.value = button.label || '';
  editSublabel.value = button.sublabel || '';
  editColor.value = button.color || '#1c69d4';
  editActionType.value = button.actionType || 'shell';
  editCommand.value = button.command || '';
  editTerminalMode.value = button.terminalMode || 'tab';
  editWorkingDir.value = button.workingDir || '';
  editKeepOpen.checked = button.keepOpen !== false;
  editUrl.value = button.url || '';
  if (editCategory) {
    editCategory.value = button.categoryOverride || '';
  }

  toggleActionFields();
  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
  editingButtonId = null;
  editingButtonFolderId = null;
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

  const isFolder = editActionType.value === 'folder';
  const defaultIcon = isFolder ? '📁' : '⚡';
  const updatedButton = {
    id: editingButtonId,
    icon: editIcon.value.trim() || defaultIcon,
    label: editLabel.value.trim().toUpperCase() || (isFolder ? 'FOLDER' : `KEY ${editingButtonId + 1}`),
    sublabel: editSublabel.value.trim().toUpperCase() || '',
    color: editColor.value,
    actionType: editActionType.value,
    command: editCommand.value.trim(),
    terminalMode: editTerminalMode.value,
    workingDir: editWorkingDir.value.trim(),
    keepOpen: editKeepOpen.checked,
    url: editUrl.value.trim(),
    categoryOverride: editCategory ? (editCategory.value.trim() || null) : null
  };

  if (isFolder && editingButtonFolderId) {
    updatedButton.folderId = editingButtonFolderId;
  }

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

// Category Lens Strip
if (categoryLensStrip) {
  categoryLensStrip.addEventListener('click', (e) => {
    const tab = e.target.closest('.m-lens-tab');
    if (!tab) return;
    const lens = tab.dataset.lens;
    if (!lens) return;
    triggerHaptic(15);
    activeLens = lens;
    virtualSubPageIndex = 0;
    categoryLensStrip.querySelectorAll('.m-lens-tab').forEach(t => {
      const isActive = t === tab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    renderKeypadState();
  });
}

// Workspace Settings Modal & CRUD Handlers (E6-2)
function setWorkspaceFormMode(mode, targetWs = null) {
  if (workspaceSettingsError) {
    workspaceSettingsError.style.display = 'none';
    workspaceSettingsError.textContent = '';
  }

  if (mode === 'edit' && targetWs) {
    if (wsFormTitle) wsFormTitle.textContent = `EDIT WORKSPACE: ${targetWs.name || targetWs.id}`;
    if (inputWsId) inputWsId.value = targetWs.id;
    if (inputWsName) inputWsName.value = targetWs.name || '';
    if (inputWsIcon) inputWsIcon.value = targetWs.icon || '⚡';
    if (inputWsMatchApps) {
      const apps = (targetWs.match && Array.isArray(targetWs.match.apps)) ? targetWs.match.apps : [];
      inputWsMatchApps.value = apps.join(', ');
    }
    if (btnCreateWorkspace) btnCreateWorkspace.style.display = 'none';
    if (btnSaveWorkspaceEdit) btnSaveWorkspaceEdit.style.display = '';
    if (btnCancelWorkspaceEdit) btnCancelWorkspaceEdit.style.display = '';
  } else {
    if (wsFormTitle) wsFormTitle.textContent = 'ADD WORKSPACE';
    if (inputWsId) inputWsId.value = '';
    if (inputWsName) inputWsName.value = '';
    if (inputWsIcon) inputWsIcon.value = '⚡';
    if (inputWsMatchApps) inputWsMatchApps.value = '';
    if (btnCreateWorkspace) btnCreateWorkspace.style.display = '';
    if (btnSaveWorkspaceEdit) btnSaveWorkspaceEdit.style.display = 'none';
    if (btnCancelWorkspaceEdit) btnCancelWorkspaceEdit.style.display = 'none';
  }
}

function renderWorkspaceList() {
  if (!workspaceListContainer) return;
  workspaceListContainer.textContent = '';

  if (!Array.isArray(currentWorkspaces) || currentWorkspaces.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.style.color = 'var(--m-body-dim, #64748b)';
    emptyRow.style.fontSize = '11px';
    emptyRow.style.padding = '8px';
    emptyRow.textContent = 'No workspaces available.';
    workspaceListContainer.appendChild(emptyRow);
    return;
  }

  currentWorkspaces.forEach(wsItem => {
    const itemEl = document.createElement('div');
    itemEl.className = 'm-ws-list-item';

    const infoEl = document.createElement('div');
    infoEl.className = 'm-ws-item-info';

    const iconEl = document.createElement('div');
    iconEl.className = 'm-ws-item-icon';
    iconEl.textContent = wsItem.icon || '⚡';

    const detailsEl = document.createElement('div');
    detailsEl.className = 'm-ws-item-details';

    const nameEl = document.createElement('div');
    nameEl.className = 'm-ws-item-name';
    nameEl.textContent = wsItem.name || wsItem.id;

    const metaEl = document.createElement('div');
    metaEl.className = 'm-ws-item-meta';

    const originBadge = document.createElement('span');
    const isBuiltin = wsItem.origin === 'builtin';
    originBadge.className = `m-ws-badge ${isBuiltin ? 'builtin' : 'user'}`;
    originBadge.textContent = isBuiltin ? 'BUILT-IN' : 'USER';
    metaEl.appendChild(originBadge);

    const apps = (wsItem.match && Array.isArray(wsItem.match.apps)) ? wsItem.match.apps : [];
    if (apps.length > 0) {
      const appsSpan = document.createElement('span');
      appsSpan.textContent = `• Apps: ${apps.slice(0, 3).join(', ')}${apps.length > 3 ? '...' : ''}`;
      metaEl.appendChild(appsSpan);
    }

    detailsEl.appendChild(nameEl);
    detailsEl.appendChild(metaEl);

    infoEl.appendChild(iconEl);
    infoEl.appendChild(detailsEl);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'm-ws-item-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'm-ws-action-btn edit';
    editBtn.textContent = 'EDIT';
    editBtn.title = `Edit ${wsItem.name}`;
    editBtn.addEventListener('click', () => {
      triggerHaptic(15);
      setWorkspaceFormMode('edit', wsItem);
      if (inputWsName) inputWsName.focus();
    });
    actionsEl.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'm-ws-action-btn delete';
    delBtn.textContent = 'DELETE';
    if (isBuiltin) {
      delBtn.disabled = true;
      delBtn.title = 'Built-in workspaces cannot be deleted';
    } else {
      delBtn.title = `Delete ${wsItem.name}`;
      delBtn.addEventListener('click', () => {
        triggerHaptic(25);
        if (confirm(`Are you sure you want to delete workspace "${wsItem.name}"?`)) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'WORKSPACE_DELETED', workspaceId: wsItem.id }));
          }
        }
      });
    }
    actionsEl.appendChild(delBtn);

    itemEl.appendChild(infoEl);
    itemEl.appendChild(actionsEl);

    workspaceListContainer.appendChild(itemEl);
  });
}

function openWorkspaceSettingsModal(mode = 'create', targetWs = null) {
  if (!canEdit) {
    if (typeof openUnlockModal === 'function') {
      openUnlockModal();
    } else {
      alert('Editor privilege required to configure workspace settings.');
    }
    return;
  }
  triggerHaptic(15);
  if (toggleSegregation) {
    toggleSegregation.checked = Boolean(currentWorkspaceSegregation && currentWorkspaceSegregation.enabled);
  }
  if (workspaceSettingsSuccess) {
    workspaceSettingsSuccess.style.display = 'none';
    workspaceSettingsSuccess.textContent = '';
  }
  setWorkspaceFormMode(mode, targetWs);
  renderWorkspaceList();
  if (workspaceSettingsModal) {
    workspaceSettingsModal.classList.remove('hidden');
  }
}

if (btnAddWorkspace) {
  btnAddWorkspace.addEventListener('click', () => {
    openWorkspaceSettingsModal('create');
    if (inputWsName) inputWsName.focus();
  });
}

if (btnWorkspaceSettings) {
  btnWorkspaceSettings.addEventListener('click', () => {
    openWorkspaceSettingsModal('create');
  });
}

if (btnCreateWorkspace) {
  btnCreateWorkspace.addEventListener('click', () => {
    if (!canEdit) return;
    const name = inputWsName ? inputWsName.value.trim() : '';
    if (!name) {
      if (workspaceSettingsError) {
        workspaceSettingsError.textContent = 'Workspace name is required.';
        workspaceSettingsError.style.display = 'block';
      }
      return;
    }
    const icon = inputWsIcon ? inputWsIcon.value.trim() : '⚡';
    const matchAppsStr = inputWsMatchApps ? inputWsMatchApps.value : '';
    const matchApps = matchAppsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    triggerHaptic(20);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'CREATE_WORKSPACE',
        name,
        icon: icon || '⚡',
        matchApps
      }));
    }
    if (workspaceSettingsModal) {
      workspaceSettingsModal.classList.add('hidden');
    }
  });
}

if (btnSaveWorkspaceEdit) {
  btnSaveWorkspaceEdit.addEventListener('click', () => {
    if (!canEdit) return;
    const workspaceId = inputWsId ? inputWsId.value : '';
    const name = inputWsName ? inputWsName.value.trim() : '';
    if (!workspaceId || !name) {
      if (workspaceSettingsError) {
        workspaceSettingsError.textContent = 'Workspace name is required.';
        workspaceSettingsError.style.display = 'block';
      }
      return;
    }
    const icon = inputWsIcon ? inputWsIcon.value.trim() : '⚡';
    const matchAppsStr = inputWsMatchApps ? inputWsMatchApps.value : '';
    const matchApps = matchAppsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    triggerHaptic(20);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'UPDATE_WORKSPACE',
        workspaceId,
        name,
        icon: icon || '⚡',
        matchApps
      }));
    }
    setWorkspaceFormMode('create');
  });
}

if (btnCancelWorkspaceEdit) {
  btnCancelWorkspaceEdit.addEventListener('click', () => {
    setWorkspaceFormMode('create');
  });
}

if (btnSettingsModalClose) {
  btnSettingsModalClose.addEventListener('click', () => {
    if (workspaceSettingsModal) workspaceSettingsModal.classList.add('hidden');
  });
}

if (btnSettingsModalDone) {
  btnSettingsModalDone.addEventListener('click', () => {
    if (workspaceSettingsModal) workspaceSettingsModal.classList.add('hidden');
  });
}

if (toggleSegregation) {
  toggleSegregation.addEventListener('change', () => {
    if (!canEdit) return;
    const enabled = toggleSegregation.checked;
    currentWorkspaceSegregation = { enabled };
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'TOGGLE_SEGREGATION', enabled }));
    }
    if (enabled && activeLens === 'all') {
      const termTab = categoryLensStrip ? categoryLensStrip.querySelector('[data-lens="terminal"]') : null;
      if (termTab) termTab.click();
    } else if (!enabled && activeLens !== 'all') {
      const allTab = categoryLensStrip ? categoryLensStrip.querySelector('[data-lens="all"]') : null;
      if (allTab) allTab.click();
    }
  });
}

if (btnExportConfig) {
  btnExportConfig.addEventListener('click', async () => {
    if (!canEdit) return;
    triggerHaptic(15);
    if (workspaceSettingsError) workspaceSettingsError.style.display = 'none';
    if (workspaceSettingsSuccess) workspaceSettingsSuccess.style.display = 'none';

    try {
      const url = pairingToken ? `/api/config/export?token=${encodeURIComponent(pairingToken)}` : '/api/config/export';
      const headers = {};
      if (pairingToken) headers['Authorization'] = `Bearer ${pairingToken}`;
      if (editorKey) headers['X-Editor-Key'] = editorKey;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const disposition = res.headers.get('content-disposition') || '';
      let filename = 'arya-dock-config.json';
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      if (workspaceSettingsSuccess) {
        workspaceSettingsSuccess.textContent = `Configuration successfully exported as ${filename}`;
        workspaceSettingsSuccess.style.display = 'block';
      }
    } catch (err) {
      if (workspaceSettingsError) {
        workspaceSettingsError.textContent = `Export failed: ${err.message}`;
        workspaceSettingsError.style.display = 'block';
      }
    }
  });
}

if (btnImportConfig && inputImportFile) {
  btnImportConfig.addEventListener('click', () => {
    if (!canEdit) return;
    triggerHaptic(15);
    inputImportFile.value = '';
    inputImportFile.click();
  });

  inputImportFile.addEventListener('change', () => {
    if (!inputImportFile.files || inputImportFile.files.length === 0) return;
    const file = inputImportFile.files[0];

    if (file.size > 2 * 1024 * 1024) {
      if (workspaceSettingsError) {
        workspaceSettingsError.textContent = 'Configuration file exceeds 2MB limit.';
        workspaceSettingsError.style.display = 'block';
      }
      inputImportFile.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        if (workspaceSettingsError) workspaceSettingsError.style.display = 'none';
        if (workspaceSettingsSuccess) workspaceSettingsSuccess.style.display = 'none';

        const text = e.target.result;
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          throw new Error('Selected file is not valid JSON.');
        }

        // Count custom shell actions for RCE user warning
        let shellCount = 0;
        const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
        for (const ws of workspaces) {
          if (Array.isArray(ws.pages)) {
            for (const page of ws.pages) {
              if (Array.isArray(page.buttons)) {
                for (const btn of page.buttons) {
                  if (btn && btn.actionType === 'shell' && typeof btn.command === 'string' && btn.command.trim().length > 0) {
                    shellCount++;
                  }
                }
              }
            }
          }
        }

        let confirmMsg = 'Importing this configuration will replace all current workspaces and shortcuts.\n\n' +
                         'A safety backup of your existing configuration will be preserved on the server.\n\n';
        if (shellCount > 0) {
          confirmMsg += `⚠️ WARNING: This configuration contains ${shellCount} custom shell command(s).\n` +
                        `Shell commands execute directly on your Linux host with your user privileges.\n` +
                        `Only import configurations from authors or sources you trust.\n\n`;
        }
        confirmMsg += 'Do you wish to proceed?';

        if (!window.confirm(confirmMsg)) {
          inputImportFile.value = '';
          return;
        }

        const url = pairingToken ? `/api/config/import?token=${encodeURIComponent(pairingToken)}` : '/api/config/import';
        const headers = { 'Content-Type': 'application/json' };
        if (pairingToken) headers['Authorization'] = `Bearer ${pairingToken}`;
        if (editorKey) headers['X-Editor-Key'] = editorKey;

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: text
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        if (workspaceSettingsSuccess) {
          workspaceSettingsSuccess.textContent = `Configuration imported successfully (${data.workspaceCount || 'multiple'} workspaces loaded).`;
          workspaceSettingsSuccess.style.display = 'block';
        }
        renderWorkspaceList();
      } catch (err) {
        if (workspaceSettingsError) {
          workspaceSettingsError.textContent = `Import failed: ${err.message}`;
          workspaceSettingsError.style.display = 'block';
        }
      } finally {
        inputImportFile.value = '';
      }
    };
    reader.onerror = () => {
      if (workspaceSettingsError) {
        workspaceSettingsError.textContent = 'Failed to read file from disk.';
        workspaceSettingsError.style.display = 'block';
      }
      inputImportFile.value = '';
    };
    reader.readAsText(file);
  });
}

// ==========================================================================
// FIRST-RUN ONBOARDING WIZARD CONTROLLER (EPIC E4-1 & E4-3)
// ==========================================================================

function setWizardStep(step) {
  currentWizardStep = step;

  if (step === 1) {
    if (wizardStepDetect) wizardStepDetect.classList.remove('hidden');
    if (wizardStepWorkspaces) wizardStepWorkspaces.classList.add('hidden');
    if (wizardStepFinish) wizardStepFinish.classList.add('hidden');

    if (stepDot1) { stepDot1.classList.add('active'); stepDot1.classList.remove('completed'); }
    if (stepDot2) { stepDot2.classList.remove('active', 'completed'); }
    if (stepDot3) { stepDot3.classList.remove('active', 'completed'); }
    if (stepLine1) stepLine1.classList.remove('active');
    if (stepLine2) stepLine2.classList.remove('active');

    if (btnWizardPrev) btnWizardPrev.classList.add('hidden');
    if (btnWizardNext) {
      btnWizardNext.classList.remove('hidden');
      btnWizardNext.textContent = 'NEXT: SELECT STARTERS ▶';
    }
    if (btnWizardApply) btnWizardApply.classList.add('hidden');
    if (btnWizardSkip) btnWizardSkip.classList.remove('hidden');

    fetchHostEcosystem();
  } else if (step === 2) {
    if (wizardStepDetect) wizardStepDetect.classList.add('hidden');
    if (wizardStepWorkspaces) wizardStepWorkspaces.classList.remove('hidden');
    if (wizardStepFinish) wizardStepFinish.classList.add('hidden');

    if (stepDot1) { stepDot1.classList.remove('active'); stepDot1.classList.add('completed'); }
    if (stepDot2) { stepDot2.classList.add('active'); stepDot2.classList.remove('completed'); }
    if (stepDot3) { stepDot3.classList.remove('active', 'completed'); }
    if (stepLine1) stepLine1.classList.add('active');
    if (stepLine2) stepLine2.classList.remove('active');

    if (btnWizardPrev) btnWizardPrev.classList.remove('hidden');
    if (btnWizardNext) btnWizardNext.classList.add('hidden');
    if (btnWizardApply) {
      btnWizardApply.classList.remove('hidden');
      btnWizardApply.textContent = 'APPLY & LAUNCH DECK 🚀';
    }
    if (btnWizardSkip) btnWizardSkip.classList.remove('hidden');
  } else if (step === 3) {
    if (wizardStepDetect) wizardStepDetect.classList.add('hidden');
    if (wizardStepWorkspaces) wizardStepWorkspaces.classList.add('hidden');
    if (wizardStepFinish) wizardStepFinish.classList.remove('hidden');

    if (stepDot1) { stepDot1.classList.remove('active'); stepDot1.classList.add('completed'); }
    if (stepDot2) { stepDot2.classList.remove('active'); stepDot2.classList.add('completed'); }
    if (stepDot3) { stepDot3.classList.add('active'); }
    if (stepLine1) stepLine1.classList.add('active');
    if (stepLine2) stepLine2.classList.add('active');

    if (btnWizardPrev) btnWizardPrev.classList.remove('hidden');
    if (btnWizardNext) btnWizardNext.classList.add('hidden');
    if (btnWizardApply) {
      btnWizardApply.classList.remove('hidden');
      btnWizardApply.textContent = 'APPLY & LAUNCH DECK 🚀';
    }
    if (btnWizardSkip) btnWizardSkip.classList.remove('hidden');
  }
}

function openOnboardingWizard(initialStep = 1) {
  if (!onboardingWizardModal) return;
  onboardingWizardModal.classList.remove('hidden');

  if (wizardOperatorNotice) {
    if (!canEdit) {
      wizardOperatorNotice.classList.remove('hidden');
    } else {
      wizardOperatorNotice.classList.add('hidden');
    }
  }

  setWizardStep(initialStep);
}

function closeOnboardingWizard() {
  if (onboardingWizardModal) {
    onboardingWizardModal.classList.add('hidden');
  }
}

async function fetchHostEcosystem(forceRefresh = false) {
  if (!wizardDetectGrid) return;

  if (!canEdit) {
    if (wizardDetectSpinner) wizardDetectSpinner.classList.add('hidden');
    if (wizardDetectSummary) {
      wizardDetectSummary.textContent = 'Host diagnostic scan requires editor permissions. Unlock editor mode above or proceed with curated starter presets.';
    }
    wizardDetectGrid.textContent = '';
    const sampleTools = [
      { name: 'VS Code', icon: '💻', binary: 'code' },
      { name: 'Terminal', icon: '⚡', binary: 'bash' },
      { name: 'Git', icon: '🌿', binary: 'git' },
      { name: 'Docker', icon: '🐳', binary: 'docker' }
    ];
    sampleTools.forEach(t => {
      const item = document.createElement('div');
      item.className = 'm-detect-item';
      const iconSpan = document.createElement('span');
      iconSpan.className = 'm-detect-icon';
      iconSpan.textContent = t.icon;
      const infoDiv = document.createElement('div');
      infoDiv.className = 'm-detect-info';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'm-detect-name';
      nameSpan.textContent = t.name;
      const binSpan = document.createElement('span');
      binSpan.className = 'm-detect-binary';
      binSpan.textContent = t.binary;
      infoDiv.appendChild(nameSpan);
      infoDiv.appendChild(binSpan);
      item.appendChild(iconSpan);
      item.appendChild(infoDiv);
      wizardDetectGrid.appendChild(item);
    });
    return;
  }

  if (wizardDetectSpinner) wizardDetectSpinner.classList.remove('hidden');

  try {
    const url = pairingToken
      ? `/api/presets/detect?token=${encodeURIComponent(pairingToken)}${forceRefresh ? '&refresh=true' : ''}`
      : `/api/presets/detect${forceRefresh ? '?refresh=true' : ''}`;
    const headers = {};
    if (pairingToken) headers['Authorization'] = `Bearer ${pairingToken}`;
    if (editorKey) headers['X-Editor-Key'] = editorKey;

    const res = await fetch(url, { headers });
    if (wizardDetectSpinner) wizardDetectSpinner.classList.add('hidden');

    if (res.ok) {
      const data = await res.json();
      detectedEcosystemData = data;
      const tools = data.detectedTools || [];
      const appsCount = data.desktopAppsCount || 0;

      if (wizardDetectSummary) {
        if (tools.length > 0) {
          wizardDetectSummary.textContent = `Host scan complete: identified ${tools.length} developer tools and ${appsCount} desktop applications.`;
        } else {
          wizardDetectSummary.textContent = 'Minimal / container environment detected. Ready to seed standard developer cockpit with baseline CLI tools.';
        }
      }

      wizardDetectGrid.textContent = '';
      if (tools.length > 0) {
        tools.forEach(t => {
          const item = document.createElement('div');
          item.className = 'm-detect-item';
          const iconSpan = document.createElement('span');
          iconSpan.className = 'm-detect-icon';
          iconSpan.textContent = t.icon || '⚡';
          const infoDiv = document.createElement('div');
          infoDiv.className = 'm-detect-info';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'm-detect-name';
          nameSpan.textContent = t.name;
          const binSpan = document.createElement('span');
          binSpan.className = 'm-detect-binary';
          binSpan.textContent = t.binary || '';
          infoDiv.appendChild(nameSpan);
          infoDiv.appendChild(binSpan);
          item.appendChild(iconSpan);
          item.appendChild(infoDiv);
          wizardDetectGrid.appendChild(item);
        });
      } else {
        const fallbacks = [
          { name: 'Bash Terminal', icon: '⚡', binary: 'bash' },
          { name: 'Git Status', icon: '🌿', binary: 'git' },
          { name: 'System Info', icon: '📊', binary: 'uname' }
        ];
        fallbacks.forEach(t => {
          const item = document.createElement('div');
          item.className = 'm-detect-item';
          const iconSpan = document.createElement('span');
          iconSpan.className = 'm-detect-icon';
          iconSpan.textContent = t.icon;
          const infoDiv = document.createElement('div');
          infoDiv.className = 'm-detect-info';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'm-detect-name';
          nameSpan.textContent = t.name;
          const binSpan = document.createElement('span');
          binSpan.className = 'm-detect-binary';
          binSpan.textContent = t.binary;
          infoDiv.appendChild(nameSpan);
          infoDiv.appendChild(binSpan);
          item.appendChild(iconSpan);
          item.appendChild(infoDiv);
          wizardDetectGrid.appendChild(item);
        });
      }
    } else {
      if (wizardDetectSummary) {
        wizardDetectSummary.textContent = 'Could not run diagnostic scan. Curated starter templates remain available below.';
      }
    }
  } catch (err) {
    if (wizardDetectSpinner) wizardDetectSpinner.classList.add('hidden');
    if (wizardDetectSummary) {
      wizardDetectSummary.textContent = 'Diagnostic scan offline. Curated starter templates remain available below.';
    }
    console.warn('Diagnostic scan error:', err);
  }
}

function applyStarterWorkspaces() {
  if (!canEdit) {
    if (typeof openUnlockModal === 'function') openUnlockModal();
    return;
  }

  const selectedIds = [];
  if (checkWsDev && checkWsDev.checked) selectedIds.push('developer');
  if (checkWsDevops && checkWsDevops.checked) selectedIds.push('devops');
  if (checkWsMedia && checkWsMedia.checked) selectedIds.push('media');
  if (checkWsSys && checkWsSys.checked) selectedIds.push('system');

  if (selectedIds.length === 0) {
    selectedIds.push('developer');
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'APPLY_STARTER_WORKSPACES',
      workspaceIds: selectedIds,
      mode: 'replace'
    }));
  }

  closeOnboardingWizard();
}

function skipOnboarding() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'COMPLETE_ONBOARDING',
      skip: true
    }));
  }
  closeOnboardingWizard();
}

// Wizard Event Listeners
if (btnWizardNext) {
  btnWizardNext.addEventListener('click', () => {
    if (currentWizardStep === 1) {
      setWizardStep(2);
    } else if (currentWizardStep === 2) {
      setWizardStep(3);
    }
  });
}

if (btnWizardPrev) {
  btnWizardPrev.addEventListener('click', () => {
    if (currentWizardStep === 3) {
      setWizardStep(2);
    } else if (currentWizardStep === 2) {
      setWizardStep(1);
    }
  });
}

if (btnWizardApply) {
  btnWizardApply.addEventListener('click', () => {
    applyStarterWorkspaces();
  });
}

if (btnWizardSkip) {
  btnWizardSkip.addEventListener('click', () => {
    skipOnboarding();
  });
}

if (btnWizardClose) {
  btnWizardClose.addEventListener('click', () => {
    closeOnboardingWizard();
  });
}

if (btnOpenWizard) {
  btnOpenWizard.addEventListener('click', () => {
    openOnboardingWizard(1);
  });
}

if (btnWizardUnlockEditor) {
  btnWizardUnlockEditor.addEventListener('click', () => {
    if (typeof openUnlockModal === 'function') openUnlockModal();
  });
}

// Initialize
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadInstalledApplications();
loadPresetsCatalog();
updateEditorUI();
connectWebSocket();
