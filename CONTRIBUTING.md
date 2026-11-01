# Contributing to Arya Dock

Thank you for your interest in contributing to **Arya Dock**! We welcome community contributions, bug reports, documentation enhancements, and feature suggestions.

---

## Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please treat everyone with respect and empathy.

---

## Development Setup

### Prerequisites
- **Linux OS** (Fedora, Ubuntu, Debian, Arch, openSUSE, etc.)
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0.0 or later
- **Git**

### Getting Started

1. **Fork and clone** the repository:
   ```bash
   git clone https://github.com/kartik1502/arya-dock.git
   cd arya-dock
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```
   This runs `node --watch server.js`, automatically restarting the server whenever backend files are modified.

4. **Verify tests pass**:
   ```bash
   npm test
   ```

---

## Architectural Overview

Arya Dock is designed to be lightweight, modular, and dependency-light:

```text
arya-dock/
├── server.js              # Server entry point, CLI flags, lifecycle management
├── lib/
│   ├── auth.js            # Cryptographic pairing token, Origin verification, role checks
│   ├── config.js          # Atomic JSON persistence, schema validation, path expansion
│   ├── terminal.js        # Terminal detection (Ptyxis, GNOME, Kitty, etc.), shell quoting
│   ├── http.js            # Static file serving, security headers, path traversal guard
│   ├── ws.js              # WebSocket connection handling, heartbeat, client sync
│   ├── apps.js            # FreeDesktop .desktop app parser, directory suggestions
│   └── network.js         # Interface discovery (USB tethering, Wi-Fi, LAN)
├── public/                # Cockpit frontend (pure HTML/CSS/JS, zero build toolchain)
│   ├── index.html         # Bezel UI, modal dialogs, drawer markup
│   ├── style.css          # OLED pitch-black theme, container queries, CSS variables
│   ├── app.js             # Client controller, WebSocket sync, responsive grid
│   ├── sw.js              # Service Worker for offline PWA caching
│   └── manifest.json      # Progressive Web App manifest
├── test/                  # Node.js native test suite (node --test)
│   ├── auth.test.js       # Auth, Origin, role escalation tests
│   ├── config.test.js     # Config schema validation, atomic write tests
│   ├── http.test.js       # Path traversal, headers, directory endpoint tests
│   ├── terminal.test.js   # Shell escaping, terminal builder, spawn error tests
│   └── integration.test.js# End-to-end WebSocket auth and mutation tests
└── config/
    └── profiles.example.json # Default template configuration
```

---

## Coding Standards

1. **Zero Runtime Bloat**:
   - Prefer Node.js native standard libraries (`fs`, `path`, `crypto`, `child_process`, `http`, `os`).
   - External dependencies should be strictly justified and kept to an absolute minimum (`ws`, `qrcode-terminal`).

2. **Security-First Mindset**:
   - Never pass unquoted strings into a shell. Always use `quoteForShell` from `lib/terminal.js`.
   - Never compare secret tokens with standard `===` operators; always use `crypto.timingSafeEqual` via `safeEqual` in `lib/auth.js`.
   - Never use `innerHTML` to render user-controlled data; always use DOM `textContent` or safe element constructors.
   - Maintain strict Origin header checks for WebSocket connections to prevent Cross-Site WebSocket Hijacking.

3. **Pure Modern CSS & Client JS**:
   - Frontend assets in `public/` are served directly without bundlers or transpilation.
   - Use CSS Container Queries and modern CSS variables matching the motorsport design system in `DESIGN.md`.

---

## Running Tests

Arya Dock uses Node.js's built-in test runner (`node --test`), requiring zero external test framework dependencies.

Run the entire test suite:
```bash
npm test
```

Run a specific test file:
```bash
node --test test/auth.test.js
node --test test/integration.test.js
```

Validate JavaScript syntax:
```bash
npm run lint
```

Every PR must pass 100% of the test suite across supported Node versions before it can be merged.

---

## Pull Request Guidelines

1. **Branch Naming**:
   - `feat/feature-name` for new capabilities
   - `fix/issue-description` for bug fixes
   - `docs/topic` for documentation improvements
   - `refactor/component` for code refactoring

2. **Commit Messages**:
   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat(scope): add new feature`
   - `fix(scope): resolve bug`
   - `docs(scope): update documentation`
   - `test(scope): add unit tests`

3. **Checklist Before Submitting**:
   - [ ] `npm test` runs cleanly and all tests pass.
   - [ ] No hardcoded personal paths or credentials.
   - [ ] No restricted brand names or proprietary marks.
   - [ ] Documentation updated if CLI flags, configs, or features changed.
   - [ ] New functionality accompanied by unit/integration tests in `test/`.
