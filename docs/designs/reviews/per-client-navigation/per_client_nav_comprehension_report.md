# Stage 6 Naive Reader Audit: docs/designs/per-client-navigation.md

# Naive Reader Audit Report: Per-Client Navigation & Independent Companion Screens

* **Target Document:** [per-client-navigation.md](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md)
* **Auditor:** Comprehension Goldfish (Stage 6 Naive Reader Audit)
* **Date:** 2026-11-09
* **Verdict:** Action Required (3 Blockers, 5 Majors, 2 Nits)

---

## 1. Paraphrase

### What this proposes
The document proposes refactoring Arya Dock's navigation model from a single global server state into independent, per-connection WebSocket sessions (`ws.navState`). Under this model, companion devices (such as phones, tablets, or secondary browser tabs) can independently navigate pages and switch or pin workspaces without forcing view changes onto other connected screens. The host workstation broadcasts active window focus shifts to all clients, but individual companion clients independently decide whether to follow or ignore these shifts based on their own local pin settings (`pinned: false` vs `pinned: true`), all while keeping persistent disk configuration isolated from transient navigation changes.

### How the existing system works, per this document
Currently, Arya Dock maintains a single `navState` singleton on the server in `server.js` that is globally shared across all WebSocket connections. When any client changes the page index, selects a workspace, or toggles pin mode, the server broadcasts that exact navigation state to all connected clients, forcing all screens to mirror the same view. Consequently, companion devices collide with each other—causing screen hijacking, global pin lockouts, and an inability to use dedicated physical decks for separate workflows simultaneously.

---

## 2. Findings & Discrepancies

### 🔴 Blocker: Undefined Context-to-Workspace Resolution in `CONTEXT_CHANGED`
* **Severity:** Blocker
* **Affected Scope:** Section 2 (lines 42, 59) and Section 5.4 Item 4 (lines 180-184)
* **Discrepancy Description & Rationale:**
  The design states that when workstation focus shifts (e.g. `ActiveWindowWatcher` detects `spotify`), Client A switches to `media`. In Section 5.4, it specifies:
  ```javascript
  navigationReducer(client.navState, { type: 'CONTEXT_CHANGED', appId })
  ```
  However, the document never explains how `appId` (`spotify`) resolves to a target `workspaceId` (`media`). Does `navigationReducer` inspect matching rules inside `appConfig`? Does `navigationReducer` take `workspaces` as a parameter (in Section 5.1 `createInitialNavigationState` received `workspaces`, but `navigationReducer` here is invoked only with `client.navState` and the action)? Without specifying how application IDs map to workspaces, a reader or implementer cannot determine how window focus tracking actually switches companion decks.

### 🔴 Blocker: Incomplete Serialization Contract & Hand-Waved Protocol Payload
* **Severity:** Blocker
* **Affected Scope:** Section 5.2 (lines 144-155)
* **Discrepancy Description & Rationale:**
  In `sendClientState`, the document replaces the core state projection and serialization logic with an ellipsis:
  ```javascript
  // Calculate projected buttons (respecting segregation & 15-tile limit)
  ...
  ws.send(JSON.stringify(payload));
  ```
  A technical design specification must define the protocol message envelope. The document does not define the shape of `payload`, what message `type` is sent to the client (e.g., `STATE`, `NAV_STATE`, `INITIAL_STATE`), or how the client UI handles this individualized message. Furthermore, "segregation" is never defined anywhere in the document.

### 🔴 Blocker: Unhandled Client Reconnection & State Eviction Lifecycle
* **Severity:** Blocker
* **Affected Scope:** Section 2 (lines 65-67), Section 4.2 (lines 106-107), Section 5.1 (lines 115-124)
* **Discrepancy Description & Rationale:**
  The document specifies that `ws.navState` is purely ephemeral in-memory state tied to the socket connection. If a mobile phone screen sleeps, the Wi-Fi drops momentarily, or the user reloads the companion browser/PWA page, the old WebSocket closes and a new connection is established. Per Section 5.1, `setupWebSocketServer` unconditionally reinitializes `ws.navState` using `appConfig.activeWorkspaceId` (defaulting to `developer`).
  This introduces severe usability friction: a companion tablet mounted to control `media` will unexpectedly revert to `developer` on every network blip, screen sleep, or page reload. The document does not specify any reconnection persistence mechanism (e.g., URL query parameters like `?workspace=media`, client-side local storage rehydration, or session tokens).

---

### 🟡 Major: Dangling Specification Concept: "Sync Intent"
* **Severity:** Major
* **Affected Scope:** Section 3 (Glossary, line 91)
* **Discrepancy Description & Rationale:**
  The glossary defines **Sync Intent** as a *"Protocol event enabling a client to synchronize with or break away from default navigation."* However, "Sync Intent" is never mentioned again in the document. Section 5.4 lists all WebSocket message handlers (`SET_WORKSPACE`, `SET_PAGE_INDEX`, `PAGE_NEXT`, `PAGE_PREV`, `PIN`, `UNPIN`, `CONTEXT_CHANGED`), none of which mention or implement Sync Intent. It is completely unclear what client action triggers Sync Intent, what payload it transmits, or how it alters `ws.navState`.

### 🟡 Major: Stale State Invariant on Workspace Deletion or Page Pruning
* **Severity:** Major
* **Affected Scope:** Section 5.2 (lines 129-142)
* **Discrepancy Description & Rationale:**
  `getClientWorkspace` performs `appConfig.workspaces?.find(w => w.id === wsId)`. If an editor deletes or renames a workspace while a companion client is viewing it, `getClientWorkspace` falls back to `workspaces[0]` for page rendering, but `ws.navState.workspaceId` is never updated or cleaned up. If that workspace ID is later recreated or if client-side actions echo back `ws.navState.workspaceId`, the client operates in an orphaned state.
  Similarly, if an editor deletes pages so that `wsObj.pages.length` shrinks, `getClientCurrentPage` clamps rendering index `idx` to 0, but leaves `ws.navState.pageIndex` out-of-bounds in memory.

### 🟡 Major: Ambiguity and Redundancy Between `mode` and `pinned`
* **Severity:** Major
* **Affected Scope:** Section 2 (lines 57, 72-74), Section 3 (line 86), Section 5.1 (line 122)
* **Discrepancy Description & Rationale:**
  The design specifies `NavigationState` as `{ workspaceId, pageIndex, mode, pinned }`. In diagrams and descriptions, it uses `pinned: false (AUTO)` and `pinned: true (PINNED)`. It is unclear whether `mode` and `pinned` are separate orthogonal flags or redundant aliases. If `mode` can be `'auto'` or `'manual'`, what happens if `mode: 'manual'` while `pinned: false`? The valid enum values for `mode` and their interaction with `pinned` are undefined.

### 🟡 Major: Vague Editor Authentication and Config Mutation Lifecycle
* **Severity:** Major
* **Affected Scope:** Section 2 (lines 77-79), Section 6 (lines 189-192)
* **Discrepancy Description & Rationale:**
  The document states that transient client navigation does not touch disk configuration, and *"Only an explicit user action from an authenticated editor (`role: 'editor'`) mutates persistent disk configuration (`appConfig.activeWorkspaceId`)."*
  However, it does not explain:
  1. How a WebSocket connection is authenticated or assigned `role: 'editor'` vs `role: 'operator'`.
  2. What explicit message triggers persistence of `activeWorkspaceId` (e.g., does `SET_WORKSPACE` accept a `persist: true` flag, or is there a dedicated configuration API?).
  3. What happens to other connected companion decks when an editor mutates `appConfig.activeWorkspaceId` (do unpinned companion clients follow the editor's default change, or ignore it?).

### 🟡 Major: Undefined Fallback `defaultNavState` and Legacy `/api/*` Routes
* **Severity:** Major
* **Affected Scope:** Section 3 (line 88)
* **Discrepancy Description & Rationale:**
  The glossary introduces `defaultNavState` as *"Fallback server navigation state used for legacy HTTP endpoints (`/api/*`)."* Section 5 provides no architectural detail on how `defaultNavState` is maintained in memory, whether it reacts to active window focus shifts, or how legacy `/api/*` routes interact with individual companion clients.

---

### 🔵 Nit: Undefined Project Acronyms and Technical Jargon
* **Severity:** Nit
* **Affected Scope:** Lines 5, 6, 7, 16, 76, 189, 191
* **Discrepancy Description & Rationale:**
  The document contains unlinked or undefined abbreviations and terms that create cognitive friction for readers new to the codebase:
  * **Pre-EGM Review** (line 5): Acronym "EGM" (Elephant-Goldfish Model / Engineering Governance Meeting) is undefined.
  * **Epic E1-2** (lines 6, 34): Roadmap milestone nomenclature used without explanation or project link.
  * **Reticle v2** (lines 7, 103, 195): Introduced without defining Reticle as the in-app UI verification harness.
  * **Pi Touchscreen** (line 16): Shorthand for Raspberry Pi hardware display.
  * **WS / WSS** (lines 19, 34, 66, 87, 113, 159): Used interchangeably for WebSocket and WebSocketServer instances without initial expansion.
  * **Virtual category lens chunking** (line 76): Introduced without context on what a "category lens" is or how chunking works.
  * **Segregation / `TOGGLE_SEGREGATION`** (lines 151, 189): Feature term referenced without explanation.
  * **`profiles.json`** (line 191): Introduced abruptly in Section 6 without linking it to `appConfig` as its disk storage representation.

### 🔵 Nit: Reticle Automation Hook Omission
* **Severity:** Nit
* **Affected Scope:** Section 7 (lines 195-200)
* **Discrepancy Description & Rationale:**
  The verification plan states: *"workstation triggers focus `spotify`"*. It does not specify how the test harness drives or simulates window focus shifts (e.g., via a test-only mock endpoint, an IPC test harness event, or an environment variable).

---

## 3. Summary of Recommendations for Author
1. **Explicit Window-to-Workspace Mapping**: Clarify how `navigationReducer` maps `appId` (`spotify`) to a workspace (`media`), and whether workspace configuration rules are passed into the reducer.
2. **Specify Message Schemas**: Fill in the `...` in `sendClientState` with the exact JSON payload schema sent to clients.
3. **Address Reconnection Ergonomics**: Introduce a mechanism (such as URL parameter `?workspace=<id>` or client-stored preference) so reconnecting companion devices do not snap back to the default workspace on page reload or network drop.
4. **Resolve "Sync Intent"**: Either implement and document the `Sync Intent` message flow or remove it from the glossary.
5. **Harmonize `mode` and `pinned`**: Consolidate `mode: 'auto' | 'pinned'` or clearly delineate the independent responsibility of `mode` versus `pinned`.
6. **Provide Glossary Links**: Briefly define domain-specific terms (Reticle, profiles.json, button segregation, lens chunking, EGM) upon first mention.
