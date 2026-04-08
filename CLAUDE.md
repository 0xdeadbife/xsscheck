# xsscheck — Agent Guide

XSS scanner that drives a real headless Chromium browser via Playwright.
No simulated DOM — every payload is actually executed by the browser.

## Architecture at a glance

```
bin/xsscheck.js          ← CLI entry (Commander), Ink TUI, IPC parent
  │
  │  fork() + IPC
  ▼
src/scanner/index.js     ← Scanner process (child). Owns the browser lifetime.
  │
  ├─ src/scanner/scheduler.js  ← Job ordering (round-robin + shuffle) and timed execution
  ├─ src/scanner/inject.js     ← Job enumeration, URL/header/cookie payload injection
  ├─ src/scanner/worker.js     ← Single-job probe (opens a BrowserContext, navigates, checks hits)
  └─ src/scanner/hooks.js      ← Browser-side init script (hooks alert/fetch/XHR/console.error)

src/tui/
  App.js         ← Root Ink component, consumes EventEmitter
  ProgressBar.js ← [██░░] done/total bar
  WorkerList.js  ← Live list of in-flight jobs
  Findings.js    ← Findings + error log

src/payload.js   ← Load payload file (strips blank lines and # comments)
src/output.js    ← Write JSON report to disk
```

## Process model

The CLI and the scanner run in **separate Node processes** connected via `child_process.fork()` IPC.

```
Parent (bin/xsscheck.js)            Child (src/scanner/index.js)
─────────────────────────           ──────────────────────────────
fork() ───────────────────────────►
       { type: 'config', data: … } ──────────────────────────────►  runScanner()

                                    ◄──  { type: 'progress', done, total, active }
                                    ◄──  { type: 'finding', url, param, surface, … }
                                    ◄──  { type: 'error', url, message }
                                    ◄──  { type: 'done', total, findings, errors, duration_ms }

IPC messages land on scanner.on('message') in the parent,
which re-emits them on an EventEmitter that the Ink TUI listens to.
```

## IPC config message schema

Sent once from parent → child immediately after fork:

```js
{
  type: 'config',
  data: {
    urls: string[],          // target URLs (at least one)
    payloads: string[],      // XSS payload strings
    concurrency: number,     // p-limit worker count (default 5)
    timeout: number,         // per-navigation timeout ms (default 8000)
    headful: boolean,        // show browser UI (default false)
    confirmFirefox: boolean, // re-verify hits in Firefox (default false)
    delayMin: number,        // min random pre-request delay ms (default 50)
    delayMax: number,        // max random pre-request delay ms (default 300)
    maxRetries: number,      // max retries on 429 / rate-limit (default 2)
  }
}
```

## Job shape

Every unit of work is a **job**:

```js
{
  url: string,        // fully-formed URL to navigate to (payload already injected for url_param surface)
  payload: string,    // raw XSS payload string
  surface: 'url_param' | 'headers' | 'cookies',
  param: string|null, // query param name for url_param surface; null otherwise
}
```

## Surfaces (injection points)

| Surface | What is mutated | How |
|---------|----------------|-----|
| `url_param` | One query parameter value | `URL.searchParams.set()` or raw string injection for pre-encoded payloads |
| `headers` | `Referer`, `X-Forwarded-For`, `User-Agent` | `context.setExtraHTTPHeaders()` |
| `cookies` | All cookies the server sets on a preflight request | `context.addCookies()` with values replaced by payload |

## Scanning pipeline

```
enumerateJobs(url, payloads)
  └─ for each payload × each surface (url params + headers + cookies)
     → produces a flat Job[]

buildSchedule(urls, payloads)           [scheduler.js]
  └─ calls enumerateJobs per URL
  └─ Fisher-Yates shuffle each URL's jobs independently
  └─ round-robin interleave across URLs
  → final ordered Job[] (less noisy — no URL gets hammered sequentially)

runJobWithDelay(browser, job, timeout, opts)   [scheduler.js]
  └─ random sleep(delayMin..delayMax) before each job
  └─ calls runJob()
  └─ on 429/rate-limit: exponential backoff up to maxRetries, capped at 5s

runJob(browser, job, timeout)           [worker.js]
  └─ probe() ×1 — if hit → probe() ×2 to confirm (eliminates flukes)

probe(browser, job, timeout)            [worker.js]
  └─ browser.newContext()
  └─ page.addInitScript(INIT_SCRIPT)   [hooks.js]
  └─ inject surface-specific payload
  └─ page.goto(url, { waitUntil: 'networkidle' })
  └─ read window.__xss_hits + Playwright dialog events
  → { hit: boolean, sink: string|null }
```

## Hit detection

The browser-side `INIT_SCRIPT` (see `src/scanner/hooks.js`) is injected before every navigation via `page.addInitScript()`. It monkey-patches:

- `window.alert / confirm / prompt` → `sink: 'dialog'`
- `window.fetch` → `sink: 'fetch'`
- `XMLHttpRequest.prototype.open` → `sink: 'xhr'`
- `console.error` → `sink: 'console.error'`

All hits are written to `window.__xss_hits[]`. After navigation, `worker.js` reads them with `page.evaluate(() => window.__xss_hits)`.

Playwright-level dialog events (via `page.on('dialog')`) are also captured as a secondary mechanism. If both fire, the Playwright event takes priority.

## Finding shape

Emitted via IPC `{ type: 'finding', … }` and written to the JSON report:

```js
{
  url: string,
  param: string|null,
  surface: 'url_param' | 'headers' | 'cookies',
  payload: string,
  sink: 'dialog' | 'fetch' | 'xhr' | 'console.error',
  confirmed: boolean,        // true if a second probe also triggered
  firefox_confirmed: boolean, // true if --confirm-firefox and Firefox also triggered
}
```

## JSON report schema (`--output <file>`)

```json
{
  "meta": {
    "date": "ISO-8601 timestamp",
    "targets": 3,
    "payloads": 20,
    "concurrency": 5,
    "duration_ms": 12400
  },
  "findings": [ ...Finding[] ],
  "errors": [ { "url": "...", "message": "..." } ]
}
```

## CLI flags

```
--url <url>          Single target URL
--list <file>        File with one URL per line (mutually exclusive with --url)
--payloads <file>    Payload wordlist (default: ./payloads.txt)
--output <file>      Write JSON report to file
--concurrency <n>    Parallel browser contexts (default: 5)
--timeout <ms>       Per-navigation timeout (default: 8000)
--headful            Show browser UI
--confirm-firefox    Re-verify confirmed hits in Firefox
--delay-min <ms>     Min random delay between requests (default: 50)
--delay-max <ms>     Max random delay between requests (default: 300)
--max-retries <n>    Max retries on 429 / rate-limit (default: 2)
```

## Key conventions

- **ESM throughout** (`"type": "module"` in package.json). Use `import/export`, not `require`.
- **Node ≥ 22** required.
- **No transpile step** — source runs directly.
- **IPC errors are swallowed** with `try { process.send(…) } catch { /* IPC closed */ }` — the parent may exit before the child finishes.
- **Pre-encoded payloads** (containing `%XX`) are injected raw into URL strings to avoid double-encoding. See `inject.js:injectUrlParam`.
- **Tests** live in `test/` (unit) and `test/integration/` (integration). Run with `npm test` / `npm run test:integration`.
