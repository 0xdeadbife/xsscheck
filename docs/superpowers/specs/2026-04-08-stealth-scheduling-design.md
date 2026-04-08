# Stealth Scheduling — Design Spec

**Date:** 2026-04-08  
**Status:** Approved

## Problem

The current scanner blasts all payloads against one URL before moving to the next. With 20 payloads × 3 surfaces = 60 requests in rapid succession to the same target, this is easily detected by WAFs and IDS systems. The goal is to make the scan pattern less recognizable and reduce server load without significantly impacting total scan time.

## Goals

- Interleave requests across URLs (round-robin)
- Randomize payload order per URL (shuffle)
- Add a small random delay between each request
- Auto-backoff on 429 / rate-limit responses
- No required flags — all new params have sensible defaults

## Architecture

### New module: `src/scanner/scheduler.js`

Single responsibility: decide **what runs** and **when**.

Exports two functions:

#### `buildSchedule(urls, payloads) → Job[]`

Produces the final ordered job list:

1. Call `enumerateJobs(url, payloads)` for each URL — no change to `inject.js`
2. Fisher-Yates shuffle each URL's job list independently
3. Interleave with round-robin: take 1 job from URL1, 1 from URL2, ... repeat until all lists are exhausted

Result: requests to the same URL are spread apart in time proportional to the number of URLs being scanned.

#### `runJobWithDelay(browser, job, timeout, opts) → Promise<Result>`

Wraps `runJob` from `worker.js`:

1. **Pre-request delay:** `await sleep(rand(opts.delayMin, opts.delayMax))` before every job
2. **Execute:** calls `runJob(browser, job, timeout)`
3. **Backoff on rate-limit:** if the error message contains `429` or `rate limit` (case-insensitive), retries up to `opts.maxRetries` times with exponential backoff: `delay = min(baseDelay * 2^attempt + jitter, 5000)ms`. `baseDelay` = `opts.delayMax`, jitter = random 0–200ms.
4. **Other errors:** propagate immediately — no retry

### Changes to `src/scanner/index.js`

- Replace `urls.flatMap(url => enumerateJobs(url, payloads))` with `buildSchedule(urls, payloads)`
- Replace `runJob(...)` call with `runJobWithDelay(browser, job, timeout, { delayMin, delayMax, maxRetries })`
- Destructure `delayMin`, `delayMax`, `maxRetries` from config

### Changes to `bin/xsscheck.js`

Add three optional CLI flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--delay-min <ms>` | `50` | Minimum pre-request delay |
| `--delay-max <ms>` | `300` | Maximum pre-request delay |
| `--max-retries <n>` | `2` | Max retries on 429 |

Add validation: `delayMin <= delayMax`, both non-negative integers.

Pass `delayMin`, `delayMax`, `maxRetries` in the IPC config message.

## Performance Impact

With `concurrency=5` and `delayMax=300ms`, the expected delay overhead is roughly `300ms / 5 = 60ms` amortized per job across the pool. For a 100-job scan this adds ~6s worst case — acceptable.

Backoff only triggers on actual 429s, which are rare in normal scans.

## Files Changed

| File | Change |
|------|--------|
| `src/scanner/scheduler.js` | **New** — `buildSchedule`, `runJobWithDelay` |
| `src/scanner/index.js` | Use `buildSchedule`, `runJobWithDelay`, destructure new config fields |
| `bin/xsscheck.js` | Add 3 optional flags, pass them in config |

## Out of Scope

- Configurable scheduling strategy (round-robin is the only mode)
- Per-domain rate limiting (all URLs share the same delay range)
- Persistent state / resumable scans
