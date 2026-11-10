# 📚 `docs/` — Architectural Specifications & Operational Reference

The `docs/` directory contains deep-dive architectural specifications, security designs, configuration references, and operational guides for Arya Dock, organized into structured categories:

```text
docs/
├── architecture/             # Core system architecture, security, and protocols
├── guides/                   # Operational user and configuration guides
├── designs/                  # Formal feature RFCs and EGM review archives
│   └── reviews/              # EGM multi-agent review reports by feature
└── research/                 # Prototypes, technical spikes, and feasibility studies
```

---

## 📑 Documentation Index

### 1. User & Operator Guides (`docs/guides/`)

| Guide | Core Topics |
|---|---|
| [`guides/usage-guide.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/guides/usage-guide.md) | Operational walkthrough: navigation modes (M1 Dev, M2 Media), dynamic tile count adjustments (`+`/`−`), drag-and-drop application catalog, terminal execution modes, and data-loss prevention. |
| [`guides/configuration.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/guides/configuration.md) | Complete reference of environment variables (`HOST`, `PORT`, `ARYA_HOME`, `CONFIG_PATH`, `AUTH_PATH`, `TERMINAL`, `ARYA_*`), CLI arguments (`--config`, `--auth`, `--rotate-credentials`, `--start`), and config file locations. |

### 2. Architecture & System Specifications (`docs/architecture/`)

| Specification | Core Topics |
|---|---|
| [`architecture/security-model.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/architecture/security-model.md) | Defense-in-depth security model: pairing tokens, constant-time validation, Origin header verification, Operator vs. Editor role separation, localhost proxy caveats, and credential rotation. |
| [`architecture/config-design.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/architecture/config-design.md) | Single-user workstation ownership model, XDG Base Directory layout, path precedence, first-boot legacy migration, debounced persistence, and backup rotation with corrupted file auto-recovery. |
| [`architecture/protocol-specs.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/architecture/protocol-specs.md) | Low-level engineering reference for optional hardware LCD keypad integration: USB HID reports, vendor VID/PID (`0x046d`/`0xc354`), LCD geometry (480×480), and Linux `udev` rules. |

### 3. Feature Design Documents (`docs/designs/`)

| Specification | Core Topics |
|---|---|
| [`designs/workspace-tile-segregation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/workspace-tile-segregation.md) | Architectural specification for workspace tile segregation, canonical page sequencing (`terminal`, `application`, `url`, `media`), and 15-tile overflow mechanics. |
| [`designs/active-window-auto-switching.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/active-window-auto-switching.md) | Context-aware active window watcher and profile/workspace auto-switching engine. |
| [`designs/per-client-navigation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/per-client-navigation.md) | Multi-device per-client navigation state isolation and independent workspace paging. |
| [`designs/workspace-management-and-switcher.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/workspace-management-and-switcher.md) | Dynamic workspace lifecycle (create, rename, delete) and horizontal mode switcher. |
| [`designs/config-import-export-engine.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/config-import-export-engine.md) | Atomic configuration export, validation, and safe import engine with automated backups. |
| [`designs/folder-subdeck-navigation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/folder-subdeck-navigation.md) | Nested sub-deck folders, hierarchical navigation stack, and dynamic breadcrumbs. |
| [`designs/onboarding-and-preset-catalog.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/onboarding-and-preset-catalog.md) | Host ecosystem diagnostic scanner and interactive starter preset catalog wizard. |
| [`designs/reviews/`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/reviews/) | EGM review archives organized into feature-specific directories with full synthesis reports. |

### 4. Technical Research & Spikes (`docs/research/`)

| Document | Core Topics |
|---|---|
| [`research/active-window-spike.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/research/active-window-spike.md) | Investigation findings for active window focus tracking on GNOME Wayland (`org.gnome.Shell.Introspect`) and X11 (`_NET_ACTIVE_WINDOW`), including privacy constraints. |
| [`research/active-window-spike.js`](file:///home/karthikulkarni/Documents/arya-dock/docs/research/active-window-spike.js) | Standalone prototype script demonstrating desktop window detection. |

---

## 🗺️ Epics Mapping

- **Epic E0 (Foundation)**: Reflected in [`architecture/security-model.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/architecture/security-model.md) (pairing tokens, Origin checks, role boundaries).
- **Epic E1 (Platform Adapters)**: Reflected in [`research/active-window-spike.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/research/active-window-spike.md) and [`architecture/protocol-specs.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/architecture/protocol-specs.md).
- **Epic E2 (Config Relocation & Persistence)**: Reflected in [`architecture/config-design.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/architecture/config-design.md) and [`guides/configuration.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/guides/configuration.md).
- **Epic E3 (Workspace Model v2 & Navigation Reducer)**: Reflected in [`guides/usage-guide.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/guides/usage-guide.md) and [`architecture/config-design.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/architecture/config-design.md).
- **Epic E4 (Onboarding & Preset Catalog)**: Reflected in [`designs/onboarding-and-preset-catalog.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/onboarding-and-preset-catalog.md).
- **Epic E5 (Config Import/Export Engine)**: Reflected in [`designs/config-import-export-engine.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/config-import-export-engine.md).
- **Epic E6 (Dynamic Scalable Workspaces & Folders)**: Reflected in [`designs/workspace-management-and-switcher.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/workspace-management-and-switcher.md) and [`designs/folder-subdeck-navigation.md`](file:///home/karthikulkarni/Documents/arya-dock/docs/designs/folder-subdeck-navigation.md).

---

## ✍️ Contribution & Maintenance Directives

When updating code in `lib/`, `platform/`, or `server.js`:
1. Keep documentation in sync within the same pull request.
2. Ensure environment variable tables and CLI flag descriptions match `server.js` and `lib/config.js`.
3. Verify that all markdown links resolve to valid repository paths.
