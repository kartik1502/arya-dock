# 🔌 `platform/` — Modular OS Abstraction Layer

The `platform/` directory provides a modular operating system abstraction layer for Arya Dock. It decouples core server logic, macro dispatching, and application discovery from host-specific command-line utilities and desktop environments.

---

## 📑 Adapter Manifest

| File | Adapter Name | Target Environment | Status |
|---|---|---|---|
| [`index.js`](file:///home/karthikulkarni/Documents/arya-dock/platform/index.js) | Dispatcher / Registry | All | Active platform detection, adapter resolution, and degraded adapter factory |
| [`linux.js`](file:///home/karthikulkarni/Documents/arya-dock/platform/linux.js) | `linux` | Linux (systemd, GNOME, Wayland, X11) | Fully supported (shell, terminal emulator auto-detection, PipeWire/WirePlumber/PulseAudio, FreeDesktop `.desktop` scanning) |
| [`darwin.js`](file:///home/karthikulkarni/Documents/arya-dock/platform/darwin.js) | `darwin` | macOS | Supported (default Zsh, `Terminal.app`, `open`, `/Applications` scanning) |
| [`fake.js`](file:///home/karthikulkarni/Documents/arya-dock/platform/fake.js) | `fake` | Automated Test Harness | Test adapter recording function calls and returning configurable mock responses |

---

## 📐 Adapter Interface Contract

Every platform adapter conforms to the following contract:

```typescript
interface PlatformAdapter {
  name: string;
  isSupported: boolean;
  statusMessage?: string;

  /** Detect or resolve default user login shell */
  getDefaultShell(): string;

  /** Detect installed terminal emulator */
  getDefaultTerminal(): { name: string; path: string };

  /** Build media command (volume_up, volume_down, mute, play_pause, next, prev) */
  getMediaCommand(action: string): CommandSpec | null;

  /** Fallback media command if primary execution fails */
  getMediaFallbackCommand?(action: string): CommandSpec | null;

  /** Build default desktop URL opener command */
  getUrlCommand(url: string): CommandSpec | null;

  /** Return list of application desktop shortcut directories */
  getApplicationDirectories(): string[];

  /** Return feature capability flags */
  capabilities(): {
    activeWindow: boolean;
    media: boolean;
    applications: boolean;
  };

  /** Fetch currently focused active window context (app-id) */
  getActiveWindow?(): ActiveWindowContext | null;
}

interface CommandSpec {
  bin: string;
  args: string[];
  options: {
    stdio: 'ignore';
    detached: boolean;
  };
  mediaFallback?: string;
}
```

---

## 🛡️ Degraded Adapter Pattern

When Arya Dock boots on an unsupported platform or when a platform adapter cannot be initialized, `platform/index.js` constructs a **Degraded Adapter** via `createDegradedAdapter(name, warningMessage)`.
- Returns safe default fallbacks (`/bin/sh` for shell, no-op commands for media and URLs, empty application lists).
- Reports capability flags as `false`.
- Ensures the server boots gracefully without unhandled exceptions or crashes.

---

## ⚙️ Environment Configuration

Override active platform selection via the `ARYA_PLATFORM` environment variable:

```bash
# Force the Linux platform adapter
ARYA_PLATFORM=linux node server.js

# Force the fake platform adapter for isolated headless testing
ARYA_PLATFORM=fake node server.js
```

---

## 🧪 Verification & Testing

```bash
# Verify platform registry, capabilities, and degraded fallback logic
node --test test/platform.test.js
```
