# Synthesis & Triaged Audit Report: Active Window Auto-Switching Engine

* **Document Under Audit:** `docs/designs/active-window-auto-switching.md`
* **Target Version:** Arya Dock v1.1.0 / Epic E1-1
* **Aggregator / Compiler:** EGM Intermediate Swarm Synthesizer (`egm-synthesizer`)
* **Source Reviews Consolidated:**
  1. `docs/designs/reviews/active_window_zoom_out_report.md` (Skeptical Architect)
  2. `docs/designs/reviews/active_window_comprehension_report.md` (Naive Reader / Comprehension)
  3. `docs/designs/reviews/active_window_critic_report.md` (Hostile Design Critic)
* **Status:** Synthesis Complete — Concrete Refactor Resolutions Established
* **Date:** 2026-11-08

---

## Reviewer Status & Swarm Consensus

| Reviewer | Lens Shortname | Status | Raw Issues Found |
| :--- | :--- | :--- | :--- |
| **Skeptical Architect** | `zoom_out` | completed | 6 findings (1 Blocker, 2 Major, 2 Minor, 1 Nit) |
| **Naive Reader** | `comprehension` | completed | 6 findings (1 Blocker, 3 Major, 2 Nit) |
| **Hostile Design Critic** | `design_critic` | completed | 10 findings (5 Blocker, 5 Major) |
| **Consolidated Swarm Total** | **Triaged & Deduplicated** | **completed** | **4 Blockers, 6 Majors, 2 Minors, 2 Nits** |

### High-Altitude Swarm Verdict
The swarm unanimously validates the **core problem and user value proposition**: automatically tracking workstation focus to switch Arya Dock companion workspaces eliminates physical cognitive friction and preserves developer keyboard flow.

However, the swarm is equally unanimous in rejecting the **initial execution design**:
1. It relies on a brute-force OS polling loop (up to 28,800 child processes/hour) that will exhaust PIDs and drain laptop battery.
2. It introduces a mathematical contradiction between polling intervals (250ms) and debounce timers (150ms).
3. It fatally assumes `gdbus` outputs JSON (it outputs GLib GVariant, which breaks `JSON.parse`).
4. It inadvertently pollutes disk persistence (`appConfig.activeWorkspaceId` is updated on focus shifts and flushed to `config.json`).
5. It assumes a 1:1 host-to-deck relationship, paralyzing multi-deck setups via a global singleton `navState`.
6. It duplicates existing codebase logic (`normalizeAppId`) while using phantom WebSocket action names and outdated DOM selectors.

---

## Prioritized Findings Summary Matrix

| ID | Category / Theme | Severity | Source Lenses | Affected Scope |
| :--- | :--- | :--- | :--- | :--- |
| **ISSUE-01** | Process Storm, Child-Process Pile-up & Polling vs. Debounce Contradiction | 🔴 **Blocker** | Architect, Reader, Critic | §2, §4.1, §4.2, line 74 |
| **ISSUE-02** | GVariant vs. JSON Serialization & Fragile Parsing | 🔴 **Blocker** | Critic, Reader | §4.1 (lines 110–118) |
| **ISSUE-03** | State Corruption: `appConfig` Pollution & Disk Persistence | 🔴 **Blocker** | Critic, Architect | §3.2, §4.3, `server.js` |
| **ISSUE-04** | Global Singleton State Trap in Multi-Deck Environments | 🔴 **Blocker** | Critic | §2, §4.3, `server.js`, `lib/ws.js` |
| **ISSUE-05** | Codebase Divergence, Duplication (`normalizeAppId`) & Contract Drift | 🟡 **Major** | Architect | §4.1, §4.3, §4.4 |
| **ISSUE-06** | Operator Privilege Lockout on Companion Decks | 🟡 **Major** | Critic, Reader | §4.4, §5.3, `lib/ws.js` |
| **ISSUE-07** | Substring Collisions & Rule Semantics in `findWorkspaceForApp` | 🟡 **Major** | Critic, Reader | §2, §4.3, `lib/navigation.js` |
| **ISSUE-08** | Command & Argument Injection Risk in `xprop` Query Chain | 🟡 **Major** | Critic | §4.1 (lines 120–124) |
| **ISSUE-09** | Watcher Lifecycle Thrashing & Missing Grace Period (Hysteresis) | 🟡 **Major** | Architect, Critic | §4.2 (lines 131–143) |
| **ISSUE-10** | Subprocess Buffer Hygiene & Privacy Threat Model Clarification | 🟡 **Major** | Reader, Critic | §2, §5.1 |
| **ISSUE-11** | D-Bus Daemon Outages, Reconnects & Console Log Flooding | 🟢 **Minor** | Critic | §4.1, §6 |
| **ISSUE-12** | Undefined Linux Desktop, Compositor & IPC Terminology | 🟢 **Minor** | Reader | §3.1, §4.1, §6 |
| **ISSUE-13** | Unspecified Shape of Navigation State (`NavigationState` Schema) | 🟢 **Nit** | Reader | §4.3, §4.4 |
| **ISSUE-14** | Legacy Callback Signature vs. Async/Promise Pattern | 🟢 **Nit** | Architect | §4.1 (line 109) |

---

## Detailed Findings Grouped by Architectural Theme

### Theme 1: OS Execution Costs & Event Debouncing (🔴 Blocker)

#### ISSUE-01: Process Storm, Child-Process Pile-up & Polling vs. Debounce Contradiction
* **Severity:** 🔴 Blocker
* **Reviewer Lenses:** Skeptical Architect (#1, #3), Naive Reader (#1), Hostile Design Critic (#1.3, #2.1, #2.2, #2.3)
* **Affected Scope:** `docs/designs/active-window-auto-switching.md` Section 2 (Pillar 3), Section 4 Architecture Diagram (line 74), Section 4.1, Section 4.2
* **Discrepancy Description:**
  1. **Process Table Exhaustion**: Polling via `child_process.execFile` every 250ms spawns 4 processes/sec (240/min; 14,400/hr) on Wayland. Under X11, querying `_NET_ACTIVE_WINDOW` followed by `WM_CLASS` spawns 8 processes/sec (28,800/hr). On developer laptops, this continuously invalidates CPU instruction caches, prevents deep C-states, drains battery, and wraps the Linux PID counter (`/proc/sys/kernel/pid_max`) every 1–2 hours.
  2. **Fork Stampede & FD Exhaustion**: If GNOME Shell stalls or heavy compilation occurs, un-gated `setInterval` calls pile up waiting child processes, exhausting file descriptors (`EMFILE`) and kernel resources (`EAGAIN`).
  3. **Timing Contradiction**: Line 74 cites `every 250ms / debounced 150ms`. A discrete 250ms polling loop cannot debounce a 150ms window. Rapid Alt-Tabbing (e.g. 80ms per window) will sample arbitrary intermediate windows, causing the 150ms timer to fire out of phase and creating visual rubber-banding on the deck.
  4. **Payload GC Churn**: `org.gnome.Shell.Introspect.GetWindows` returns metadata for *all* open windows (50–250KB per call), causing 200KB–1MB/sec of throwaway string allocations and GC scavenge latency spikes.
* **Architectural Resolution:**
  - **Differentiate X11 from Wayland**:
    - **X11**: Do not poll. Spawn a single persistent streaming process: `xprop -spy -root _NET_ACTIVE_WINDOW`. Listen on `stdout` line events. When a window ID appears, query its `WM_CLASS` once.
    - **GNOME Wayland**: Replace `setInterval` with **serialized recursive `setTimeout`** at an interval of 750ms–1000ms. Enforce a single-flight mutex (`isQueryRunning = false`) so a new query is never spawned while one is in flight. Provide an `AbortController` timeout of 250ms with `SIGKILL`.
  - **Decouple Debouncing**:
    - For push streams (X11): Apply standard 150ms timer debounce.
    - For polling (Wayland): Require **2 consecutive identical matching samples** before dispatching a focus change, eliminating timer-aliasing artifacts.

---

### Theme 2: Serialization & Data Ingestion (🔴 Blocker)

#### ISSUE-02: GVariant Format Incompatibility & Fragile Parsing
* **Severity:** 🔴 Blocker
* **Reviewer Lenses:** Hostile Design Critic (#3.1), Naive Reader (#2, #4)
* **Affected Scope:** Section 4.1 (lines 110–118)
* **Discrepancy Description:**
  - The spec states `gdbus call` is primary and parses its dictionary, listing `busctl --json=short` as a fallback.
  - `gdbus` outputs GLib GVariant syntax (e.g., `(@a{ta{sv}} {1234: {'title': <'Terminal'>, 'app-id': <'ptyxis'>}},)`), **NOT valid JSON**. Running `JSON.parse()` crashes with `SyntaxError`.
  - Parsing GVariant via ad-hoc regex is dangerous: a browser tab titled `has-focus': <true>, 'app-id': <'spotify'>` could fool regex into switching workspaces based on window content rather than window metadata.
* **Architectural Resolution:**
  - Invert tool priority: make `busctl --user --json=short call org.gnome.Shell.Introspect /org/gnome/Shell/Introspect org.gnome.Shell.Introspect GetWindows` the **primary Wayland inspector**.
  - Ingest directly via `JSON.parse()` wrapped in a `try/catch`.
  - If `busctl` is not present, fall back to X11 `xprop`. Do not attempt regex parsing of GVariant streams.

---

### Theme 3: State Integrity & Persistence Boundaries (🔴 Blocker)

#### ISSUE-03: Accidental Disk Persistence of Transient Focus (`appConfig` Pollution)
* **Severity:** 🔴 Blocker
* **Reviewer Lenses:** Hostile Design Critic (#4.1), Skeptical Architect (#4)
* **Affected Scope:** Section 3.2 (Non-Goal 4), Section 4.3 (lines 146–152), `server.js` (lines 123–126)
* **Discrepancy Description:**
  - Section 3.2 Non-Goals guarantees that auto-switching will never destructively alter saved workspace configurations.
  - However, in `server.js`:
    ```javascript
    if (appConfig.activeWorkspaceId !== navState.workspaceId) {
      appConfig.activeWorkspaceId = navState.workspaceId;
      appConfig.activeProfile = navState.workspaceId;
    }
    ```
  - Whenever the server stops or an editor changes a tile, `flushConfigSync()` persists `appConfig` to `config.json`.
  - Consequently, whatever window had workstation focus at shutdown permanently overwrites the user's default workspace on disk!
* **Architectural Resolution:**
  - Establish a strict boundary between transient navigation state and persistent configuration.
  - `CONTEXT_CHANGED` focus events must only update runtime `navState.workspaceId` and broadcast over WebSockets. They must **never** mutate `appConfig.activeWorkspaceId` or trigger `saveConfig()`.
  - Only deliberate, manual workspace selections (`SET_WORKSPACE` / `USER_SELECT`) by the user may update `appConfig.activeWorkspaceId`.

---

### Theme 4: Multi-Device Concurrency & Pinning (🔴 Blocker)

#### ISSUE-04: Global Singleton State Trap in Multi-Deck Environments
* **Severity:** 🔴 Blocker
* **Reviewer Lenses:** Hostile Design Critic (#1.1)
* **Affected Scope:** Section 2, Section 4.3, `server.js` (lines 86–91), `lib/ws.js`
* **Discrepancy Description:**
  - `server.js` maintains a single global `navState` singleton.
  - If a user operates multiple companion screens (e.g. tablet on a stand for Spotify/Media controls, phone beside keyboard for code macros), workstation focus shifts will yank the tablet screen to the developer workspace against the user's intent.
  - If the user taps "PIN" on the tablet, `navState.pinned` becomes `true` globally, freezing auto-switching for the phone as well.
* **Architectural Resolution:**
  - **Phase 1 (v1.1.0 Protocol Foundation)**:
    - Add client-side pin independence or registration modes: WebSockets register with `{ clientMode: 'follow-active-window' | 'pinned-workspace' }`.
    - At minimum, the companion UI must support a local lock that ignores incoming `CONTEXT_CHANGED` state broadcasts if locally pinned.
  - **Phase 2 (Multi-Deck Architecture)**:
    - Decouple `navState` per client session (`ws.navState`), maintaining independent workspace pointers per connected device.

---

### Theme 5: Codebase Consistency & Integration (🟡 Major)

#### ISSUE-05: Codebase Divergence, Duplication (`normalizeAppId`) & Contract Drift
* **Severity:** 🟡 Major
* **Reviewer Lenses:** Skeptical Architect (#2, #4)
* **Affected Scope:** Section 4.1 (Point 3), Section 4.3, Section 4.4
* **Discrepancy Description:**
  1. `normalizeAppId()` is already implemented in `lib/navigation.js` (lines 55–68) with full test coverage in `test/navigation.test.js`. Re-implementing it in `platform/linux.js` is redundant and invites drift.
  2. The spec references phantom UI IDs and WS actions: `#btnWorkspacePin`, `PIN_WORKSPACE`, `UNPIN_WORKSPACE`.
     - In `public/index.html` (line 129), the actual ID is `#btnPinWorkspace`.
     - In `lib/ws.js` (lines 314–337), existing actions are `PIN`, `UNPIN`, and `TOGGLE_PIN`.
  3. `server.js` line 128 shows `dispatchNav()` returns `navState`, NOT a boolean `changed`.
* **Architectural Resolution:**
  - Keep `platform/linux.js` as a pure extraction adapter that returns raw `{ appId: string, wmClass?: string } | null`.
  - Use `lib/navigation.js` for all normalization, regex stripping, and rule matching.
  - Align all names with the codebase: `#btnPinWorkspace`, `PIN`, `UNPIN`, `TOGGLE_PIN`, and document that `dispatchNav()` returns the next state object.

#### ISSUE-06: Operator Privilege Lockout on Companion Decks
* **Severity:** 🟡 Major
* **Reviewer Lenses:** Hostile Design Critic (#4.2), Naive Reader (#5)
* **Affected Scope:** Section 4.4, Section 5.3, `lib/ws.js` (lines 396–401), `public/app.js` (lines 969–971)
* **Discrepancy Description:**
  - Remote mobile decks connect with `role: 'operator'` by default.
  - `lib/ws.js` rejects `SET_WORKSPACE` with `Unauthorized: editor privilege required` if `!ws.canEdit`.
  - When auto-switching transitions a deck to a workspace, an operator has no permission to manually switch away by clicking tabs (`M1`, `M2`), locking them into whatever workspace the host auto-selected.
* **Architectural Resolution:**
  - Clarify authorization: Changing the active view (`SET_WORKSPACE` / `USER_SELECT`) is an operational control, NOT a configuration edit.
  - Update `lib/ws.js` to allow operators to switch workspaces, reserving editor authorization strictly for workspace layout modifications (adding/editing tiles).

#### ISSUE-07: Substring Collisions & Rule Semantics in `findWorkspaceForApp`
* **Severity:** 🟡 Major
* **Reviewer Lenses:** Hostile Design Critic (#5.2), Naive Reader (#3)
* **Affected Scope:** Section 2 (line 29), Section 4.3, `lib/navigation.js` (lines 101–105)
* **Discrepancy Description:**
  - In `lib/navigation.js`, `normalized.includes(normalizedRule)` allows loose substring matches. Short rules like `"sh"` match `photoshop`, `bash`, `ssh`, and `dashboard`.
  - The spec omits conflict resolution rules (which workspace wins when multiple match?) and fallback behavior (does unmatched preserve mode `'auto'` or switch to `'manual'`?).
* **Architectural Resolution:**
  - Restrict matching to exact string equality and reverse-DNS dot/hyphen token equality (`segments.includes(normalized)`). Disallow raw substring `.includes()` on rules under 4 characters.
  - Precedence: First workspace matching in `appConfig.workspaces` array order wins.
  - Unmatched behavior: Preserve current workspace; `mode` remains `'auto'` awaiting the next recognizable application.

#### ISSUE-08: Command & Argument Injection Risk in `xprop` Query Chain
* **Severity:** 🟡 Major
* **Reviewer Lenses:** Hostile Design Critic (#5.1)
* **Affected Scope:** Section 4.1 (lines 120–124)
* **Discrepancy Description:**
  - In the X11 query chain, `<winId>` from `xprop -root _NET_ACTIVE_WINDOW` is passed into `xprop -id <winId> WM_CLASS`.
  - If `<winId>` contains unexpected formatting or flags (e.g. `-root`), argument injection could occur.
* **Architectural Resolution:**
  - Validate `<winId>` strictly against `/^0x[0-9a-fA-F]+$/` before executing `execFile`. Reject non-matching outputs immediately.

#### ISSUE-09: Watcher Lifecycle Thrashing & Missing Grace Period (Hysteresis)
* **Severity:** 🟡 Major
* **Reviewer Lenses:** Skeptical Architect (#5), Hostile Design Critic (#1.2)
* **Affected Scope:** Section 4.2 (lines 131–143)
* **Discrepancy Description:**
  - Stopping the watcher immediately when `connectedClients.size === 0` causes thrashing during mobile browser tab switches, Wi-Fi blips, or page refreshes (50–150ms disconnect/reconnect).
  - Pending `execFile` queries have no `AbortController`, causing defunct asynchronous callbacks after watcher teardown.
* **Architectural Resolution:**
  - Implement a **3-second teardown hysteresis timer** when clients drop to 0. If a client connects before the timer fires, cancel the teardown.
  - Attach an `AbortController` to all platform child process executions and invoke `.abort()` on `watcher.stop()`.

#### ISSUE-10: Subprocess Buffer Hygiene & Privacy Threat Model Clarification
* **Severity:** 🟡 Major
* **Reviewer Lenses:** Naive Reader (#4), Hostile Design Critic (#2.3)
* **Affected Scope:** Section 2 (Pillar 2), Section 5.1
* **Discrepancy Description:**
  - `org.gnome.Shell.Introspect.GetWindows` emits window titles for all desktop windows into the Node.js stdout buffer in memory.
  - The spec asserts zero capture, but does not address memory buffer life cycle or the danger of error formatters dumping raw stdout buffers into server logs.
* **Architectural Resolution:**
  - Document the privacy boundary: raw JSON from `busctl` enters ephemeral process memory, is parsed for `app-id`, and immediately garbage collected.
  - Add explicit code guidelines ensuring error formatters and debug logs only log `{ error: err.message, exitCode }`, never raw stdout buffers.

---

### Theme 6: Documentation Completeness & Standards (🟢 Minor & Nits)

#### ISSUE-11: D-Bus Daemon Outages & Console Log Flooding
* **Severity:** 🟢 Minor
* **Reviewer Lenses:** Hostile Design Critic (#3.2)
* **Resolution:** Implement a circuit breaker: upon 3 consecutive D-Bus query failures, drop query interval to 5000ms and suppress duplicate warning logs.

#### ISSUE-12: Undefined Linux Desktop, Compositor & IPC Terminology
* **Severity:** 🟢 Minor
* **Reviewer Lenses:** Naive Reader (#2)
* **Resolution:** Add a reference glossary in Section 3 defining D-Bus, `busctl`, Wayland compositor isolation, `org.gnome.Shell.Introspect`, and X11 EWMH properties (`_NET_ACTIVE_WINDOW`, `WM_CLASS`).

#### ISSUE-13: Unspecified Shape of Navigation State (`NavigationState` Schema)
* **Severity:** 🟢 Nit
* **Reviewer Lenses:** Naive Reader (#6)
* **Resolution:** Provide a formal TypeScript interface in Section 4 defining `NavigationState`:
  ```typescript
  interface NavigationState {
    workspaceId: string;
    pageIndex: number;
    mode: 'auto' | 'manual';
    pinned: boolean;
    lastAppId: string | null;
  }
  ```

#### ISSUE-14: Legacy Callback Signature vs. Async/Promise Pattern
* **Severity:** 🟢 Nit
* **Reviewer Lenses:** Skeptical Architect (#6)
* **Resolution:** Change `getActiveWindow(callback)` in Section 4.1 to `async getActiveWindow(): Promise<{ appId: string, wmClass?: string } | null>`.

---

# Concrete Architectural Resolutions for Specification Refactor

When updating `docs/designs/active-window-auto-switching.md`, the author should incorporate the following 5 definitive architectural blueprints:

### 1. Dual-Path Platform Engine (`platform/linux.js`)

```
   ┌─────────────────────────────────────────────────────────────┐
   │                     platform/linux.js                       │
   └───────────────┬─────────────────────────────┬───────────────┘
                   │                             │
    (Wayland / GNOME Shell)             (X11 / XWayland)
                   │                             │
   busctl --user --json=short call       xprop -spy -root _NET_ACTIVE_WINDOW
   Introspect GetWindows                 (Persistent Long-Running Process)
                   │                             │
       Serialized setTimeout                     ▼
       Single-flight guard               Line emitted: 0x03800004
       Interval: 750ms                   Regex guard: /^0x[0-9a-fA-F]+$/
       AbortController: 250ms                    │
                   │                     xprop -id 0x03800004 WM_CLASS
                   ▼                             ▼
       JSON.parse() (safe try/catch)     Extract string class
                   │                             │
                   └──────────────┬──────────────┘
                                  │
                                  ▼
                   Return raw { appId, wmClass }
```

### 2. Debounce & Edge-Detection State Machine

* **X11 Streaming**: Line output triggers a 150ms trailing timer. Intermediate focus blips during Alt-Tabbing reset the timer.
* **Wayland Polled**: Polling interval set to 750ms. A focus change is only committed to the reducer if observed across **2 consecutive polling ticks** (or when window ID differs and persists), preventing Alt-Tab aliasing.

### 3. Isolation of State vs. Persistence

```javascript
// IN server.js:
case 'CONTEXT_CHANGED': {
  const nextNav = navigationReducer(navState, event, context);
  if (nextNav !== navState) {
    navState = nextNav;
    // CRITICAL: DO NOT mutate appConfig.activeWorkspaceId!
    // Auto-switch focus pointer is strictly transient in-memory state.
    broadcastState(wss, context);
  }
  break;
}
```

### 4. Lifecycle Manager with 3-Second Hysteresis (`ActiveWindowWatcher`)

```javascript
class ActiveWindowWatcher {
  // Starts when clientCount > 0
  // On clientCount === 0:
  // Starts 3000ms teardown timer.
  // If client reconnects: clearTimeout(timer).
  // If timer fires: watcher.stop(), abort pending execFile processes.
}
```

### 5. Alignment with Established Codebase Contracts

* UI Element: `#btnPinWorkspace` (`public/index.html`)
* WebSocket Actions: `PIN`, `UNPIN`, `TOGGLE_PIN` (`lib/ws.js`)
* Navigation Reducer: Reuse `normalizeAppId()` from `lib/navigation.js`
* Operator Permissions: Allow `role: 'operator'` clients to send `SET_WORKSPACE` to clear auto-switch locks without requiring editor privilege.
