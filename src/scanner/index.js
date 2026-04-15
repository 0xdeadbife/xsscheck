import { chromium, firefox } from 'playwright';
import pLimit from 'p-limit';
import { buildSchedule, runJobWithDelay } from './scheduler.js';
import { runJob } from './worker.js';

/**
 * Scanner process entry point (runs as a forked child process).
 *
 * Lifecycle:
 *   1. Waits for exactly one { type: 'config', data } IPC message from the parent.
 *   2. Launches Chromium, builds the job schedule, runs all jobs concurrently
 *      (up to `concurrency` at a time via p-limit).
 *   3. Streams IPC messages back to the parent as results arrive:
 *        { type: 'progress', done, total, active }
 *        { type: 'finding', url, param, surface, payload, sink, confirmed, firefox_confirmed }
 *        { type: 'error', url, message }
 *        { type: 'done', total, findings, errors, duration_ms }
 *   4. Closes the browser and exits.
 *
 * All process.send() calls are wrapped in try/catch because the parent may
 * exit (SIGINT) before the child finishes, closing the IPC channel.
 *
 * Config shape: see CLAUDE.md → "IPC config message schema"
 */
process.once('message', (msg) => {
  if (msg.type !== 'config') return;
  runScanner(msg.data).catch((err) => {
    try { process.send({ type: 'error', url: null, message: String(err?.message ?? err) }); } catch { /* IPC closed */ }
    try { process.send({ type: 'done', total: 0, findings: 0, errors: 1, duration_ms: 0 }); } catch { /* IPC closed */ }
  });
});

async function runScanner(config) {
  const { urls, payloads, concurrency, timeout, headful, confirmFirefox, delayMin, delayMax, maxRetries } = config;
  const startTime = Date.now();

  const browser = await chromium.launch({ headless: !headful });
  const ffBrowser = confirmFirefox ? await firefox.launch({ headless: !headful }) : null;
  const limit = pLimit(concurrency);

  // Build full job list (round-robin across URLs, shuffled per URL)
  const allJobs = buildSchedule(urls, payloads);
  const total = allJobs.length;
  let done = 0;
  const active = new Map(); // jobIndex → { url, surface }
  const findings = [];
  const errors = [];

  function emitProgress() {
    try {
      process.send({
        type: 'progress',
        done,
        total,
        active: [...active.values()],
      });
    } catch {
      // IPC channel closed (parent process exited)
    }
  }

  const tasks = allJobs.map((job, i) =>
    limit(async () => {
      active.set(i, { url: job.url, surface: job.surface });
      emitProgress();

      try {
        const result = await runJobWithDelay(browser, job, timeout, { delayMin, delayMax, maxRetries });

        if (result.hit) {
          const finding = {
            url: job.baseUrl ?? job.url,
            param: job.param,
            surface: job.surface,
            payload: job.payload,
            sink: result.sink,
            confirmed: result.confirmed,
            firefox_confirmed: false,
          };

          // Firefox cross-check (optional)
          if (ffBrowser && result.confirmed) {
            const ffResult = await runJob(ffBrowser, job, timeout);
            finding.firefox_confirmed = ffResult.hit;
          }

          findings.push(finding);
          try {
            process.send({ type: 'finding', ...finding });
          } catch { /* IPC closed */ }
        }
      } catch (err) {
        const errorEntry = { url: job.url, message: String(err?.message ?? err) };
        errors.push(errorEntry);
        try { process.send({ type: 'error', ...errorEntry }); } catch { /* IPC closed */ }
      } finally {
        active.delete(i);
        done++;
        emitProgress();
      }
    })
  );

  try {
    await Promise.all(tasks);
  } finally {
    await browser.close().catch(() => {});
    await ffBrowser?.close().catch(() => {});
  }

  try {
    process.send({
      type: 'done',
      total,
      findings: findings.length,
      errors: errors.length,
      duration_ms: Date.now() - startTime,
    });
  } catch { /* IPC closed */ }
}
