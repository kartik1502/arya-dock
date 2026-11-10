# Arya Dock: Issue Backlog

Each issue has: **Labels**, **Location**, **Problem**, **Impact**, **Hints** (direction, not a full solution), and **Acceptance criteria** (how you know it's done).

## Suggested order

1. #1 → #2 → #3 (the trust boundary; do these together or in this order)
2. #4, #5, #6 (hardening on top of that)
3. #7, #8, #9, #10 (robustness)
4. #11, #12, #13 (correctness / honesty)
5. #14, #15, #16 (docs, structure, tests)

---

## #1 Unauthenticated WebSocket allows remote command execution

**Labels:** `security` `critical` `server`  
**Location:** `server.js` → `server.listen(PORT, '0.0.0.0')`, `wss.on('connection')`, message handlers `UPDATE_BUTTON`, `BUTTON_CLICK`

**Problem**  
The server binds to all interfaces and accepts any WebSocket client with no identity check. A client can send `UPDATE_BUTTON` to set `command` to anything, then `BUTTON_CLICK` to execute it through `exec` in your login shell.

**Impact**  
Anyone on the same Wi-Fi / LAN (or tethered network) can run arbitrary commands as your user. This is remote code execution.

**Hints**  
- Think about what a legitimate phone has that a stranger on the LAN does not. The QR code you already print at startup is a natural place to carry a secret.
- Decide where the secret lives (generated per start vs. persisted) and how the browser keeps it (URL → storage → sent on WS connect). Consider what each choice means for the PWA "Add to Home Screen" flow.
- Authenticate during the HTTP upgrade, not after the socket is already open and processing messages.
- Use a constant-time comparison for the secret.
- Consider an opt-in flag or env var for binding to a specific interface instead of always `0.0.0.0`.

**Acceptance criteria**  
- A WebSocket connection without a valid secret is rejected before any message is processed.
- Static files and `/api/*` either require the same secret or are clearly documented as public (see #4).
- The startup banner/QR includes the secret; the README documents how pairing works.
- Manual test: connecting with a plain `wscat`/script and no secret fails.

---

## #2 No `Origin` check on WebSocket and `Access-Control-Allow-Origin: *` (cross-site hijacking)

**Labels:** `security` `critical` `server`  
**Location:** `server.js` → `new WebSocket.Server({ server })`, all `res.writeHead(..., 'Access-Control-Allow-Origin': '*')`

**Problem**  
Browsers do not apply the same-origin policy to WebSocket connections. Any website open in your browser can attempt `ws://localhost:3333`. The server never inspects `Origin`, and the HTTP responses allow every origin via CORS.

**Impact**  
A malicious page you visit on the same machine (or a page opened on your phone while paired) can connect to the deck and trigger the same actions as in #1, even if the server is only "local".

**Hints**  
- Look at the `verifyClient` option on the `ws` server (or handling the `upgrade` event yourself).
- Decide what the allowed origins are. The page is served by this same server, so the allowed set is derived from the host(s) you serve on. Think about USB IP, Wi-Fi IP, and `localhost`.
- Ask whether the API endpoints need CORS at all. The frontend is same-origin.

**Acceptance criteria**  
- A WS upgrade with a foreign `Origin` header is rejected (test with `curl`/script setting `Origin: https://evil.example`).
- `Access-Control-Allow-Origin: *` is removed, or justified in a comment if kept for a specific endpoint.
- Legit flows still work: `localhost`, USB tether IP, Wi-Fi IP, and the installed PWA.

---

## #3 Separate "press a key" privilege from "edit what a key does"

**Labels:** `security` `high` `design`  
**Location:** `server.js` message handlers: `UPDATE_BUTTON`, `ADD_BUTTON`, `DELETE_BUTTON`, `SET_BUTTONS_COUNT`, `SET_PROFILE`

**Problem**  
Every connected client can both trigger actions and redefine them. Triggering a pre-configured key is low risk; redefining a command is equivalent to shell access.

**Impact**  
Even after #1/#2, a compromised or shared phone session can persistently change commands that run later.

**Hints**  
- Consider two levels: a "viewer/operator" role (click keys, change page) and an "editor" role (mutate config). What would a second credential or an explicit "unlock edit mode" step look like?
- Think about whether edit mode should be allowed from the phone at all, or only from `localhost`.
- Log mutation events (who/when/what changed) so surprises are visible.

**Acceptance criteria**  
- Config-mutating messages are rejected for sessions without edit privilege, with an error message sent back to the client.
- UI hides or disables edit controls when the session cannot edit.
- Decision is documented in the README (who can edit and how).

---

## #4 Unauthenticated `/api/apps` and `/api/directories` leak system info

**Labels:** `security` `high` `server`  
**Location:** `server.js` → HTTP handler routes `/api/apps`, `/api/directories`, `getSuggestedProjectDirs()`

**Problem**  
These endpoints return your installed applications (including `Exec` commands) and your home/Documents directory layout, with CORS `*`, to anyone who can reach the port.

**Impact**  
Information disclosure that makes targeting easier, and exposes personal paths.

**Hints**  
- Apply the same auth as #1. Decide whether the API should require it separately from the WS.
- `getSuggestedProjectDirs()` lists every folder in `~/Documents`. Do you want that surfaced to every client, or only to editors (#3)?
- `cachedInstalledApps` is never invalidated. Consider whether that matters.

**Acceptance criteria**  
- Requests to `/api/*` without credentials return 401/403.
- Directory suggestions are only available to sessions with edit privilege.
- No personal hard-coded paths remain in `getSuggestedProjectDirs()` (move to config, see #9).

---

## #5 Shell command construction is fragile (quoting / injection) in `buildTerminalCommand` and the `url` action

**Labels:** `security` `high` `server`  
**Location:** `server.js` → `buildTerminalCommand`, `executeAction` (`case 'url'`, `case 'shell'`)

**Problem**  
Commands are assembled as one string and wrapped in double quotes, with only `"` escaped. Inside double quotes the shell still expands `$(...)`, backticks, `$VAR`, and `\`. The `url` action opened URLs with no scheme validation. `workingDir` is also interpolated into `cd "..."`.

**Impact**  
Because commands are arbitrary by design, the main risk is the trust boundary (#1–#3). But broken quoting also causes real bugs (labels/paths with `"`, `$`, or backslashes), and the `url` action can launch non-http handlers (`file:`, custom schemes).

**Hints**  
- Look at `child_process.spawn` / `execFile` with an argument array instead of `exec` with a single string. The `cwd` option replaces the `cd "..." &&` prefix.
- For terminals that take `-- cmd args`, think about passing the shell and its `-c` script as separate arguments rather than one interpolated string.
- For `url`, parse with `new URL()` and allow-list protocols (`http:`, `https:`).
- Build a small test list of nasty inputs (quotes, `$()`, spaces, unicode, very long) and run each through your builder.

**Acceptance criteria**  
- No user-controlled value is interpolated into a shell string without being passed as a separate argument or properly quoted.
- `url` buttons reject non-http(s) schemes.
- A button/directory with spaces, quotes, and `$` in its name works.
- Existing `tab` / `window` / `existing` / `background` modes still behave the same on your terminal.

---

## #6 `innerHTML` with config/app-derived strings (XSS)

**Labels:** `security` `medium` `frontend`  
**Location:** `public/app.js` → `appsList.innerHTML`, `card.innerHTML`, `btn.innerHTML`, `keyEl.innerHTML`, `addKeyEl.innerHTML`

**Problem**  
Labels, sublabels, app names and comments are inserted via template strings into `innerHTML`. Values come from `.desktop` files (`Name=`/`Comment=`) and from button config that any editing client can set.

**Impact**  
Stored XSS on the deck page. Combined with the no-auth issue, a crafted label can run script in the page, which can then send WS commands.

**Hints**  
- Audit every `innerHTML` assignment and classify: static markup only, or contains data.
- For data, build nodes with `createElement` + `textContent`, or set attributes via `setAttribute` and `dataset`.
- Consider adding a `Content-Security-Policy` header from the server as defense in depth. Check what the inline styles/scripts in `index.html` would need.

**Acceptance criteria**  
- No user/system-derived string reaches `innerHTML`.
- Test: a button labelled `<img src=x onerror=alert(1)>` renders as literal text.
- CSP header is present (or a written reason it isn't).

---

## #7 `execSync('which ...')` blocks the event loop and runs repeatedly

**Labels:** `performance` `medium` `server`  
**Location:** `server.js` → `getDefaultTerminal()`, called from `buildTerminalCommand` and startup

**Problem**  
On every terminal-mode button press the server synchronously spawns up to ~10 `which` processes. `getDefaultShell()` also hits the filesystem each time.

**Impact**  
Noticeable delay on button presses, and it blocks WebSocket handling for all clients while it runs.

**Hints**  
- These values rarely change during a run. Where's the cheapest place to compute them once?
- Consider a config override (e.g. `terminal` in config or env var) so the user can force a terminal.
- If you want detection without spawning processes, think about scanning `PATH` yourself.

**Acceptance criteria**  
- Terminal and shell detection happen once (lazily or at startup) and are reused.
- No `execSync` on the button-press path.
- Optional: user can override terminal/shell via env or config.

---

## #8 `UPDATE_BUTTON` / `ADD_BUTTON` accept unvalidated payloads

**Labels:** `robustness` `medium` `server`  
**Location:** `server.js` → `UPDATE_BUTTON` (`{ ...page.buttons[idx], ...data.button }`), `ADD_BUTTON`

**Problem**  
The incoming object is spread straight into the stored button. Unknown fields, wrong types, huge strings, or `id` changes all get persisted. `data.button` can also be `undefined`, which throws inside the handler (caught only by the generic try/catch).

**Impact**  
Corrupted `profiles.json`, id collisions, and hard-to-debug UI states.

**Hints**  
- Define the button schema once: allowed fields, types, max lengths, allowed `actionType` and `terminalMode` values, allowed color format.
- Whitelist fields when merging instead of spreading everything. Never let the client change `id`.
- Send an error message back to the client on rejection.

**Acceptance criteria**  
- Invalid payloads are rejected with a clear error and nothing is saved.
- Unknown fields are dropped.
- `id` cannot be modified through `UPDATE_BUTTON`.

---

## #9 Config persistence: non-atomic writes and personal config committed to the repo

**Labels:** `robustness` `medium` `config`  
**Location:** `server.js` → `saveConfig()`, `config/profiles.json`

**Problem**  
- `writeFileSync` directly onto the live file means a crash mid-write can leave truncated JSON, and on load failure the server silently continues with `{}` (which later crashes in `getActiveProfile`).
- `profiles.json` is tracked in git and contains personal absolute paths (e.g. `/home/<you>/.local/share/JetBrains/...`) and your project layout. Every UI edit dirties the repo.

**Impact**  
Possible config loss, startup crashes, and publishing personal paths in a public repo.

**Hints**  
- Write to a temp file in the same directory, then rename.
- Track a `profiles.example.json` and gitignore the real config; on first run, copy the example if the real file is missing.
- Make startup fail loudly (or restore from backup) if the config can't be parsed, rather than limping on with `{}`.
- Consider a `~/.config/arya-dock/` location instead of the repo dir.
- Consider debouncing saves if many edits arrive in a burst.

**Acceptance criteria**  
- Killing the process during a save never leaves invalid JSON.
- Fresh clone + `npm start` works with no manual file creation.
- `git status` stays clean after using the UI.
- Personal paths removed from tracked files.

---

## #10 `SET_BUTTONS_COUNT` silently deletes configured keys

**Labels:** `ux` `data-loss` `medium` `frontend` `server`  
**Location:** `server.js` → `SET_BUTTONS_COUNT`; `+` / `−` buttons in `public/app.js`

**Problem**  
Decreasing the count slices the array from the end and saves immediately. A mis-tap on `−` destroys a configured button with no undo.

**Impact**  
Silent data loss, especially likely on a touch screen.

**Hints**  
- Which is cheaper: confirming only when the removed key is non-empty, or keeping an undo buffer for the last change?
- Think about whether "empty" placeholder keys (label `KEY n`, no command) can be removed freely.
- A visible "undo" toast on touch UIs is often better than a modal.

**Acceptance criteria**  
- Removing a configured key requires confirmation or can be undone.
- Removing an empty placeholder key does not nag.
- Behavior documented in the README.

---

## #11 Service worker doesn't deliver the advertised offline PWA

**Labels:** `bug` `docs-mismatch` `medium` `frontend`  
**Location:** `public/sw.js`, README "PWA & Offline" row

**Problem**  
`ASSETS` is defined but never used. The `install` handler only calls `skipWaiting()`, and the fetch handler is network-first with a `caches.match` fallback against a cache that is never populated. `CACHE_NAME` is also only used for cleanup.

**Impact**  
The app shell does not load offline, contradicting the README.

**Hints**  
- Decide the real goal: is offline useful for a deck that needs a live WebSocket anyway? Possibly only the shell/"disconnected" screen matters.
- If yes, populate the cache on `install` and think about update strategy (when does the user get new files?).
- If no, simplify or remove the claim and keep only what the manifest/installability needs.
- Remember `Cache-Control: no-store` headers from the server interact with cache strategy.

**Acceptance criteria**  
- Either: with the server stopped, the installed PWA opens to a sensible "disconnected / reconnecting" screen. Or: README no longer claims offline support.
- `ASSETS`/`CACHE_NAME` are either used or removed.

---

## #12 Static file path check uses a prefix match without a separator

**Labels:** `security` `low` `server`  
**Location:** `server.js` → `filePath.startsWith(PUBLIC_DIR)`

**Problem**  
`startsWith('/x/public')` also matches a sibling like `/x/public-secrets/...`. Currently there is no such sibling, but the check is not robust. `req.url` is also not decoded or validated.

**Impact**  
Low today, but a latent traversal bug if directories are added later.

**Hints**  
- Compare against the directory with a trailing separator, or use `path.relative` and check it doesn't start with `..`.
- Decide how to handle malformed URL encoding (should return 400, not throw).
- Consider whether directory requests and dotfiles should be blocked.

**Acceptance criteria**  
- Requests like `/../server.js`, `/%2e%2e/server.js`, and `/..%2fconfig/profiles.json` all return 403/404.
- Malformed URLs return 400 without crashing the server.

---

## #13 Placeholder / misleading default buttons

**Labels:** `bug` `docs` `low` `config`  
**Location:** `config/profiles.json`

**Problem**  
Several defaults don't do what their labels say:
- "AI AGENT / RUN AGENT" runs `lzd --version`.
- "Reload API / Restart Svc" only calls `notify-send`.
- "Clean Cache / rm -rf tmp" only calls `notify-send`.
- "TEST SUITE" runs `npm test || pytest || cargo test` with no `workingDir`, so it runs in the server's cwd.
- Duplicate "Localhost" labels, and buttons with both `command` and `url` set for `url` actions.

**Impact**  
Confusing for new users, and risky if someone "fixes" the labels by making them really run `rm -rf`.

**Hints**  
- Decide the purpose of the shipped config: a minimal safe demo, or your personal setup. Keep the personal one out of the repo (#9).
- Make every shipped button either real and harmless or clearly marked as an example.

**Acceptance criteria**  
- Every shipped default button's label matches its behavior.
- No destructive commands in defaults.
- Buttons that need a project directory set `workingDir` or are removed.

---

## #14 README / docs consistency and scope

**Labels:** `docs` `low`  
**Location:** `README.md`, `DESIGN.md`, `docs/architecture/protocol-specs.md`, last commit message

**Problem**  
- README claims "sub-millisecond latency" and "zero battery drain"-style properties that aren't measurable/defensible over WebSocket + tethering.
- The last commit says Motorsport references were sanitized, but the README and design system still lean heavily on them.
- `docs/architecture/protocol-specs.md` documents a specific hardware device (VID/PID, HID++ packets) that this software-only project doesn't implement, with no explanation of why it's here.
- The project is Linux-specific (`.desktop` parsing, platform URL openers, audio/media controllers, specific terminals) but this isn't stated up front.

**Hints**  
- Replace performance claims with what you can measure (e.g. measure round-trip time of a `PING`/`PONG`).
- Pick a naming/theming direction and make README, DESIGN, and commit history agree.
- Either add an intro to the protocol doc ("reference for a future hardware backend") or move it to a separate repo/branch.
- Add a "Requirements / Supported platforms" section including dependencies (audio and media controllers, etc.).

**Acceptance criteria**  
- No unverifiable latency claims.
- A requirements section lists OS, runtime, and optional tools.
- Protocol doc has a short scope statement or is moved.
- Security model (#1–#3) is documented.

---

## #15 Modularize `server.js`

**Labels:** `refactor` `low` `server`  
**Location:** `server.js` (~700 lines)

**Problem**  
HTTP routing, static serving, app discovery, shell/terminal detection, command building, action dispatch, WS handling, and startup banner all live in one file with global mutable state (`appConfig`, `currentPageIndex`).

**Impact**  
Hard to test, and every change risks unrelated behavior.

**Hints**  
- Natural seams: `config` (load/save/validate), `apps` (desktop discovery), `terminal` (detect + build command), `actions` (dispatch), `http` (static + api), `ws` (protocol handlers).
- `buildTerminalCommand` should be a pure function of its inputs, which makes it easy to test (see #16).
- Think about where `currentPageIndex` should live. It's global across all clients right now (see #16 note).

**Acceptance criteria**  
- `server.js` is a thin entry point.
- Terminal command building and config validation can be imported and tested without starting the server.
- No behavior change (verify manually against each terminal mode).

---

## #16 Add tests and decide multi-client semantics

**Labels:** `testing` `design` `low`  
**Location:** whole repo; `server.js` → `currentPageIndex`, `broadcastState`

**Problem**  
No tests exist. Also, current page is a single global, so two connected devices share a page; one phone changing pages changes it for all. That may be intended, but it isn't stated.

**Hints**  
- Start with pure functions: `resolveWorkingDir`, button validation (#8), command builder (#5), static path guard (#12). Node's built-in `node:test` needs no new dependency.
- Add one integration test: start the server on a random port, connect a WS client, verify auth rejection (#1/#2) and a `BUTTON_CLICK` against a harmless command.
- Decide: shared page (like a physical deck) or per-client page. Document the choice.

**Acceptance criteria**  
- `npm test` runs and passes.
- Tests cover at least: path resolution, command quoting cases, auth rejection, origin rejection, button validation.
- Multi-client page behavior is documented (and covered by a test if you change it).

---

## Out of scope / ideas for later

- Hot-reloading `profiles.json` when edited by hand.
- Full Wayland/X11 active-window auto-profile switching in production (spike completed in `docs/research/active-window-spike.md`; platform adapters gracefully degrade with `activeWindow: false` until production tracking is enabled).
- Windows platform adapter support.
