# Stage 8 Swarm Synthesis Report: Per-Client Navigation & Independent Companion Screens

**Target Document:** [`docs/designs/per-client-navigation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md)  
**Compiler:** EGM Synthesizer Persona (Stage 8 Technical Swarm Compiler)  
**Consolidated Inputs:**
- Stage 5: Skeptical Architect / Zoom Out Review ([`per_client_nav_zoom_out_report.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/reviews/per_client_nav_zoom_out_report.md))
- Stage 6: Naive Reader / Comprehension Audit ([`per_client_nav_comprehension_report.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/reviews/per_client_nav_comprehension_report.md))
- Stage 7: Hostile Design Critic Review ([`per_client_nav_critic_report.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/reviews/per_client_nav_critic_report.md))  

**Final Swarm Verdict:** **REJECTED (REQUIRES REVISION)** — 4 Blockers, 6 Majors, 2 Nits

---

## 1. Reviewer Status Matrix

| Reviewer Lens | Stage | Status | Findings Reported |
| :--- | :---: | :---: | :--- |
| **Skeptical Architect** (`zoom_out`) | Stage 5 | completed | 2 Blockers, 4 Majors, 1 Nit |
| **Naive Reader** (`comprehension`) | Stage 6 | completed | 3 Blockers, 5 Majors, 2 Nits |
| **Hostile Design Critic** (`design_critic`) | Stage 7 | completed | 3 Blockers, 3 Majors, 1 Nit |

---

## 2. Executive Synthesis & Swarm Consensus

All three review lenses strongly endorse the core thesis: transitioning navigation state from a server-wide singleton to per-connection WebSocket properties (`ws.navState`) is essential to prevent screen hijacking across multi-device setups.

However, the design document in its current draft cannot be approved for implementation due to critical structural disconnects:
1. **Execution Desynchronization**: Redesigning navigation while ignoring `BUTTON_CLICK` guarantees that companion deck taps will execute wrong commands from foreign workspaces on the host machine.
2. **Zombie Multi-Client Lifecycles**: Deleting workspaces or pruning pages leaves companion sockets holding orphaned, out-of-bounds state.
3. **Reticle Test Infeasibility**: Specifying a single Reticle flow JSON to test multi-client isolation and OS window switching is architecturally impossible under Reticle v2's single-session browser model.
4. **Phantom Abstractions vs. Incomplete Schemas**: The document invents unused concepts ("Sync Intent", `defaultNavState`) while replacing the critical serialization protocol in Section 5.2 with an ellipsis (`...`).

---

## 3. Consolidated & Deduplicated Findings

### 🔴 Prioritized Blockers

#### Blocker 1: Button Execution Desynchronization & Host Command Misrouting (`BUTTON_CLICK`)
* **Reviewer Lenses:** `zoom_out` (Finding 1), `design_critic` (Probe 3 & Finding 1)
* **Affected Scope:** Section 5.2 (lines 144–155), Section 5.4 (lines 169–185)
* **Discrepancy Description:**
  Section 5.4 details page flips and workspace switches but completely omits [`BUTTON_CLICK`](file:///home/karthikulkarni/Documents/arya-dock/lib/ws.js#L279-L287). Currently, `lib/ws.js` evaluates button lookups using `getCurrentPage()`, which reads the global server state singleton. If a companion client on workspace `media` taps button slot 0 while the workstation host/editor is on `developer`, the server executes button slot 0 of `developer` (e.g. running a build script or shell terminal kill command instead of Spotify play/pause). Furthermore, when client-side category lenses are active (`activeLens !== 'all'`), virtual pages aggregate buttons across canonical pages; searching only the canonical page index fails button resolution.
* **Consolidated Recommendation:**
  1. Add `BUTTON_CLICK` explicitly to Section 5.4.
  2. Implement `resolveClientButton(ws, clickId, appConfig)`:
     - Search the calling client's active page: `getClientCurrentPage(ws, appConfig).buttons.find(b => b.id === clickId)`.
     - If not found (to support virtual category lenses), search across the client's entire active workspace: `getClientWorkspace(ws, appConfig).pages.flatMap(p => p.buttons).find(b => b.id === clickId)`.
  3. Include `{ workspaceId, pageIndex }` in the client's `BUTTON_CLICK` payload as a verification guard against race conditions.

#### Blocker 2: Unhandled Multi-Client Workspace Deletion & Page Pruning (Zombie States)
* **Reviewer Lenses:** `zoom_out` (Finding 2), `comprehension` (Finding 2), `design_critic` (Probe 1 & Finding 2)
* **Affected Scope:** Section 5.2 (lines 129–142), Section 5.4 (lines 169–185)
* **Discrepancy Description:**
  When an editor deletes a workspace (`WORKSPACE_DELETED`) or trims page count, Section 5.4 does not dispatch the event to connected companion clients. While `getClientWorkspace()` falls back to `workspaces[0]` for display, `ws.navState.workspaceId` and `pageIndex` remain pointing to the destroyed workspace or out-of-bounds page index. Subsequent `PAGE_NEXT`/`PAGE_PREV` operations fail bounds calculations (`totalPages` defaults to 1), and `CONTEXT_CHANGED` cannot heal the socket because it retains the unmatched phantom workspace.
* **Consolidated Recommendation:**
  In Section 5.4, specify that `WORKSPACE_DELETED` and page pruning events must iterate over all connected clients:
  ```javascript
  wss.clients.forEach(client => {
    client.navState = navigationReducer(client.navState, {
      type: 'WORKSPACE_DELETED',
      workspaceId: deletedWsId,
      fallbackWorkspaceId: appConfig.workspaces[0]?.id || 'developer'
    }, { workspaces: appConfig.workspaces });
    sendClientState(client, context);
  });
  ```

#### Blocker 3: Reticle v2 Multi-Client Test Architecture Infeasibility
* **Reviewer Lenses:** `comprehension` (Nit 2), `design_critic` (Probe 5 & Finding 3)
* **Affected Scope:** Section 7 (*Reticle v2 Verification Plan*, lines 195–200)
* **Discrepancy Description:**
  Section 7 proposes `.reticle/flows/arya-dock-4f274f15/per-client-navigation.json` to instantiate multiple companion screens, trigger cross-client workspace changes, and drive OS window focus shifts. Reticle v2 flow JSON files are strictly single-client browser automation journeys (`startPath: "/"`, DOM action steps). They have no multi-client schema and cannot coordinate multiple WebSocket sessions or simulate host OS window focus shifts (`ActiveWindowWatcher`).
* **Consolidated Recommendation:**
  Replace Section 7 with a two-tiered verification strategy:
  1. **Node.js Concurrency Test Suite (`test/per-client-navigation.test.js`)**: Connect multiple mock WebSocket clients to `createServer()`, execute interleaved `SET_WORKSPACE`, `PIN`, and mock `activeWatcher.onChange('spotify')` events, asserting exact per-socket isolation and deterministic frame delivery.
  2. **Single-Client Reticle Flow (`.reticle/flows/.../companion-deck-state.json`)**: Drive a single client session to verify rendering of local navigation badges (`PINNED` vs `AUTO`), local page flipping indicators, and responsive grid layout.

#### Blocker 4: Incomplete Protocol Serialization Contract & Ellipsis Pseudo-Code
* **Reviewer Lenses:** `zoom_out` (Finding 5), `comprehension` (Blocker 2), `design_critic` (Finding 4)
* **Affected Scope:** Section 5.2 (lines 144–155)
* **Discrepancy Description:**
  `sendClientState` replaces the core state projection and serialization logic with an ellipsis (`// Calculate projected buttons (respecting segregation & 15-tile limit) ... ws.send(...)`). The document fails to define the message `type` (e.g. `STATE_UPDATE`), the envelope payload structure, or the boundary between server-provided canonical data and client-side virtual category lens chunking.
* **Consolidated Recommendation:**
  Eliminate the ellipsis and define the explicit JSON protocol contract:
  ```javascript
  const payload = {
    type: 'STATE_UPDATE',
    navState: {
      workspaceId: workspace.id,
      pageIndex: safePageIndex,
      pinned: ws.navState.pinned
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      segregation: workspace.segregation || { enabled: false }
    },
    page: {
      index: safePageIndex,
      totalPages: workspace.pages.length || 1,
      buttons: page.buttons.slice(0, 15) // Canonical 15-tile physical limit
    },
    allButtons: workspace.pages.flatMap(p => p.buttons) // Provided for client-side category lenses
  };
  ws.send(JSON.stringify(payload));
  ```

---

### 🟡 Prioritized Majors

#### Major 1: Incomplete `CONTEXT_CHANGED` Mapping & Omission of Reducer Context
* **Reviewer Lenses:** `comprehension` (Blocker 1), `design_critic` (Probe 4 & Finding 6)
* **Affected Scope:** Section 2 (lines 42, 59), Section 5.4 (lines 170–174, 180–184)
* **Discrepancy Description:**
  Section 5.4 invokes `navigationReducer(client.navState, { type: 'CONTEXT_CHANGED', appId })` without passing `context`. In `lib/navigation.js`, workspace matching against `appConfig.workspaces` requires `context.workspaces`. Without `context`, `navigationReducer` cannot map application IDs to workspaces. Furthermore, invoking `navigationReducer` for `USER_SELECT` without `context` bypasses workspace existence validation and page bounds clamping.
* **Consolidated Recommendation:**
  Explicitly specify passing context in all reducer dispatches:
  ```javascript
  ws.navState = navigationReducer(ws.navState, action, {
    workspaces: appConfig.workspaces,
    totalPages: targetWs?.pages?.length || 1
  });
  ```
  Clarify in Section 2 that `appId` resolves to `workspaceId` via the existing `activeWindow` mapping rules configured in `appConfig.workspaces`.

#### Major 2: Navigation vs. Disk Persistence Decoupling & Operator Bleed
* **Reviewer Lenses:** `zoom_out` (Finding 6), `comprehension` (Major 4), `design_critic` (Probe 4 & Finding 5)
* **Affected Scope:** Section 2.5 (lines 77–79), Section 6 (lines 188–193)
* **Discrepancy Description:**
  In `server.js:189-194`, `dispatchNav` mutates `appConfig.activeWorkspaceId` whenever `USER_SELECT` occurs, triggering disk saves to `profiles.json`. If operators are granted navigation freedom, their transient deck switches will overwrite the workstation host's boot profile.
* **Consolidated Recommendation:**
  Decouple ephemeral client navigation from server configuration persistence:
  - Transient navigation actions (`SET_WORKSPACE`, `PAGE_NEXT`, `PAGE_PREV`, `PIN`, `UNPIN`) mutate only in-memory `ws.navState` and never touch disk.
  - Disk persistence of `appConfig.activeWorkspaceId` is restricted to explicit editor configuration actions (e.g. `SAVE_ACTIVE_WORKSPACE` or workspace settings mutations guarded by `canEdit`).

#### Major 3: Segregation Target Misdirection & Projection Decoupling
* **Reviewer Lenses:** `zoom_out` (Finding 5), `design_critic` (Probe 2 & Finding 4)
* **Affected Scope:** Section 2 (Principle 4), Section 5.2 (lines 151–153), Section 6 (line 189)
* **Discrepancy Description:**
  `TOGGLE_SEGREGATION` in `lib/ws.js` evaluates `const targetId = data.workspaceId || activeWs.id`. If an editor on a companion screen toggles segregation, it falls back to the server singleton (`activeWs.id`), corrupting the wrong workspace. Additionally, attempting server-side category lens calculation leaks client UI state (`activeLens`) into the server.
* **Consolidated Recommendation:**
  1. Fix `TOGGLE_SEGREGATION` to require `workspaceId` in the message payload, falling back to `ws.navState.workspaceId`.
  2. Keep lens projection client-side: server sends canonical `page.buttons` (capped at 15) and `allButtons`; client handles virtual lens chunking (`public/app.js`).

#### Major 4: Speculative Dead-Weight Protocol Pruning ("Sync Intent" & `defaultNavState`)
* **Reviewer Lenses:** `zoom_out` (Findings 3 & 4), `comprehension` (Majors 1 & 5)
* **Affected Scope:** Section 3 (*Reference Glossary & Definitions*, lines 88, 91)
* **Discrepancy Description:**
  - **"Sync Intent"**: Defined as a protocol event for clients to sync or break away from default navigation, but never referenced or implemented in message routing. Unpinned clients already track focus automatically, and pinned clients stay locked.
  - **`defaultNavState`**: Defined as a server fallback for "legacy HTTP endpoints (`/api/*`)". Code audit of `lib/http.js` confirms that no HTTP navigation endpoints exist.
* **Consolidated Recommendation:**
  Delete "Sync Intent" and `defaultNavState` from the glossary and specification to maintain a lean, YAGNI-compliant architecture.

#### Major 5: State Model Simplification (`mode` vs `pinned` Redundancy)
* **Reviewer Lenses:** `comprehension` (Major 3)
* **Affected Scope:** Section 2 (lines 57, 72–74), Section 3 (line 86), Section 5.1 (line 122)
* **Discrepancy Description:**
  `NavigationState` defines `{ workspaceId, pageIndex, mode, pinned }`. In diagrams and text, `mode: 'auto'` corresponds to `pinned: false`, and `mode: 'manual'` corresponds to `pinned: true`. Having two concurrent properties representing the same lock state introduces invalid state permutations (e.g. `mode: 'manual', pinned: false`).
* **Consolidated Recommendation:**
  Consolidate `NavigationState` to use `pinned: boolean` as the canonical mutable flag. Treat `mode` as a derived read-only presentation helper (`pinned ? 'PINNED' : 'AUTO'`), eliminating state ambiguity.

#### Major 6: Reconnection Ergonomics without Leaky Server Session Registries
* **Reviewer Lenses:** `zoom_out` (Arch 3), `comprehension` (Blocker 3), `design_critic` (Nit 7)
* **Affected Scope:** Section 2 (lines 65–67), Section 5.1 (lines 115–124)
* **Discrepancy Description:**
  When a mobile phone locks its screen or experiences a Wi-Fi blip, the WebSocket closes. On reconnect, `setupWebSocketServer` unconditionally reinitializes `ws.navState` to the server default (`developer`), frustrating users who have mounted dedicated companion screens (e.g. `media`). However, building complex server-side session stores (`Map<deviceId, State>`) creates memory leaks when sockets drop.
* **Consolidated Recommendation:**
  Adopt stateless, client-driven rehydration:
  - Companion clients include their current workspace preference via URL parameter (`/?workspace=media`) or send an immediate handshake `SET_WORKSPACE` on socket open.
  - Keeps the server 100% stateless and garbage-collection safe (`ws.on('close') => ws.navState = null`), while giving mobile companion decks seamless resumption.

---

### 🟢 Prioritized Nits

#### Nit 1: Missing Acronym Definitions and Project Lexicon
* **Reviewer Lenses:** `comprehension` (Nit 1)
* **Affected Scope:** Lines 5, 6, 7, 16, 76, 189, 191
* **Discrepancy Description:**
  Terms and abbreviations such as "EGM", "Epic E1-2", "Reticle v2", "Pi Touchscreen", "WS/WSS", "virtual category lens", and "profiles.json" are introduced without initial expansion or cross-links.
* **Consolidated Recommendation:**
  Add a brief "Conventions & Terminology" section or hyperlinked footnotes defining these terms on first use.

#### Nit 2: Specification Detail Balance: Replace Helper Pseudocode with Protocol Contracts
* **Reviewer Lenses:** `zoom_out` (Finding 7)
* **Affected Scope:** Section 5.2 (lines 129–142)
* **Discrepancy Description:**
  The design includes line-by-line JavaScript helper implementations (`getClientWorkspace`, `getClientCurrentPage`) while leaving the protocol payloads for `sendClientState` and `BUTTON_CLICK` undefined.
* **Consolidated Recommendation:**
  Replace internal helper pseudocode with formal protocol message schemas and routing tables.

---

## 4. Concrete, Actionable Remediation Checklist

To bring `docs/designs/per-client-navigation.md` to approved status, execute the following remediation checklist:

- [ ] **Section 2 (Architecture & Principles)**
  - [ ] Update Principle 3 to clarify that `appId` resolves to `workspaceId` via rules in `appConfig.workspaces`.
  - [ ] Update Principle 4 to clarify that 15-tile limits apply to server-transmitted canonical pages, while category lens virtual chunking remains client-side.
  - [ ] Update Principle 5 to explicitly state that transient navigation never touches disk; only explicit editor configuration changes mutate `appConfig.activeWorkspaceId`.
- [ ] **Section 3 (Glossary)**
  - [ ] Delete `defaultNavState`.
  - [ ] Delete `Sync Intent`.
  - [ ] Simplify `NavigationState` to `{ workspaceId, pageIndex, pinned }` (with `mode` as derived presentation).
- [ ] **Section 4 (Goals & Non-Goals)**
  - [ ] Clarify Goal 6: Verification via Node.js concurrency tests for multi-client isolation + Reticle flow for single-deck UI badge validation.
- [ ] **Section 5.1 (Per-Socket Navigation Initialization)**
  - [ ] Document client-driven reconnection rehydration via URL query params (`/?workspace=<id>`) or initial handshake.
  - [ ] Add explicit socket teardown hygiene: `ws.on('close', () => { ws.navState = null; })`.
- [ ] **Section 5.2 (Serialization Protocol)**
  - [ ] Replace `...` with the complete JSON payload schema for `STATE_UPDATE`.
  - [ ] Include `workspace`, `page` (buttons capped at 15), and `allButtons` in the serialized payload.
- [ ] **Section 5.4 (Message Handler Routing)**
  - [ ] Add `BUTTON_CLICK` routing: resolve click against `getClientCurrentPage(ws, appConfig)` with fallback to `allButtons` of client's workspace.
  - [ ] Add `WORKSPACE_DELETED` routing: fan out to all `wss.clients` through `navigationReducer` with fallback workspace.
  - [ ] Ensure all `navigationReducer` invocations pass `{ workspaces: appConfig.workspaces, totalPages }`.
  - [ ] Update `TOGGLE_SEGREGATION` to require `workspaceId` or fall back to calling socket's `ws.navState.workspaceId`.
- [ ] **Section 7 (Verification Plan)**
  - [ ] Replace impossible multi-client Reticle flow with:
    - Native Node.js concurrency suite: `test/per-client-navigation.test.js`.
    - Single-session Reticle UI flow: `.reticle/flows/arya-dock-4f274f15/companion-deck-state.json`.
