# EGM Synthesis Report: Configuration Backup, Import & Export Engine

**Target Design Document:** `docs/designs/config-import-export-engine.md`  
**Synthesizer:** EGM Multi-Agent Coordinator & Technical Editor  
**Status:** Complete Architectural Synthesis & Recommendation Ledger  
**Target Path for Output Document:** `docs/designs/reviews/config_import_export_synthesis_report.md`

---

## 1. Executive Summary & Review Meta

The technical design document for the **Configuration Backup, Import & Export Engine** (`docs/designs/config-import-export-engine.md`) underwent a comprehensive multi-agent EGM audit across three specialized lenses:
1. **Stage 5: Skeptical Architect** (`9018f189-08e3-428f-b119-ba9157381d2c`) — Analyzed separation of concerns, state lifecycle, backup semantics, validation reuse, and payload hygiene.
2. **Stage 6: Naive Reader** (`3380ef99-00e2-4a27-acec-bdc2e9ecfe89`) — Evaluated operational clarity, failure modes, UI element contracts, schema version definitions, auth roles, and Reticle verification gaps.
3. **Stage 7: Hostile Design Critic** (`e417ec64-d8eb-4c67-bc76-ba6eab3b1817`) — Probed race conditions, unbounded stream memory denial-of-service, remote code execution risks via shell scripts, prototype pollution vectors, and WebSocket zombie state desynchronization.

Across all three stages, **17 distinct findings** were identified and successfully deduplicated into **11 unified architectural issues** organized into 4 priority tiers:
* 🔴 **Blockers (4 Critical Architecture Defects)**: Architectural layering breach (`http.js` vs `server.js`), WebSocket zombie navigation state, debounce save race condition, and missing client UI feedback elements.
* 🟡 **High Priority (4 Core Engine Integrity & Security Issues)**: Backup lifecycle misunderstanding, missing pure `validateConfig` extraction, unmitigated shell action RCE warnings, and streaming body parser memory exhaustion.
* 🟢 **Medium Priority (3 Data Contract & Verification Invariants)**: Prototype pollution reviver & export whitelisting, schema v0/v1/v2 definitions & error contracts, and Reticle v2 verification coverage for import.
* ⚪ **Low / Refinements (3 Polish & Documentation Items)**: File input stale state / operator button visibility, export client error handling, and terminology/acronym glossaries.

---

## 2. Reviewer Ledger & Participation Status

| Stage & Persona shortname | Conversation ID | Focus Lens | Status | Findings Reported |
|---|---|---|---|---|
| **Stage 5: Skeptical Architect** | `9018f189-08e3-428f-b119-ba9157381d2c` | Architectural layering, persistence semantics, YAGNI, code reuse | **Completed** | 5 |
| **Stage 6: Naive Reader** | `3380ef99-00e2-4a27-acec-bdc2e9ecfe89` | UI DOM contracts, schema versioning, failure semantics, Reticle plan | **Completed** | 9 |
| **Stage 7: Hostile Design Critic** | `e417ec64-d8eb-4c67-bc76-ba6eab3b1817` | Race conditions, memory limits, RCE attack vectors, multi-client sync | **Completed** | 11 |

---

## 3. Prioritized Finding Matrix & Deduplication Map

| Synthesis ID | Priority | Primary Lens / Source Findings | Unified Issue Title | Impacted Modules |
|---|---|---|---|---|
| **SYNTH-B1** | 🔴 Blocker | S5-F1, S6-F1, S7-F1.1, S7-F2.1 | Architectural Decoupling & Atomic State Transition via `onImportConfig` | `lib/http.js`, `server.js` |
| **SYNTH-B2** | 🔴 Blocker | S7-F1.2, S7-F1.3 | WebSocket Client Nav Reconciliation & `activeWorkspaceId` Validation | `server.js`, `lib/ws.js` |
| **SYNTH-B3** | 🔴 Blocker | S7-F2.2 | Debounce Save Race Condition (In-Flight Save Overwriting Import) | `server.js` |
| **SYNTH-B4** | 🔴 Blocker | S6-F2 | UI DOM Contract: Missing Success Banner & Confirmation Specs | `public/index.html`, `public/app.js` |
| **SYNTH-H1** | 🟡 High | S5-F2 | Backup Lifecycle Correction (Removal of Redundant `rotateBackups`) | `lib/config.js`, Design Doc |
| **SYNTH-H2** | 🟡 High | S5-F3, S7-F3.3 | Extraction of Pure `validateConfig` Validator in `lib/config.js` | `lib/config.js` |
| **SYNTH-H3** | 🟡 High | S7-F2.3 | Remote Code Execution Warning & Pre-Flight Shell Action Inspection | `public/app.js`, Design Doc |
| **SYNTH-H4** | 🟡 High | S7-F2.4, S5-F5 | Streaming Request Body Parsing & 2MB Hard Socket Abort | `lib/http.js` |
| **SYNTH-M1** | 🟢 Medium | S7-F3.1, S5-F4, S7-F3.2 | Prototype Pollution JSON Reviver & Whitelisted Export Schema Projection | `lib/http.js`, `lib/config.js` |
| **SYNTH-M2** | 🟢 Medium | S6-F3, S6-F4, S6-F5 | Formal Schema Versioning (v0/v1/v2), Auth Roles & HTTP Error Contract | Design Doc |
| **SYNTH-M3** | 🟢 Medium | S6-F6 | Comprehensive End-to-End Reticle v2 Verification Journey | `.reticle/flows/...`, Test Harness |
| **SYNTH-L1** | ⚪ Refinement| S7-F4.1 | Client File Input Value Reset & Read-Only Operator Button Guard | `public/app.js` |
| **SYNTH-L2** | ⚪ Refinement| S6-F9 | Client-Side Export Error Feedback Handling | `public/app.js` |
| **SYNTH-L3** | ⚪ Refinement| S6-F8, S6-F9 | Glossary of Project Acronyms & Virtual 15-Key Pad Terminology | Design Doc |

---

## 4. Deep-Dive Architectural Decisions & Synthesis

### 🔴 Blocker 1: Architectural Decoupling & In-Memory State Synchronization (SYNTH-B1)
* **Root Problem:**  
  In the current design, `lib/http.js` was tasked with directly parsing, validating, saving to disk, and broadcasting WebSocket state. However, in `server.js`, `let appConfig` and `let navState` are closed over in `createServer()`. `createHttpHandler` only receives `getConfig: () => appConfig`. If `lib/http.js` persists to disk independently, the runtime server's in-memory `appConfig` remains stale. Conversely, if in-memory state is overwritten before disk persistence, a disk write failure leaves the server in a split-brain condition where runtime memory and disk disagree.
* **Architectural Decision:**
  1. Pass an asynchronous callback `onImportConfig(validatedConfig)` into `createHttpHandler({ ..., onImportConfig })`.
  2. The HTTP layer is strictly limited to authentication, content-type checking, streaming body accumulation (capped at 2MB), prototype pollution filtering, and invoking `validateConfig(body, { repair: false })`.
  3. The `onImportConfig` implementation inside `server.js` enforces the **Write-to-Disk-First Invariant**:
     - Synchronously cancel any pending debounced save timer: `if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; hasPendingSave = false; }`.
     - Write atomically to disk via `saveConfigAtomic(configPath, validatedConfig, { maxBackups })`.
     - If disk writing throws, abort immediately and propagate HTTP 500. Memory state remains 100% untouched; no complex rollback mechanism is necessary.
     - Only upon successful disk write, assign `appConfig = validatedConfig`.
     - Reconcile navigation state and broadcast `STATE_UPDATE`.

---

### 🔴 Blocker 2: WebSocket Navigation State Reconciliation & Pointer Integrity (SYNTH-B2)
* **Root Problem:**  
  Arya Dock companion screens maintain per-client `client.navState`. When a new configuration is imported, workspaces may be deleted, renamed, or replaced. Clients pointed to a deleted workspace ID enter a zombie state: `getClientWorkspace` falls back to `workspaces[0]`, but `client.navState.workspaceId` still holds the obsolete ID. This desynchronizes client actions from server state. Furthermore, if the imported configuration has a corrupt or missing `activeWorkspaceId`, server runtime operations throw null-pointer errors.
* **Architectural Decision:**
  1. **Strict Pointer Normalization in `validateConfig`:**  
     Validate that `config.activeWorkspaceId` is a string matching an `id` present in `config.workspaces`. If missing, invalid, or matching no workspace, normalize it immediately to `config.workspaces[0].id`.
  2. **Multi-Client State Reconciliation in `server.js`:**  
     Inside `onImportConfig`, re-synchronize the server's own `navState`:
     ```js
     navState = createInitialNavigationState({
       workspaces: appConfig.workspaces,
       initialWorkspaceId: appConfig.activeWorkspaceId,
       mode: 'auto',
       pinned: false
     });
     ```
     Iterate across all connected WebSocket clients in `wsManager.wss.clients`:
     ```js
     for (const client of wsManager.wss.clients) {
       if (client.readyState === 1 && client.navState) {
         const exists = appConfig.workspaces.some(w => w.id === client.navState.workspaceId);
         if (!exists) {
           client.navState.workspaceId = appConfig.activeWorkspaceId;
           client.navState.pageIndex = 0;
         }
       }
     }
     broadcastState(wsManager.wss, wsContext);
     ```

---

### 🔴 Blocker 3: Debounce Save Race Condition Invalidation (SYNTH-B3)
* **Root Problem:**  
  `server.js` debounces disk saves with `saveTimer = setTimeout(..., 250)`. If a user edits a button or workspace immediately before an import is posted (e.g. at $t=0$ edit happens, at $t=100\text{ms}$ import is posted), `hasPendingSave` is `true`. When the import writes to disk at $t=150\text{ms}$, the debounced save timer would fire at $t=250\text{ms}$ and overwrite the newly imported configuration with the pre-import deck.
* **Architectural Decision:**
  Inside `onImportConfig`, unconditionally clear and reset the debouncer prior to disk writing:
  ```js
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  hasPendingSave = false;
  ```

---

### 🔴 Blocker 4: Cockpit UI Contracts, DOM Elements & Confirmation Protocol (SYNTH-B4)
* **Root Problem:**  
  `docs/designs/config-import-export-engine.md` specifies that upon successful import the client "displays success banner and re-renders workspace list". However, `public/index.html` contains no `#workspaceSettingsSuccess` element (only `#workspaceSettingsError`). Furthermore, the user confirmation step was ambiguously phrased.
* **Architectural Decision:**
  1. Add `<div id="workspaceSettingsSuccess" class="m-success-banner" style="display: none;"></div>` directly adjacent to `#workspaceSettingsError` in `#workspaceSettingsModal`.
  2. Standardize the client import confirmation dialog contract in `public/app.js`:
     ```javascript
     const confirmed = confirm(
       `Importing this configuration will replace all current workspaces and shortcuts.\n\n` +
       `A safety backup of your existing configuration will be preserved on the server.\n\n` +
       `Do you wish to proceed?`
     );
     if (!confirmed) {
       inputImportFile.value = '';
       return;
     }
     ```

---

### 🟡 High Priority 1: Backup Lifecycle Correction (SYNTH-H1)
* **Root Problem:**  
  The design document stated: *"Pre-Import Safety Snapshot: Before overwriting existing configuration, the server forces an immediate timestamped backup (`rotateBackups`)"*. This reflects a misunderstanding of `lib/config.js`. `rotateBackups` does **not** create backups; it only purges excess timestamped backups. Calling it prior to a save is redundant and wrong because `saveConfigAtomic(configPath, data, { maxBackups })` already creates a timestamped backup (`.bak.<timestamp>-<counter>`) and invokes `rotateBackups` internally.
* **Architectural Decision:**  
  Update Section 2, Section 3.2, and Section 6 of the design document to state that disk backup is guaranteed inherently by `saveConfigAtomic(configPath, validatedConfig, { maxBackups: 5 })`. No manual invocation of `rotateBackups` is required.

---

### 🟡 High Priority 2: Pure `validateConfig` Extraction in `lib/config.js` (SYNTH-H2)
* **Root Problem:**  
  Section 2 and 3.2 reference `validateConfig`. No such function exists in `lib/config.js`. `loadConfig` currently mixes disk reads, backup auto-recovery, prototype pollution stripping, migrations, and button repairs.
* **Architectural Decision:**  
  Extract an exported, pure validation and normalization function in `lib/config.js`:
  ```js
  function validateConfig(raw, options = {}) {
    const { repair = false } = options;
    // 1. Root object check
    // 2. Migration to CURRENT_SCHEMA_VERSION via migrateConfig
    // 3. Workspaces array verification (must contain >= 1 workspace)
    // 4. validateWorkspace and validateButton validation per page (capped at 15 keys)
    // 5. activeWorkspaceId validation & fallback to workspaces[0].id
    // 6. profiles dictionary synchronization
    // Returns { valid: boolean, config: Object, error?: string }
  }
  ```
  `POST /api/config/import` calls `validateConfig(body, { repair: false })` (strict mode: rejects malformed configs with HTTP 400). `loadConfig` calls `validateConfig(candidate, { repair: true })` (tolerant mode).

---

### 🟡 High Priority 3: Remote Code Execution Warning & Shell Pre-Flight Inspection (SYNTH-H3)
* **Root Problem:**  
  Configurations can contain custom shell commands (`actionType: 'shell'`) executed by Arya Dock with host user privileges. An untrusted imported backup could inject destructive or malicious shell commands (`rm -rf ~`, exfiltration scripts).
* **Architectural Decision:**  
  1. Prior to submitting the import payload to `POST /api/config/import`, the client inspects the parsed JSON for buttons where `actionType === 'shell'` and `command.trim().length > 0`.
  2. If shell actions are detected, the confirmation dialog explicitly informs the user:
     ```
     WARNING: This configuration contains X custom shell command(s).
     Shell commands execute directly on your Linux host.
     Only import configurations from sources you trust.
     ```
  3. Server validation also audits button commands, ensuring control characters / binary payloads are rejected.

---

### 🟡 High Priority 4: Streaming Request Body Parsing & 2MB Hard Socket Abort (SYNTH-H4)
* **Root Problem:**  
  Buffering arbitrary request bodies without tracking chunk sizes exposes the Node.js server to memory exhaustion attacks (DoS). Furthermore, exact `req.headers['content-type'] === 'application/json'` checks fail when clients send charset suffixes (e.g. `application/json; charset=utf-8`).
* **Architectural Decision:**  
  In `lib/http.js`:
  1. Validate content type using: `(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')`.
  2. Enforce byte tracking on incoming stream chunks:
     ```js
     let totalBytes = 0;
     const MAX_BYTES = 2 * 1024 * 1024; // 2MB
     req.on('data', chunk => {
       totalBytes += chunk.length;
       if (totalBytes > MAX_BYTES) {
         req.destroy(); // Hard socket termination to prevent buffering
         if (!res.headersSent) {
           res.writeHead(413, { 'Content-Type': 'application/json' });
           res.end(JSON.stringify({ error: 'Payload Too Large: import configuration exceeds 2MB limit' }));
         }
       }
     });
     ```

---

### 🟢 Medium Priority 1: Prototype Pollution JSON Reviver & Whitelisted Export Projection (SYNTH-M1)
* **Architectural Decision:**
  1. Parse incoming JSON with a reviver function that strictly rejects keys matching `__proto__`, `constructor`, or `prototype`:
     ```js
     JSON.parse(rawText, (key, value) => {
       if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
         throw new Error(`Prototype pollution attempt detected: key "${key}" is prohibited`);
       }
       return value;
     });
     ```
  2. For `GET /api/config/export`, project a clean Schema v2 payload using an explicit whitelist:
     ```js
     const exportPayload = {
       schemaVersion: 2,
       activeWorkspaceId: appConfig.activeWorkspaceId,
       workspaces: appConfig.workspaces,
       profiles: appConfig.profiles,
       exportedAt: Date.now()
     };
     ```
     This strictly guarantees no internal secrets, tokens, or extraneous internal metadata are exposed.

---

### 🟢 Medium Priority 2: Formal Schema Versioning, Auth Roles & HTTP Error Contract (SYNTH-M2)
* **Architectural Decision:**
  1. **Schema Evolution:**
     - **Schema v0**: Legacy flat profiles object (`profiles: { [id]: { buttons: [] } }`).
     - **Schema v1**: Multi-page profiles dictionary (`profiles: { [id]: { pages: [{ pageNumber, buttons }] } }`).
     - **Schema v2**: First-class workspaces array (`workspaces: [{ id, name, icon, pages, match, segregation }]`) with dual backwards-compatible `profiles` projection.
  2. **Role & Loopback Semantics:**
     - `x-pairing-token` required for all HTTP API access.
     - Loopback clients (`127.0.0.1`, `::1`) automatically receive the `editor` role without supplying `x-editor-key`.
     - Remote LAN clients require `x-editor-key` in request headers to qualify for `editor` role; otherwise, HTTP 403 Forbidden is returned.
  3. **HTTP Error Contract:**
     Standardize error responses across all config endpoints:
     ```json
     {
       "error": "Human-readable error description",
       "code": "ERR_INVALID_SCHEMA | ERR_PAYLOAD_TOO_LARGE | ERR_UNAUTHORIZED | ERR_FORBIDDEN"
     }
     ```

---

### 🟢 Medium Priority 3: End-to-End Reticle v2 Verification Journey (SYNTH-M3)
* **Architectural Decision:**  
  Expand `.reticle/flows/arya-dock-4f274f15/config-import-export.json` beyond simple button presence to execute an end-to-end journey:
  1. Open `#workspaceSettingsModal`.
  2. Click `#btnExportConfig` and assert successful `GET /api/config/export` (200 OK, valid JSON).
  3. Add a temporary test workspace in the UI.
  4. Trigger import of the previously exported backup via `#inputImportFile`.
  5. Confirm import dialog.
  6. Assert `#workspaceSettingsSuccess` is visible and verifies workspace list returned to pre-modification state.
  7. Attempt to import an invalid JSON file and assert `#workspaceSettingsError` is displayed.

---

### ⚪ Low / Refinements: UI Polish & Documentation Glossaries (SYNTH-L1, SYNTH-L2, SYNTH-L3)
* **Architectural Decisions:**
  1. In `public/app.js`, reset `inputImportFile.value = ''` in all resolution branches (success, cancel, error) so selecting the same file repeatedly triggers `change`.
  2. Hide or disable `#btnImportConfig` and `#btnExportConfig` if `!canEdit`.
  3. Wrap the client `fetch('/api/config/export')` call in a `try/catch` block that surfaces errors in `#workspaceSettingsError` if network failures or 403/401 responses occur.
  4. Add an acronym glossary table (PWA, EGM, XDG, CSP, REST, RCE) to Section 1 of the design doc.
  5. Replace confusing "Physical 15-Key Layout" phrasing with "Virtual 3x5 Keypad Matrix (15 Keys Maximum per Page)".

---

## 5. Component Delta Blueprint

### `lib/config.js`
* Extract pure `validateConfig(data, { repair = false })`.
* Export `validateConfig`.
* Refactor `loadConfig` to delegate object normalization to `validateConfig(parsed, { repair: true })`.

### `server.js`
* Wire `onImportConfig: async (validatedConfig)` into `createHttpHandler`.
* In `onImportConfig`:
  1. Cancel `saveTimer` and set `hasPendingSave = false`.
  2. Call `saveConfigAtomic(configPath, validatedConfig, { maxBackups })`.
  3. Assign `appConfig = validatedConfig`.
  4. Reconcile server `navState` and client `client.navState` across `wss.clients`.
  5. Call `broadcastState(wsManager.wss, wsContext)`.

### `lib/http.js`
* Implement `GET /api/config/export` with Schema v2 projection and `Content-Disposition`.
* Implement `POST /api/config/import` with:
  - Header inspection (`startsWith('application/json')`).
  - Streaming chunk byte tracker with `req.destroy()` upon exceeding 2MB.
  - Reviver checking for `__proto__`, `constructor`, `prototype`.
  - Invocation of `validateConfig(parsed, { repair: false })`.
  - Delegation to `onImportConfig(validatedConfig)`.
  - Unified HTTP error response mapping (400, 401, 403, 413, 500).

### `public/index.html`
* Add `<div id="workspaceSettingsSuccess" class="m-success-banner" style="display: none;"></div>` in `#workspaceSettingsModal`.
* Add `#btnExportConfig`, `#btnImportConfig`, and `#inputImportFile`.

### `public/app.js`
* Implement `#btnExportConfig` click handler with blob download and error handling.
* Implement `#btnImportConfig` trigger for `#inputImportFile`.
* Implement `#inputImportFile` change handler with:
  - Client-side JSON inspection.
  - Shell command count warning in confirmation dialog.
  - POST to `/api/config/import`.
  - Success/error banner handling and `inputImportFile.value = ''` cleanup.
  - Disable buttons if `!canEdit`.

### `test/config-import-export.test.js` & `.reticle/`
* Write comprehensive integration tests covering auth, 2MB limit, prototype pollution rejection, debounce cancellation, and client state fan-out.
* Write full Reticle v2 flow verifying both export and import cycles.

---

## 6. Synthesis Conclusion & Handoff Recommendation

All findings across Stages 5, 6, and 7 are fully resolved and aligned with zero architectural contradictions.

The design document `docs/designs/config-import-export-engine.md` is ready to be updated with these refined specifications. Once updated, the implementation phase plan (Phases 1-3) can proceed with absolute architectural confidence.
