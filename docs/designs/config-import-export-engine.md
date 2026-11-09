# Configuration Backup, Import & Export Engine — Technical Design Document

* **Author:** Karthik Kulkarni
* **Date:** 2026-11-09
* **Status:** EGM Approved Architecture Specification
* **Target Version:** Arya Dock v1.4.0 / Epic E2-4 (Configuration Backup, Import & Export Engine)
* **Verification Harness:** Node.js HTTP & Concurrency Test Runner & Reticle v2 Flow Runner
* **Review Synthesis:** [`docs/designs/reviews/config_import_export_synthesis_report.md`](./reviews/config_import_export_synthesis_report.md)

---

## 1. Problem Statement & Motivation

Arya Dock v1.3.0 introduced full workspace lifecycle management (Epic E6-2) and responsive dynamic switchers (Epic E6-3). Power users configure sophisticated multi-page control decks containing custom shell scripts, application hotkeys, category segregation rules, and desktop match associations.

However, three critical operational gaps exist:

1. **Host-Bound Configurations & Lack of Portability**:
   Users who switch between machines (e.g. home desktop, office workstation, laptop) or who reinstall their Linux distribution have no streamlined in-app mechanism to export their deck layouts or import a saved configuration.
2. **Disaster Recovery & Accidental Mutation Exposure**:
   While the server maintains timestamped backup rotation during mutations, companion deck users currently have no manual "Snapshot / Download Backup" action in the web UI. If an editor accidentally reconfigures tiles or deletes custom decks, they cannot restore from an external snapshot without SSH/terminal access to `~/.config/arya-dock/`.
3. **Preset Sharing & Template Bootstrapping**:
   Sharing macro deck configurations between developers (e.g. a team "DevOps & K8s Deck" or "Audio/Video Stream Deck") requires manual filesystem extraction and file editing.

### Acronym Glossary
* **EGM**: Elephant-Goldfish Model (Multi-agent specification audit workflow).
* **PWA**: Progressive Web App (Companion touchscreen client).
* **XDG**: XDG Base Directory Specification (`~/.config/arya-dock`).
* **CSP**: Content Security Policy.
* **REST**: Representational State Transfer (HTTP endpoints).
* **RCE**: Remote Code Execution (mitigated via pre-flight shell action warning inspection).

---

## 2. Core Architecture & Security Invariants

```
+-----------------------------------------------------------------------------------------+
|                                ARYA DOCK SERVER (Node.js)                               |
|                                                                                         |
|  [ HTTP REST API Layer (lib/http.js) ]                                                  |
|    |-- GET  /api/config/export --> Auth Guard -> Editor Guard                            |
|    |                                -> Project Clean Schema v2 (Whitelist)              |
|    |                                -> Set Content-Disposition attachment               |
|    |-- POST /api/config/import --> Auth Guard -> Editor Guard                            |
|    |                                -> Chunked Stream Byte Accounting (2MB Limit)        |
|    |                                -> JSON Reviver (Prototype Pollution Defense)        |
|    |                                -> Schema Validation (validateConfig, repair: false)|
|    |                                -> Delegate to server.js onImportConfig callback    |
|                                                                                         |
|  [ Server State & Persistence Orchestrator (server.js) ]                                |
|    |-- Cancel pending debounced save (saveTimer = null, hasPendingSave = false)         |
|    |-- Atomic Disk Write (saveConfigAtomic creates .bak timestamped backup automatically)|
|    |-- Overwrite in-memory appConfig & re-initialize server navState                    |
|    |-- Reconcile client navState across all connected WebSocket companion screens       |
|    |-- Multi-Client WebSocket Fan-Out (broadcastState)                                 |
+-----------------------------------------------------------------------------------------+
                                            │
                               HTTP Download / JSON Upload
                                            │
                                            ▼
+-----------------------------------------------------------------------------------------+
|                                  CLIENT WEB COCKPIT                                     |
|                                                                                         |
|  [ Workspace Settings Modal (#workspaceSettingsModal) ]                                 |
|    |-- Section: BACKUP & RESTORE CONFIGURATION                                          |
|    |-- Button: [Download Backup (.json)] (#btnExportConfig)                             |
|    |-- Button: [Import Configuration]    (#btnImportConfig -> #inputImportFile)         |
|    |-- Feedback / Alert Banners          (#workspaceSettingsSuccess,                    |
|    |                                      #workspaceSettingsError)                      |
+-----------------------------------------------------------------------------------------+
```

### Architectural & Security Invariants:
1. **Zero-Trust Editor Barrier**:
   Exporting and importing configurations requires both a valid pairing token (`x-pairing-token` / `Bearer` token) and editor role privileges. Loopback requests (`127.0.0.1`, `::1`) automatically receive editor privileges; remote LAN requests require `x-editor-key`. Read-only operators are strictly prohibited (HTTP `403 Forbidden`).
2. **Prototype Pollution & Injection Defense**:
   Incoming JSON is parsed with a strict reviver function that immediately throws if keys matching `__proto__`, `constructor`, or `prototype` are detected.
3. **Virtual 3x5 Keypad Matrix (15 Keys Maximum per Page)**:
   Every imported workspace must pass `validateConfig`. No page may exceed 15 buttons. If an imported configuration has legacy Schema v0 or v1 structure, it is sequentially migrated to Schema v2 via `migrateConfig`.
4. **Write-to-Disk-First Transactional Invariant**:
   `server.js` calls `saveConfigAtomic` before updating runtime memory. If disk writing throws an I/O error (`ENOSPC`, `EACCES`), memory remains 100% untouched and HTTP 500 is returned, preventing split-brain states.
5. **Debounce Cancellation**:
   Any pending debounced save timer (`saveTimer`) is cleared before applying the import, ensuring pre-import edits cannot overwrite newly imported configurations.
6. **Automatic Safety Snapshot**:
   `saveConfigAtomic` inherently creates a timestamped copy (`.bak.<timestamp>-<counter>`) of the pre-import configuration and prunes excess backups using `rotateBackups`.
7. **WebSocket Navigation State Reconciliation**:
   Connected clients whose `client.navState.workspaceId` pointed to a deleted workspace ID are cleanly reconciled to `activeWorkspaceId`, preventing zombie pointer errors.
8. **Pre-Flight RCE Warning**:
   If an imported configuration contains `actionType: 'shell'` buttons, the user confirmation prompt explicitly warns the user that executable commands are present.

---

## 3. Protocol & API Specification

### 3.1. `GET /api/config/export`
* **Method:** `GET` (or `HEAD`)
* **Headers Required:**
  - `Authorization: Bearer <token>` or `x-pairing-token: <token>`
  - `x-editor-key: <editorKey>` (or loopback editor session)
* **Response Headers:**
  - `Content-Type: application/json; charset=utf-8`
  - `Content-Disposition: attachment; filename="arya-dock-config-YYYY-MM-DD-HHmmss.json"`
  - `Cache-Control: no-cache, no-store, must-revalidate`
* **Response Body:** Clean Schema v2 JSON object:
  ```json
  {
    "schemaVersion": 2,
    "activeWorkspaceId": "developer",
    "workspaces": [ ... ],
    "profiles": { ... },
    "exportedAt": 1793561000000
  }
  ```
* **Security Whitelist Projection:** Only public workspace definitions and backwards-compatible profiles are exported. Internal server secrets (`pairingToken`, `editorKey`) are strictly excluded.

### 3.2. `POST /api/config/import`
* **Method:** `POST`
* **Headers Required:**
  - `Authorization: Bearer <token>` or `x-pairing-token: <token>`
  - `x-editor-key: <editorKey>` (or loopback editor session)
  - `Content-Type: application/json` (allows optional charset suffixes like `application/json; charset=utf-8`)
* **Body Limits:** Strictly capped to 2MB. Streaming chunks are counted; if cumulative bytes exceed 2MB, socket is immediately destroyed (`req.destroy()`) and HTTP `413 Payload Too Large` is returned.
* **Validation Pipeline:**
  1. Parse body as valid JSON object with prototype pollution reviver (reject with `400 Bad Request`, `code: 'ERR_INVALID_JSON'`).
  2. Validate schema version (v0, v1, v2 migrated via `migrateConfig`). Reject future versions > 2 with `400 Bad Request`.
  3. Validate workspaces and buttons via `validateConfig(parsed, { repair: false })`. Reject > 15 buttons per page with `400 Bad Request`, `code: 'ERR_INVALID_SCHEMA'`.
  4. Validate `activeWorkspaceId` exists in `workspaces`; if not, normalize to `workspaces[0].id`.
* **Execution:**
  1. Pass validated configuration to `onImportConfig`.
  2. Cancel `saveTimer` and set `hasPendingSave = false`.
  3. Call `saveConfigAtomic(configPath, validatedConfig, { maxBackups })`.
  4. Overwrite in-memory `appConfig` state.
  5. Reconcile navigation state across all connected WebSocket clients.
  6. Broadcast `STATE_UPDATE` to all companion screens.
  7. Return `200 OK`:
     ```json
     {
       "status": "ok",
       "message": "Configuration successfully imported",
       "workspaceCount": 3,
       "activeWorkspaceId": "developer"
     }
     ```

### 3.3. Standardized Error Response Contract
```json
{
  "error": "Detailed error message",
  "code": "ERR_UNAUTHORIZED | ERR_FORBIDDEN | ERR_PAYLOAD_TOO_LARGE | ERR_INVALID_JSON | ERR_INVALID_SCHEMA | ERR_IMPORT_FAILED"
}
```

---

## 4. User Interface Specification

### 4.1. Backup & Restore Section in `#workspaceSettingsModal`
In `public/index.html`:
```html
<div class="m-ws-manage-section">
  <div class="m-ws-section-header">
    <h4>BACKUP & RESTORE CONFIGURATION</h4>
  </div>
  <p class="m-settings-help">
    Export your complete workspace layout and shortcuts as a JSON file, or restore from a previous backup snapshot.
  </p>
  <div id="workspaceSettingsSuccess" class="m-success-banner" style="display: none;"></div>
  <div style="display: flex; gap: 8px; margin-top: 6px;">
    <button id="btnExportConfig" class="m-btn m-btn-secondary" style="flex: 1;">
      📥 EXPORT BACKUP (.JSON)
    </button>
    <button id="btnImportConfig" class="m-btn m-btn-secondary" style="flex: 1;">
      📤 IMPORT BACKUP (.JSON)
    </button>
    <input type="file" id="inputImportFile" accept=".json,application/json" style="display: none;">
  </div>
</div>
```

In `public/style.css`:
```css
.m-success-banner {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #6ee7b7;
  border-radius: var(--m-radius-sm);
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.4;
}
```

### 4.2. Client Interaction Logic (`public/app.js`)
* **Export Flow**:
  1. User clicks `#btnExportConfig`.
  2. Fetches `GET /api/config/export` with headers `Authorization` and `X-Editor-Key`.
  3. Creates an ephemeral object URL (`URL.createObjectURL(blob)`) and triggers automated browser download.
  4. Surfaces success in `#workspaceSettingsSuccess` or errors in `#workspaceSettingsError`.
* **Import Flow**:
  1. User clicks `#btnImportConfig`, resetting `inputImportFile.value = ''` and triggering file dialog.
  2. On file selection, reads file as text using `FileReader`.
  3. Checks file size $\le 2\text{MB}$.
  4. Parses JSON and counts custom shell actions.
  5. Presents confirmation dialog with shell command warning if present.
  6. Posts JSON to `POST /api/config/import` with auth headers.
  7. On success: displays success banner in `#workspaceSettingsSuccess` and calls `renderWorkspaceList()`.
  8. On failure: displays error message in `#workspaceSettingsError`.
  9. Resets `inputImportFile.value = ''` in all paths.

---

## 5. Verification & Testing Strategy

### 5.1. Unit & Integration Test Suite (`test/config-import-export.test.js`)
* **T1.1–T1.5**: Authenticated export (200 OK, valid attachment headers and Schema v2 JSON), 401 Unauthorized, 403 Forbidden for remote operators, HEAD method support, 405 Method Not Allowed.
* **T2.1–T2.8**: Valid Schema v2 import (persists, broadcasts state), automatic pre-import `.bak` preservation, legacy Schema v1 migration, prototype pollution rejection (`400 Bad Request`), 2MB streaming cap enforcement (`413 Payload Too Large`), corrupt schema rejection (>15 keys, 400), debounce race cancellation, and multi-client navigation pointer reconciliation.

### 5.2. Reticle v2 Verification Flow
* Registered in `.reticle/flows/arya-dock-4f274f15/config-import-export.json` and [test/reticle.test.js](file:///home/karthikulkarni/Documents/arya-dock/test/reticle.test.js).
* Exercises settings modal opening, export button click, import button trigger, and confirmation.

---

## 6. Implementation Phase Plan

- [x] **Phase 0**: Architecture Specification, Multi-Agent EGM Review (Stages 5–9), and Synthesis Report.
- [ ] **Phase 1**: Core Validation in `lib/config.js` (`validateConfig` pure extraction and `loadConfig` refactoring).
- [ ] **Phase 2**: Backend HTTP Handlers in `lib/http.js` and Server State Orchestration in `server.js`.
- [ ] **Phase 3**: Cockpit UI in `public/index.html`, `public/style.css`, and `public/app.js`.
- [ ] **Phase 4**: Automated Testing & Reticle Verification (`test/config-import-export.test.js`, `.reticle/flows/`, `npm test`, `npm run test:reticle`, `npm run lint`).
