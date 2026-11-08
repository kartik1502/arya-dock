# Consolidated Multi-Lens Review Report: Workspace Tile Segregation Engine

* **Target Document:** [`docs/designs/workspace-tile-segregation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/workspace-tile-segregation.md)
* **Date:** 2026-11-08
* **Review Pipeline:** EGM Uninterrupted Full Flow (Stages 5, 6, 7, 8, 9)
* **Contributing Reviewer Personas:**
  - Skeptical Architect (`egm-zoom-out` — Stages 5 & 8)
  - Inventive Catalyst (`egm-inventive-catalyst` — Stage 5)
  - Naive Reader (`egm-comprehension` — Stage 6)
  - Hostile Design Critic (`egm-design` — Stage 7)
  - Structural Layout Validator (`egm-structural` — Stage 7)
  - Technical Copy Editor (`egm-style` — Stage 7)
  - Pragmatic Tech Lead (`egm-implementation-readiness` — Stage 9)
  - Codebase Quality Auditor (`egm-codebase-details` — Stage 9)

---

## 1. Executive Summary & Architectural Crossroads

The review audited the technical design across high-altitude simplicity, TRIZ contradiction elimination, document self-containment, systems architecture, schema/codebase fidelity, and implementation readiness.

The core motivation—organizing macro shortcuts into functional categories while respecting the strict 15-tile (5×3) mobile companion deck ceiling—is sound. However, the current specification attempts to solve this presentation concern by **destructively mutating the persistent storage layer** (`workspace.pages` in `profiles.json`), creating six fundamental blockers:
1. **Schema & ID Invariant Collapse**: Violates the non-negative integer button ID requirement (`lib/config.js`), and causes duplicate ID collisions when merging pages.
2. **Fatal Algorithmic Crash on Reversal**: Disabling segregation crashes the Node.js server with an unhandled `TypeError` because tiles added during segregation lack `originCoordinates`.
3. **Multi-Deck Viewport Hijacking**: Broadcasting global `navState.pageIndex` shifts pages on connected physical companion decks under operators' fingers, creating accidental execution hazards.
4. **Dynamic Grid Mismatch**: Sparse 15-cell grid (`slotIndex`) conflicts with Arya Dock's dynamic container query engine (`getOptimalGridDimensions()`), breaking touch targets on mobile viewports.
5. **Protocol Desynchronization**: Relies on non-existent broadcast events (`SET_WORKSPACE`, `NAV_STATE`) and omits serializing `segregation` or `page.category` inside `broadcastState()`.
6. **Phantom UI Components**: Instructs adding controls to a "workspace settings drawer/modal" that does not exist in `public/index.html`.

### The Architectural Crossroads for the Author

| Path | Description | Pros | Cons |
|---|---|---|---|
| **Path A: Virtual Lens / View Projection (Recommended by Skeptical Architect)** | Treat segregation as an ephemeral presentation layer. `workspace.pages` remains canonical. When segregation is active, memory partitions tiles into category views of up to 15 tiles on-the-fly. | Zero disk corruption risk; 100% mathematically reversible (O(1) toggle); zero button ID collisions; preserves dense responsive touch grids. | Physical pages in `profiles.json` remain unsegregated. |
| **Path B: Hardened Physical Page Segregation** | Persist dedicated category pages to disk, but replace brittle per-tile `originCoordinates` with an atomic workspace snapshot (`_unsegregatedSnapshot`), enforce monotonic integer ID re-indexing, and decouple client navigation. | Fulfills literal multi-page disk structure request; allows hardware paddle cycling through distinct category pages. | Requires atomic snapshot management and page array partitioning logic in `lib/segregation.js`. |

---

## 2. Consolidated Action Items by Priority

### 🔴 Blockers (Must Resolve Before Implementation)

* [ ] **B1: Enforce Non-Negative Integer Button IDs & Monotonic Re-Indexing**
  - *Description*: Remove all string button IDs (e.g. `"btn-docker-up"`) from Section 4.2 and Section 4.6. Enforce `typeof id === 'number' && Number.isInteger(id) && id >= 0`. In `lib/segregation.js`, monotonically re-index button IDs (`button.id = index`) whenever buttons are pooled, routed, or partitioned across pages to eliminate duplicate ID collisions.
  - *Traceability*: Critic Finding 1, Structural Finding 2, Inventive Finding 2, Codebase Finding 7, Zoom Out 8 Finding 2.
* [ ] **B2: Replace Per-Tile `originCoordinates` with Atomic Snapshot & 2-Pass Restoration**
  - *Description*: Eliminate `button.originCoordinates`. Upon toggling segregation ON, save `workspace._unsegregatedSnapshot = JSON.parse(JSON.stringify(workspace.pages))`. Upon toggling OFF:
    1. Restore pre-segregation pages from `_unsegregatedSnapshot`.
    2. Merge newly added buttons (buttons present in category pages that do not exist in the snapshot) into available slots (< 15 tiles) or overflow to `Page N+1`.
    3. Delete `_unsegregatedSnapshot`. Prevents unhandled `TypeError` crashes.
  - *Traceability*: Comprehension Finding 1, Inventive Finding 1, Critic Finding 3, Implementation Finding 2, Zoom Out 8 Finding 3.
* [ ] **B3: Decouple Tile CRUD Mutations from Global Navigation Broadcasts**
  - *Description*: Never mutate or broadcast global `navState.pageIndex` during `ADD_BUTTON` or `UPDATE_BUTTON`. Scope navigation page adjustments solely to the mutating WebSocket client session (`client.send(...)`), and respect `navState.pinned === true` so companion deck screens are never yanked under an operator's fingers.
  - *Traceability*: Critic Finding 2, Inventive Finding 4, Zoom Out 8 Finding 4.
* [ ] **B4: Reconcile Spatial Slot Model with Dynamic Fluid Grid Engine**
  - *Description*: Keep `page.buttons` dense (do not inject dummy objects into backend storage). Enforce the 15-tile limit strictly as an array ceiling: `page.buttons.length <= 15`. If visual whitespace is desired (`autoCompact: false`), implement it purely in the frontend CSS Grid presentation layer (`grid-column` / `grid-row` mapped from `slotIndex`) without breaking `getOptimalGridDimensions()`.
  - *Traceability*: Zoom Out 5 Finding 2, Critic Finding 4, Codebase Finding 6, Implementation Finding 6, Zoom Out 8 Finding 5.
* [ ] **B5: Standardize WebSocket Protocol on Unified `STATE_UPDATE` Broadcast**
  - *Description*: Remove references to broadcasting `SET_WORKSPACE` and `NAV_STATE`. Update `broadcastState()` in `lib/ws.js` to serialize `segregation: workspace.segregation || { enabled: false }` and `pageCategory: page.category || null` within the standard `STATE_UPDATE` payload.
  - *Traceability*: Structural Finding 5, Codebase Finding 1, Implementation Finding 1, Zoom Out 8 Finding 6.
* [ ] **B6: Define Concrete DOM Containers for Workspace Settings**
  - *Description*: Specify explicit DOM markup in `public/index.html` for a workspace settings modal (`#workspaceSettingsModal`) and header trigger button (`#btnWorkspaceSettings`), with toggle input (`#toggleSegregation`) and role-based access checking (`canEdit`).
  - *Traceability*: Codebase Finding 4, Implementation Finding 3, Zoom Out 8 Finding 12.

---

### 🟡 Majors (High-Impact Design & Architecture Alignment)

* [ ] **M1: Mandate Role Authorization (`ws.canEdit`) on New WebSocket Actions**
  - *Description*: Guard `TOGGLE_SEGREGATION` and any category mutation handlers with `if (!ws.canEdit)` in `lib/ws.js` to prevent unauthorized companion decks from reorganizing layouts.
  - *Traceability*: Critic Finding 5, Codebase Finding 7, Implementation Finding 10, Zoom Out 8 Finding 7.
* [ ] **M2: Schema Whitelisting & Extraction of `validatePage` in `lib/config.js`**
  - *Description*: Update `validateWorkspace()` to whitelist `workspace.segregation`. Extract and export a dedicated `validatePage(rawPage, options)` function validating `category` (`'terminal' | 'application' | 'url' | 'media' | null`) and `pageNumber`.
  - *Traceability*: Structural Finding 4, Critic Finding 6, Codebase Finding 3, Implementation Finding 4, Zoom Out 8 Finding 8.
* [ ] **M3: Scope `lib/navigation.js` Strictly to Pure State Transitions**
  - *Description*: Remove page allocation and sequential renumbering duties from `lib/navigation.js`. Keep page allocation inside `lib/segregation.js` and `lib/ws.js`. Limit `lib/navigation.js` to navigation state transitions (`USER_SELECT` with direct `pageIndex`).
  - *Traceability*: Comprehension Finding 2, Codebase Finding 2, Implementation Finding 5.
* [ ] **M4: Attach `isApplication: true` in App Catalog Drag-and-Drop Handlers**
  - *Description*: Update `renderAppCatalog` dragstart, `btnPickFromApps`, and drop handlers in `public/app.js` to attach `isApplication: true` so desktop GUI applications are not misclassified as Terminal commands.
  - *Traceability*: Comprehension Finding 3, Codebase Finding 5, Implementation Finding 6, Zoom Out 8 Finding 9.
* [ ] **M5: Eliminate Viewport Jitter on Default `ADD_BUTTON`**
  - *Description*: When `ADD_BUTTON` is emitted without a payload, inherit the category of the currently active page (e.g. adding a tile while viewing `Media 1` initializes a media tile) rather than unconditionally defaulting to shell/terminal.
  - *Traceability*: Critic Finding 7, Inventive Finding 4.
* [ ] **M6: Add Desktop Application Inference in `classifyButton()`**
  - *Description*: In `classifyButton()`, cross-reference `button.command` against installed desktop app names or common GUI binaries to ensure legacy shortcuts configured before segregation are correctly identified as Application.
  - *Traceability*: Critic Finding 9, Zoom Out 8 Finding 9.
* [ ] **M7: Adapt `SET_BUTTONS_COUNT` for Segregated Workspaces**
  - *Description*: Update `lib/ws.js` so that `SET_BUTTONS_COUNT` (`+` / `-` controls) distributes tiles only within the active category's sub-pages rather than linear workspace-wide redistribution.
  - *Traceability*: Codebase Finding 10, Critic Finding 8.
* [ ] **M8: Standardize Category Page Lifecycle Symmetry**
  - *Description*: Either initialize all 4 canonical category pages up-front upon toggle, or create them strictly on-demand without retaining asymmetrical single-page empty placeholders upon tile deletion.
  - *Traceability*: Comprehension Finding 5, Structural Finding 7, Critic Finding 11, Zoom Out 8 Finding 10.
* [ ] **M9: Correct Mermaid Diagram Syntax & Edge Bindings**
  - *Description*: Update Section 4.1 flowchart: bind edges directly to `UI` and `Nav` nodes, eliminate subgraph edge linking, and accurately label broadcast edges as `STATE_UPDATE`.
  - *Traceability*: Structural Finding 3.
* [ ] **M10: Add Missing `terminalMode: 'existing'` to Terminal Classifier**
  - *Description*: Update Section 4.3 to evaluate `if (['tab', 'window', 'existing'].includes(button.terminalMode))` to prevent interactive tab sessions from falling through to the background/application branch.
  - *Traceability*: Structural Finding 6, Zoom Out 8 Finding 11.
* [ ] **M11: Calibrate Tone, Emotional Framing, and Action Taxonomy**
  - *Description*: Replace "hardware categories" with "functional action categories" in Section 3 and 5.5. Remove promotional buzzwords ("cognitive fragmentation", "tactile legibility", "chaotic spillover", "naive array compaction") and unprovable assertions ("complete coverage").
  - *Traceability*: Style Findings 1, 2, 3, 4, 5.

---

### 🟢 Nits (Polish & Hygiene)

* [ ] **N1: Resolve CSS Class Collision on Category Tabs**
  - *Description*: Rename new deck lens strip from `.m-category-tabs` to `.m-lens-strip` to avoid colliding with the existing App Catalog drawer tabs.
  - *Traceability*: Zoom Out 5 Finding 5, Codebase Finding 8, Zoom Out 8 Finding 12.
* [ ] **N2: Sanitize `categoryOverride` Dropdown Values**
  - *Description*: Map `<option value="">Auto (Default)</option>` and ensure empty strings are sanitized to `null` in `lib/config.js`.
  - *Traceability*: Implementation Finding 8, Zoom Out 8 Finding 13.
* [ ] **N3: Normalize Category Override String Casing**
  - *Description*: In `classifyButton()`, apply `.trim().toLowerCase()` to `button.categoryOverride` before comparison.
  - *Traceability*: Critic Finding 13, Zoom Out 8 Finding 13.
* [ ] **N4: Define Category Lens Buttons as Deterministic Navigation Triggers**
  - *Description*: Remove "optional" from Section 6.2 Phase 3; define lens buttons as client-side `USER_SELECT` triggers targeting the first page of that category.
  - *Traceability*: Comprehension Finding 4, Implementation Finding 9.
* [ ] **N5: Standardize Headings, Markdown Markers, and File Links**
  - *Description*: Number Section 3 subheadings (`### 3.1`, `### 3.2`), unify list markers to `-`, and wrap file references in clickable markdown links with absolute `file://` URIs.
  - *Traceability*: Structural Findings 8, 9, 10.

---

## 3. Findings Traceability Matrix

| Consolidated Item | Severity | Originating Stage & Persona | Affected Sections |
|---|---|---|---|
| **B1: Integer Button IDs & Re-indexing** | 🔴 Blocker | Stage 5 (Inventive), Stage 7 (Critic, Structural), Stage 8 (Zoom Out), Stage 9 (Codebase) | §4.2, §4.4, §4.6 |
| **B2: Snapshot Restoration & 2-Pass Merge** | 🔴 Blocker | Stage 5 (Inventive), Stage 6 (Comprehension), Stage 7 (Critic, Structural), Stage 8 (Zoom Out), Stage 9 (Readiness) | §4.4, §4.5, §6.2 |
| **B3: Decouple Navigation from Mutations** | 🔴 Blocker | Stage 5 (Inventive, Zoom Out), Stage 7 (Critic), Stage 8 (Zoom Out) | §4.1, §4.4, §4.6, §6.3 |
| **B4: Dense Arrays & Fluid Grid Sizing** | 🔴 Blocker | Stage 5 (Zoom Out), Stage 7 (Critic), Stage 8 (Zoom Out), Stage 9 (Codebase, Readiness) | §4.2, §4.4, §5.3, §6.2 |
| **B5: Unified `STATE_UPDATE` Protocol** | 🔴 Blocker | Stage 7 (Structural), Stage 8 (Zoom Out), Stage 9 (Codebase, Readiness) | §4.1, §4.6, §6.2 |
| **B6: DOM Target for Settings Modal** | 🔴 Blocker | Stage 8 (Zoom Out), Stage 9 (Codebase, Readiness) | §6.1, §6.2 |
| **M1: Role Authorization on Handlers** | 🟡 Major | Stage 7 (Critic), Stage 8 (Zoom Out), Stage 9 (Codebase, Readiness) | §4.6, §6.2 |
| **M2: `validatePage` & Whitelisting** | 🟡 Major | Stage 7 (Structural, Critic), Stage 8 (Zoom Out), Stage 9 (Codebase, Readiness) | §4.2, §6.1, §6.2 |
| **M3: Refine `lib/navigation.js` Scope** | 🟡 Major | Stage 6 (Comprehension), Stage 9 (Codebase, Readiness) | §6.1, §6.2 |
| **M4: `isApplication: true` Drag Attachment** | 🟡 Major | Stage 6 (Comprehension), Stage 8 (Zoom Out), Stage 9 (Codebase) | §4.2, §6.2 |
| **M5: Viewport Jitter on `ADD_BUTTON`** | 🟡 Major | Stage 7 (Critic) | §4.4 |
| **M6: Legacy Application Inference** | 🟡 Major | Stage 7 (Critic), Stage 8 (Zoom Out) | §4.3 |
| **M7: `SET_BUTTONS_COUNT` Adaptation** | 🟡 Major | Stage 7 (Critic), Stage 9 (Codebase) | §6.1, §6.2 |
| **M8: Category Lifecycle Symmetry** | 🟡 Major | Stage 6 (Comprehension), Stage 7 (Structural, Critic), Stage 8 (Zoom Out) | §4.4 |
| **M9: Mermaid Syntax & Edge Corrections** | 🟡 Major | Stage 7 (Structural) | §4.1 |
| **M10: Include `terminalMode: 'existing'`** | 🟡 Major | Stage 7 (Structural), Stage 8 (Zoom Out) | §4.3 |
| **M11: Tone, Style, & Taxonomy Fixes** | 🟡 Major | Stage 7 (Style) | §1, §3, §5 |
| **N1: CSS Class Namespace `.m-lens-strip`** | 🟢 Nit | Stage 5 (Zoom Out), Stage 8 (Zoom Out), Stage 9 (Codebase) | §6.1, §6.2 |
| **N2: Dropdown Value Sanitization** | 🟢 Nit | Stage 8 (Zoom Out), Stage 9 (Readiness) | §6.2 |
| **N3: Case-Insensitive Overrides** | 🟢 Nit | Stage 7 (Critic), Stage 8 (Zoom Out) | §4.3 |
| **N4: Bounded Lens Trigger Navigation** | 🟢 Nit | Stage 6 (Comprehension), Stage 9 (Readiness) | §6.2 |
| **N5: Headings, Markers, & File Links** | 🟢 Nit | Stage 7 (Structural) | §3, §4, §5 |

---

## 4. Stage Reports Directory Index

For detailed granular findings, refer to the individual stage reports generated during this review:
* Stage 5: [`zoom_out_report.md`](file:///home/karthikulkarni/Documents/arya-dock/zoom_out_report.md)
* Stage 6: [`comprehension_report.md`](file:///home/karthikulkarni/Documents/arya-dock/comprehension_report.md)
* Stage 7: [`critic_report.md`](file:///home/karthikulkarni/Documents/arya-dock/critic_report.md)
* Stage 8: [`intermediate_zoom_out_report.md`](file:///home/karthikulkarni/Documents/arya-dock/intermediate_zoom_out_report.md)
* Stage 9: [`implementation_readiness_report.md`](file:///home/karthikulkarni/Documents/arya-dock/implementation_readiness_report.md)
