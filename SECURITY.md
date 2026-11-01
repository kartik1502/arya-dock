# Security Policy

Arya Dock executes commands and launches terminal actions on your local workstation. As such, security is a first-class consideration in the project's architecture and design.

---

## Supported Versions

Only the latest release and the current `master` branch receive security patches.

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0.0 | :x:                |

---

## Security Model Overview

Arya Dock incorporates several defense-in-depth measures to safeguard your workstation:

1. **Cryptographic Authentication**:
   - WebSocket upgrades and dynamic HTTP `/api/*` endpoints require a secure 32-character hexadecimal pairing token (`ARYA_PAIRING_TOKEN`).
   - Constant-time comparison (`crypto.timingSafeEqual`) is enforced to eliminate timing side-channel attacks.

2. **Cross-Site WebSocket Hijacking (CSWSH) Guard**:
   - The HTTP `Origin` header during WebSocket handshakes is verified strictly against loopback (`127.0.0.1`, `::1`), `localhost`, and local network interface addresses.
   - Remote or unauthorized origins receive `403 Forbidden`.

3. **Role-Based Access Control (RBAC)**:
   - **Operator Role**: Remote phone/tablet connections can only trigger existing configured buttons (`BUTTON_CLICK`) and page shifts (`PAGE_PREV`, `PAGE_NEXT`). Operators cannot modify shortcuts, change profile definitions, or browse directories.
   - **Editor Role**: Requires explicit elevation via `X-Editor-Key` / in-app unlock modal with `ARYA_EDITOR_KEY` (or direct localhost access).

4. **Strict URL and Command Sanitization**:
   - Disallowed protocols (`javascript:`, `data:`, `vbscript:`, `file:`) are blocked.
   - Shell arguments are quoted and escaped to prevent command injection.

---

## Reporting a Vulnerability

If you discover a security vulnerability in Arya Dock, please **do not** open a public issue or discuss it in public forums.

Instead, report it responsibly via one of the following channels:

1. **GitHub Security Advisory (Recommended)**:
   - Navigate to the [Arya Dock Security Advisories page](https://github.com/kartik1502/arya-dock/security/advisories) and click **"Report a vulnerability"**.

2. **Email**:
   - Send an email with full details to [kartikkulkarni1411@gmail.com](mailto:kartikkulkarni1411@gmail.com).
   - Please include:
     - Description of the issue and potential security impact.
     - Step-by-step reproduction instructions or a minimal proof of concept (PoC).
     - Operating system, Node.js version, and environment context.

### What to Expect

- **Acknowledgment**: You will receive an initial response within 48 hours confirming receipt of your report.
- **Assessment**: We will evaluate the report, verify the vulnerability, and determine the remediation path.
- **Coordination**: We will keep you informed of the fix progress and coordinate a public disclosure date.
- **Credit**: We will credit you in the security advisory and release notes unless you prefer to remain anonymous.
