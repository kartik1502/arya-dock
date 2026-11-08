# 📚 `docs/` — Architectural Specifications & Operational Reference

The `docs/` directory contains deep-dive architectural specifications, security designs, configuration references, and operational guides for Arya Dock.

---

## 📑 Documentation Index

| Guide | Core Topics |
|---|---|
| [`config-design.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/config-design.md) | Single-user workstation ownership model, XDG Base Directory layout, path precedence, first-boot legacy migration, debounced persistence, and backup rotation with corrupted file auto-recovery. |
| [`configuration.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/configuration.md) | Complete reference of environment variables (`HOST`, `PORT`, `ARYA_HOME`, `CONFIG_PATH`, `AUTH_PATH`, `TERMINAL`, `ARYA_*`), CLI arguments (`--config`, `--auth`, `--rotate-credentials`, `--start`), and config file locations. |
| [`security-model.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/security-model.md) | Defense-in-depth security model: pairing tokens, constant-time validation, Origin header verification, Operator vs. Editor role separation, localhost proxy caveats, and credential rotation. |
| [`usage-guide.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/usage-guide.md) | Operational walkthrough: navigation modes (M1 Dev, M2 Media), dynamic tile count adjustments (`+`/`−`), drag-and-drop application catalog, terminal execution modes, and data-loss prevention. |
| [`protocol-specs.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/protocol-specs.md) | Low-level engineering reference for optional hardware LCD keypad integration: USB HID reports, vendor VID/PID (`0x046d`/`0xc354`), LCD geometry (480×480), and Linux `udev` rules. |
| [`active-window-spike.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/active-window-spike.md) | Investigation findings for active window focus tracking on GNOME Wayland (`org.gnome.Shell.Introspect`) and X11 (`_NET_ACTIVE_WINDOW`), including privacy constraints (window titles never read or emitted). |
| [`designs/workspace-tile-segregation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/workspace-tile-segregation.md) | Architectural specification for workspace tile segregation, canonical page sequencing (`terminal`, `application`, `url`, `media`), 15-tile overflow mechanics, and lossless two-way migration. |
| [`designs/reviews/`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/reviews/) | EGM review artifacts and multi-agent audit reports across 5 review stages (Zoom Out, Comprehension, Hostile Critic, Intermediate Zoom Out, Implementation Readiness). |

---

## 🗺️ Epics Mapping

- **Epic E0 (Foundation)**: Reflected in [`security-model.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/security-model.md) (pairing tokens, Origin checks, role boundaries).
- **Epic E1 (Platform Adapters)**: Reflected in [`active-window-spike.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/active-window-spike.md) and [`protocol-specs.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/protocol-specs.md).
- **Epic E2 (Config Relocation & Persistence)**: Reflected in [`config-design.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/config-design.md) and [`configuration.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/configuration.md).
- **Epic E3 (Workspace Model v2 & Navigation Reducer)**: Reflected in [`usage-guide.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/usage-guide.md) and [`config-design.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/config-design.md).

---

## ✍️ Contribution & Maintenance Directives

When updating code in `lib/`, `platform/`, or `server.js`:
1. Keep documentation in sync within the same pull request.
2. Ensure environment variable tables and CLI flag descriptions match `server.js` and `lib/config.js`.
3. Verify that all markdown links resolve to valid repository paths.
