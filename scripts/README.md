# 🛠️ `scripts/` — Tooling & CI Automation

The `scripts/` directory contains developer utilities and continuous integration (CI) automation scripts for Arya Dock.

---

## 📑 Script Manifest

| Script | Invocation | Primary Function |
|---|---|---|
| [`lint.js`](file:///home/karthikulkarni/Documents/arya-dock/scripts/lint.js) | `npm run lint`<br/>`node scripts/lint.js` | Recursively crawls and validates JavaScript syntax (`node --check`) across all source and test directories without requiring external dependencies like ESLint. |

---

## 🔍 How `lint.js` Works

1. **Target Directory Crawling**:
   - Scans `server.js` at repository root.
   - Recursively traverses `lib/`, `platform/`, `public/`, `test/`, and `scripts/`.
2. **Native Syntax Validation**:
   - Dispatches each file to `process.execPath` (Node.js) with `--check`:
     ```bash
     node --check <file_path>
     ```
   - Catches early syntax errors, unclosed brackets, missing semicolons, or invalid keywords.
3. **CI Status Reporting**:
   - Accumulates syntax errors and prints error stack traces to `stderr`.
   - Exits with status code `0` on success, or `1` if any file fails syntax inspection.

---

## ⚙️ CI / CD Integration

`lint.js` is executed as the first gatekeeper step in `.github/workflows/ci.yml`:

```yaml
- name: Run Syntax Linter
  run: npm run lint
```
