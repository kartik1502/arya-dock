# 🔒 Arya Dock — Security Model & Architecture

Arya Dock implements strict defense-in-depth boundaries to protect your workstation from unauthorized command execution, cross-site hijacking, and network eavesdropping.

---

## 1. Cryptographic Pairing Token (`ARYA_PAIRING_TOKEN`)

- All WebSocket upgrade handshakes and `/api/*` endpoints require a secure 32-character hexadecimal token.
- Tokens can be supplied via the `Authorization: Bearer <token>` header, `X-Pairing-Token` header, or URL query parameter (`?token=<token>`).
- The pairing token is cryptographically generated on first launch (`crypto.randomBytes(16).toString('hex')`) and persisted in `config/auth.json` with strict `0600` permissions.
- Evaluated on upgrade and API requests using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

---

## 2. Origin Header Verification

- Browser WebSocket upgrades verify the HTTP `Origin` header against localhost, loopback (`127.0.0.1`, `::1`), and detected host network interface IPs.
- Requests originating from external browser tabs or malicious websites are rejected with `403 Forbidden`, neutralizing Cross-Site WebSocket Hijacking (CSWSH).
- Wildcard CORS (`Access-Control-Allow-Origin: *`) is completely removed from all HTTP endpoints.

---

## 3. Role Separation: Operator vs. Editor

- **Operator Role (Viewer / Trigger):** Default role for remote phone and tablet connections. Operators are permitted to trigger buttons (`BUTTON_CLICK`), switch active pages (`PAGE_PREV`, `PAGE_NEXT`), and respond to heartbeats (`PING`/`PONG`). Operators **cannot** mutate button definitions, add or remove tiles, switch active profiles, inspect workstation directories (`/api/directories`), or scan host applications and executable commands (`/api/apps`).
- **Editor Role:** Full workstation configuration privilege. Editors can modify button actions (`UPDATE_BUTTON`), add/delete tiles (`ADD_BUTTON`, `DELETE_BUTTON`), resize the grid (`SET_BUTTONS_COUNT`), change active profiles (`SET_PROFILE`), browse workstation directories (`/api/directories`), and scan installed system applications with executable commands (`/api/apps`).

---

## 4. Localhost Automatic Editor Privilege & SSH Tunnel / Proxy Considerations

- Connections originating directly from localhost (`127.0.0.1`, `::1`, `localhost`) automatically receive the **Editor** role without needing an editor key.
- ⚠️ **Key Security Behavior:** If you expose Arya Dock via an SSH port forward (e.g. `ssh -L 3333:localhost:3333 user@server`) or behind a reverse proxy (e.g. Nginx, Caddy) that forwards connections from `127.0.0.1` without preserving remote client IPs, **every incoming connection through that tunnel or proxy will appear as localhost and receive full Editor privileges**. When exposing Arya Dock remotely across shared networks, bind directly to your LAN IP or configure reverse proxies so that client IPs are not masked as `127.0.0.1`.

---

## 5. Remote Editor Elevation & Query-String Elimination

- Remote devices connect as Operators by default. To unlock Editor privileges, tap the unlock button in the web interface and enter the Editor Key into the in-app modal (transmitting an `AUTH_EDIT` WebSocket message) or provide the `X-Editor-Key` HTTP header.
- Query-string `editKey` (`?editKey=...`) is **intentionally rejected and ignored** across both HTTP and WebSocket connections to prevent editor keys from leaking into browser history, server access logs, or HTTP Referer headers.
- **Environment Scan Protection (`/api/apps` & `/api/directories`):** System application scanning (`/api/apps`, which exposes executable command strings) and directory browsing (`/api/directories`, which exposes filesystem structure) are gated behind the Editor privilege barrier. Unprivileged operators receive `403 Forbidden`.

---

## 6. Unauthenticated Static Assets

- Static web assets (`/`, `/index.html`, `/style.css`, `/app.js`, `/manifest.json`, `/icon.svg`) are served without requiring an authentication token.
- This allows browsers and Progressive Web App (PWA) client shells to load the application frontend and service worker offline before pairing. All dynamic data endpoints (`/api/*`) and WebSocket control channels require authentication.

---

## 7. Credential Rotation Lifecycle

- Credentials (`pairingToken` and `editorKey`) are stored in `config/auth.json`.
- Rotate credentials on disk at any time via CLI:
  ```bash
  node server.js --rotate-credentials
  ```
- **Restart Required:** Credentials are loaded into server memory at boot time, and active WebSocket connections stay connected. Rotating credentials on disk does not terminate active sessions until the server process is restarted.
- To rotate credentials and immediately launch the server with the new credentials in a single command, run:
  ```bash
  node server.js --rotate-credentials --start
  ```

---

## 8. Content Security Policy (CSP) & Defense-in-Depth

- Strict security headers: `default-src 'self'`, `connect-src 'self' ws: wss:`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`.
- Dynamic user-controlled strings and application metadata are rendered via safe DOM `textContent` APIs.
