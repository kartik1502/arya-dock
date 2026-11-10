# Architectural Synthesis Report: First-Run Onboarding Wizard & Preset Catalog (Epic E4-1 & E4-3)

**Target:** `docs/designs/onboarding-and-preset-catalog.md`  
**Destination Report Path:** `docs/designs/reviews/onboarding_presets_synthesis_report.md`  
**Synthesizer Persona:** EGM Synthesizer  
**Date:** 2026-11-09  

---

## 1. Reviewer Status

| Reviewer Persona | Lens & Perspective | Status | Findings Contributed |
|---|---|---|---|
| `naive_reader` | User Onboarding, Operator UX & Touch Ergonomics | **completed** | 4 (1 Blocker, 2 Major, 1 Nit) |
| `skeptical_architect` | Concurrency, System State Reconciliation & FS DoS | **completed** | 4 (2 Blockers, 2 Major, 0 Nits) |
| `hostile_design_critic` | Security Boundaries, Privilege Separation & Prototype Safety | **completed** | 4 (2 Blockers, 1 Major, 1 Nit) |

---

## 2. Prioritized Findings (Blockers ➔ Major ➔ Nits)

### 🔴 Blocker 1: Unauthenticated Host Reconnaissance via `/api/presets/detect`
* **Reviewer Lens:** `hostile_design_critic`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.2
* **Discrepancy Description:** The specification originally stated that `GET /api/presets/detect` is accessible with only a pairing token. An unprivileged companion deck (or any client with network pairing credentials) could probe the host filesystem for all installed tools, IDEs, desktop applications, and project directory paths.
* **Rationale & Recommendation:** Elevate the privilege requirement for `GET /api/presets/detect` to require **both** `checkHttpAuth()` (pairing token) and `checkEditorPrivilege()` (editor key). Operators must be strictly barred from host filesystem reconnaissance. For operator companion screens, serve a static catalog preview or prompt for editor elevation before initiating discovery.

### 🔴 Blocker 2: Client-Role Deadlock on Companion Deck First-Boot
* **Reviewer Lens:** `naive_reader`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.3
* **Discrepancy Description:** When a user pairs a mobile device via QR code, the connection defaults to `role: 'operator'` (`canEdit: false`). If the wizard pops up automatically and prompts the operator to select and apply starter workspaces, submitting the form will trigger a `403 Forbidden` rejection, causing an immediate UX deadlock.
* **Rationale & Recommendation:** Design the wizard with an explicit **Guided Preview Mode** for operators. When `canEdit === false`, display an informational banner and an **"Unlock Editor Mode"** CTA (`#btnWizardUnlockEditor`). When clicked, it opens `#unlockModal` to authenticate the editor key. Only elevate and mutate when the editor role is verified.

### 🔴 Blocker 3: Prototype Pollution via Unchecked Starter Workspace IDs
* **Reviewer Lens:** `hostile_design_critic`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.2 & `lib/ws.js`
* **Discrepancy Description:** `APPLY_STARTER_WORKSPACES` and `POST /api/presets/apply` accept arbitrary `workspaceIds` in the payload. Dynamically querying or indexing objects with client-supplied strings opens prototype pollution vectors (`__proto__`, `constructor`, `toString`) and injection of rogue workspace structures.
* **Rationale & Recommendation:** Enforce a strict enum allowlist: `const ALLOWED_STARTER_IDS = new Set(['developer', 'devops', 'media', 'system'])`. Lookups must use `Map` or `Object.create(null)`. All incoming JSON payloads must pass through a reviver function rejecting `__proto__`, `constructor`, and `prototype`.

### 🔴 Blocker 4: Multi-Client Socket Desynchronization & Zombie Pointers
* **Reviewer Lens:** `skeptical_architect`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.2 & `server.js`
* **Discrepancy Description:** Applying starter workspaces replaces or mutates `appConfig.workspaces`. If other companion clients are connected, their in-flight `navState.workspaceId` or `folderStack` will reference deleted or re-indexed structures, resulting in blank screens or silent crashes.
* **Rationale & Recommendation:** Mirror the exact `onImportConfig` pattern:
  1. Cancel pending config save timers.
  2. Write to disk first atomically with timestamped backup (`saveConfigAtomic`).
  3. Mutate in-memory config.
  4. Reset server navigation state.
  5. Reconcile all connected sockets: if their current `workspaceId` no longer exists, reassign to `activeWorkspaceId` and clamp `pageIndex`.
  6. Broadcast `STATE_UPDATE` to all companion clients.

### 🔴 Blocker 5: 15-Tile Physical Grid Ceiling Breach ($N > 15$)
* **Reviewer Lens:** `skeptical_architect`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.1 & §3.1
* **Discrepancy Description:** If the scanner detects 20+ development tools, naively dumping them into a single starter workspace page violates the hardware and touch-grid invariant of $\le 15$ tiles per page ($5 \times 3$ grid).
* **Rationale & Recommendation:** Implement deterministic multi-page partitioning using `chunkArray(detectedButtons, 15)`. Generated workspaces must partition overflow shortcuts into sequential pages (`Page 1`, `Page 2`, etc.). For generated folders, cap buttons at $\le 14$ tiles, reserving slot 0 for the system back tile (`__back__`).

---

### 🟡 Major 6: Filesystem Scan Denial-of-Service & PATH Delimiter Bug
* **Reviewer Lens:** `skeptical_architect`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.1
* **Discrepancy Description:** `fs.accessSync` across every directory in `$PATH` on every HTTP request can cause disk I/O thrashing. Additionally, `process.env.PATH.split(':')` breaks on Windows systems (which use `;`).
* **Rationale & Recommendation:** 
  1. Use `path.delimiter` instead of hardcoded `':'`.
  2. Introduce a 60-second in-memory memoization cache for detection results.
  3. Implement single-flight request coalescing (concurrent requests share the running Promise).
  4. Allow cache bypass only via `?refresh=true` with editor credentials.

### 🟡 Major 7: Divergent Dual Sources of Truth for Presets
* **Reviewer Lens:** `hostile_design_critic`
* **Affected Scope:** `public/app.js` vs `lib/presets.js`
* **Discrepancy Description:** `public/app.js` maintains a hardcoded `PRESETS` array, while `lib/presets.js` introduces backend detection and starter templates. This creates duplicate catalogs that inevitably diverge.
* **Rationale & Recommendation:** Centralize all presets and templates in `lib/presets.js`. Expose `GET /api/presets/catalog` (accessible to paired clients) and have `public/app.js` consume presets dynamically, retiring the client-side hardcoded array.

### 🟡 Major 8: Touchscreen Usability Failure (Drag-and-Drop Reliance)
* **Reviewer Lens:** `naive_reader`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.3
* **Discrepancy Description:** Relying on HTML5 drag-and-drop to assign presets from the drawer to keypad slots fails completely on mobile touch screens (iOS Safari and Android Chrome touch events do not fire native drag events).
* **Rationale & Recommendation:** Provide a primary, touch-friendly **"Tap to Assign"** workflow: tapping a preset opens an inline keypad slot selector modal or dropdown (`#slotPickerModal`), allowing one-touch slot assignment on mobile viewports.

### 🟡 Major 9: Missing Persistent Onboarding State Tracking
* **Reviewer Lens:** `naive_reader`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.3
* **Discrepancy Description:** Without tracking onboarding completion in `profiles.json`, the wizard would either trigger repeatedly on every page refresh or rely on volatile browser `localStorage`.
* **Rationale & Recommendation:** Add `config.onboardingCompleted: boolean` (default: `false`) to Schema v2 in `lib/config.js`. When the user finishes or skips the wizard, persist `onboardingCompleted: true` to `profiles.json`.

### 🟡 Major 10: Headless / Container Zero-Detection Crash
* **Reviewer Lens:** `skeptical_architect`
* **Affected Scope:** `docs/designs/onboarding-and-preset-catalog.md` §2.1
* **Discrepancy Description:** In headless servers, minimal VMs, or containerized environments where no GUI apps or CLI tools are detected, `generateCuratedWorkspaces()` could generate empty workspaces or fail with null references.
* **Rationale & Recommendation:** Implement a resilient baseline fallback: if 0 tools are detected, generate a clean default "Developer Cockpit" populated with standard bash, git, curl, and system monitoring shortcuts with explanatory tooltips.

---

### 🟢 Nit 11: Exact DOM IDs & CSS Class Contracts
* **Reviewer Lens:** `naive_reader` & `hostile_design_critic`
* **Discrepancy Description:** The design doc used generic names without specifying unambiguous DOM selectors.
* **Recommendation:** Explicitly document all DOM IDs and CSS classes: `#onboardingWizardModal`, `#wizardStepDetect`, `#wizardStepWorkspaces`, `#wizardStepFinish`, `#btnWizardPrev`, `#btnWizardNext`, `#btnWizardApply`, `#btnWizardSkip`, `#btnWizardUnlockEditor`, and `.m-preset-badge`.

---

## 3. Unified Technical Architecture Specification

### 3.1 Single Source of Truth (`lib/presets.js`) Contract

`lib/presets.js` is the sole authority for:
1. **Static Catalog Presets**: Quick-assign tiles for Terminal, Apps, Web, and Media.
2. **Detection Logic**: PATH scanning via `path.delimiter`, `.desktop` discovery, and directory suggestions with 60-second in-memory memoization.
3. **Curated Workspace Seeder**: Deterministic generation of Schema v2 workspaces respecting the 15-tile physical grid ceiling.

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const { getInstalledApplications, getSuggestedProjectDirs } = require('./apps');

// Strict Enum Allowlist to prevent prototype pollution
const ALLOWED_STARTER_IDS = Object.freeze(['developer', 'devops', 'media', 'system']);

// Static Catalog Presets (Consolidated Single Source of Truth)
const STATIC_PRESETS = Object.freeze([
  { id: 'ai-agent', name: 'AI Coding Agent', icon: '🤖', color: '#6366f1', actionType: 'shell', command: 'claude || ollama run codellama', terminalMode: 'tab', category: 'development' },
  { id: 'vs-code', name: 'VS Code', icon: '💻', color: '#1c69d4', actionType: 'shell', command: 'code .', terminalMode: 'tab', category: 'development' },
  { id: 'terminal', name: 'Terminal Tab', icon: '⚡', color: '#1c69d4', actionType: 'shell', command: 'ptyxis --tab || gnome-terminal --tab || alacritty || kitty &', terminalMode: 'tab', category: 'system' },
  { id: 'browser', name: 'Web Browser', icon: '🌐', color: '#3b82f6', actionType: 'shell', command: 'google-chrome || brave-browser || firefox &', terminalMode: 'background', category: 'network' },
  { id: 'git-status', name: 'Git Status', icon: '🌿', color: '#10b981', actionType: 'shell', command: 'git status', terminalMode: 'tab', category: 'development' },
  { id: 'lazydocker', name: 'LazyDocker', icon: '⚡', color: '#10b981', actionType: 'shell', command: 'lazydocker || lzd', terminalMode: 'tab', category: 'devops' },
  { id: 'k9s', name: 'K9s Kubernetes', icon: '☸️', color: '#326ce5', actionType: 'shell', command: 'k9s', terminalMode: 'tab', category: 'devops' },
  { id: 'sys-stats', name: 'System Monitor', icon: '📊', color: '#8b5cf6', actionType: 'shell', command: 'btop || htop', terminalMode: 'tab', category: 'system' },
  { id: 'media-play', name: 'Play / Pause', icon: '⏯️', color: '#10b981', actionType: 'media', mediaAction: 'play_pause', category: 'media' },
  { id: 'mute-audio', name: 'Mute Audio', icon: '🔇', color: '#ef4444', actionType: 'media', mediaAction: 'mute', category: 'media' },
  { id: 'vol-up', name: 'Volume +5%', icon: '🔊', color: '#3b82f6', actionType: 'media', mediaAction: 'vol_up', category: 'media' },
  { id: 'vol-down', name: 'Volume -5%', icon: '🔉', color: '#3b82f6', actionType: 'media', mediaAction: 'vol_down', category: 'media' }
]);

// 60-Second In-Memory Memoization & Single-Flight Coalescing
let memoizedDetection = null;
let memoizedExpiry = 0;
let inFlightScanPromise = null;
const CACHE_TTL_MS = 60 * 1000;

function isBinaryInPath(binaryName) {
  if (!binaryName || typeof binaryName !== 'string') return false;
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const fullPath = path.join(dir, binaryName);
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return true;
    } catch (_) {}
  }
  return false;
}

async function detectHostEcosystem(options = {}) {
  const { forceRefresh = false } = options;
  const now = Date.now();

  if (!forceRefresh && memoizedDetection && now < memoizedExpiry) {
    return memoizedDetection;
  }

  if (inFlightScanPromise) {
    return inFlightScanPromise;
  }

  inFlightScanPromise = (async () => {
    try {
      const detectedTools = [];
      const toolCatalog = [
        { id: 'code', name: 'VS Code', binary: 'code', category: 'development', icon: '💻', color: '#1c69d4' },
        { id: 'claude', name: 'Claude Code', binary: 'claude', category: 'development', icon: '🤖', color: '#6366f1' },
        { id: 'docker', name: 'Docker', binary: 'docker', category: 'devops', icon: '🐳', color: '#0db7ed' },
        { id: 'lazydocker', name: 'LazyDocker', binary: 'lazydocker', category: 'devops', icon: '⚡', color: '#10b981' },
        { id: 'kubectl', name: 'Kubectl', binary: 'kubectl', category: 'devops', icon: '☸️', color: '#326ce5' },
        { id: 'k9s', name: 'K9s', binary: 'k9s', category: 'devops', icon: '🐶', color: '#38bdf8' },
        { id: 'btop', name: 'Btop Monitor', binary: 'btop', category: 'system', icon: '📊', color: '#8b5cf6' },
        { id: 'htop', name: 'Htop Monitor', binary: 'htop', category: 'system', icon: '📈', color: '#10b981' },
        { id: 'git', name: 'Git CLI', binary: 'git', category: 'development', icon: '🌿', color: '#f05032' }
      ];

      for (const item of toolCatalog) {
        if (isBinaryInPath(item.binary)) {
          detectedTools.push(item);
        }
      }

      const desktopApps = getInstalledApplications(forceRefresh);
      const suggestedDirs = getSuggestedProjectDirs();

      const result = {
        timestamp: now,
        detectedTools,
        desktopAppsCount: desktopApps.length,
        suggestedDirsCount: suggestedDirs.length,
        hasDetectedTools: detectedTools.length > 0
      };

      memoizedDetection = result;
      memoizedExpiry = Date.now() + CACHE_TTL_MS;
      return result;
    } finally {
      inFlightScanPromise = null;
    }
  })();

  return inFlightScanPromise;
}

function chunkArray(items, size = 15) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function generateCuratedWorkspaces(selectedIds, detectedEcosystem = {}) {
  const sanitizedIds = (Array.isArray(selectedIds) ? selectedIds : [])
    .filter(id => ALLOWED_STARTER_IDS.includes(id));

  // Baseline Fallback: Ensure at least 'developer' exists
  if (sanitizedIds.length === 0) {
    sanitizedIds.push('developer');
  }

  const generated = [];

  for (const wsId of sanitizedIds) {
    if (wsId === 'developer') {
      const devButtons = [];
      let idCounter = 0;

      // Seed detected developer tools
      const tools = detectedEcosystem.detectedTools || [];
      const devTools = tools.filter(t => t.category === 'development' || t.category === 'system');

      if (devTools.length > 0) {
        for (const t of devTools) {
          devButtons.push({
            id: idCounter++,
            label: t.name.toUpperCase(),
            sublabel: 'CLI / DEV',
            icon: t.icon,
            color: t.color,
            actionType: 'shell',
            command: t.binary,
            terminalMode: 'tab',
            keepOpen: true
          });
        }
      } else {
        // Container / Headless Baseline Fallback
        devButtons.push(
          { id: idCounter++, label: 'TERMINAL', sublabel: 'SHELL', icon: '⚡', color: '#1c69d4', actionType: 'shell', command: 'bash', terminalMode: 'tab', keepOpen: true },
          { id: idCounter++, label: 'GIT STATUS', sublabel: 'REPO', icon: '🌿', color: '#10b981', actionType: 'shell', command: 'git status', terminalMode: 'tab', keepOpen: true },
          { id: idCounter++, label: 'SYSTEM INFO', sublabel: 'UNAME', icon: '📊', color: '#8b5cf6', actionType: 'shell', command: 'uname -a', terminalMode: 'tab', keepOpen: true }
        );
      }

      // Partition strictly into 15-tile pages
      const buttonPages = chunkArray(devButtons, 15);
      generated.push({
        id: 'developer',
        name: 'Developer Cockpit',
        icon: '💻',
        segregation: { enabled: false },
        pages: buttonPages.map((btns, idx) => ({
          pageNumber: idx + 1,
          name: idx === 0 ? 'Core Tools' : `Tools (Page ${idx + 1})`,
          buttons: btns
        }))
      });
    }

    if (wsId === 'devops') {
      const devopsButtons = [
        { id: 0, label: 'CONTAINERS', sublabel: 'DOCKER', icon: '🐳', color: '#0db7ed', actionType: 'shell', command: 'docker ps', terminalMode: 'tab', keepOpen: true },
        { id: 1, label: 'K8S CONTEXT', sublabel: 'KUBECTL', icon: '☸️', color: '#326ce5', actionType: 'shell', command: 'kubectl config current-context', terminalMode: 'tab', keepOpen: true },
        { id: 2, label: 'DEV LOGS', sublabel: 'JOURNAL', icon: '📜', color: '#64748b', actionType: 'shell', command: 'journalctl -f -n 50', terminalMode: 'tab', keepOpen: true }
      ];
      generated.push({
        id: 'devops',
        name: 'DevOps & Cloud',
        icon: '⚡',
        segregation: { enabled: false },
        pages: [{ pageNumber: 1, name: 'Cloud & Cluster', buttons: devopsButtons }]
      });
    }

    if (wsId === 'media') {
      const mediaButtons = [
        { id: 0, label: 'MUTE', sublabel: 'TOGGLE', icon: '🔇', color: '#ef4444', actionType: 'media', mediaAction: 'mute' },
        { id: 1, label: 'VOL DOWN', sublabel: '5% DOWN', icon: '🔉', color: '#3b82f6', actionType: 'media', mediaAction: 'vol_down' },
        { id: 2, label: 'VOL UP', sublabel: '5% UP', icon: '🔊', color: '#3b82f6', actionType: 'media', mediaAction: 'vol_up' },
        { id: 3, label: 'PLAY/PAUSE', sublabel: 'MEDIA', icon: '⏯️', color: '#10b981', actionType: 'media', mediaAction: 'play_pause' },
        { id: 4, label: 'SCREENSHOT', sublabel: 'AREA', icon: '📸', color: '#f97316', actionType: 'shell', command: 'gnome-screenshot -i 2>/dev/null || grim 2>/dev/null', terminalMode: 'background' },
        { id: 5, label: 'LOCK PC', sublabel: 'LOCK', icon: '🔒', color: '#ef4444', actionType: 'shell', command: 'loginctl lock-session', terminalMode: 'background' }
      ];
      generated.push({
        id: 'media',
        name: 'Media & Telemetry',
        icon: '🎵',
        segregation: { enabled: false },
        pages: [{ pageNumber: 1, name: 'Controls', buttons: mediaButtons }]
      });
    }
  }

  return generated;
}

module.exports = {
  ALLOWED_STARTER_IDS,
  STATIC_PRESETS,
  detectHostEcosystem,
  generateCuratedWorkspaces,
  chunkArray
};
```

---

### 3.2 Revised Technical Specification Document

The specification at `docs/designs/onboarding-and-preset-catalog.md` is updated to reflect this unified architecture.
