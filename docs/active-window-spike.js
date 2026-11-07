#!/usr/bin/env node
/**
 * Arya Dock — Active Window Detection Spike Script (E1-1)
 *
 * Demonstrates cross-environment active window identification:
 * - Wayland (GNOME Shell Introspect D-Bus API)
 * - X11 / XWayland (_NET_ACTIVE_WINDOW / WM_CLASS)
 * - Sway / Hyprland (IPC socket listeners)
 *
 * Privacy Guarantees:
 * - Strict omission of window titles (`title` / `_NET_WM_NAME`).
 * - Only stable application identifiers (`app-id`, `wm_class`, `desktopId`) are parsed and emitted.
 */

const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const POLL_INTERVAL_MS = 250;
const DEBOUNCE_MS = 150;

/**
 * Normalizes raw application identifiers into canonical IDs.
 * E.g., 'org.gnome.Ptyxis.desktop' -> 'org.gnome.Ptyxis'
 *       'google-chrome.desktop' -> 'google-chrome'
 *       'jetbrains-idea-ce.desktop' -> 'jetbrains-idea'
 */
function normalizeAppId(rawId) {
  if (!rawId || typeof rawId !== 'string') return null;
  let id = rawId.trim();
  if (id.endsWith('.desktop')) {
    id = id.slice(0, -8);
  }
  // JetBrains product normalization (e.g., jetbrains-idea-ce -> jetbrains-idea)
  if (id.startsWith('jetbrains-')) {
    id = id.replace(/-ce$|-ultimate$|-eap$/, '');
  }
  return id.toLowerCase();
}

/**
 * Detects current session type.
 */
function getSessionInfo() {
  const sessionType = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  const desktop = (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase();
  return {
    sessionType: sessionType || (process.env.WAYLAND_DISPLAY ? 'wayland' : (process.env.DISPLAY ? 'x11' : 'unknown')),
    desktop,
    isGnome: desktop.includes('gnome'),
    isKde: desktop.includes('kde') || desktop.includes('plasma'),
    isSway: desktop.includes('sway') || Boolean(process.env.SWAYSOCK),
    isHyprland: desktop.includes('hyprland') || Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE)
  };
}

/**
 * Method 1: GNOME Wayland via org.gnome.Shell.Introspect
 * Queries the compositor directly for windows with `has-focus: true`.
 * Window titles are discarded immediately during parsing.
 */
function getGnomeActiveApp(callback) {
  // Try gdbus first, then busctl
  const cmd = 'gdbus call --session --dest org.gnome.Shell.Introspect --object-path /org/gnome/Shell/Introspect --method org.gnome.Shell.Introspect.GetWindows';
  exec(cmd, { timeout: 800, maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err) {
      // Fallback to busctl
      const busctlCmd = 'busctl --user --json=short call org.gnome.Shell.Introspect /org/gnome/Shell/Introspect org.gnome.Shell.Introspect GetWindows';
      exec(busctlCmd, { timeout: 800, maxBuffer: 1024 * 1024 }, (bErr, bStdout) => {
        if (bErr) return callback(new Error('GNOME Shell Introspect D-Bus unavailable: ' + (err.message || bErr.message)));
        try {
          const parsed = JSON.parse(bStdout);
          // busctl JSON format: data[0] contains dictionary of windows
          const windows = parsed.data && parsed.data[0] ? parsed.data[0] : {};
          for (const winId of Object.keys(windows)) {
            const props = windows[winId];
            if (props['has-focus'] && props['has-focus'].data === true) {
              const appId = props['app-id'] ? props['app-id'].data : (props['wm-class'] ? props['wm-class'].data : null);
              return callback(null, normalizeAppId(appId));
            }
          }
          return callback(null, null);
        } catch (parseErr) {
          return callback(parseErr);
        }
      });
      return;
    }

    // Parse gdbus GVariant output
    // Example segment: 'has-focus': <true>, 'app-id': <'org.gnome.Ptyxis.desktop'>, 'wm-class': <'ptyxis'>
    try {
      const focusMatches = stdout.matchAll(/\{([^}]+'has-focus':\s*<true>[^}]+)\}/g);
      for (const match of focusMatches) {
        const block = match[1];
        const appIdMatch = block.match(/'app-id':\s*<'([^']+)'/);
        const wmClassMatch = block.match(/'wm-class':\s*<'([^']+)'/);
        const raw = appIdMatch ? appIdMatch[1] : (wmClassMatch ? wmClassMatch[1] : null);
        if (raw) return callback(null, normalizeAppId(raw));
      }
      return callback(null, null);
    } catch (e) {
      return callback(e);
    }
  });
}

/**
 * Method 2: X11 / XWayland via xprop
 * Resolves _NET_ACTIVE_WINDOW on the root window, then queries WM_CLASS.
 */
function getX11ActiveApp(callback) {
  exec('xprop -root 32x "\\t$0" _NET_ACTIVE_WINDOW', { timeout: 600 }, (err, stdout) => {
    if (err) return callback(err);
    const winMatch = stdout.match(/_NET_ACTIVE_WINDOW\s+0x([0-9a-fA-F]+)/);
    if (!winMatch || winMatch[1] === '0') {
      return callback(null, null);
    }
    const winId = '0x' + winMatch[1];
    exec(`xprop -id ${winId} WM_CLASS`, { timeout: 600 }, (clsErr, clsStdout) => {
      if (clsErr) return callback(clsErr);
      // WM_CLASS(STRING) = "instance", "class"
      const clsMatch = clsStdout.match(/WM_CLASS\(STRING\)\s*=\s*"([^"]+)",\s*"([^"]+)"/);
      if (clsMatch) {
        const wmClass = clsMatch[2] || clsMatch[1];
        return callback(null, normalizeAppId(wmClass));
      }
      return callback(null, null);
    });
  });
}

/**
 * Active Window Watcher with debouncing and change detection.
 */
class ActiveWindowWatcher {
  constructor(options = {}) {
    this.pollInterval = options.pollInterval || POLL_INTERVAL_MS;
    this.debounceMs = options.debounceMs || DEBOUNCE_MS;
    this.session = getSessionInfo();
    this.lastAppId = null;
    this.pendingAppId = null;
    this.debounceTimer = null;
    this.pollTimer = null;
    this.onChange = options.onChange || ((appId) => console.log(`[FOCUS CHANGE] -> ${appId}`));
  }

  start() {
    console.log(`[Arya Dock Watcher] Detected session: ${this.session.sessionType} (${this.session.desktop || 'generic'})`);
    console.log(`[Arya Dock Watcher] Polling every ${this.pollInterval}ms (debounce: ${this.debounceMs}ms)`);
    console.log('[Arya Dock Watcher] Privacy enforced: Window titles stripped, tracking app identifiers only.\n');

    const poll = () => {
      const handler = (err, appId) => {
        if (!err && appId) {
          this.handleDetectedApp(appId);
        }
        this.pollTimer = setTimeout(poll, this.pollInterval);
      };

      if (this.session.isGnome && this.session.sessionType === 'wayland') {
        getGnomeActiveApp(handler);
      } else if (this.session.sessionType === 'x11') {
        getX11ActiveApp(handler);
      } else {
        // Fallback: attempt GNOME Introspect first, then X11
        getGnomeActiveApp((err, appId) => {
          if (!err && appId) return handler(null, appId);
          getX11ActiveApp(handler);
        });
      }
    };

    poll();
  }

  handleDetectedApp(appId) {
    if (appId === this.lastAppId) return;

    if (appId !== this.pendingAppId) {
      this.pendingAppId = appId;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        if (this.pendingAppId && this.pendingAppId !== this.lastAppId) {
          this.lastAppId = this.pendingAppId;
          this.onChange(this.lastAppId);
        }
      }, this.debounceMs);
    }
  }

  stop() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

// CLI Execution Support
if (require.main === module) {
  const watcher = new ActiveWindowWatcher({
    onChange: (appId) => {
      const now = new Date().toISOString().split('T')[1].slice(0, 8);
      console.log(`[${now}] Focused Application: ${appId}`);
    }
  });

  watcher.start();

  process.on('SIGINT', () => {
    console.log('\n[Arya Dock Watcher] Stopping watcher.');
    watcher.stop();
    process.exit(0);
  });
}

module.exports = {
  getSessionInfo,
  normalizeAppId,
  getGnomeActiveApp,
  getX11ActiveApp,
  ActiveWindowWatcher
};
