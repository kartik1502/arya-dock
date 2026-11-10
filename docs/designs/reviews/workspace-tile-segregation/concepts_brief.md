# Workspace Tile Segregation Engine

* **Author:** Karthik Kulkarni
* **Date:** 2026-11-08

## Overview

The Workspace Tile Segregation Engine is an opt-in organization system for Arya Dock that automatically classifies macro tiles into distinct functional categories—**Terminal / CLI**, **Applications**, **Web / URLs**, and **Media & Telemetry**—and routes them into dedicated, category-specific pages within a workspace (such as the Dev Cockpit), regardless of which page the user happens to be viewing when creating or editing a tile.

This feature solves deck clutter and cognitive overhead on companion decks without sacrificing the strict 15-tile (5×3) per-page physical layout limit. It ensures developer workflows remain structured, predictable, and clean as shortcut libraries expand.

---

## Analysis

The feature was evaluated across seven specialized architectural review lenses (UX & Ergonomics, Codebase Details, System Architecture, Cognitive Ergonomics, Implementation Readiness, Structural Layout & Invariants, and Inventive Catalyst):

### 1. The Spatial Memory Contradiction
Arya Dock functions as a hardware-free Stream Deck alternative where users develop unconscious physical and tactile muscle memory for tile coordinates (e.g., Row 1, Column 1 is always the primary test runner).
- **Risk:** Automatically removing a tile from its current page upon editing its action type ("The Vanishing Key") and packing remaining tiles forward destroys muscle memory across the entire deck.
- **Inventive Resolution (TRIZ Principle 15 & 24):** The system resolves this contradiction via a dual-mode mechanism:
  1. *Virtual Category Lenses (Non-destructive filtering):* A top cockpit filter strip (`[ALL] [💻 TERMINAL] [🚀 APPS] [🌐 URLS] [🎵 MEDIA]`) that dynamically highlights and isolates categories on the client without mutating disk state or scrambling coordinates.
  2. *Opt-in Physical Segregation:* An explicit workspace-level setting (`segregation: { enabled: true, autoCompact: false }`) that organizes tiles into canonical page sequences while preserving intentional empty grid slots (`slotIndex`).

### 2. Classification Heuristic & Ambiguity Resolution
- In Arya Dock, headless build commands, interactive shells, and native applications all execute via `actionType: 'shell'`.
- Naively mapping `terminalMode: 'background'` to "Applications" fails because background shell commands (`git pull`, `cargo test`, `docker compose up`) are developer CLI tools, not GUI desktop apps.
- **Classification Engine Invariant:**
  - `actionType === 'media'` ➔ **Media**
  - `actionType === 'url'` ➔ **URL**
  - `actionType === 'shell'` with `terminalMode: 'tab'` or `'window'` ➔ **Terminal**
  - `actionType === 'shell'` with `terminalMode: 'background'`:
    - If originated from the FreeDesktop Application Drawer (`isApplication: true` or matching installed desktop entry) ➔ **Application**
    - Otherwise ➔ **Terminal**
  - Explicit `categoryOverride` (`'terminal'`, `'application'`, `'url'`, `'media'`) on the button schema overrides all heuristics.

### 3. Capacity & Page Overflow Mechanics
- All category pages strictly respect the **15-tile (5×3) per-page ceiling**.
- When a category bucket reaches 15 tiles (e.g. adding a 16th terminal tile), it allocates to the next category page (e.g. `Terminal 2`), creating it dynamically if none exists.
- Category pages follow a deterministic canonical sequence within `workspace.pages`:
  `[Terminal 1..N] ➔ [Application 1..N] ➔ [URL 1..N] ➔ [Media 1..N]`.
- Empty category pages are retained as placeholders rather than pruned oscillatingly to prevent page count jitter during single-tile mutations.

### 4. Reversibility & Lossless Migration (TRIZ Principle 11)
- Toggling segregation on an existing workspace stores historical layout coordinates in `originCoordinates: { pageIndex, slotIndex }`.
- Disabling segregation restores every tile back to its exact pre-segregated coordinate, ensuring zero permanent data loss or layout scrambling.

---

## Goals vs. Non-Goals

### In-Scope Goals
* **Deterministic Classification:** Categorize tiles into Terminal, Application, URL, and Media using pure inspection of `actionType`, `terminalMode`, application metadata, and optional `categoryOverride`.
* **Workspace Opt-In Boundary:** Segregation is strictly opt-in per workspace (`workspace.segregation = { enabled: true }`). Default workspaces allow mixed-type freeform layouts.
* **15-Tile 5×3 Hard Ceiling:** Every category page strictly enforces the 15-tile limit, overflowing to sub-pages (`Category 2`, `Category 3`) automatically.
* **Automatic Mutation Routing:** When a tile's action type or category changes in edit mode, it routes to the correct category page automatically.
* **Slot Preservation (Non-Destructive Compaction):** Prevent unwanted tile re-ordering by preserving spatial layout positions where intentional whitespace was left.
* **Lossless Reversibility:** Enabling or disabling segregation can be toggled without losing the user's manual tile arrangements.

### Out-of-Scope Non-Goals
* **Cross-Workspace Segregation:** Tiles will not be automatically moved outside their owning workspace (e.g., from `developer` to `media`). Segregation applies strictly across pages *within* the active workspace.
* **Automated AI/LLM Categorization:** Classification relies purely on explicit schema rules and metadata, with zero remote network calls, LLM token costs, or nondeterministic heuristics.
* **Arbitrary User-Defined Categories:** Version 1 restricts categories to the core standard set (Terminal, Application, URL, Media) plus Custom overrides, avoiding arbitrary taxonomy fragmentation.

---

## Alternatives Weighed

1. **Forced Workspace-Wide Auto-Sorting (Rejected)**:
   - *Reason:* Rejected because forcing every workspace to auto-segregate breaks user workflows that intentionally pair shell scripts with web links on a unified project dashboard.
2. **Naive Background Shell Classification as "Application" (Rejected)**:
   - *Reason:* Rejected because developers frequently configure headless CLI scripts (`git status`, `npm test`) with `terminalMode: 'background'`. Classifying these as applications violates the developer mental model.
3. **Aggressive Page Re-compaction on Every Mutation (Rejected)**:
   - *Reason:* Rejected by UX review because packing remaining tiles forward whenever a tile is deleted or moved shifts adjacent buttons, destroying tactile muscle memory across the deck.
4. **Pure Client-Side Virtual Lenses without Server Schema Support (Rejected as Sole Solution)**:
   - *Reason:* While virtual lenses provide an excellent viewing filter, power users specifically requested distinct physical pages so hardware keypad paging paddles (`PREV` / `NEXT`) cycle through distinct functional groups on mobile companion decks.

---

## Key Decisions & Staging for Next Steps

### Key Decisions Resolved
1. **Opt-In Workspace Flag:** Configured via `workspace.segregation = { enabled: boolean, autoCompact: boolean }` in Schema v2.
2. **Schema Extension in [`lib/config.js`](file:///home/karthikulkarni/Documents/arya-dock/lib/config.js):**
   - Update `validateButton` to whitelist `categoryOverride` (`'terminal' | 'application' | 'url' | 'media' | null`) and `originCoordinates`.
   - Update `validateWorkspace` to validate the `segregation` configuration block.
3. **Canonical Page Sequence:** Segregated pages order deterministically: `Terminal ➔ Application ➔ URL ➔ Media`.
4. **Safe Page Navigation:** When a tile is added or mutated, the server smoothly advances `navState.pageIndex` to the target category page and broadcasts updated telemetry.

### Next Staging
- Present this synthesized brief for review.
- Proceed to `/egm:egm-draft` to author the detailed technical RFC and architectural specification document before implementation.
