// ==========================================================================
// Motorsport ARYA DOCK — CLIENT CONTROLLER
// Drag-and-drop app assignment, system application catalog, and M telemetry.
// ==========================================================================

let ws = null;
let currentButtons = [];
let installedApps = [];
let isEditMode = false;
let editingButtonId = null;
let pickerTargetButtonId = null;
let selectedAppForPopup = null;
let wakeLock = null;

// Built-in Motorsport Quick Presets
const MOTORSPORT_PRESETS = [
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

// Fetch Installed Applications from Server
async function loadInstalledApplications() {
  try {
    const res = await fetch('/api/apps');
    if (res.ok) {
      installedApps = await res.json();
    }
  } catch (err) {
    console.warn('Could not fetch /api/apps, using presets:', err);
    installedApps = [];
  }
  renderAppCatalog('all');
}

// Render the App Drawer Cards (with Drag & Drop support)
function renderAppCatalog(filterCategory = 'all', searchQuery = '') {
  appsList.innerHTML = '';

  let list = [];
  if (filterCategory === 'presets') {
    list = MOTORSPORT_PRESETS;
  } else {
    // Merge presets and installed apps
    const combined = [...MOTORSPORT_PRESETS, ...installedApps];
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
    appsList.innerHTML = '<div class="m-loading-apps">NO MATCHING APPLICATIONS FOUND</div>';
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

    // HTML5 Drag & Drop start
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(appPayload));
      e.dataTransfer.effectAllowed = 'copy';
      card.style.opacity = '0.5';
    });

    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
    });

    // Touch / Tap support: Open Quick Assign popup or modal picker
    card.addEventListener('click', () => {
      triggerHaptic(15);
      if (pickerTargetButtonId !== null) {
        // Modal picker mode: populate modal fields
        editIcon.value = appPayload.icon;
        editLabel.value = formatAppLabel(appPayload.name);
        editSublabel.value = formatAppSublabel(appPayload.category, appPayload.comment);
        editActionType.value = 'shell';
        editCommand.value = appPayload.command;
        toggleActionFields();
        closeDrawer();
        pickerTargetButtonId = null;
      } else {
        // Direct tap-to-assign on key
        openAssignPopup(appPayload);
      }
    });

    card.innerHTML = `
      <div class="m-app-icon">${app.emoji || '🚀'}</div>
      <div class="m-app-info">
        <div class="m-app-name">${app.name}</div>
        <div class="m-app-meta">${app.comment || app.command}</div>
      </div>
      <div class="m-drag-handle" title="Drag onto Key">⠿</div>
    `;

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
  appDrawer.classList.remove('hidden');
  appSearchInput.focus();
}

function closeDrawer() {
  appDrawer.classList.add('hidden');
  pickerTargetButtonId = null;
}

btnOpenDrawer.addEventListener('click', openDrawer);
btnBannerOpenApps.addEventListener('click', openDrawer);
btnDrawerClose.addEventListener('click', closeDrawer);

// Quick Assign Popup (Tap-to-Assign for Touch / Mobile)
function openAssignPopup(appPayload) {
  selectedAppForPopup = appPayload;
  popupAppTitle.textContent = `ASSIGN "${appPayload.name.toUpperCase()}"`;
  popupTargetGrid.innerHTML = '';

  for (let i = 0; i < 9; i++) {
    const btn = document.createElement('button');
    btn.className = 'm-target-btn';
    btn.innerHTML = `KEY ${i + 1}`;
    btn.addEventListener('click', () => {
      triggerHaptic(25);
      assignAppToButton(i, selectedAppForPopup);
      closeAssignPopup();
      closeDrawer();
    });
    popupTargetGrid.appendChild(btn);
  }

  assignPopup.classList.remove('hidden');
}

function closeAssignPopup() {
  assignPopup.classList.add('hidden');
  selectedAppForPopup = null;
}

btnPopupClose.addEventListener('click', closeAssignPopup);

// Assign App to Key & Push to Server
function assignAppToButton(buttonIndex, app) {
  const colorPalette = ['#0066b1', '#1c69d4', '#e22718', '#0066b1', '#1c69d4', '#e22718', '#2b2b2b', '#1c69d4', '#0066b1'];
  const updatedButton = {
    id: buttonIndex,
    icon: app.icon || '🚀',
    label: formatAppLabel(app.name),
    sublabel: formatAppSublabel(app.category, app.comment),
    color: colorPalette[buttonIndex % colorPalette.length],
    actionType: 'shell',
    command: app.command
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'UPDATE_BUTTON', button: updatedButton }));
  }

  flashButtonAck(buttonIndex);
}

// WebSocket Setup
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  connectionStatus.className = 'm-status-pill disconnected';
  statusText.textContent = 'DISCONNECTED';

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connectionStatus.className = 'm-status-pill connected';
    statusText.textContent = 'M ONLINE';
  };

  ws.onclose = () => {
    connectionStatus.className = 'm-status-pill disconnected';
    statusText.textContent = 'OFFLINE';
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error('Error handling message:', e);
    }
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'INIT':
      updateActiveModeButtons(data.activeProfileId);
      updatePageInfo(data.pageNumber, data.totalPages, data.pageName);
      renderButtons(data.buttons);
      break;

    case 'STATE_UPDATE':
      updateActiveModeButtons(data.activeProfileId);
      updatePageInfo(data.pageNumber, data.totalPages, data.pageName);
      renderButtons(data.buttons);
      break;

    case 'BUTTON_ACK':
      flashButtonAck(data.buttonId);
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

// Render 9 Keypad Buttons with HTML5 Drag & Drop targets
function renderButtons(buttons) {
  currentButtons = buttons;
  keypadGrid.innerHTML = '';

  for (let i = 0; i < 9; i++) {
    const btnData = buttons.find(b => b.id === i) || {
      id: i,
      label: `KEY ${i + 1}`,
      sublabel: 'EMPTY',
      icon: '◻️',
      color: '#1c69d4'
    };

    const keyEl = document.createElement('div');
    keyEl.className = `m-lcd-key ${isEditMode ? 'edit-mode' : ''}`;
    keyEl.dataset.buttonId = i;
    keyEl.style.setProperty('--key-accent', btnData.color || '#1c69d4');

    keyEl.innerHTML = `
      <div class="m-key-icon">${btnData.icon || '⚡'}</div>
      <div class="m-key-label">${btnData.label || ''}</div>
      <div class="m-key-sublabel">${btnData.sublabel || ''}</div>
    `;

    // Pointer events for instant low latency clicks
    keyEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      triggerHaptic(20);
      keyEl.classList.add('pressed');

      if (isEditMode) {
        openEditModal(btnData);
      } else {
        sendButtonClick(btnData.id);
      }
    });

    const removePressed = () => keyEl.classList.remove('pressed');
    keyEl.addEventListener('pointerup', removePressed);
    keyEl.addEventListener('pointercancel', removePressed);
    keyEl.addEventListener('pointerleave', removePressed);

    // ======================================================================
    // HTML5 DRAG & DROP TARGET HANDLERS
    // Drag any app or preset directly onto this key!
    // ======================================================================
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
          assignAppToButton(i, app);
        }
      } catch (err) {
        console.error('Drop error:', err);
      }
    });

    keypadGrid.appendChild(keyEl);
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

// Steering Shift Paddles (HID 0x01a1 & 0x01a2)
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

// M Drive Mode buttons (M1 / M2)
btnModeM1.addEventListener('click', () => {
  triggerHaptic(20);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: 'developer' }));
  }
});

btnModeM2.addEventListener('click', () => {
  triggerHaptic(20);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: 'media' }));
  }
});

// Edit Mode Toggle
btnEdit.addEventListener('click', () => {
  isEditMode = !isEditMode;
  btnEdit.classList.toggle('active', isEditMode);
  const keys = keypadGrid.querySelectorAll('.m-lcd-key');
  keys.forEach(k => k.classList.toggle('edit-mode', isEditMode));
});

// Key Configuration Modal
function openEditModal(button) {
  editingButtonId = button.id;
  modalTitle.textContent = `CONFIGURE KEY ${String(button.id + 1).padStart(2, '0')}`;
  editIcon.value = button.icon || '⚡';
  editLabel.value = button.label || '';
  editSublabel.value = button.sublabel || '';
  editColor.value = button.color || '#1c69d4';
  editActionType.value = button.actionType || 'shell';
  editCommand.value = button.command || '';
  editUrl.value = button.url || '';

  toggleActionFields();
  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
  editingButtonId = null;
}

btnModalClose.addEventListener('click', closeEditModal);

// Modal "Choose from Installed Apps" button
btnPickFromApps.addEventListener('click', () => {
  pickerTargetButtonId = editingButtonId;
  openDrawer();
});

editActionType.addEventListener('change', toggleActionFields);

function toggleActionFields() {
  const type = editActionType.value;
  if (type === 'url') {
    commandGroup.classList.add('hidden');
    urlGroup.classList.remove('hidden');
  } else {
    commandGroup.classList.remove('hidden');
    urlGroup.classList.add('hidden');
  }
}

btnModalTest.addEventListener('click', () => {
  if (editingButtonId !== null) {
    sendButtonClick(editingButtonId);
  }
});

btnModalSave.addEventListener('click', () => {
  if (editingButtonId === null) return;

  const updatedButton = {
    id: editingButtonId,
    icon: editIcon.value.trim() || '⚡',
    label: editLabel.value.trim().toUpperCase() || `KEY ${editingButtonId + 1}`,
    sublabel: editSublabel.value.trim().toUpperCase() || '',
    color: editColor.value,
    actionType: editActionType.value,
    command: editCommand.value.trim(),
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
loadInstalledApplications();
connectWebSocket();
