let ws = null;
let currentButtons = [];
let isEditMode = false;
let editingButtonId = null;
let wakeLock = null;

// DOM Elements
const keypadGrid = document.getElementById('keypadGrid');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = connectionStatus.querySelector('.status-text');
const pageLabel = document.getElementById('pageLabel');
const pageName = document.getElementById('pageName');
const profileSelect = document.getElementById('profileSelect');
const btnPagePrev = document.getElementById('btnPagePrev');
const btnPageNext = document.getElementById('btnPageNext');
const btnEdit = document.getElementById('btnEdit');
const btnWakeLock = document.getElementById('btnWakeLock');
const btnFullscreen = document.getElementById('btnFullscreen');
const transportMode = document.getElementById('transportMode');

// Edit Modal Elements
const editModal = document.getElementById('editModal');
const btnModalClose = document.getElementById('btnModalClose');
const modalTitle = document.getElementById('modalTitle');
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
    transportMode.textContent = 'Mode: Cable (USB / ADB)';
  } else {
    transportMode.textContent = `Mode: Wireless / BT (${host})`;
  }
}
updateTransportDisplay();

// Haptic feedback helper
function triggerHaptic(duration = 18) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(duration);
    } catch (e) {
      // ignore
    }
  }
}

// WebSocket Setup
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  connectionStatus.className = 'status-badge disconnected';
  statusText.textContent = 'Connecting...';

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connectionStatus.className = 'status-badge connected';
    statusText.textContent = 'Ready';
  };

  ws.onclose = () => {
    connectionStatus.className = 'status-badge disconnected';
    statusText.textContent = 'Offline';
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };

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
      populateProfiles(data.profiles, data.activeProfileId);
      updatePageInfo(data.pageNumber, data.totalPages, data.pageName);
      renderButtons(data.buttons);
      break;

    case 'STATE_UPDATE':
      if (profileSelect.value !== data.activeProfileId) {
        profileSelect.value = data.activeProfileId;
      }
      updatePageInfo(data.pageNumber, data.totalPages, data.pageName);
      renderButtons(data.buttons);
      break;

    case 'BUTTON_ACK':
      flashButtonAck(data.buttonId);
      break;
  }
}

function populateProfiles(profiles, activeId) {
  profileSelect.innerHTML = '';
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activeId) opt.selected = true;
    profileSelect.appendChild(opt);
  }
}

function updatePageInfo(pageNum, totalPages, name) {
  pageLabel.textContent = `PAGE ${pageNum} / ${totalPages}`;
  pageName.textContent = name;
}

function renderButtons(buttons) {
  currentButtons = buttons;
  keypadGrid.innerHTML = '';

  for (let i = 0; i < 9; i++) {
    const btnData = buttons.find(b => b.id === i) || {
      id: i,
      label: `Key ${i + 1}`,
      sublabel: 'Empty',
      icon: '◻️',
      color: '#334155'
    };

    const keyEl = document.createElement('div');
    keyEl.className = `lcd-key ${isEditMode ? 'edit-mode' : ''}`;
    keyEl.dataset.buttonId = i;
    keyEl.style.setProperty('--key-glow', `${btnData.color || '#6366f1'}44`);
    keyEl.style.borderTopColor = btnData.color || '#334155';

    keyEl.innerHTML = `
      <div class="key-icon">${btnData.icon || '⚡'}</div>
      <div class="key-label">${btnData.label || ''}</div>
      <div class="key-sublabel">${btnData.sublabel || ''}</div>
    `;

    // Pointer events for instant low-latency touch response
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
    el.style.transform = 'scale(0.95)';
    setTimeout(() => {
      el.style.transform = '';
    }, 120);
  }
}

// Paging Buttons (Virtual HID 0x01a1 & 0x01a2)
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

// Profile Selection
profileSelect.addEventListener('change', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'SET_PROFILE', profileId: profileSelect.value }));
  }
});

// Edit Mode Toggle
btnEdit.addEventListener('click', () => {
  isEditMode = !isEditMode;
  btnEdit.classList.toggle('active', isEditMode);
  const keys = keypadGrid.querySelectorAll('.lcd-key');
  keys.forEach(k => k.classList.toggle('edit-mode', isEditMode));
});

// Modal Logic
function openEditModal(button) {
  editingButtonId = button.id;
  modalTitle.textContent = `Edit Button #${button.id + 1}`;
  editIcon.value = button.icon || '⚡';
  editLabel.value = button.label || '';
  editSublabel.value = button.sublabel || '';
  editColor.value = button.color || '#6366f1';
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
    label: editLabel.value.trim() || `Key ${editingButtonId + 1}`,
    sublabel: editSublabel.value.trim() || '',
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

// Wake Lock API (Keep screen awake on phone)
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

// Fullscreen API Toggle
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    btnFullscreen.classList.add('active');
  } else {
    document.exitFullscreen().catch(() => {});
    btnFullscreen.classList.remove('active');
  }
});

// Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('SW registration failed:', err);
    });
  });
}

// Start
connectWebSocket();
