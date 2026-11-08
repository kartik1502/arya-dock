# 📱 `public/` — Frontend Progressive Web App (PWA) Client Shell

The `public/` directory contains the client-side single-page application and Progressive Web App (PWA) shell for Arya Dock. It connects to the workstation backend over authenticated WebSockets to render a pitch-black cockpit control deck on phones, tablets, or secondary monitors.

---

## 📑 File Manifest

| File | Description |
|---|---|
| [`index.html`](file:///home/karthikulkarni/Documents/arya-dock/public/index.html) | Single-page PWA shell, OLED dark cockpit DOM structure, drawer markup, and modal dialogs |
| [`app.js`](file:///home/karthikulkarni/Documents/arya-dock/public/app.js) | Client controller, WebSocket state synchronization, role management, drag-and-drop catalog, and Wake Lock |
| [`style.css`](file:///home/karthikulkarni/Documents/arya-dock/public/style.css) | Dark cockpit design system, container-query adaptive grid (`@container`), tactile bevels, and active LED glows |
| [`manifest.json`](file:///home/karthikulkarni/Documents/arya-dock/public/manifest.json) | Web App Manifest for standalone installation and home-screen launching on Android and iOS |
| [`sw.js`](file:///home/karthikulkarni/Documents/arya-dock/public/sw.js) | Service Worker providing offline asset caching and cache rotation (`arya-dock-v4`) |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Application icons formatted for mobile home screens and desktop favicons |

---

## 🔒 Security & Client Role Management

1. **URL Parameter Scrubbing**:
   - When launching from a QR code or pairing URL (e.g. `/?token=...&editKey=...`), `app.js` immediately caches the token in `localStorage` and cleans the browser URL bar using `window.history.replaceState`.
   - Prevents sensitive authentication credentials from lingering in browser history, bookmarks, or screenshots.
2. **Role Boundaries (Operator vs. Editor)**:
   - Remote clients connect as **Operators** by default (`role: 'operator'`). Mutation controls (edit mode toggle, app drawer button, tile count adjustment, profile switching) are hidden or disabled.
   - Remote users can elevate to **Editor** by tapping the lock icon and submitting the Editor Key (`AUTH_EDIT` WebSocket message). Localhost connections inherit Editor privileges automatically.
3. **Data Loss Guard**:
   - Reducing grid tile count via `−` triggers a verification check. If any tiles slated for deletion contain configured commands or labels, a confirmation modal alerts the operator, requiring explicit approval (`force: true`).

---

## 📶 Service Worker Caching Strategy (`sw.js`)

- **Cache-First for Static Shell**: Caches HTML, CSS, JavaScript, manifest, and icons under cache key `arya-dock-v4`.
- **Dynamic Bypass**:
  - Never intercepts or caches `/api/*` endpoints, `/ws` WebSocket handshakes, or `/health`.
  - Rejects caching of any request containing `token=` or `editKey=` in query parameters.
- **Cache Invalidation**: On activation, sweeps and purges legacy cache versions before claiming active clients.

---

## 📱 Hardware Integration: Screen Wake Lock

- `app.js` integrates with the browser **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`).
- Prevents phone or tablet screens from dimming or sleeping while resting on a desk dock.
- Automatically re-acquires the lock when the browser tab regains visibility (`visibilitychange` event).

---

## 🧪 Verification & Testing

Frontend contracts and verification flows are tested using Reticle and integration suites:

```bash
# Run WebSocket integration suite validating frontend protocol payloads
node --test test/integration.test.js

# Verify Reticle flow definitions for pagination, mode switching, and security barriers
node --test test/reticle.test.js
```
