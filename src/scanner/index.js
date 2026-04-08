import { chromium, firefox } from 'playwright';
import pLimit from 'p-limit';
import { buildSchedule, runJobWithDelay } from './scheduler.js';

/**
 * Scanner process entry point.
 * Receives a { type: 'config', data } message from the parent CLI process,
 * then runs all jobs and emits IPC messages back.
 *
 * Config shape:
 * {
 *   urls: string[],
 *   payloads: string[],
 *   concurrency: number,
 *   timeout: number,
 *   headful: boolean,
 *   confirmFirefox: boolean,
 * }
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
            url: job.url,
            param: job.param,
            surface: job.surface,
            payload: job.payload,
            sink: result.sink,
            confirmed: result.confirmed,
            firefox_confirmed: false,
          };

          // Firefox cross-check (optional)
          if (confirmFirefox && result.confirmed) {
            const ffBrowser = await firefox.launch({ headless: !headful });
            try {
              const ffResult = await runJob(ffBrowser, job, timeout);
              finding.firefox_confirmed = ffResult.hit;
            } finally {
              await ffBrowser.close().catch(() => {});
            }
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
