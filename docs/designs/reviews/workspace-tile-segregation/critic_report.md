# Stage 7: Critic Review Report

Target Document: `docs/designs/workspace-tile-segregation.md`  
Scope: FeatureRange (Lines 1 to 313)  
Reviewers: Hostile Design Critic (`egm-design`), Structural Layout Validator (`egm-structural`), Technical Copy Editor (`egm-style`)  

---

## Executive Summary

The Critic Review identified critical architectural flaws, protocol discrepancies, schema incompatibilities, and editorial inaccuracies across Sections 1 through 5.

Key findings include:
1. **Button ID Collisions and Schema Violations**: The document introduces string IDs (`"btn-docker-up"`), violating `lib/config.js`'s strict integer ID requirement. Furthermore, merging buttons across pages causes duplicate integer ID collisions on canonical pages, breaking click dispatching and triggering destructive auto-repair.
2. **Multi-Deck Viewport Hijacking & Accidental Execution Hazard**: Broadcasters force-updating `navState.pageIndex` on tile mutations will violently shift the active page on connected operator decks (tablets/phones), creating dangerous accidental button tap hazards.
3. **Restoration Algorithmic Crash**: Reversal algorithm throws unhandled `TypeError` exceptions for tiles added during segregation because `originCoordinates` is never initialized on `ADD_BUTTON`.
4. **Dynamic Grid Engine Conflict**: `slotIndex` assumes a static 5×3 grid, directly conflicting with Arya Dock's responsive container query engine (`getOptimalGridDimensions()`), which dynamically collapses grids down to 2×1 or 2×2.
5. **Taxonomy & Editorial Errors**: Software shortcut action types are mislabeled as "hardware categories", and the text relies on emotional framing, ungrounded intensifiers, and promotional jargon.

---

## Detailed Consolidated Findings

### 🔴 Blocker

#### 1. Button ID Invariant Breakdown & Cross-Page ID Collisions
* **Auditors**: `egm-design`, `egm-structural`
* **Affected Scope**: Section 4.2 (Line 123), Section 4.4, Section 4.6 (Line 269)
* **Analysis**:
  - `validateButton()` in `lib/config.js` strictly requires non-negative integers (`typeof id === 'number' && Number.isInteger(id) && id >= 0`). Specifying string IDs like `"btn-docker-up"` causes immediate validator rejection.
  - In Arya Dock, button IDs are currently scoped locally per page (`[0, 1, 2]`). When `migrateToSegregated()` pools buttons across pages into category pages, duplicate IDs (`0, 0, 1, 1`) are created, breaking `BUTTON_CLICK`, `UPDATE_BUTTON`, and `DELETE_BUTTON` dispatching in `lib/ws.js`.
* **Remediation**: Retain integer button IDs (`0..N-1`), and enforce monotonic re-indexing per page upon all routing and repartitioning operations in `lib/segregation.js`.

#### 2. Multi-Deck Concurrency Hijacking via Global Navigation Mutex
* **Auditors**: `egm-design`
* **Affected Scope**: Section 4.1 (Lines 84–85), Section 4.4 (Line 220, 230), Section 6.3 (Line 384)
* **Analysis**:
  - `navState.pageIndex` is global server state pushed to all connected clients.
  - Automatically updating `navState.pageIndex` when an editor creates or moves a tile will yank the viewport on all connected secondary companion decks (tablets/phones). An operator actively tapping controls (e.g. Media mute) risks touching the screen just as it switches to Terminal, accidentally executing a destructive shell command.
* **Remediation**: Do NOT mutate global `navState.pageIndex` on tile edits. Keep navigation page adjustments scoped to the mutating client session, and protect pinned companion decks (`navState.pinned === true`).

#### 3. Algorithmic Crash on Restoration (Missing `originCoordinates`)
* **Auditors**: `egm-structural`, `egm-design`
* **Affected Scope**: Section 4.4 (Lines 200–221), Section 4.5 (Lines 240–262)
* **Analysis**:
  - Section 4.4 assigns `slotIndex` on `ADD_BUTTON` but never populates `originCoordinates`.
  - Disabling segregation executes `button.originCoordinates.pageIndex`. Any button added during segregated mode causes an unhandled `TypeError: Cannot read properties of undefined (reading 'pageIndex')`, crashing the server.
* **Remediation**: Assign fallback unsegregated coordinates on `ADD_BUTTON`, or implement a 2-pass restoration algorithm that reconstructs pre-segregation pages from valid `originCoordinates` and appends newly added tiles to remaining slots or subsequent pages.

#### 4. Spatial Slot Model (`slotIndex`) Conflicts with Dynamic Grid Engine
* **Auditors**: `egm-design`
* **Affected Scope**: Section 4.2 (Line 130), Section 4.4 (Line 205), Section 5.3 (Lines 291–297)
* **Analysis**:
  - Arya Dock dynamically scales grid columns and rows via `getOptimalGridDimensions()` (rendering 2×1, 2×2, 3×3 grids based on button count).
  - Placing a single button with `slotIndex: 14` into a 2-button page collapses into a 2×1 grid, displacing or breaking the slot position.
* **Remediation**: Explicitly specify whether segregated mode forces a static 5×3 CSS grid with empty slot placeholders (`.m-lcd-key.empty-slot`), or keeps arrays dense for responsive scaling.

#### 5. Taxonomy Error: Action Types Mislabeled as "Hardware Categories"
* **Auditors**: `egm-style`
* **Affected Scope**: Section 3 (Line 50), Section 5.5 (Line 310)
* **Analysis**: Terminal sessions, desktop apps, URLs, and media controls are software shortcut action types, not "hardware categories".
* **Remediation**: Rephrase to "four functional action categories" throughout Sections 3 and 5.5.

---

### 🟡 Major

#### 6. Missing Privilege Boundaries on WebSocket Mutations
* **Auditors**: `egm-design`
* **Affected Scope**: Section 4.6 (Lines 264–273)
* **Analysis**: Mutating actions in `lib/ws.js` must verify `ws.canEdit`. The protocol specification omits this check for `TOGGLE_SEGREGATION` and `SET_BUTTON_CATEGORY`.
* **Remediation**: Mandate `ws.canEdit` verification on all segregation mutations.

#### 7. Schema Whitelisting & Missing `validatePage` Function
* **Auditors**: `egm-structural`, `egm-design`
* **Affected Scope**: Section 4.2 (Lines 89–117)
* **Analysis**:
  - `validateWorkspace()` in `lib/config.js` uses a strict whitelist and strips unrecognized keys like `segregation`.
  - `validatePage()` does not exist; page validation is inline.
* **Remediation**: Extract `validatePage()` in `lib/config.js` to whitelist `category` and `pageNumber`, and update `validateWorkspace()` to whitelist `workspace.segregation`.

#### 8. Mermaid Syntax & Protocol Inconsistencies
* **Auditors**: `egm-structural`
* **Affected Scope**: Section 4.1 (Lines 64–85), Section 4.6 (Lines 264–273)
* **Analysis**:
  - The Mermaid diagram contains an orphaned `Nav` node and connects edges directly to container subgraphs.
  - Broadcast messages are labeled `SET_WORKSPACE` and `NAV_STATE`, whereas Arya Dock dispatches an atomic `STATE_UPDATE` payload via `broadcastState()`.
* **Remediation**: Update Mermaid diagram to connect directly to `UI` and `Nav`, and standardize protocol actions to `STATE_UPDATE`.

#### 9. Classifier Omission: `terminalMode: 'existing'`
* **Auditors**: `egm-structural`
* **Affected Scope**: Section 4.3 (Lines 167–179)
* **Analysis**: In `lib/config.js`, `ALLOWED_MODES` includes `'existing'`. An interactive session targeting an active terminal tab (`terminalMode: 'existing'`) is omitted from `classifyButton()` and falls through to `'application'`.
* **Remediation**: Include `terminalMode === 'existing'` in the Terminal classification branch.

#### 10. Legacy Desktop App Misclassification
* **Auditors**: `egm-design`
* **Affected Scope**: Section 4.3 (Lines 172–179)
* **Analysis**: Existing shortcuts created via the app catalog do not have `isApplication: true`. Enabling segregation will misclassify 100% of existing GUI applications as Terminal.
* **Remediation**: Include app catalog matching or binary name inference in `classifyButton()`.

#### 11. Category Lifecycle Asymmetry (On-Demand vs. Placeholders)
* **Auditors**: `egm-structural`, `egm-design`
* **Affected Scope**: Section 4.4 (Lines 208–219, 234–237)
* **Analysis**: Creating category pages on-demand conflicts with retaining empty placeholder pages when tiles are deleted, creating unpredictable page counts.
* **Remediation**: Standardize on on-demand category page creation without phantom empty pages, or initialize all 4 canonical category pages upon toggle.

#### 12. Emotional Framing and Uncalibrated Claims
* **Auditors**: `egm-style`
* **Affected Scope**: Section 1 (Lines 18–21), Section 3 (Lines 40–45), Section 5 (Lines 281–309)
* **Analysis**: Overuse of emotional buzzwords ("cognitive fragmentation", "tactile legibility", "chaotic spillover", "naive array compaction") and unprovable claims ("complete coverage").
* **Remediation**: Calibrate language to objective technical descriptions.

---

### 🟢 Nit

#### 13. Case-Sensitivity in Category Overrides
* **Auditors**: `egm-design`
* **Affected Scope**: Section 4.3 (Lines 151–154)
* **Analysis**: String comparison fails if client sends capitalized category overrides.
* **Remediation**: Normalize strings with `.trim().toLowerCase()`.

#### 14. Document Symmetry, Heading Hierarchy, and Markdown Links
* **Auditors**: `egm-structural`
* **Affected Scope**: Section 3 (Lines 39, 47), Section 4.1 (Lines 60–62), Section 5 (List markers)
* **Analysis**: Inconsistent heading numbering (`### 3.1`), mixed list markers (`*` vs `-`), and unlinked file references.
* **Remediation**: Standardize formatting and use clickable markdown links with absolute `file://` URIs.
