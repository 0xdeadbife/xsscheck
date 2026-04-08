import { chromium, firefox } from 'playwright';
import pLimit from 'p-limit';
import { enumerateJobs } from './inject.js';
import { runJob } from './worker.js';

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
process.on('message', async (msg) => {
  if (msg.type !== 'config') return;
  await runScanner(msg.data);
});

async function runScanner(config) {
  const { urls, payloads, concurrency, timeout, headful, confirmFirefox } = config;
  const startTime = Date.now();

  const browser = await chromium.launch({ headless: !headful });
  const limit = pLimit(concurrency);

  // Build full job list
  const allJobs = urls.flatMap(url => enumerateJobs(url, payloads));
  const total = allJobs.length;
  let done = 0;
  const active = new Map(); // jobIndex → { url, surface }
  const findings = [];
  const errors = [];

  function emitProgress() {
    process.send({
      type: 'progress',
      done,
      total,
      active: [...active.values()],
    });
  }

  const tasks = allJobs.map((job, i) =>
    limit(async () => {
      active.set(i, { url: job.url, surface: job.surface });
      emitProgress();

      try {
        const result = await runJob(browser, job, timeout);

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
            const ffResult = await runJob(ffBrowser, job, timeout);
            finding.firefox_confirmed = ffResult.hit;
            await ffBrowser.close().catch(() => {});
          }

          findings.push(finding);
          process.send({ type: 'finding', ...finding });
        }
      } catch (err) {
        const errorEntry = { url: job.url, message: err.message };
        errors.push(errorEntry);
        process.send({ type: 'error', ...errorEntry });
      }

      active.delete(i);
      done++;
      emitProgress();
    })
  );

  await Promise.all(tasks);
  await browser.close().catch(() => {});

  process.send({
    type: 'done',
    total,
    findings: findings.length,
    errors: errors.length,
    duration_ms: Date.now() - startTime,
  });
}
