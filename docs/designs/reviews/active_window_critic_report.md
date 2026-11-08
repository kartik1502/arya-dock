# Architectural Critique & Threat Model: Active Window Auto-Switching Engine

* **Document Under Audit:** `docs/designs/active-window-auto-switching.md`
* **Audit Persona:** Hostile Design Critic (Senior Software Engineer / Systems Architect)
* **Date:** 2026-11-08
* **Recommendation:** REJECT & REDESIGN CORE SUBSYSTEMS

---

## 1. System Architecture & Concurrency

### 1.1 The Global Singleton State Trap in Multi-Deck Environments
* **Severity:** Blocker
* **Affected Scope:** `server.js` (lines 86–91, 120–128), `lib/ws.js` (lines 28–70, 314–352)
* **Critique:**
  The design assumes a 1:1 relationship between the host workstation and a single companion deck. However, Arya Dock explicitly advertises multi-device support (e.g. tablet on a desk stand for media controls + phone mounted beside keyboard for code macros).
  - `server.js` maintains a single global `navState` singleton.
  - When `ActiveWindowWatcher` detects focus on `code`, `server.js` dispatches `CONTEXT_CHANGED` and broadcasts `STATE_UPDATE` to **all connected WebSocket clients**.
  - If a user has a tablet displaying the `media` workspace and a phone displaying `developer`, switching focus on the PC forcibly yanks the tablet screen away from Media to Developer!
  - If the user taps "PIN" on the tablet to prevent this, `navState.pinned` becomes `true` globally. This freezes the phone deck as well, completely paralyzing auto-switching across all connected companion devices.
* **Remediation:**
  Decouple deck navigation into per-connection session state (`ws.navState` or `clientId`), or explicitly define a client registration model (`role: 'follow-focus'` vs `'fixed-workspace'`). If a global mode is retained, pinning must support per-client overrides.

### 1.2 WebSocket Reconnection Thrashing & Lifecycle Race Conditions
* **Severity:** Major
* **Affected Scope:** `docs/designs/active-window-auto-switching.md` (Section 4.2), `server.js`
* **Critique:**
  The design specifies starting the watcher on `connectedClients.size === 1` and calling `activeWindowWatcher.stop()` on `connectedClients.size === 0`.
  - Mobile browsers aggressively suspend JavaScript execution and tear down WebSockets when the phone screen dims or when the user switches tabs (visible in `public/app.js` lines 673–685).
  - During rapid reconnects (e.g. intermittent Wi-Fi, screen sleep/wake), the client reconnects before the previous TCP socket's `close` event has completed, or disconnects/reconnects in a tight loop.
  - When `activeWindowWatcher.stop()` is called while a 250ms `execFile` asynchronous call is in flight, the design provides no cancellation token (`AbortController`). The in-flight child process continues executing in the OS kernel; upon completion, its callback resolves against a destroyed watcher instance or resurrects defunct state.
* **Remediation:**
  1. Add a grace period / hysteresis timer (e.g., 5000ms delay) before shutting down the watcher on zero clients to prevent rapid start/stop thrashing.
  2. Implement `AbortController` support on child process execution to cancel and kill pending process queries immediately upon `stop()`.

### 1.3 Rapid Alt-Tabbing Sampling Aliasing & State Churn
* **Severity:** Major
* **Affected Scope:** `docs/designs/active-window-auto-switching.md` (Section 2, 4), `lib/navigation.js`
* **Critique:**
  The design specifies a 250ms polling interval paired with a 150ms debounce window. This is a fundamental mathematical mismatch:
  - If a user holds `Alt-Tab` to cycle through 8 open windows at 80ms per window, polling at 250ms samples the window list at arbitrary phase intervals.
  - Intermediate windows that happened to coincide with a 250ms polling tick will trigger the 150ms debounce timer. If the user stops on a final window, the previously scheduled 150ms debounce timer may fire before the next 250ms poll discovers the true resting window, creating visual rubber-banding (deck jumps to intermediate window, then snaps to final window).
* **Remediation:**
  The polling watcher must perform polling-level edge detection: record raw focus shifts and only dispatch `CONTEXT_CHANGED` when the window ID has been observed stable across consecutive polling ticks.

---

## 2. OS Execution Costs: The 250ms ExecFile Catastrophe

### 2.1 Process Table Thrashing and PID Exhaustion
* **Severity:** Blocker
* **Affected Scope:** `platform/linux.js` (Section 4.1), `server.js`
* **Critique:**
  Spawning an external binary (`gdbus` / `busctl` or `xprop`) every 250ms equates to:
  - **4 process spawns per second**
  - **240 process spawns per minute**
  - **14,400 process spawns per hour**
  - Under X11 fallback (requiring `xprop -root` followed by `xprop -id`), this doubles to **28,800 spawns per hour**!
  - In Node.js, `child_process.execFile` incurs `uv_spawn` overhead: `clone(2)`/`fork(2)` + `execve(2)`. This destroys CPU instruction caches, wastes laptop battery through constant CPU wakeups, and rapidly exhausts the Linux PID ceiling (`/proc/sys/kernel/pid_max`, default 32,768). On a developer machine, PIDs will wrap around every 1 to 2 hours, disrupting external audit loggers and monitoring tools.
* **Remediation:**
  Replace periodic `execFile` polling with either:
  1. A persistent long-running helper child process (e.g., a tiny Python or C daemon, or `gdbus monitor` / native D-Bus session socket connection using `@particle/dbus` or standard D-Bus unix domain socket) that emits focus changes over `stdout` line-by-line via push events.
  2. If periodic polling is non-negotiable, increase the polling interval to ≥1000ms and use a strict single-flight concurrency lock (`isQueryRunning`) to prevent overlapping executions.

### 2.2 Unbounded Fork Stampede & Event Loop Starvation
* **Severity:** Blocker
* **Affected Scope:** `platform/linux.js`, `server.js`
* **Critique:**
  What happens when the developer starts a heavy compilation (`cargo build -j16`, `npm run build`), or when GNOME Shell freezes momentarily during a GPU driver hiccup?
  - A `gdbus` call will stall for 1–5 seconds.
  - If `setInterval(..., 250)` is used without a concurrency gate, a new `execFile` will be launched every 250ms while previous calls remain hung in kernel queues.
  - After 5 seconds, 20 child processes are stuck waiting on D-Bus. Node.js file descriptors for pipes (`stdin`, `stdout`, `stderr`) are consumed.
  - This leads to `EMFILE` (too many open files), `EAGAIN` (`fork: Resource temporarily unavailable`), and unhandled process crashes.
* **Remediation:**
  - Enforce a strict single-flight guard: if a previous query has not returned, skip the tick.
  - Always pass `{ timeout: 200, killSignal: 'SIGKILL' }` to `execFile` to guarantee that stalled queries are eliminated before the next tick.

### 2.3 Payload Explosion & V8 Garbage Collection Churn
* **Severity:** Major
* **Affected Scope:** `platform/linux.js`
* **Critique:**
  `org.gnome.Shell.Introspect.GetWindows` does NOT return only the active window. It dumps a serialized dictionary of **every window open across all monitors and virtual workspaces**, including hidden windows, background utilities, and panel docklets.
  - On a typical developer workstation with 30–50 open windows, `GetWindows` returns a 50KB to 250KB string.
  - At 4 calls per second, Node.js must buffer, allocate, and parse **200KB to 1MB of text per second** (~3.6 GB of throwaway strings per hour).
  - This generates intense Young Generation GC scavenges, causing event-loop latency spikes that degrade WebSocket message responsiveness for button clicks.
* **Remediation:**
  Do not parse full desktop window dumps 4 times a second. Query window focus via direct X11 root properties or targeted Wayland introspection.

---

## 3. Error Recovery: D-Bus Stalls & Format Parsing

### 3.1 GVariant Format Incompatibility & Parsing Vulnerability
* **Severity:** Blocker
* **Affected Scope:** `platform/linux.js`
* **Critique:**
  The design document claims `gdbus call` outputs a dictionary that can be inspected for `has-focus == true` and `app-id`.
  - **`gdbus` outputs GLib GVariant syntax, NOT JSON!**
    Example output: `(@a{ta{sv}} {18446744073709551615: {'title': <'Terminal'>, 'app-id': <'org.gnome.Ptyxis.desktop'>, 'has-focus': <true>}},)`
  - Standard `JSON.parse()` will throw a `SyntaxError`.
  - If ad-hoc regex is used to parse this output, it can be easily fooled or broken. For example, if a user browses a web page whose title contains `has-focus': <true>, 'app-id': <'spotify'>`, a naive regex will match the title string instead of the actual window metadata.
  - The design document states `busctl --user --json=short` is a "fallback", but `busctl` with `--json=short` is the ONLY tool of the two that produces valid JSON.
* **Remediation:**
  Make `busctl --user --json=short call org.gnome.Shell.Introspect /org/gnome/Shell/Introspect org.gnome.Shell.Introspect GetWindows` the PRIMARY call, not the fallback, and parse it with `JSON.parse()` inside a `try/catch` block.

### 3.2 D-Bus Daemon Restarts & Log Flooding
* **Severity:** Major
* **Affected Scope:** `platform/linux.js`
* **Critique:**
  If the GNOME Shell crashes, restarts (`gnome-shell --replace`), or the user locks the desktop session, `gdbus`/`busctl` will fail with errors like:
  `Error org.freedesktop.DBus.Error.ServiceUnknown` or `NameHasNoOwner`.
  - If these errors are logged to `console.warn` inside the 250ms polling loop, the console and log files will be spammed with **240 error messages per minute**.
* **Remediation:**
  Implement a circuit breaker with exponential backoff: upon 3 consecutive D-Bus query failures, drop the polling frequency to once every 5 seconds until connectivity is restored, and suppress repeated identical log messages.

---

## 4. Pinning & State Integrity

### 4.1 Accidental Disk Persistence of Transient Focus
* **Severity:** Blocker
* **Affected Scope:** `server.js` (lines 120–128, 137–164)
* **Critique:**
  Section 3.2 (Non-Goals) states:
  > *"4. Destructive Profile Alterations: Auto-switching alters only the transient navigation pointer (`navState.workspaceId`); workspace configurations and tile layouts remain untouched."*
  
  However, in `server.js`:
  ```javascript
  const nextState = navigationReducer(navState, event, context);
  if (nextState !== navState) {
    navState = nextState;
    if (appConfig.activeWorkspaceId !== navState.workspaceId) {
      appConfig.activeWorkspaceId = navState.workspaceId;
      appConfig.activeProfile = navState.workspaceId;
    }
  }
  ```
  And `server.js` registers shutdown handlers:
  ```javascript
  const onSigint = () => { flushConfigSync(); process.exit(0); };
  ```
  Whenever the server stops or an editor mutates any tile, `flushConfigSync()` persists `appConfig` to `config.json`.
  Because `appConfig.activeWorkspaceId` is overwritten by `CONTEXT_CHANGED`, whatever application window happened to have focus when the workstation shuts down becomes the permanently saved default workspace on reboot!
* **Remediation:**
  Never mutate `appConfig.activeWorkspaceId` from `CONTEXT_CHANGED`. Only user-initiated manual workspace selections (`SET_WORKSPACE`) should mutate `appConfig`. The navigation reducer's auto-switch pointer must remain strictly transient.

### 4.2 Operator Lockout: Tapping Workspaces on Unauthenticated Decks
* **Severity:** Major
* **Affected Scope:** `public/app.js` (lines 969–971), `lib/ws.js` (lines 396–401)
* **Critique:**
  In `public/app.js`:
  ```javascript
  btn.addEventListener('click', () => {
    if (canEdit && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SET_WORKSPACE', workspaceId: wsItem.id }));
    }
  });
  ```
  And in `lib/ws.js`:
  ```javascript
  case 'SET_WORKSPACE': {
    if (!ws.canEdit) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: editor privilege required' }));
      return;
    }
  ```
  Remote mobile companion devices connect with `role: 'operator'` by default. Operators **cannot manually click workspace tabs** (`M1`, `M2`)!
  If auto-switching is active, an operator on their phone is completely powerless to manually navigate away from an auto-switched workspace unless they unlock Editor mode with the master password.
* **Remediation:**
  Permit operators to execute navigation events (`USER_SELECT` / `SET_WORKSPACE`). Modifying the active navigation view is an operational control, not a destructive configuration mutation.

---

## 5. Security & Edge Case Vulnerabilities

### 5.1 Command & Argument Injection in `xprop` Query Chain
* **Severity:** Major
* **Affected Scope:** `docs/designs/active-window-auto-switching.md` (Section 4.1), `platform/linux.js`
* **Critique:**
  The design specifies:
  ```bash
  xprop -root 32x "\t$0" _NET_ACTIVE_WINDOW
  xprop -id <winId> WM_CLASS
  ```
  If `<winId>` is extracted from the stdout of the first command and passed directly into `execFile` without validation:
  - If `_NET_ACTIVE_WINDOW` returns unexpected text, errors, or crafted window properties (e.g. `-root` or invalid hex), it could trigger argument injection.
* **Remediation:**
  Strictly validate `<winId>` using `/^0x[0-9a-fA-F]+$/` before passing it to `execFile`. If the output does not strictly match a hexadecimal window ID, abort and return `null`.

### 5.2 Broad Substring Collisions in `findWorkspaceForApp`
* **Severity:** Major
* **Affected Scope:** `lib/navigation.js` (lines 101–105)
* **Critique:**
  In `lib/navigation.js`:
  ```javascript
  if (normalized.includes(normalizedRule)) {
    return ws.id;
  }
  ```
  If a user configures a rule like `"sh"`, `"term"`, or `"code"`:
  - `"sh"` matches `photoshop`, `bash`, `ssh`, `dashboard`.
  - `"code"` matches `barcode-scanner`, `unicode-lookup`.
  - Empty string or single-character rules match every single focused application.
* **Remediation:**
  Require exact match or tokenized reverse-DNS segment match (`appId.split('.').includes(rule)`). Never allow raw substring `.includes()` on short tokens.

---

## 6. Summary Matrix of Findings

| ID | Finding | Severity | Subsystem | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **CRIT-01** | `execFile` every 250ms spawns 14.4k–28.8k child processes/hr | **Blocker** | `platform/linux.js` | Replace polling with long-running event stream or raise interval to ≥1000ms with concurrency locks. |
| **CRIT-02** | Fork stampede & FD exhaustion when D-Bus/GNOME stalls | **Blocker** | `server.js` / `platform` | Add `isQueryRunning` lock and strict `{ timeout: 200 }` on `execFile`. |
| **CRIT-03** | `appConfig.activeWorkspaceId` polluted by focus shifts | **Blocker** | `server.js` | Isolate `navState` from disk-persisted `appConfig`. |
| **CRIT-04** | Global singleton `navState` breaks multi-deck setups | **Blocker** | `server.js` / `lib/ws.js` | Scope navigation state per client or provide client pin overrides. |
| **CRIT-05** | `gdbus` produces GVariant, not JSON; regex parsing fragile | **Blocker** | `platform/linux.js` | Use `busctl --json=short` and parse safely via `JSON.parse()`. |
| **CRIT-06** | WebSocket reconnect storms thrash watcher start/stop | **Major** | `server.js` | Add 5-second shutdown hysteresis timer on zero clients. |
| **CRIT-07** | Operators locked out from manual workspace switching | **Major** | `public/app.js` / `ws.js` | Allow operator role to dispatch `USER_SELECT`. |
| **CRIT-08** | Unvalidated `<winId>` in `xprop` query chain | **Major** | `platform/linux.js` | Enforce `/^0x[0-9a-fA-F]+$/` regex guard before running `xprop -id`. |
| **CRIT-09** | Substring collisions in `findWorkspaceForApp` | **Major** | `lib/navigation.js` | Replace `.includes()` with exact/token match. |
| **CRIT-10** | D-Bus disconnection floods console logs (240 lines/min) | **Major** | `platform/linux.js` | Add circuit breaker and log deduplication. |

---

## 7. Mandatory Remediation Checklist for PRD Approval

Before moving from Draft to Implementation, the design document must be updated with:
1. **Concurrency Lock & Subprocess Timeout Specification**: An explicit state machine guaranteeing at most ONE OS query process is in flight at any time, terminated with `SIGKILL` if exceeding 200ms.
2. **Persistent Introspection Process Architecture**: Re-architect detection from a 250ms polling loop to a persistent push-based watcher or an event listener.
3. **Session vs Persistent Config Boundary**: Explicit separation preventing `CONTEXT_CHANGED` from modifying `appConfig.activeWorkspaceId` or triggering `saveConfig()`.
4. **Multi-Deck Pinning Policy**: Clarification on whether pinning is global or per-deck, with a protocol for companion decks to opt out of auto-switching.
5. **JSON Inspection Standard**: Replacement of `gdbus` with `busctl --json=short` as the primary Linux Wayland inspector.
