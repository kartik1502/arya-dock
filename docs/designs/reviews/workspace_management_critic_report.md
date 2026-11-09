# Technical Design Audit Report: Workspace Lifecycle Management & Scalable Dynamic Switcher

**Audited Document:** `docs/designs/workspace-management-and-switcher.md`  
**Reviewer:** Design Critic Goldfish (Senior Software Engineer & Hostile System Critic)  
**Target Version:** Arya Dock v1.3.0 / Epic E6-2 & E6-3  
**Target Output File:** `docs/designs/reviews/workspace_management_critic_report.md`  

---

### Executive Summary

The proposed technical design document outlines the CRUD lifecycle for workspaces and a dynamic switcher bar. However, the proposal suffers from critical architectural gaps, persistence boundary oversights, prototype pollution vulnerabilities via object method shadowing, mobile viewport starvation hazards, and protocol discrepancies. 

The design assumes existing backend deletion and navigation mechanics are complete, but in reality, adopting the specification as written would introduce race conditions, state desynchronization across companion clients, and potential Node.js process crashes.

---

### Key Findings & Defect Matrix

| ID | Dimension | Severity | Scope | Summary |
|---|---|---|---|---|
| **CRIT-01** | Concurrency & State Sync | **Blocker** | Lines 92–102, 121–126; `lib/ws.js` | Desynchronization of Host Server Active Workspace & Navigation State |
| **CRIT-02** | Security & Injection | **Blocker** | Lines 61–63, 166–169; `lib/ws.js` | Prototype Method Shadowing & Process Crash via Unsanitized Keys (`toString`, `valueOf`) |
| **CRIT-03** | Protocol & Specification | **Blocker** | Lines 37, 156 vs Section 3 | Ghost Requirement: UI Promises Reordering, but Protocol Omits `REORDER_WORKSPACES` |
| **CRIT-04** | Persistence Boundaries | **Major** | Lines 51–54, 99, 124; `server.js` | 250ms Debounce Window Data Loss & In-Memory State Desynchronization |
| **CRIT-05** | Responsive & Mobile Layout | **Major** | Lines 21–23, 141–147; `public/style.css` | Header Flex-Wrap Causes Viewport Starvation and Keypad Grid Clipping on Mobile |
| **CRIT-06** | State Machine & UX | **Major** | Lines 64–66, 94; `public/app.js` | 0-Button Empty Workspaces Render as Black Void Without Edit Mode Affordance |
| **CRIT-07** | Input Sanitization & Unicode | **Major** | Lines 90, 119 | Flawed UTF-16 String Length Validation Rejects Standard Compound Emojis |
| **CRIT-08** | Navigation Context Matching | **Major** | Lines 84, 91, 112, 120; `lib/navigation.js` | Match Rule Collisions Mask Precedence with Zero Conflict Resolution |
| **CRIT-09** | Verification Strategy | **Major** | Lines 175–181, 194–196 | Reticle v2 Verification Plan Lacks Durable Reload Checks and Concrete Assertions |
| **CRIT-10** | Usability & Accessibility | **Nit** | Lines 141–147 | Hidden Add Button Behind Silent Overflow & Missing Keyboard ARIA Specs |

---

### Detailed Findings & Technical Remediation

#### 1. [Blocker] Concurrency & State Sync: Desynchronization of Host Server Active Workspace & Navigation State
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 92–102, 121–126), `lib/ws.js`, `server.js`
* **Defect Description:**
  Section 3.1 states that upon receiving `CREATE_WORKSPACE`, the server action:
  > *"Switches calling client's ws.navState to newId with pageIndex: 0. Broadcasts STATE_UPDATE to all clients."*
  
  This violates Arya Dock’s core dual-layer navigation model. In `server.js`, the host workstation maintains a master `navState` managed via `dispatchNav`. The design document completely omits invoking:
  ```javascript
  dispatchNav({ type: 'USER_SELECT', workspaceId: newId });
  appConfig.activeWorkspaceId = newId;
  appConfig.activeProfile = newId;
  ```
  Consequently, while the initiating editor socket updates its local `ws.navState`, the server's global `navState` and `appConfig.activeWorkspaceId` remain fixed on the previous workspace. When a companion operator client connects without an explicit `workspace` query parameter, `getClientWorkspace` defaults to `appConfig.activeWorkspaceId`, resulting in immediate desynchronization between the editor and companion viewers.
  
  Furthermore, in `WORKSPACE_DELETED` (Section 3.3 and `lib/ws.js:474-512`), deleting a workspace splices `appConfig.workspaces`, but **never** updates `appConfig.activeWorkspaceId` or `appConfig.activeProfile`. If the deleted workspace was currently active on the host, `appConfig.activeWorkspaceId` is left dangling with a deleted ID.
* **Actionable Recommendation:**
  1. Mandate that `CREATE_WORKSPACE` synchronously updates `appConfig.activeWorkspaceId = newId` and dispatches `dispatchNav({ type: 'USER_SELECT', workspaceId: newId })` on the host.
  2. Patch `WORKSPACE_DELETED` to reassign `appConfig.activeWorkspaceId = fallbackWsId` and delete `appConfig.profiles[delWsId]` from memory immediately, avoiding dangling references.

---

#### 2. [Blocker] Security & Injection: Prototype Method Shadowing & Process Crash via Unsanitized Keys
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 61–63, 166–169), `lib/ws.js`, `lib/config.js`
* **Defect Description:**
  The document asserts protection via:
  > *"All workspace IDs (generated or requested) are strictly validated against DANGEROUS_KEYS (`__proto__`, `constructor`, `prototype`)."*
  
  This blacklist is dangerously incomplete. In JavaScript, plain objects (`{}`) inherit properties from `Object.prototype`. If a user passes `name: "toString"` or `name: "valueOf"`:
  1. The slug becomes `"toString"`.
  2. In `lib/ws.js:534`:
     ```javascript
     const foundWs = appConfig.profiles[targetId];
     ```
     `appConfig.profiles['toString']` evaluates to `[Function: toString]` (truthy!).
  3. When the code subsequently attempts to access `foundWs.pages.length`, it throws:
     ```
     TypeError: Cannot read properties of undefined (reading 'length')
     ```
     Because this runs inside an asynchronous WebSocket message listener, an uncaught exception **terminates the entire Node.js server process**.
  4. Setting `appConfig.profiles['hasOwnProperty'] = ...` shadows built-in methods, causing any subsequent `appConfig.profiles.hasOwnProperty(key)` calls to crash with `TypeError: ... is not a function`.
* **Actionable Recommendation:**
  1. Do not rely solely on a 3-word blacklist. Slug generation for user-created workspaces must enforce a mandatory, safe prefix (e.g. `ws-${slug}`) or validate against `Object.getOwnPropertyNames(Object.prototype)`.
  2. All dictionary lookups against `profiles` must strictly use `Object.prototype.hasOwnProperty.call(appConfig.profiles, id)` or store profiles in a null-prototype dictionary (`Object.create(null)`).

---

#### 3. [Blocker] Protocol Specification: Ghost Requirement — Reordering Promised in UI but Absent from Protocol
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Line 37, Line 156 vs Section 3)
* **Defect Description:**
  Section 2 (Architecture Diagram line 37) and Section 4.2 (Line 156) declare:
  > *"Active Workspaces List (Reorder, Rename, Delete)"*
  
  Yet, Section 3 (*Protocol & WebSocket Payload Specifications*) contains **zero** specifications for reordering. There is no `REORDER_WORKSPACES` message type, no schema definition for ordered IDs (`{ type: "REORDER_WORKSPACES", orderedIds: string[] }`), no array transposition validation, and no concurrency collision strategy (e.g., reordering while a deletion occurs).
* **Actionable Recommendation:**
  Either:
  1. Formalize the `REORDER_WORKSPACES` protocol in Section 3 with strict validation (must contain an exact permutation of existing non-builtin IDs, editor privilege required, atomic save and broadcast); OR
  2. Explicitly descope workspace reordering from Epic E6-2/E6-3 and remove it from UI mockups and specifications.

---

#### 4. [Major] Persistence Boundaries: 250ms Debounce Window Data Loss & In-Memory Desync
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 51–54, 99, 124), `server.js`
* **Defect Description:**
  Section 3.1 & 3.2 call `saveConfig()`. In `server.js`, `saveConfig()` is debounced by 250ms (`debounceMs: 250`).
  1. **Rapid Process Termination:** If a workspace is created or edited immediately prior to an automated test teardown, system reboot, or power cycle, the in-memory state is never flushed to `profiles.json`.
  2. **Memory vs Disk Asynchrony:** `saveConfigAtomic()` in `lib/config.js` re-derives `configData.profiles` from `configData.workspaces` upon write. However, Section 3.1 mandates mutating `appConfig.profiles[newId]` in memory directly. If `appConfig.profiles` is missing or undefined (e.g., pure Schema v2 configuration), this throws a `TypeError`. If it is mutated, but a subsequent mutation fails before debounce flushes, in-memory state diverges from persisted state.
* **Actionable Recommendation:**
  1. Define explicit persistence semantics: workspace structural mutations (`CREATE_WORKSPACE`, `UPDATE_WORKSPACE`, `WORKSPACE_DELETED`) should bypass the 250ms debounce and execute an immediate atomic write (`saveConfig(true)`), unlike high-frequency layout changes.
  2. Provide a centralized helper `syncProfilesDictionary(appConfig)` instead of manually manipulating `appConfig.profiles` inside WebSocket message branches.

---

#### 5. [Major] Mobile Layout: Header Flex-Wrap Causes Viewport Starvation
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 21–23, 141–147), `public/style.css:108-121`, `public/index.html:91-121`
* **Defect Description:**
  In `public/style.css`, `.m-header` has:
  ```css
  .m-header {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap; /* <--- Line 118 */
  }
  ```
  The TDD specifies that `.m-mode-selector` will use `overflow-x: auto;`. However, because `.m-mode-selector` is a child of a flex container with `flex-wrap: wrap`, CSS flexbox layout rules dictate that an unconstrained flex item with `min-width: auto` expands to fit its content rather than scrolling.
  
  When 5 or more workspaces exist, `.m-mode-selector` pushes `.m-header-tools` onto a second or third line. On a mobile phone in landscape orientation (~390px total screen height), a 2-to-3 line header consumes 120px–150px. Because `.m-app-container` has fixed `height: 100dvh` and `overflow: hidden`, this expansion compresses `.m-cockpit-frame`, squeezing the 15-key grid down until button icons and labels collide or become completely illegible.
* **Actionable Recommendation:**
  1. Modify `.m-header` rules: `.m-mode-selector` must be given `flex: 1 1 0; min-width: 0; max-width: 100%;` and `white-space: nowrap;`.
  2. Ensure `.m-mode-btn` has `flex-shrink: 0;`.
  3. Under mobile media queries (`@media (max-width: 768px)`), prevent `.m-header` from wrapping into multi-line rows; header tools must maintain a fixed compact footprint.

---

#### 6. [Major] State Machine & UX: 0-Button Empty Workspaces Render as Black Void
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 64–66, 94), `public/app.js:1030-1045`
* **Defect Description:**
  Core Invariant 3 specifies:
  > *"Newly created workspaces are initialized with Page 1 containing 0 buttons (`pages: [{ pageNumber: 1, name: 'Page 1', buttons: [] }]`)."*
  
  In `public/app.js:renderButtons`:
  ```javascript
  const showAddTile = (isEditMode && canEdit && currentButtons.length < 15);
  ```
  When an editor creates a workspace and is switched to it, `isEditMode` is typically `false`. As a result, `currentButtons.length === 0` and `showAddTile === false`.
  
  The keypad grid renders **zero DOM elements**. The user is presented with a pitch-black, blank screen. There is no empty-state prompt, no visual boundary, and no hint on how to add buttons. On mobile companion devices, this appears as an application crash or frozen WebSocket stream.
* **Actionable Recommendation:**
  1. Update Section 4 to specify an explicit Empty State view in `renderButtons()` when `buttons.length === 0`.
  2. If the client has editor privileges (`canEdit === true`), render a centered, styled prompt: `[+ Add First Tile]` or a callout to open the `APPS` catalog drawer.

---

#### 7. [Major] Input Sanitization: Flawed UTF-16 String Length Validation Rejects Valid Emojis
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 90, 119)
* **Defect Description:**
  The validation rule states:
  > *"`icon`: String, optional, 1-4 characters (emoji or short symbol)"*
  
  Evaluating `icon.length <= 4` in JavaScript checks UTF-16 code units, not Unicode grapheme clusters. Modern emojis with Zero-Width Joiners (ZWJ), skin-tone modifiers, or variation selectors exceed 4 UTF-16 code units:
  * `🧑‍💻` (Technologist): length = 5
  * `🕵️‍♂️` (Man Detective): length = 7
  * `👨‍👩‍👧‍👦` (Family): length = 11
  * `🏳️‍🌈` (Rainbow Flag): length = 6
  
  Users selecting standard modern emojis from system keyboards will have their inputs rejected with validation errors.
* **Actionable Recommendation:**
  Update the validation specification:
  ```javascript
  const graphemeCount = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter().segment(icon.trim())].length
    : [...icon.trim()].length;
  if (graphemeCount < 1 || graphemeCount > 2) {
    return { valid: false, error: 'Icon must be 1-2 emoji symbols' };
  }
  ```

---

#### 8. [Major] Context Switching: Match Rules Collision & Precedence Ambiguity
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 84, 91, 112, 120), `lib/navigation.js:findWorkspaceForApp`
* **Defect Description:**
  Section 3.1 & 3.2 accept arbitrary `matchApps` arrays without validation against existing workspaces.
  In `lib/navigation.js:findWorkspaceForApp`, matching iterates linearly across `appConfig.workspaces` from index `0` to `N`. If built-in `developer` matches `code`, and a user configures a new workspace "Frontend" matching `code`, the new rule is permanently dead code—it will never trigger because `developer` is evaluated first.
  
  Furthermore, the payload schema calls the field `matchApps: string[]`, but the internal configuration schema stores this as `workspace.match = { apps: string[] }`. The document does not specify this mapping, creating a risk that developers assign `workspace.matchApps` directly, breaking context auto-switching.
* **Actionable Recommendation:**
  1. Explicitly document the schema mapping: payload `matchApps` must normalize to `workspace.match = { apps: matchApps.map(...) }`.
  2. Implement collision detection in `UPDATE_WORKSPACE` / `CREATE_WORKSPACE`. If an app identifier is already bound to another workspace, return a warning or re-assign the rule based on an explicit priority policy.

---

#### 9. [Major] Verification Strategy: Incomplete Reticle v2 Plan Lacking Durable Reload Checks
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 175–181, 194–196)
* **Defect Description:**
  The verification plan in Section 5.4 outlines a loose, 4-step sequence without Reticle predicates, unambiguous selectors, or durability assertions:
  1. It omits checking role boundaries: operator rejection (`canEdit: false`) is not verified.
  2. It omits durable reload verification (`durable: true` in Reticle), which is mandatory to prove the 250ms debounce write succeeded.
  3. It does not verify multi-device fan-out (Invariant 5).
* **Actionable Recommendation:**
  Formalize the Reticle specification using strict Reticle step predicates:
  * Step 1: Open modal via target `{ role: 'button', name: '+ Add Workspace' }`.
  * Step 2: Fill `{ role: 'textbox', name: 'Name' }` with `"DevOps Cockpit"`.
  * Step 3: Trigger action and assert consequence: `reticle_act_and_wait` with `until: { kind: 'element', query: { role: 'button', name: 'DevOps Cockpit' } }, durable: true`.
  * Step 4: Add an explicit operator unauthorized flow asserting `{ kind: 'signal', name: 'MUTATION_REJECTED' }`.

---

#### 10. [Nit] Usability & Accessibility: Hidden Add Trigger & Unafforded Horizontal Overflow
* **Affected Scope:** `docs/designs/workspace-management-and-switcher.md` (Lines 141–147)
* **Defect Description:**
  Appending `+ Add Workspace` at the end of `.m-mode-selector` with `scrollbar-width: none` means that when workspaces overflow the screen, the `+` button is hidden off-screen to the right with zero visual indication that horizontal scrolling is possible.
  Additionally, the document mentions "keyboard navigation" without specifying standard ARIA roles (`role="tablist"`, `role="tab"`, `aria-selected`, ArrowLeft/ArrowRight navigation).
* **Actionable Recommendation:**
  1. Pin the `+ Add Workspace` button outside the scrollable viewport or style a persistent gradient fade mask indicating overflow content.
  2. Specify standard WAI-ARIA tab pattern conventions for the dynamic switcher bar.

---

### Conclusion & Next Steps

The design document requires revisions before code implementation begins. The author must resolve the **Concurrency / dispatchNav desync**, fix the **Prototype Pollution / Object Method Shadowing hazard**, formalize or remove **Reordering**, and address **Mobile Flex-Wrap starvation**.
