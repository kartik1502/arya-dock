# Comprehension & Clarity Audit: Active Window Auto-Switching Engine

**Document Under Review:** `docs/designs/active-window-auto-switching.md`  
**Auditor Persona:** Comprehension Goldfish (Naive Reader / Zero Assumed Project Knowledge)
**Date:** 2026-11-08

---

### Paraphrase

#### What this proposes
This document proposes an automated workspace switching engine for Arya Dock that tracks the currently focused application on a Linux workstation (via GNOME Wayland D-Bus or X11/XWayland properties) and dynamically switches the companion touch deck to a matching workspace (e.g., switching to a developer cockpit when an IDE is focused). The system runs active detection only when companion devices are connected, filters out window titles to prevent privacy leakage, coalesces rapid focus shifts with a 150ms debounce, and allows users to override automatic switching via a manual UI pin.

#### How the existing system works, per this document
Arya Dock currently operates as an interactive secondary-screen control deck (on tablets, phones, or browsers) displaying static or manual workspaces (like developer tools or media controls) capped at 15 tiles per page. Today, workspace transitions require the user to physically tap mode tabs (`M1 DEV COCKPIT`, `M2 MEDIA`) on the touch screen. The system has no awareness of workstation desktop state, meaning shortcuts remain on whichever workspace was last manually selected even when the workstation user switches tasks or applications.

---

### Audit Answers to Core Questions

1. **Are all terms and acronyms clearly defined?**  
   **No.** The document heavily assumes familiarity with Linux desktop internals. Key acronyms and concepts (D-Bus, XWayland, Wayland compositor, `org.gnome.Shell.Introspect`, `busctl`, `gdbus`, `WM_CLASS`, `_NET_ACTIVE_WINDOW`, `xprop`, and reverse-DNS vs. binary `appId`s) are introduced without inline definitions, role explanations, or links to upstream specifications.
2. **Is the flow from window focus event to UI update clear and step-by-step?**  
   **Partially.** The high-level diagram outlines the data path, but the actual trigger mechanism contains a significant logical ambiguity: line 74 cites `every 250ms / debounced 150ms`. Because the platform calls (`gdbus call`, `xprop`) are one-off CLI inspection commands rather than event subscriptions, the system appears to be polling, yet polling intervals and debouncing algorithms are not reconciled.
3. **Are the privacy guarantees understandable to an end-user or auditor without reading code?**  
   **Mostly, but with a blind spot.** The intent ("Zero Window Title Capture") is well explained. However, an auditor will notice that on GNOME Wayland, `org.gnome.Shell.Introspect.GetWindows` dumps metadata (including `title`) for *all* open windows into the stdout buffer of the `gdbus` subprocess. The document asserts titles are dropped immediately in `platform/linux.js`, but does not explain subprocess buffer handling, error-logging sanitization, or why X11 never fetches titles whereas Wayland ingests all window metadata into process memory.
4. **Identify any confusing sections, ambiguities, or comprehension gaps.**  
   Detailed in the structured findings below.

---

### Structured Findings

#### Finding 1: Polling Cadence vs. Debounce Timing Contradiction
* **Severity:** Blocker
* **Affected Scope:** Section 2 (line 34), Section 4 Architecture Diagram (line 74), Section 4.1 (lines 109–125), Section 4.2 (lines 131–143)
* **Discrepancy Description & Rationale:**  
  The document states in Section 2 that Alt-Tabbing is coalesced using a "150ms debounce window," and line 74 annotates the flow with `appId (every 250ms / debounced 150ms)`. Meanwhile, Section 4.1 describes `getActiveWindow(callback)` using one-off CLI calls (`gdbus call`, `xprop`), which implies polling.  
  If the watcher polls every 250ms, consecutive samples are already separated by 250ms. A 150ms debounce on a 250ms polling loop is mathematically incoherent without explaining how debouncing is implemented (e.g., does it require two consecutive identical polls at 250ms? Is polling running at 50ms intervals? Or does it listen to a D-Bus signal?). A fresh engineer cannot implement this without guessing the timer architecture.

#### Finding 2: Undefined Linux Windowing and IPC Terminology
* **Severity:** Major
* **Affected Scope:** Section 3.1 (lines 43–44), Section 4.1 (lines 110–125), Section 6 (lines 191–193)
* **Discrepancy Description & Rationale:**  
  The specification references specialized desktop Linux concepts without defining what they are, what packages provide them, or linking to documentation:
  - **D-Bus**: Mentioned repeatedly as an IPC mechanism without clarifying that it is the Linux desktop message bus.
  - **`gdbus` vs `busctl`**: Not explained why two utilities exist (GLib/GIO vs. systemd), which is preferred, or what packages must be installed.
  - **Wayland Compositor vs XWayland vs X11**: No explanation of Wayland's security isolation (which prevents global window queries by design) or why GNOME Shell's private `org.gnome.Shell.Introspect` interface is required.
  - **`_NET_ACTIVE_WINDOW` & `WM_CLASS`**: Mentioned as raw string queries without explaining that they are EWMH/ICCCM standard X11 window properties retrieved via `xprop`.
  - **`appId`**: The document alternates between short names (`code`, `spotify`), desktop IDs (`org.gnome.ptyxis`), and binary names without stating the canonical format produced by `normalizeAppId()`.

#### Finding 3: Missing Schema and Resolution Semantics for `workspace.match.apps`
* **Severity:** Major
* **Affected Scope:** Section 2 (line 29), Section 4.3 (lines 153–161), Section 7.1 (line 204)
* **Discrepancy Description & Rationale:**  
  The document relies on `workspace.match.apps` to map an application to a workspace, but never defines its data format:
  - Is it an array of strings (`['code', 'vscode']`), glob patterns (`code*`), or regular expressions?
  - Is matching case-sensitive or case-insensitive?
  - How are conflicts resolved if multiple workspaces match the same application? (First match wins? Exact match over substring?)
  - If no workspace matches, Section 6 says the current workspace is preserved, but does `navState.mode` remain `'auto'` or transition to `'manual'`?

#### Finding 4: Incomplete Privacy Threat Model Regarding Subprocess Payloads
* **Severity:** Major
* **Affected Scope:** Section 2 (lines 33–34), Section 4.1 (lines 110–118), Section 5 (lines 178–181)
* **Discrepancy Description & Rationale:**  
  Section 2 and Section 5 assert a "Zero Window Title Capture" invariant. However, `org.gnome.Shell.Introspect.GetWindows` returns a serialized dictionary of every single open window on the desktop, containing window titles, positions, and process metadata.  
  To satisfy an auditor or end-user:
  1. The document must explain that the `gdbus` stdout stream enters the Node.js process memory buffer before JSON/string parsing discards the `title` key.
  2. The document must explicitly define how command errors or debug dumps are sanitized to guarantee that raw D-Bus stdout strings containing titles are never dumped into server error logs or crash reports.
  3. The document should contrast this with X11, where querying `WM_CLASS` never requests `_NET_WM_NAME` in the first place.

#### Finding 5: Undefined Authorization and Role Model for `canEdit`
* **Severity:** Nit
* **Affected Scope:** Section 5.3 (lines 183–185)
* **Discrepancy Description & Rationale:**  
  Section 5.3 mentions: "Matching rules (`workspace.match.apps`) can only be modified by authorized `editor` clients (`ws.canEdit === true`). Unauthorized attempts are rejected with `ERROR`."  
  The document does not describe what defines an "editor" client, how `ws.canEdit` is set or authenticated, or where workspace modification endpoints are specified. If role-based access control is out of scope for this document, it should be referenced via link or marked as a dependency on an external auth specification.

#### Finding 6: Unspecified Shape of Navigation State (`navState`)
* **Severity:** Nit
* **Affected Scope:** Section 4 Architecture Diagram (line 87), Section 4.3 (lines 153–161), Section 4.4 (lines 169–170)
* **Discrepancy Description & Rationale:**  
  `navState` is referenced across multiple components (`server.js`, `lib/navigation.js`, `public/app.js`), but its schema is only partially sketched in inline code snippets. A naive reader cannot tell what full state object is emitted in `STATE_UPDATE` (e.g. `{ workspaceId: string, pageIndex: number, mode: 'auto' | 'manual', pinned: boolean }`). A formal TypeScript interface or JSON schema block would make this self-contained.

---

### Actionable Recommendations for Author
1. **Clarify Watcher Execution Model**: Replace the ambiguous `every 250ms / debounced 150ms` with an explicit state machine or timer diagram detailing whether polling runs at interval $T_1$ and requires $N$ consecutive matching ticks, or if debounce is an elapsed-time threshold.
2. **Add a Jargon Glossary**: Add a brief table or bulleted list defining D-Bus, GNOME Introspect, Wayland compositor security constraints, X11/XWayland, and `xprop`.
3. **Specify `workspace.match.apps` Schema & Precedence**: Provide an explicit JSON schema example and declare the conflict resolution rule (e.g., first matching workspace in profile order wins).
4. **Harden Privacy / Logging Section**: Explicitly state that raw subprocess buffers from `gdbus` are parsed in memory and immediately garbage-collected without ever passing through logging formatters.
