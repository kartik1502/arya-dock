# 🧪 `test/` — Automated Test Suites & Quality Assurance

The `test/` directory contains automated unit, integration, security, and protocol verification test suites for Arya Dock.

---

## 📑 Test Suites Manifest

| Test File | Target Modules | Coverage Scope |
|---|---|---|
| [`auth.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/auth.test.js) | `lib/auth.js` | Constant-time `safeEqual` timing tests, Origin header verification, localhost address detection, operator vs. editor role barriers, `0600` permission enforcement, and credential rotation. |
| [`config.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/config.test.js) | `lib/config.js` | Schema migrations (v0->v1->v2), button & workspace validation, XDG path resolution, read-only fallback, atomic temporary file swaps, timestamped backup rotation, and corrupted file auto-recovery. |
| [`terminal.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/terminal.test.js) | `lib/terminal.js` | Shell escaping (`quoteForShell`), terminal emulator CLI flag generation (`ptyxis`, `gnome-terminal`, `konsole`, `alacritty`, `kitty`), background vs. interactive execution, and media/url command creation. |
| [`navigation.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/navigation.test.js) | `lib/navigation.js` | Pure `navigationReducer` state transitions: `USER_SELECT`, cyclic `PAGE_PREV`/`PAGE_NEXT`, `PIN`/`UNPIN`/`TOGGLE_PIN`, `CONTEXT_CHANGED` application matching with `normalizeAppId`, and `WORKSPACE_DELETED` fallback selection. |
| [`platform.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/platform.test.js) | `platform/*` | Platform adapter registry, degraded fallback adapter behavior on unsupported environments, and `fake` test adapter overrides and call-tracking assertions. |
| [`http.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/http.test.js) | `lib/http.js` | Static asset serving, MIME type resolution, directory traversal rejection (`..`, `%2e`), `/health` endpoint, and `/api/apps` & `/api/directories` authentication and role barrier enforcement. |
| [`integration.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/integration.test.js) | Full Stack (`server.js`, `lib/ws.js`) | End-to-end WebSocket handshake, token validation, client role elevation (`AUTH_EDIT`), button clicks (`BUTTON_CLICK` -> `BUTTON_ACK`), tile mutations, grid count adjustment, and real-time state broadcasts. |
| [`per-client-navigation.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/per-client-navigation.test.js) | Multi-Socket WebSocket Sessions (`lib/ws.js`, `server.js`) | Multi-socket concurrent navigation isolation, per-socket `BUTTON_CLICK` execution resolution, active window multi-cast with pin guards, workspace deletion fan-out, and stateless reconnection via `/?workspace=media`. |
| [`reticle.test.js`](file:///home/karthikulkarni/Documents/arya-dock/test/reticle.test.js) | UI Flows (`.reticle/flows/`) | Conformance validation of predefined Reticle in-app verification flows: deck pagination, mode switching, tile count adjustments, app catalog drawer, and editor mode security barriers. |

---

## 🚀 Running Tests

Arya Dock uses Node.js native test runner (`node:test` and `node:assert/strict`), eliminating heavy external testing dependencies.

```bash
# Run the entire test suite
npm test

# Run a specific test file
node --test test/navigation.test.js

# Run tests with Reticle verification flows
npm run test:reticle

# Run syntax lint verification
npm run lint
```

---

## 🛡️ Testing Invariants

- **Isolated Sandboxes**: File persistence tests use temporary directories (`fs.mkdtempSync(path.join(os.tmpdir(), 'arya-test-'))`) and clean up after execution.
- **Port Zero Dynamic Binding**: Network and server integration tests bind to `port: 0` to prevent collisions with running instances or other test runners.
- **Hermetic Platform Testing**: Tests utilize the `fake` platform adapter to avoid invoking real system terminals or media players during CI runs.
