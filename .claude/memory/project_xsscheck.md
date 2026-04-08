---
name: xsscheck project context
description: Context for the xsscheck CLI XSS validator project
type: project
---

xsscheck is a personal CLI XSS validator tool (bug bounty / pentest / local dev testing) built with Node.js 22+, Playwright (Chromium), Ink 5 TUI, p-limit, and commander.

Architecture: process-split — CLI (Ink TUI) forks scanner child process, IPC via process.send/process.on('message').

Injection surfaces: URL params, HTTP headers (Referer/X-Forwarded-For/User-Agent), cookies.
Payload file: external only (./payloads.txt default, override with --payloads).
Concurrency default: 5 workers.
No build step — pure ESM JS with React.createElement (no JSX transpiler).

**Why:** Personal tool for bug bounty/pentest/local dev. Clean TUI output is important. Accuracy over speed.

**How to apply:** Keep it lean — no build tooling, no extra deps, no form injection or crawling (future scope).

Spec: docs/superpowers/specs/2026-04-08-xsscheck-design.md
Plan: docs/superpowers/plans/2026-04-08-xsscheck.md
