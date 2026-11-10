# Stage 5: Initial Zoom Out Review Report

Target Document: `docs/designs/workspace-tile-segregation.md`  
Reviewers: Skeptical Architect (`egm-zoom-out`) & Inventive Catalyst (`egm-inventive-catalyst`)  
Scope: Full Document (Lines 1–384)

---

## Executive Architectural Synthesis

The initial Zoom Out audit identified fundamental contradictions between the proposed server-side page segregation mechanism and Arya Dock's core architectural model:

1. **Workflow-Centric vs. Technology-Siloed Deck Mental Model**: Companion macro decks are organized around cohesive project tasks (e.g. CLI script + local URL + IDE launcher on one deck). Forcibly shredding pages into single-technology silos contradicts the primary use case, while top-level contextual separation already exists via Workspaces (`developer`, `media`).
2. **Dynamic Fluid Grid vs. Sparse `slotIndex` Incompatibility**: Arya Dock dynamically recomputes fluid grid dimensions (`getOptimalGridDimensions` in `public/app.js`: 2×2, 3×2, 3×3, 5×3) over dense arrays to maximize finger target size on mobile screens. The proposed sparse 15-cell grid with `slotIndex` gaps causes visual and touch degradation on phones.
3. **Flawed "Lossless Reversibility" & Active Mutation Tracking**: The snapshot mechanism (`originCoordinates`) only records state at the initial moment of toggle. Any tile added (`ADD_BUTTON`) or reclassified (`UPDATE_BUTTON`) while segregation is active lacks origin coordinates, causing crashes or permanent layout corruption upon restoration.
4. **Integer ID Namespace Violations & Page Scoping Collisions**: The document's examples specify string IDs (`"btn-docker-up"`), which violate Arya Dock's strict schema validator (`lib/config.js` mandates non-negative integers). Furthermore, button IDs are currently scoped locally per page; moving a button to a new category page risks immediate duplicate ID collisions.
5. **Multi-Deck Viewport Disruption**: Pruning empty sub-pages dynamically renumbers remaining pages, causing unexpected page index jumps under the fingers of active companion deck operators.

---

## Detailed Consolidated Findings

### 🔴 Blocker

#### 1. Flawed Reversibility Under Active Mutations (Unresolved Dynamic Invariant)
* **Auditors**: `egm-zoom-out`, `egm-inventive-catalyst`
* **Affected Scope**: Section 3 (Goal 6), Section 4.4 (Lines 200–221), Section 4.5 (Lines 240–262)
* **Analysis**: Storing `originCoordinates` only at toggle-on fails when new tiles are created or modified during segregated mode. Upon disabling segregation, `restoreFromSegregated()` encounters undefined coordinates, triggering runtime exceptions or data loss.
* **Resolution**: If physical pages are reorganized, a deterministic relocation ledger must assign synthetic origin coordinates for newly added tiles. Alternatively, decouple physical storage from presentation using a client-side virtual projection or non-destructive lens.

#### 2. Data Model Violation: Integer ID Schema and Page-Scoping Collisions
* **Auditors**: `egm-inventive-catalyst`
* **Affected Scope**: Section 4.2 (Line 123), Section 4.4, Section 4.6 (Lines 267–272)
* **Analysis**: The document specifies string IDs (`"btn-docker-up"`), which directly violate `validateButton` in `lib/config.js` (`typeof id === 'number' && Number.isInteger(id) && id >= 0`). Additionally, button IDs are currently generated relative to the local page. Moving a button from `Terminal 1` (ID `0`) to `Application 1` (which already has an ID `0`) causes immediate duplicate ID collisions.
* **Resolution**: Keep button IDs strictly as integers, and ensure button IDs are unique across the entire workspace before supporting inter-page dynamic routing.

#### 3. Incompatibility with Arya Dock's Dynamic Responsive Grid
* **Auditors**: `egm-zoom-out`
* **Affected Scope**: Section 4.2 (Line 130), Section 4.4 (Lines 205–207), Section 5.3 (Lines 291–297)
* **Analysis**: `public/app.js` dynamically sizes grid cells based on `buttons.length` (rendering a 2×2 grid for 4 buttons, 3×3 for 9 buttons) to ensure large touch targets on mobile viewports. Forcing a rigid 5×3 15-cell grid with empty placeholders destroys responsive finger scaling on smaller touchscreens.
* **Resolution**: Keep `page.buttons` dense, allowing `getOptimalGridDimensions()` to compute responsive layout sizing, or restrict 5×3 fixed grid rendering strictly to explicit fixed-grid settings.

---

### 🟡 Major

#### 4. Spatial Coordinate Collisions During Multi-Page Migration
* **Auditors**: `egm-inventive-catalyst`
* **Affected Scope**: Section 4.4, Section 4.5, Section 5.3
* **Analysis**: Multiple pages in an existing workspace frequently share identical button positions (e.g. Page 1 has tile 0, Page 2 has tile 0). Aggregating them into `Terminal 1` causes slot collisions. If preserved strictly, it explodes page counts into sparse single-tile pages; if shifted, it alters muscle memory.
* **Resolution**: Define an explicit slot collision resolution policy: manual Page 0 tiles retain coordinates as primary anchors, while colliding tiles from subsequent pages are offset deterministically with `slotCollision: true`.

#### 5. Connected Deck Disruption from Dynamic Page Pruning
* **Auditors**: `egm-inventive-catalyst`, `egm-zoom-out`
* **Affected Scope**: Section 4.4 (Lines 232–237), Section 6.3 (Line 384)
* **Analysis**: In a multi-device setup (companion deck + workstation editor), pruning empty overflow sub-pages instantly shifts page indices globally via `navState.pageIndex`, causing the companion deck's active viewport to shift abruptly.
* **Resolution**: Maintain empty sub-pages as placeholder tombstones during active sessions, or isolate navigation updates so editing actions do not disrupt operator decks.

#### 6. Unnecessary Protocol Extensions & CSS Namespace Collisions
* **Auditors**: `egm-zoom-out`
* **Affected Scope**: Section 4.6 (Lines 264–273), Section 6.1 (Line 325), Section 6.2 (Line 366)
* **Analysis**: 
  - `SET_BUTTON_CATEGORY` is redundant with the existing generic `UPDATE_BUTTON` action.
  - `.m-category-tabs` already exists in `public/index.html` and `public/style.css` for the App Catalog drawer; reusing it causes stylesheet collisions.
* **Resolution**: Reuse `UPDATE_BUTTON` for category overrides; rename UI filter elements to `.m-lens-strip` or `.m-category-filter`.

---

### 🟢 Nit

#### 7. Indiscriminate Fallback to Terminal Category
* **Auditors**: `egm-inventive-catalyst`
* **Affected Scope**: Section 4.3 (Line 182)
* **Analysis**: Unrecognized custom or plugin actions fall back to `'terminal'`, which may misclassify future non-shell shortcuts.
* **Resolution**: Route unrecognized action types to a generic or custom category rather than defaulting to CLI terminal.
