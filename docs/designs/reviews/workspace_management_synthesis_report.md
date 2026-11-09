# Consolidated EGM Synthesis Report: Workspace Lifecycle Management & Scalable Dynamic Switcher

**Target Design Document:** `docs/designs/workspace-management-and-switcher.md`  
**Version / Epic:** Arya Dock v1.3.0 / Epic E6-2 & E6-3  
**Synthesized From:**
- `docs/designs/reviews/workspace_management_comprehension_report.md` (Comprehension Auditor)
- `docs/designs/reviews/workspace_management_zoom_out_report.md` (Zoom-Out Skeptical Architect)
- `docs/designs/reviews/workspace_management_critic_report.md` (Design Critic)

---

## 1. Executive Summary & Synthesis Overview

The proposed design for Workspace Lifecycle Management (CRUD) and Scalable Dynamic Switcher provides the foundation for empowering users to configure custom decks directly in the companion web UI without editing `profiles.json` on the host workstation.

However, all three auditor lenses converged on **four architectural blockers** that must be resolved prior to implementation:
1. **State Desynchronization**: Mutating local client socket state on creation and deletion bypasses host master `dispatchNav` and leaves host `appConfig.activeWorkspaceId` dangling.
2. **State Broadcast Blindspot**: `sendClientState` strips `match` rules from the workspace payload, rendering client-side auto-switch inspection and editing impossible.
3. **Prototype Method Shadowing Vulnerability**: Blacklisting only `__proto__`, `constructor`, `prototype` leaves standard `Object.prototype` methods (`toString`, `valueOf`, `hasOwnProperty`) vulnerable, which will crash the Node.js process upon dictionary property access.
4. **Ghost Protocol Requirement**: UI mockups promise drag-and-drop workspace reordering without any backing WebSocket protocol, ordering schema, or collision handling.

---

## 2. Reviewer Status Matrix

| Auditor Shortname | Reviewer Persona | Review Status | Findings Contributed |
| :--- | :--- | :---: | :---: |
| `comprehension` | Naive Reader & Comprehension Auditor | **completed** | 10 |
| `zoom_out` | Skeptical Architect (Simplicity & YAGNI) | **completed** | 7 |
| `design_critic` | Hostile System Critic & Senior Engineer | **completed** | 10 |

---

## 3. Prioritized Consolidated Findings

---

### 🔴 Blockers

#### BLK-01: Concurrency & State Sync — Desynchronization of Host Navigation State & Workspace Deletion
* **Reviewer Lenses:** `design_critic` (CRIT-01), `zoom_out` (Finding 5), `comprehension` (Finding 1)
* **Affected Scope:** Sections 1.4, 2 (Invariant 4), 3.1 (Lines 92–102), 3.3 (Lines 127–135); `lib/ws.js:474-512`, `server.js:dispatchNav`, `lib/navigation.js`
* **Discrepancy Description:**
  Section 3.1 states that upon receiving `CREATE_WORKSPACE`, the server action *"Switches calling client's ws.navState to newId with pageIndex: 0"*. This bypasses the pure state machine in `lib/navigation.js:navigationReducer` and omits updating the host workstation's navigation state (`dispatchNav({ type: 'USER_SELECT', workspaceId: newId })`, `appConfig.activeWorkspaceId = newId`). When companion operator devices connect, `getClientWorkspace` falls back to the host's `activeWorkspaceId`, causing instant desynchronization.
  Furthermore, `WORKSPACE_DELETED` in `lib/ws.js:474-512` splices `appConfig.workspaces` but leaves `appConfig.activeWorkspaceId` dangling with a deleted ID if the deleted workspace was currently active on the host.
* **Rationale & Recommendation:**
  1. Mandate that all workspace mutations dispatch navigation transitions through `navigationReducer` and trigger the host workstation's `dispatchNav`.
  2. Update `CREATE_WORKSPACE` to synchronously assign `appConfig.activeWorkspaceId = newId` and dispatch `USER_SELECT`.
  3. In `WORKSPACE_DELETED`, immediately reassign `appConfig.activeWorkspaceId = fallbackWsId`, delete `appConfig.profiles[delWsId]`, and broadcast updated state to all connected sockets.

---

#### BLK-02: Critical State Propagation Blindspot — `match` Rules Stripped in Client Broadcast
* **Reviewer Lenses:** `zoom_out` (Finding 1), `design_critic` (CRIT-08), `comprehension` (Finding 4)
* **Affected Scope:** Section 1 (Item 3), Section 3.2, Section 4.2; `lib/ws.js:54-60`
* **Discrepancy Description:**
  Section 1 and Section 4.2 premise that users will view and edit application auto-switch matching rules (`matchApps`) from the web UI. However, inspecting `sendClientState` in `lib/ws.js:54-60` reveals that workspaces are broadcast with only `id`, `name`, `icon`, `origin`, and `segregation`. The `match` property is **completely stripped**. The client UI has zero awareness of configured match rules, cannot compute rule counts, and cannot pre-populate the edit modal for existing workspaces.
* **Rationale & Recommendation:**
  1. Update `sendClientState` in `lib/ws.js` to broadcast `match: w.match || { apps: [] }` in the workspaces projection.
  2. Formally specify the bi-directional mapping between UI payloads (`matchApps: string[]`) and internal schema (`match: { apps: string[] }`).

---

#### BLK-03: Security & Injection Hazard — Object Prototype Method Shadowing & Process Crash
* **Reviewer Lenses:** `design_critic` (CRIT-02), `zoom_out` (Section 4.2), `comprehension` (Finding 6)
* **Affected Scope:** Section 2 (Invariant 2, Lines 61–63), Section 5.2 (Lines 166–169); `lib/ws.js`, `lib/config.js`
* **Discrepancy Description:**
  The design specifies blacklisting only `__proto__`, `constructor`, `prototype`. Plain JavaScript objects inherit properties from `Object.prototype`. If a user inputs a workspace name whose slug evaluates to `"toString"`, `"valueOf"`, or `"hasOwnProperty"`:
  1. `appConfig.profiles['toString']` evaluates to `[Function: toString]` (truthy).
  2. Subsequent code accessing `foundWs.pages.length` throws `TypeError: Cannot read properties of undefined (reading 'length')`.
  3. Because this runs inside an asynchronous WebSocket message listener, the uncaught exception **terminates the entire Node.js server process**.
* **Rationale & Recommendation:**
  1. Mandatory slug prefixing: Slug generation for user-created workspaces must enforce a safe prefix (e.g., `ws-${slug}`) or blacklist against `Object.getOwnPropertyNames(Object.prototype)`.
  2. Safe dictionary lookup: Dictionary lookups against `profiles` must strictly use `Object.prototype.hasOwnProperty.call(appConfig.profiles, id)` or store profiles in a null-prototype dictionary (`Object.create(null)`).

---

#### BLK-04: Ghost Requirement — Workspace Reordering Promised in UI but Omitted from Protocol
* **Reviewer Lenses:** `design_critic` (CRIT-03), `zoom_out` (Finding 3), `comprehension` (Finding 2)
* **Affected Scope:** Section 2 (Architecture Diagram line 37), Section 4.2 (Line 156) vs Section 3
* **Discrepancy Description:**
  Section 2 and Section 4.2 explicitly promise an *"Active Workspaces List (Reorder, Rename, Delete)"*. However, Section 3 contains **zero** protocol specification for reordering (`REORDER_WORKSPACES`). There is no schema definition for ordered IDs, no array transposition validation, and no concurrency collision strategy (e.g., reordering during concurrent deletion).
* **Rationale & Recommendation:**
  1. Apply YAGNI: Descope workspace reordering from Epics E6-2 & E6-3, removing "Reorder" from UI diagrams, manager mockups, and scope.
  2. Mark workspace reordering as an explicit Non-Goal for v1.3.0. Workspaces will maintain their canonical array order in `appConfig.workspaces`.

---

### 🟡 Majors

#### MAJ-01: Architectural Duplication — Ignoring Existing `validateWorkspace` Helper
* **Reviewer Lenses:** `zoom_out` (Finding 2)
* **Affected Scope:** Section 3.1, Section 3.2, Section 6 (Phase 1); `lib/config.js:556-712`
* **Discrepancy Description:**
  Section 6 proposes writing bespoke validation helpers in `lib/ws.js` or `lib/config.js`, introducing differing character limits (32 vs 64 chars). `validateWorkspace(raw, options)` already exists and is exported from `lib/config.js:556-712`. It already handles prototype keys, defaults, match arrays, pages, and schema repair.
* **Rationale & Recommendation:**
  Do not write duplicate validation logic. Reuse `validateWorkspace` directly in WebSocket handlers. Add only a minimal, safe slug generator function.

---

#### MAJ-02: Mobile Viewport Starvation & Keypad Squeeze via Header Flex-Wrap
* **Reviewer Lenses:** `design_critic` (CRIT-05), `zoom_out` (Section 3.2)
* **Affected Scope:** Section 1.4 (Lines 21–23), Section 4.1 (Lines 141–147); `public/style.css:108-121`
* **Discrepancy Description:**
  In `public/style.css`, `.m-header` has `flex-wrap: wrap`. An unconstrained horizontal switcher without `flex: 1 1 0; min-width: 0; white-space: nowrap;` expands to fit content. When 5+ workspaces exist, `.m-mode-selector` forces `.m-header-tools` onto a 2nd or 3rd line. On mobile devices in landscape orientation (~390px total height), multi-line headers consume 120–150px, compressing `.m-cockpit-frame` and clipping the 15-key keypad grid.
* **Rationale & Recommendation:**
  1. Constrain `.m-mode-selector` with `flex: 1 1 0; min-width: 0; max-width: 100%; overflow-x: auto; white-space: nowrap;`.
  2. Set `.m-mode-btn` to `flex-shrink: 0;`.
  3. Lock `.m-header` to a single row on mobile viewports (`flex-wrap: nowrap;`).

---

#### MAJ-03: Modal Proliferation Bloat — Competing Workspace Settings Modals
* **Reviewer Lenses:** `zoom_out` (Finding 4)
* **Affected Scope:** Section 4.2; `public/index.html:423-448`
* **Discrepancy Description:**
  The design introduces a new `#workspaceModal` alongside the existing `#workspaceSettingsModal` (which currently manages Category Segregation). This causes DOM duplication, competing backdrop layers, duplicate ESC-key listeners, and confusing UX.
* **Rationale & Recommendation:**
  Consolidate workspace creation, renaming, icon editing, and match rules into the existing `#workspaceSettingsModal` rather than adding a fourth modal to `index.html`.

---

#### MAJ-04: Empty Workspace UX Black Void Hazard
* **Reviewer Lenses:** `design_critic` (CRIT-06)
* **Affected Scope:** Section 2 (Invariant 3, Lines 64–66), Section 3.1 (Line 94); `public/app.js:1030-1045`
* **Discrepancy Description:**
  Workspaces are created with 0 buttons (`buttons: []`). In `public/app.js`, `showAddTile` is only true when `isEditMode && canEdit`. When a client navigates to a newly created workspace while not in edit mode, the keypad renders zero DOM elements, displaying an empty black void that users perceive as an application crash or frozen WebSocket stream.
* **Rationale & Recommendation:**
  Implement an explicit empty-state view in `renderButtons()` when `buttons.length === 0`. If `canEdit === true`, display a centered `[+ Add First Tile]` prompt or callout to open the `APPS` catalog drawer.

---

#### MAJ-05: Persistence Boundaries — 250ms Debounce Window Data Loss & In-Memory Desync
* **Reviewer Lenses:** `design_critic` (CRIT-04), `zoom_out` (Finding 7)
* **Affected Scope:** Section 3.1 & 3.2 (Lines 51–54, 99, 124); `server.js`, `lib/config.js`
* **Discrepancy Description:**
  Structural workspace mutations rely on `saveConfig()`, which is debounced by 250ms. Process termination or system power loss within this window results in unwritten configuration. Additionally, directly mutating `appConfig.profiles[newId]` in memory diverges from `saveConfigAtomic`, which re-derives `profiles` from `workspaces`.
* **Rationale & Recommendation:**
  1. Structural workspace lifecycle mutations (`CREATE_WORKSPACE`, `UPDATE_WORKSPACE`, `WORKSPACE_DELETED`) must trigger immediate atomic writes (`saveConfig(true)`), bypassing the 250ms debounce.
  2. Implement a centralized `syncProfilesDictionary(appConfig)` helper to maintain consistency between `workspaces` and `profiles`.

---

#### MAJ-06: Input Sanitization — UTF-16 String Length Rejects Valid Compound Emojis
* **Reviewer Lenses:** `design_critic` (CRIT-07), `comprehension` (Finding 6)
* **Affected Scope:** Section 3.1 (Line 90), Section 3.2 (Line 119)
* **Discrepancy Description:**
  Validating `icon.length <= 4` checks UTF-16 code units, not grapheme clusters. Modern emojis with Zero-Width Joiners (ZWJ) or skin-tone modifiers (e.g., `🧑‍💻` length 5, `👨‍👩‍👧‍👦` length 11) will fail validation, rejecting valid user input from standard mobile/OS emoji pickers.
* **Rationale & Recommendation:**
  Use `Intl.Segmenter` or grapheme cluster segmentation:
  ```javascript
  const graphemes = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter().segment(icon.trim())].length
    : [...icon.trim()].length;
  if (graphemes < 1 || graphemes > 2) return { valid: false, error: 'Icon must be 1-2 emoji symbols' };
  ```
  Also specify fallback behavior for symbol-only workspace names (auto-prefix `ws-` + timestamp or counter).

---

#### MAJ-07: Context Switching — App Match Rules Collision & Precedence Ambiguity
* **Reviewer Lenses:** `design_critic` (CRIT-08)
* **Affected Scope:** Section 3.1 (Lines 84, 91), Section 3.2 (Lines 112, 120); `lib/navigation.js`
* **Discrepancy Description:**
  Context matching iterates linearly across `appConfig.workspaces` (0 to N). If a user configures a match rule identical to an existing workspace (or built-in workspace), the new rule is silently shadowed and becomes dead code.
* **Rationale & Recommendation:**
  1. Formalize match rule precedence in the design.
  2. Add collision detection in `CREATE_WORKSPACE` and `UPDATE_WORKSPACE`: warn or reject when an app identifier is already bound to another workspace.

---

#### MAJ-08: Client Authorization & Operator Unlock Protocol Vagueness
* **Reviewer Lenses:** `comprehension` (Finding 5), `zoom_out` (Section 4)
* **Affected Scope:** Section 2 (Lines 59–60), Section 4.1 (Line 146), Section 5.1 (Lines 164–165)
* **Discrepancy Description:**
  The document notes that `ws.canEdit === true` is required and mentions "unlock for operators", but never specifies how an operator client unlocks editor privileges (PIN, modal, query parameter) or the exact error schema returned when a mutation is rejected.
* **Rationale & Recommendation:**
  Formalize the WebSocket rejection schema:
  `{ type: "ERROR", error: "EDITOR_REQUIRED", code: 403, action: "[ACTION_NAME]" }`.
  Explicitly document that read-only operators promote their session via `#unlockModal` before sending mutation messages.

---

#### MAJ-09: Inconsistent Deletion Constraints: Built-in vs User Workspaces
* **Reviewer Lenses:** `comprehension` (Finding 7)
* **Affected Scope:** Section 2 (Invariant 4, Lines 67–68), Section 4.2 (Line 158)
* **Discrepancy Description:**
  Section 2 states: *"Deletion of the final remaining workspace is strictly prohibited (min 1)."* Section 4.2 states: *"Built-in workspaces (`origin: 'builtin'`) can be renamed/re-iconed, but deletion is disabled if it's the sole remaining workspace."* This implies built-ins can be deleted if other workspaces exist, contradicting the immutable built-in origin invariant.
* **Rationale & Recommendation:**
  Unify the lifecycle rules:
  1. Built-in workspaces (`origin: 'builtin'`) can never be deleted under any circumstances (delete button disabled in UI, rejected on backend).
  2. User-created workspaces (`origin: 'user'`) can be deleted provided `appConfig.workspaces.length > 1`.

---

#### MAJ-10: Verification Plan Gaps — Incomplete Reticle v2 Specification
* **Reviewer Lenses:** `design_critic` (CRIT-09)
* **Affected Scope:** Section 5.4 (Lines 175–181, 194–196)
* **Discrepancy Description:**
  The Reticle verification plan outlines loose steps without durable reload verification (`durable: true`), operator permission denial assertions, or multi-client fan-out checks.
* **Rationale & Recommendation:**
  Formalize the verification plan using strict Reticle step predicates:
  - Add `durable: true` reload checks to prove immediate disk persistence.
  - Assert operator mutation rejection (`canEdit: false` emits `MUTATION_REJECTED` signal).
  - Assert multi-client synchronization across concurrent browser tabs.

---

### 🟢 Nits

#### NIT-01: Operator UX Real Estate — Inconsistent `+ Add Workspace` Button Visibility
* **Reviewer Lenses:** `zoom_out` (Finding 6), `design_critic` (CRIT-10)
* **Affected Scope:** Section 4.1 (Line 146); `public/app.js:268-292`
* **Discrepancy Description:**
  Displaying a permanent, disabled, or unlock-prompting `+ Add Workspace` button to read-only companion operators wastes scarce horizontal space on mobile companion viewports.
* **Rationale & Recommendation:**
  Hide the `+` button when `canEdit === false`, matching the visibility behavior of `#tileControls` and `[+ ADD TILE]`.

---

#### NIT-02: Undefined Terminology — "Segregation" and "Pinned Status"
* **Reviewer Lenses:** `comprehension` (Finding 3)
* **Affected Scope:** Section 2 (Line 70), Section 3.1 (Line 96)
* **Discrepancy Description:**
  Terms like "Category Segregation" and "Pinned status" are referenced without definitions or links to prior architecture documents.
* **Rationale & Recommendation:**
  Provide brief inline glosses defining Category Segregation (isolating category tiles to specific workspaces) and Pinned status (sticky navigation overrides).

---

#### NIT-03: Switcher Mode Pill Labeling (`M1`, `M2`) and ARIA Keyboard Navigation
* **Reviewer Lenses:** `comprehension` (Findings 8 & 9), `design_critic` (CRIT-10)
* **Affected Scope:** Section 1 (Line 16), Section 4.1 (Lines 141–147)
* **Discrepancy Description:**
  The `M` acronym is undefined, and switcher accessibility specifications (ARIA tablist, tab roles, arrow key navigation) are omitted.
* **Rationale & Recommendation:**
  Define `M` as Macro/Mode visual index (`index + 1`), and specify standard WAI-ARIA tab pattern conventions (`role="tablist"`, `role="tab"`, `aria-selected`, `ArrowLeft`/`ArrowRight` key handlers).

---

#### NIT-04: Unexplained Internal Epic References and Tooling Acronyms
* **Reviewer Lenses:** `comprehension` (Finding 10)
* **Affected Scope:** Metadata (Lines 6–7), Section 1 (Line 13)
* **Discrepancy Description:**
  References to Epics E1-1, E1-2, E6-2, and Reticle runner lack brief parenthetical context for onboarding engineers.
* **Rationale & Recommendation:**
  Add brief contextual notes clarifying referenced Epics (e.g., Epic E1-2: Security & Permissions; Epic E6-2: Dynamic Navigation).

---

## 4. Synthesis Action Plan for Document Author

To achieve implementation readiness, update `docs/designs/workspace-management-and-switcher.md` with the following revisions:

1. **Protocol & State Sync**: Update Section 3 to specify dispatching through `navigationReducer` and server `dispatchNav`, synchronizing `appConfig.activeWorkspaceId`, and removing dangling references on deletion.
2. **Broadcast Schema**: Update Section 3.2 and Section 4.2 to mandate broadcasting `match: w.match || { apps: [] }` in `sendClientState`.
3. **Security Invariants**: Update Section 2 and Section 5.2 to mandate safe slug prefixing (e.g., `ws-${slug}`) and prototype method protection against `Object.prototype` properties.
4. **Descope Reordering**: Remove speculative workspace reordering from UI mockups, architecture diagrams, and scope (mark as Non-Goal).
5. **Codebase Reuse**: Replace proposed validation helpers in Section 6 with direct references to existing `validateWorkspace(raw, options)` in `lib/config.js`.
6. **Mobile Layout CSS**: Specify `.m-mode-selector` with `flex: 1 1 0; min-width: 0; white-space: nowrap;` and prevent multi-line flex wrapping on `.m-header`.
7. **Consolidate Modals**: Merge workspace management into `#workspaceSettingsModal`.
8. **Empty State & Unicode**: Add empty-state UI affordance for 0-button workspaces and update emoji length checking to use `Intl.Segmenter`.
