# xsscheck

XSS scanner powered by a real headless browser. No pattern matching — payloads are actually executed.

Most XSS scanners simulate the DOM or match response text. xsscheck drives a real Chromium instance via Playwright: every payload is injected, the page navigates, and JavaScript runs. A hit means something actually executed.

---

## Features

- **Real browser execution** — Chromium (headless or headful), no heuristics
- **Three injection surfaces** — URL parameters, HTTP headers, cookies
- **Double-probe confirmation** — candidate hits are re-tested in a fresh context to eliminate false positives
- **Firefox cross-check** — optionally re-verify confirmed hits in Firefox
- **Stealth scheduling** — round-robin across targets, randomized delays, exponential backoff on 429s
- **Live TUI** — real-time progress bar, active workers, and findings via Ink
- **JSON output** — machine-readable report with full finding metadata

---

## Requirements

- Node.js ≥ 22
- Chromium (via Playwright)

```sh
npx playwright install chromium
# also needed if using --confirm-firefox:
npx playwright install firefox
```

---

## Install

```sh
git clone https://github.com/yourname/xsscheck.git
cd xsscheck
npm install
npx playwright install chromium
```

To use as a global command:

```sh
npm link
```

---

## Usage

```sh
# Scan a single URL
xsscheck --url "https://example.com/search?q=test" --payloads payloads.txt

# Scan a list of URLs
xsscheck --list targets.txt --payloads payloads.txt

# Save results to a JSON file
xsscheck --url "https://example.com/search?q=test" --payloads payloads.txt --output results.json
```

---

## Injection surfaces

For each (URL, payload) pair, the payload is injected into all three surfaces independently:

| Surface      | What is mutated                            | Mechanism                          |
|--------------|--------------------------------------------|------------------------------------|
| `url_param`  | Each query parameter value, one at a time  | `URL.searchParams.set()` or raw injection for pre-encoded payloads |
| `headers`    | `Referer`, `X-Forwarded-For`, `User-Agent` | `context.setExtraHTTPHeaders()`    |
| `cookies`    | All cookies set by the server on preflight | `context.addCookies()` with values replaced |

---

## Detection model

Before each navigation, xsscheck injects an init script that monkey-patches `alert`, `confirm`, `prompt`, `window.fetch`, `XMLHttpRequest.prototype.open`, and `console.error`. Any call to these sinks writes to `window.__xss_hits[]`, which is read after the page settles.

Playwright-level `dialog` events are captured in parallel as a secondary mechanism.

On a candidate hit, the job is re-run once in a fresh `BrowserContext`. Only hits that trigger on both probes are reported as confirmed.

Detected sinks: `dialog`, `fetch`, `xhr`, `console.error`.

---

## Stealth scheduling

Jobs are shuffled per-target and round-robined across all URLs, so no single host receives sequential requests. A random delay (configurable with `--delay-min` / `--delay-max`) is applied before each job. On HTTP 429 or rate-limit responses, xsscheck backs off exponentially up to `--max-retries` attempts.

---

## Flags

| Flag                  | Default         | Description                                              |
|-----------------------|-----------------|----------------------------------------------------------|
| `--url <url>`         | —               | Single target URL (mutually exclusive with `--list`)     |
| `--list <file>`       | —               | File with one URL per line                               |
| `--payloads <file>`   | `./payloads.txt`| Payload wordlist                                         |
| `--output <file>`     | —               | Write JSON report to file                                |
| `--concurrency <n>`   | `5`             | Parallel browser contexts                                |
| `--timeout <ms>`      | `8000`          | Per-navigation timeout                                   |
| `--headful`           | `false`         | Show the browser window                                  |
| `--confirm-firefox`   | `false`         | Re-verify confirmed hits in Firefox                      |
| `--delay-min <ms>`    | `50`            | Minimum random delay between requests                    |
| `--delay-max <ms>`    | `300`           | Maximum random delay between requests                    |
| `--max-retries <n>`   | `2`             | Retries on 429 / rate-limit responses                    |

---

## Payload file

One payload per line. Blank lines and lines starting with `#` are ignored.

```
<script>alert(1)</script>
"><script>alert(document.domain)</script>
<img src=x onerror=alert(1)>
<svg onload=alert(1)>
javascript:alert(1)
# WAF bypass variants below
```

No built-in wordlist is included. Bring your own.

---

## JSON output

When `--output` is specified, a report is written at process exit:

```json
{
  "meta": {
    "date": "2026-04-08T12:00:00.000Z",
    "targets": 3,
    "payloads": 20,
    "concurrency": 5,
    "duration_ms": 12400
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

## License

MIT