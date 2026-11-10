# 🏛️ System Architecture & Specifications

This directory contains the core system architecture, security specifications, and hardware protocol designs for Arya Dock:

| Specification | Document | Description |
| :--- | :--- | :--- |
| **Security Model** | [`security-model.md`](./security-model.md) | Defense-in-depth model, token validation, Origin header verification, role boundaries, and credential rotation. |
| **Config Persistence** | [`config-design.md`](./config-design.md) | Single-user ownership model, XDG Base Directory layout, path precedence, first-boot migration, and atomic backups. |
| **Hardware Protocol** | [`protocol-specs.md`](./protocol-specs.md) | Reference protocol specification for optional hardware LCD keypads, USB HID framing, and layout geometry. |
