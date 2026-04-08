import { INIT_SCRIPT } from './hooks.js';
import { buildHeadersPayload } from './inject.js';

/**
 * Run a single XSS check job. Probes once; if a hit is found, rechecks in a
 * fresh context to confirm (eliminates flaky positives).
 *
 * @param {import('playwright').Browser} browser
 * @param {{ url: string, payload: string, surface: string, param: string|null }} job
 * @param {number} timeout - Per-navigation timeout in ms
 * @returns {Promise<{ hit: boolean, sink: string|null, confirmed: boolean }>}
 */
export async function runJob(browser, job, timeout) {
  const first = await probe(browser, job, timeout);
  if (!first.hit) return { hit: false, sink: null, confirmed: false };

  const second = await probe(browser, job, timeout);
  return { hit: true, sink: first.sink, confirmed: second.hit };
}

/**
 * Single probe: open a fresh BrowserContext, navigate, and check for XSS hits.
 *
 * @param {import('playwright').Browser} browser
 * @param {{ url: string, payload: string, surface: string, param: string|null }} job
 * @param {number} timeout
 * @returns {Promise<{ hit: boolean, sink: string|null }>}
 */
async function probe(browser, job, timeout) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  let dialogSink = null;

  page.on('dialog', async (dialog) => {
    dialogSink = 'dialog';
    await dialog.dismiss().catch(() => {});
  });

  await page.addInitScript(INIT_SCRIPT);

  if (job.surface === 'headers') {
    await context.setExtraHTTPHeaders(buildHeadersPayload(job.payload));
  } else if (job.surface === 'cookies') {
    const hostname = new URL(job.url).hostname;
    await context.addCookies([{
      name: 'xss',
      value: job.payload,
      domain: hostname,
      path: '/',
    }]);
  }

  try {
    // Race: Playwright networkidle vs hard timeout
    await Promise.race([
      page.goto(job.url, { waitUntil: 'networkidle', timeout }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('hard timeout')), timeout)
      ),
    ]);
  } catch {
    // Timeout or navigation error — still check for hits that fired before abort
  }

  let hits = [];
  try {
    hits = await page.evaluate(() => window.__xss_hits ?? []);
  } catch {
    // Page may have crashed; no hits
  }

  await context.close().catch(() => {});

  const sink = dialogSink ?? (hits.length > 0 ? hits[0].sink : null);
  return { hit: sink !== null, sink };
}
