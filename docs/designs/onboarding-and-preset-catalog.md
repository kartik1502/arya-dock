# Technical Specification: First-Run Onboarding Wizard & Preset Catalog (Epic E4-1 & E4-3)

## Status: APPROVED (EGM Review Consensus)
* **Epic ID**: E4-1 (Host System Diagnostic Scanner & Smart Profile Seeder) & E4-3 (First-Run Interactive Onboarding Wizard & Preset Catalog)
* **Target Schema**: Version 2 (`workspaces` array model)
* **Synthesis Document**: [`docs/designs/reviews/onboarding-presets/onboarding_presets_synthesis_report.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/reviews/onboarding-presets/onboarding_presets_synthesis_report.md)

---

## 1. Executive Summary

This specification defines the complete end-to-end architecture for replacing Arya Dock's static default configuration copy with an intelligent, non-invasive **Host Ecosystem Diagnostic Scanner & Curated Seeder** (`lib/presets.js`) alongside a responsive, touch-friendly **First-Run Onboarding Wizard & Preset Catalog** (`#onboardingWizardModal` in `public/index.html` and `public/app.js`).

---

## 2. Core Architectural Components

### 2.1 Single Source of Truth (`lib/presets.js`)
All static preset definitions, diagnostic scanners, and curated workspace generators are consolidated in `lib/presets.js`:
- **Portability**: Uses `path.delimiter` (`:` on POSIX, `;` on Windows) for `$PATH` scanning.
- **Performance & DoS Defense**: 60-second in-memory memoization cache with single-flight request coalescing to eliminate synchronous I/O thrashing and event loop blocking.
- **Physical Grid Ceiling**: Enforces $\le 15$ buttons per page on every workspace page via `chunkArray(items, 15)`.
- **Baseline Fallback**: Generates clean, robust developer tools even in headless / minimal container environments with 0 desktop applications.
- **Prototype Pollution Defense**: Restricts workspace IDs to strict enum `ALLOWED_STARTER_IDS = ['developer', 'devops', 'media', 'system']`.

### 2.2 Server Endpoints & WebSocket Handlers
- **`GET /api/presets/catalog`**: Returns static preset catalog `{ presets: STATIC_PRESETS }`. Protected by pairing token (`checkHttpAuth`).
- **`GET /api/presets/detect`**: Probes host environment. Protected by pairing token AND editor key (`checkHttpAuth` && `checkEditorPrivilege`). Supports `?refresh=true`.
- **`POST /api/presets/apply`**: Replaces or merges starter workspaces. Protected by pairing token AND editor key. Reviver rejects `__proto__`, `constructor`, `prototype`.
- **WebSocket `APPLY_STARTER_WORKSPACES`**: Companion client message handler. Reconciles navigation across all connected sockets and broadcasts `STATE_UPDATE`.

### 2.3 Frontend Onboarding Wizard & Touch Ergonomics
- **First-Run Detection**: `config.onboardingCompleted: boolean` (Schema v2). If `false` and editor, opens `#onboardingWizardModal`.
- **Operator Guided Preview**: If `canEdit === false`, shows `#wizardOperatorNotice` with `#btnWizardUnlockEditor` rather than failing on submit.
- **Touch Ergonomics**: In the App Drawer, tapping any preset opens `#slotPickerModal` for one-touch assignment to any of the 15 keypad slots, eliminating mobile HTML5 drag-and-drop limitations.

---

## 3. Strict Invariants

1. **15-Tile Physical Grid Ceiling**: Every generated workspace page strictly contains $\le 15$ buttons ($5 \times 3$ grid layout).
2. **Editor Authorization Barrier**: Only authenticated editors can query `/api/presets/detect` or apply starter workspaces. Operators receive `403 Forbidden` (`ERR_UNAUTHORIZED`).
3. **Multi-Client Navigation Safety**: Starter workspace application executes the `onImportConfig` pattern: writes to disk first, updates in-memory config, resets server navigation, and reconciles all connected socket viewports.
4. **Persistent Onboarding State**: Persists `onboardingCompleted: true` in `profiles.json` upon completion or skip.
