# xsscheck — Design Spec
**Date:** 2026-04-08
**Status:** Approved

---

## Overview

`xsscheck` is a CLI tool for accurate XSS validation using a real headless Chromium browser. Designed for bug bounty, pentest, and local development testing. It injects payloads into URL parameters, HTTP headers, and cookies, then detects execution via real browser event hooks — not pattern matching.

---

## Goals

- Real browser execution only — no fake/heuristic detection
- Fast but accurate — favor correctness, recheck positives
- Clean terminal UX — Ink-based TUI, readable at a glance
- Personal use — no heavy install ergonomics needed

---

## Architecture & Process Model

Two processes communicate via Node.js IPC (`process.send` / `process.on('message')`):

```
┌─────────────────────────────────────────────────┐
│  CLI entry (bin/xsscheck.js)                    │
│  - parses args (url/list, payloads, flags)      │
│  - spawns scanner as child_process              │
│  - mounts Ink TUI, listens on IPC              │
└────────────────┬────────────────────────────────┘
                 │ IPC (JSON messages)
┌────────────────▼────────────────────────────────┐
│  Scanner process (src/scanner/index.js)         │
│  - owns worker pool (p-limit, default 5)        │
│  - manages Playwright browser lifecycle         │
│  - emits: progress | finding | error | done     │
└─────────┬──────────────┬──────────────┬─────────┘
          │              │              │
     Worker 1       Worker 2       Worker 3
   (browser ctx) (browser ctx) (browser ctx)
```

**Key decisions:**
- One shared Chromium browser instance; isolated `BrowserContext` per worker
- IPC uses native `child_process` — no extra transport libs
- Scanner exits with a summary payload; TUI drains remaining messages then unmounts
- TUI crashes never affect the scanner; scanner crashes are caught and reported to TUI

---

## CLI Interface

```
xsscheck [options]

  --url <url>             Single target URL
  --list <file>           File containing one URL per line
  --payloads <file>       Payload wordlist (default: ./payloads.txt)
  --output <file>         Write JSON results to file
  --concurrency <n>       Worker count (default: 5)
  --headful               Run browser in headful mode (debug)
  --confirm-firefox       Re-verify confirmed hits in Firefox (off by default)
  --timeout <ms>          Per-request timeout (default: 8000)
```

`--url` and `--list` are mutually exclusive. One is required.

---

## Injection Surfaces

For each (URL, payload) pair, the payload is injected into:

1. **URL parameters** — each query param value is substituted one at a time
2. **HTTP headers** — `Referer`, `X-Forwarded-For`, `User-Agent`
3. **Cookies** — any cookies present on the initial request are payload-substituted

Headers and cookies are set via Playwright's `route` interception or `context.setExtraHTTPHeaders` / `context.addCookies`.

---

## Payload File

- Default location: `./payloads.txt` (relative to cwd)
- Override: `--payloads <path>`
- Format: one payload per line, blank lines and `#` comments ignored
- No built-in payload list is shipped with the tool

---

## Detection Model

### Init Script Hooks

Injected via `page.addInitScript()` before every navigation:

```js
window.__xss_hits = [];

// Dialog sinks
const _alert = window.alert;
window.alert = window.confirm = window.prompt = (m) => {
  window.__xss_hits.push({ sink: 'dialog', value: String(m) });
};

// Fetch sink
const _fetch = window.fetch;
window.fetch = (...args) => {
  window.__xss_hits.push({ sink: 'fetch', args: args.map(String) });
  return _fetch(...args);
};

// XHR sink
const _open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(...args) {
  window.__xss_hits.push({ sink: 'xhr', args: args.map(String) });
  return _open.apply(this, args);
};

// Console error capture
const _cerr = console.error;
console.error = (...args) => {
  window.__xss_hits.push({ sink: 'console.error', args: args.map(String) });
  _cerr(...args);
};
```

### Parallel Event Listeners

In addition to the init script, each page registers:
- `page.on('dialog')` — catches native alert/confirm/prompt dialogs (dismiss immediately)
- `page.on('pageerror')` — catches uncaught JS errors (may indicate partial execution)

### Wait Strategy

After navigation, wait for whichever resolves first:
- `networkidle` (Playwright built-in)
- `domcontentloaded` + 1500ms cap

No fixed `sleep()` calls.

### Execution Flow Per (URL, Payload) Pair

1. Acquire worker slot from pool
2. Create fresh `BrowserContext`
3. Inject init script
4. Navigate to URL with payload applied to the current surface
5. Wait (network idle or cap)
6. Evaluate `window.__xss_hits` — any entries = candidate hit
7. Also check dialog/pageerror listeners
8. **On candidate hit:** emit `finding` (unconfirmed) to TUI, then recheck once in a new fresh context
9. **Confirmed hit:** emit `finding` (confirmed: true) to TUI
10. Destroy context, release worker slot

### Firefox Confirmation (`--confirm-firefox`)

When enabled, any confirmed Chromium hit is re-run once in Firefox (`playwright.firefox`). Result noted in findings but does not gate the confirmed status.

---

## IPC Message Types

All messages are JSON objects sent from scanner → TUI via `process.send()`.

| Type | Payload |
|------|---------|
| `progress` | `{ done, total, active: [{ url, param }] }` |
| `finding` | `{ url, param, payload, sink, confirmed }` |
| `error` | `{ url, message }` |
| `done` | `{ total, findings, duration_ms }` |

---

## TUI Layout (Ink)

```
xsscheck v1.0.0  ▸  target: hackerone.com  ▸  payloads: 42  ▸  workers: 5

  [████████████░░░░░░░░]  61/120  51%

  ● running   https://example.com/search?q=...
  ● running   https://example.com/redirect?url=...
  ✓ done      https://example.com/about

  FINDINGS (2)
  ─────────────────────────────────────────────────
  ⚡ VULN  https://example.com/search?q=<script>alert(1)</script>
           sink: dialog  param: q  confirmed: yes

  ⚡ VULN  https://example.com/redir?url=javascript:alert(1)
           sink: dialog  param: url  confirmed: yes
  ─────────────────────────────────────────────────

  [ctrl+c to stop]
```

- Progress bar is real-time
- Active worker list shows last N active requests (N = concurrency)
- Findings accumulate and never scroll away
- Errors shown in dim gray, separate from findings
- On `done`, show summary line and exit cleanly

---

## JSON Output (`--output <file>`)

Written to file at process exit. Not printed to stdout.

```json
{
  "meta": {
    "date": "2026-04-08T12:00:00Z",
    "targets": 120,
    "payloads": 42,
    "concurrency": 5,
    "duration_ms": 4821
  },
  "findings": [
    {
      "url": "https://example.com/search?q=<script>alert(1)</script>",
      "param": "q",
      "surface": "url_param",
      "payload": "<script>alert(1)</script>",
      "sink": "dialog",
      "confirmed": true,
      "firefox_confirmed": false
    }
  ],
  "errors": [
    { "url": "https://example.com/slow", "message": "Timeout after 8000ms" }
  ]
}
```

---

## Project Structure

```
xsscheck/
├── bin/
│   └── xsscheck.js          # CLI entry, spawns scanner, mounts TUI
├── src/
│   ├── scanner/
│   │   ├── index.js         # Scanner process entry, worker pool
│   │   ├── worker.js        # Single (URL, payload, surface) execution unit
│   │   ├── inject.js        # URL/header/cookie payload injection helpers
│   │   └── hooks.js         # Init script string (browser-side hooks)
│   ├── tui/
│   │   ├── App.js           # Root Ink component
│   │   ├── ProgressBar.js   # Animated progress bar
│   │   ├── WorkerList.js    # Active worker status
│   │   └── Findings.js      # Findings display
│   └── output.js            # JSON report writer
├── payloads.txt             # Default payload list (user-provided)
├── package.json
└── docs/
    └── superpowers/specs/
        └── 2026-04-08-xsscheck-design.md
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `playwright` | Headless Chromium (+ optional Firefox) |
| `ink` | React-based TUI |
| `react` | Required by Ink |
| `p-limit` | Worker pool / concurrency limiter |
| `commander` | CLI argument parsing |

---

## Out of Scope

- Form input injection (future)
- Crawling / link discovery (future)
- Authentication / session management
- Proxy integration
- Built-in payload list
