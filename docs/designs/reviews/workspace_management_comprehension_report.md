# Comprehension Audit Report: Workspace Lifecycle Management & Scalable Dynamic Switcher

**Target Document**: `docs/designs/workspace-management-and-switcher.md`  
**Auditor**: Comprehension Goldfish (EGM Naive Reader Persona)  
**Mode**: REVIEW  

---

### What this proposes
The document proposes introducing dynamic workspace lifecycle management (CRUD operations) and a horizontally-scrollable, responsive switcher UI for Arya Dock v1.3.0. Users with editor permissions will be able to create, rename, re-icon, reorder, and delete workspaces directly from a new `#workspaceModal` interface, as well as configure auto-switch app matching rules. On the backend, new WebSocket handlers (`CREATE_WORKSPACE`, `UPDATE_WORKSPACE`, and UI integration for `WORKSPACE_DELETED`) will validate payloads, generate sanitized slugs, maintain a minimum 1-workspace invariant with 15-keypad limits, synchronize configuration between `workspaces` and `profiles`, and broadcast updates to companion clients.

### How the existing system works, per this document
According to the document, Arya Dock v1.2.0 uses hardcoded static buttons in the UI for two default workspaces (`M1 developer` and `M2 media`), lacking an in-app trigger to add new workspaces or configure active-window app-matching rules. Modifying or adding workspaces currently requires manually editing the host's `~/.config/arya-dock/profiles.json` file. Furthermore, while the document asserts that `WORKSPACE_DELETED` is already implemented on the backend, power users with many workspaces encounter UI wrapping and clipping on mobile viewports due to the fixed, non-scrolling workspace bar.

---

### Audit Findings

#### 1. Premise Regarding Existing Backend Support for `WORKSPACE_DELETED`
* **Severity**: Blocker
* **Affected Scope**: Section 1 (Line 18), Section 2 (Line 49), Section 3.3 (Lines 127–135)
* **Discrepancy Description & Rationale**:
  The document asserts that `WORKSPACE_DELETED` "exists in `lib/ws.js`" (Line 18) and is "[a]lready supported in backend; UI integration with safety confirmation dialog" (Line 127). The design must explicitly document how the server purges the workspace, how it synchronizes `appConfig.profiles` and `appConfig.workspaces`, how it redirects `ws.navState` for clients currently focused on the deleted workspace, and how the server handles and responds to attempts to delete the last remaining workspace.

#### 2. Missing Protocol & Specification for Workspace Reordering
* **Severity**: Major
* **Affected Scope**: Section 2 Architecture Diagram (Line 37), Section 4.2 (Line 156)
* **Discrepancy Description & Rationale**:
  The architecture diagram explicitly promises an "Active Workspaces List (Reorder, Rename, Delete)", and Section 4.2 lists "Workspaces List (Manager)" capabilities. However, Section 3 ("Protocol & WebSocket Payload Specifications") does not specify any protocol handler or payload for reordering (such as `REORDER_WORKSPACES`). There is no explanation of whether reordering mutates an array order in `appConfig.workspaces` or relies on an explicit sort field (`index`, `order`), nor how this change is fanned out to connected clients. If reordering is deferred to future work, it must be cleanly marked as a Non-Goal.

#### 3. Undefined Concepts: "Segregation" and "Pinned Status"
* **Severity**: Major
* **Affected Scope**: Section 2 Core Design Invariants (Line 70), Section 3.1 Server Action (Line 96)
* **Discrepancy Description & Rationale**:
  In Section 3.1, the server action for `CREATE_WORKSPACE` specifies: `Sets segregation: { enabled: false }`. In Section 2, the document states: "broadcast updated `workspaces` arrays to all connected companion devices without interrupting their current page or pinned status." Neither "segregation" nor "pinned status" is defined inline, explained, or linked to external documentation. A reader unfamiliar with internal project terminology cannot discern what segregation governs or how pinned navigation state functions.

#### 4. Ambiguous Relationship and Data Schemas between `workspaces` and `profiles`
* **Severity**: Major
* **Affected Scope**: Section 1 (Line 18), Section 3.1 (Lines 97–98), Section 3.2 (Lines 122–123)
* **Discrepancy Description & Rationale**:
  The document uses "workspace" and "profile" interchangeably or side-by-side without explaining the relationship between them. It specifies saving to `~/.config/arya-dock/profiles.json`, appending to `appConfig.workspaces`, and syncing to `appConfig.profiles[newId]`. The document fails to provide a schema definition for either object. A fresh reader cannot determine whether `profiles` is a legacy migration artifact, an indexed hash map of `workspaces`, or a distinct entity holding button layouts.

#### 5. Vague Client Authorization & Operator "Unlock" Workflow
* **Severity**: Major
* **Affected Scope**: Section 2 (Lines 59–60), Section 4.1 (Line 146), Section 5.1 (Lines 164–165)
* **Discrepancy Description & Rationale**:
  The document notes that workspace mutations require editor status (`ws.canEdit === true`) and that the `+ Add Workspace` button prompts "unlock for operators" (Line 146). However, the document never defines what an "operator" client is, how a client authenticates or unlocks editor privileges (e.g., PIN, password, query parameter, or WebSocket auth message), or what error schema is returned when rejected. Section 5.1 casually states that rejected operators receive an `ERROR: editor privilege required` payload, but does not formalize the JSON structure.

#### 6. Unspecified Fallback Behavior and Error Handling on Slug Conflicts & Sanitization
* **Severity**: Major
* **Affected Scope**: Section 2 (Line 63), Section 3.1 (Lines 88–93)
* **Discrepancy Description & Rationale**:
  The specification mandates sanitizing slugs to `^[a-z0-9-]+$` with a "safe fallback prefix `ws-`" and auto-incrementing duplicate slugs (`blender-3d-2`). It fails to clarify edge cases:
  1. What is the fallback behavior when a user inputs a name composed entirely of symbols or emoji (e.g., `"🎨⚡"`)? Does it become `ws-1`?
  2. What happens if an empty or whitespace-only name is passed? Does the server return a validation error or auto-generate a fallback?
  3. In `UPDATE_WORKSPACE`, does renaming a workspace also rename its slug/ID, or is `workspaceId` permanent and immutable? If immutable, that should be stated explicitly.

#### 7. Inconsistent Deletion Rules for Built-in Workspaces vs User Workspaces
* **Severity**: Major
* **Affected Scope**: Section 2 (Lines 67–68), Section 4.2 (Line 158)
* **Discrepancy Description & Rationale**:
  Section 2 (Invariant 4) states: "Deletion of the final remaining workspace is strictly prohibited. The server enforces a minimum of 1 workspace at all times." However, Section 4.2 states: "Built-in workspaces (`origin: 'builtin'`) can be renamed/re-iconed, but deletion is disabled if it's the sole remaining workspace." This phrasing implies that built-in workspaces *can* be deleted if other workspaces exist, or that user-created workspaces might have different deletion constraints. The exact lifecycle rules for `origin: 'builtin'` vs `origin: 'user'` must be clarified consistently.

#### 8. Unexplained Mode Pill Labeling (`M1`, `M2`, `M3`) and Dynamic Ordering
* **Severity**: Nit
* **Affected Scope**: Section 1 (Line 16), Section 4.1 (Lines 144–145)
* **Discrepancy Description & Rationale**:
  The switcher UI renders mode indicator pills labeled `M1`, `M2`, `M3`. The acronym `M` is never defined (e.g., "Mode", "Macro Deck"). Furthermore, it is not specified whether `M1`, `M2` are fixed identifiers, dynamic indices based on visual position (`index + 1`), or custom user-defined shortcuts.

#### 9. Missing Keyboard Navigation Specification for Switcher
* **Severity**: Nit
* **Affected Scope**: Section 1.4 (Line 22), Section 4.1 (Lines 141–147)
* **Discrepancy Description & Rationale**:
  Section 1.4 states that "The workspace switcher requires responsive horizontal scrolling with smooth touch-drag and keyboard navigation." However, Section 4.1 details CSS flexbox and touch scrolling, but omits the keyboard navigation specification entirely (e.g., whether users navigate via arrow keys, Tab/Shift-Tab, or hotkeys `Alt+1..9`).

#### 10. Unexplained Internal Epic References and Tooling Acronyms
* **Severity**: Nit
* **Affected Scope**: Metadata (Lines 6–7), Section 1 (Line 13)
* **Discrepancy Description & Rationale**:
  The document references "Epic E1-1", "Epic E1-2", "Epic E6-2", "Epic E6-3", and "Reticle v2 Flow Runner" without inline context or links to tracking documentation. To a reader newly onboarding onto the project, these references lack clarity without brief parenthetical explanations.
