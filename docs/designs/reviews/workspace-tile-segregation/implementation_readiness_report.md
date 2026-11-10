# Stage 9: Implementation Readiness Report

Target Document: `docs/designs/workspace-tile-segregation.md`  
Scope: DetailedRange (Lines 314 to 384: Section 6 Implementation Plan & Risk Assessment)  
Reviewers: Pragmatic Tech Lead (`egm-implementation-readiness`), Codebase Quality Auditor (`egm-codebase-details`)  

---

## Executive Summary

The Implementation Readiness Test evaluated Section 6 for execution completeness, ambiguity, codebase alignment, and test coverage. While the phased sequencing is logically structured, the audit found **3 Blockers**, **5 Majors**, and **4 Nits** that prevent an engineer from executing the plan without ambiguity or runtime errors.

Crucial implementation blockers include:
1. **Broken State Synchronization**: The plan relies on non-existent broadcast events (`SET_WORKSPACE`, `NAV_STATE`) and omits serializing `segregation` or `page.category` inside `broadcastState()`, leaving clients unable to detect or render segregation state.
2. **Undefined Restoration on Dynamic Tiles**: The reversibility algorithm provides no fallback for buttons created after segregation was enabled, resulting in unhandled `TypeError` exceptions.
3. **Phantom UI Components**: The plan instructs adding a toggle to a "workspace settings drawer/modal" that does not exist in `public/index.html`.
4. **Codebase Disconnects**: `validatePage` is referenced as an existing function (it is currently inline in `validateWorkspace`), `lib/navigation.js` is incorrectly tasked with page allocation, and drag-and-drop handlers in `public/app.js` omit the `isApplication: true` flag.

---

## Detailed Consolidated Findings

### 🔴 Blocker

#### 1. Mismatched Broadcast Protocol & Missing State Serialization
* **Auditors**: `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope**: Section 6.1 (Line 322), Section 6.2 Phase 2 (Line 356)
* **Analysis**:
  - Phase 2 states that segregation mutations broadcast `SET_WORKSPACE` and `NAV_STATE`.
  - In Arya Dock, `SET_WORKSPACE` is a client mutation request, and `NAV_STATE` does not exist. All server state distribution is unified through `broadcastState(wss, context)`, which emits a single `STATE_UPDATE` payload.
  - Furthermore, `broadcastState()` currently does not serialize `workspace.segregation` or `page.category`. Frontend clients will never receive segregation settings, breaking toggle switch initialization and category badges.
* **Remediation**:
  - Update Phase 2 Step 1 to extend `broadcastState()` and `INIT` in `lib/ws.js` to serialize `segregation: workspace.segregation || { enabled: false }` and `pageCategory: page.category || null`.
  - Update Phase 2 Step 2 to invoke `broadcastState(wss, context)` instead of broadcasting `SET_WORKSPACE` / `NAV_STATE`.

#### 2. Undefined Restoration Behavior for Tiles Added While Segregated
* **Auditors**: `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope**: Section 6.2 Phase 1 Step 2 (Line 343), Phase 1 Step 3 (Line 348)
* **Analysis**:
  - When segregation is disabled, `restoreFromSegregated()` groups buttons by `button.originCoordinates.pageIndex`.
  - Buttons created via `ADD_BUTTON` during segregated mode have no `originCoordinates`, causing `restoreFromSegregated()` to throw `TypeError: Cannot read properties of undefined (reading 'pageIndex')` or drop new buttons.
* **Remediation**:
  - Specify a 2-pass restoration algorithm in `lib/segregation.js`:
    - Pass 1: Reconstruct pre-segregated pages from buttons with valid `originCoordinates`.
    - Pass 2: Append buttons with `originCoordinates == null` into remaining slots (< 15 tiles) or overflow to new sequential pages (`Page N+1`).

#### 3. Non-Existent UI Surface: "Workspace Settings Drawer / Modal"
* **Auditors**: `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope**: Section 6.1 (Line 324), Section 6.2 Phase 3 (Lines 360–362)
* **Analysis**:
  - `public/index.html` has no workspace settings drawer or modal. The existing containers are `#appDrawer` (App Catalog), `#assignPopup`, `#editModal`, and `#unlockModal`.
  - The plan leaves the implementer with no DOM container specifications, trigger buttons, or styling rules.
* **Remediation**:
  - Specify exact DOM additions in `public/index.html`:
    - Add a settings trigger button `#btnWorkspaceSettings` to `.m-header-tools`.
    - Add a modal container `<div id="workspaceSettingsModal" class="m-modal-backdrop hidden">` containing `<input type="checkbox" id="toggleSegregation">`.

---

### 🟡 Major

#### 4. Non-Existent Function Reference: `validatePage` in `lib/config.js`
* **Auditors**: `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope**: Section 6.1 (Line 320), Section 6.2 Phase 1 Step 1 (Line 336)
* **Analysis**:
  - `validatePage` does not exist in `lib/config.js`; page validation is inline inside `validateWorkspace()`.
  - `validateWorkspace()` returns a strict whitelist `{ id, name, icon, pages, origin, match }`, silently stripping `workspace.segregation`.
* **Remediation**:
  - Explicitly specify extracting and exporting `validatePage(rawPage, options = {})` in `lib/config.js`, sanitizing invalid `category` values to `null`.
  - Update `validateWorkspace()` to whitelist `workspace.segregation`.

#### 5. Architectural Misplacement of Page Allocation in `lib/navigation.js`
* **Auditors**: `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope**: Section 6.1 (Line 323), Section 6.2 Phase 2 (Line 352)
* **Analysis**:
  - Table 6.1 tasks `lib/navigation.js` with category sub-page allocation and renumbering.
  - `navigationReducer` in `lib/navigation.js` is a pure state reducer tracking `{ mode, workspaceId, pageIndex, pinned }` and has no page allocation or button array logic.
* **Remediation**:
  - Keep page allocation and renumbering inside `lib/segregation.js` and `lib/ws.js`. Limit `lib/navigation.js` strictly to navigation transitions (e.g. `USER_SELECT` with direct `pageIndex`).

#### 6. Missing `isApplication: true` Attachment in UI Drag & Drop
* **Auditors**: `egm-codebase-details`
* **Affected Scope**: Section 6.2 Phase 1 (Line 337), Phase 3 (Lines 360–369)
* **Analysis**:
  - Existing app catalog drag-and-drop handlers in `public/app.js` (`renderAppCatalog`, `btnPickFromApps`, `btnAddTile`) create button payloads with `actionType: 'shell'` without `isApplication: true`.
  - Without updating these handlers, every desktop application dragged from the catalog will lack `isApplication: true` and will be misclassified by `classifyButton()` as Terminal.
* **Remediation**:
  - Add explicit tasks in Phase 3 to attach `isApplication: true` whenever buttons are created or assigned from `installedApps` or desktop presets in `public/app.js`.

#### 7. Sparse Slot Preservation Conflicts with Dynamic Grid Rendering
* **Auditors**: `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope**: Section 6.1 (Line 325), Section 6.2 Phase 3 (Lines 366–369)
* **Analysis**:
  - `renderButtons()` in `public/app.js` computes `--grid-cols` and `--grid-rows` purely from `currentButtons.length`, rendering buttons contiguously.
  - A page with 2 buttons collapses to a 2×1 grid, ignoring `slotIndex` and rendering buttons side-by-side.
* **Remediation**:
  - Define the rendering rule in Phase 3: when segregation is enabled, set fixed 5×3 grid dimensions (`--grid-cols: 5`, `--grid-rows: 3`) and render placeholder slots (`.m-lcd-key.empty-slot`) for unoccupied indices `0..14`.

#### 8. Missing Authorization Checks on New WebSocket Handlers
* **Auditors**: `egm-codebase-details`
* **Affected Scope**: Section 6.1 (Line 322), Section 6.2 Phase 2 (Lines 355–358)
* **Analysis**:
  - All mutating WebSocket handlers in `lib/ws.js` enforce `if (!ws.canEdit)`. Phase 2 omits this check for `TOGGLE_SEGREGATION`.
* **Remediation**:
  - Mandate `ws.canEdit` verification on `TOGGLE_SEGREGATION` and `SET_BUTTON_CATEGORY`.

---

### 🟢 Nit

#### 9. CSS Class Collision with App Catalog Drawer (`.m-category-tabs`)
* **Auditors**: `egm-codebase-details`
* **Affected Scope**: Section 6.1 (Line 325)
* **Analysis**: `.m-category-tabs` is already defined in `public/style.css` (lines 1050–1056) for app catalog drawer filtering.
* **Remediation**: Rename new header lens strip to `.m-lens-strip` or `.m-header-category-tabs`.

#### 10. `categoryOverride` Dropdown Sanitization
* **Auditors**: `egm-implementation-readiness`
* **Affected Scope**: Section 6.2 Phase 3 (Line 364)
* **Analysis**: If `Auto (Default)` option sends `"auto"`, validator will reject it unless mapped to `null`.
* **Remediation**: Set `<option value="">Auto (Default)</option>` and map empty strings to `null`.

#### 11. Ambiguity in "Optional" Quick Category Lens Bar
* **Auditors**: `egm-implementation-readiness`
* **Affected Scope**: Section 6.2 Phase 3 (Line 368)
* **Analysis**: Stating "Add optional quick category lens bar" leaves the scope ambiguous.
* **Remediation**: Remove "optional" and explicitly define lens buttons as `USER_SELECT` navigation triggers targeting the first page of that category.

#### 12. Tile Counter (`SET_BUTTONS_COUNT`) Handling
* **Auditors**: `egm-codebase-details`
* **Affected Scope**: Section 6.2 Phase 2
* **Analysis**: Tapping `+` or `-` invokes `distributeTilesToSubsequentPages()`, which distributes tiles linearly without category awareness.
* **Remediation**: Note in Phase 2 how `SET_BUTTONS_COUNT` behaves when segregation is enabled (e.g. clamp to 15 or distribute within the category).
