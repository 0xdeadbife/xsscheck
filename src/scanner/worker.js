import { INIT_SCRIPT } from './hooks.js';
import { buildHeadersPayload, buildCookiesPayload } from './inject.js';

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
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
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
      // Preflight: collect cookies the server sets on a normal request
      const preflight = await browser.newContext({ ignoreHTTPSErrors: true });
      let existingCookies = [];
      try {
        const pfPage = await preflight.newPage();
        await pfPage.goto(job.url, { waitUntil: 'domcontentloaded', timeout }).catch(() => {});
        existingCookies = await preflight.cookies();
      } finally {
        await preflight.close().catch(() => {});
      }

      const hostname = new URL(job.url).hostname;
      const cookiesToInject = existingCookies.length > 0
        ? buildCookiesPayload(existingCookies, job.payload)
        : [{ name: 'xss', value: job.payload, domain: hostname, path: '/' }];

      try {
        await context.addCookies(cookiesToInject);
      } catch {
        // Payload contains characters invalid in cookie values (e.g. <, >, ").
        // If the browser rejects the cookie, the payload can't execute via this
        // surface anyway — skip rather than error.
        return { hit: false, sink: null };
      }
    }

    let hardTimeoutId;
    const hardTimeoutPromise = new Promise((_, reject) => {
      hardTimeoutId = setTimeout(() => reject(new Error('hard timeout')), timeout + 1000);
    });

    try {
      await Promise.race([
        page.goto(job.url, { waitUntil: 'networkidle', timeout }),
        hardTimeoutPromise,
      ]);
    } catch {
      // Timeout or navigation error — still check for hits that fired before abort
    } finally {
      clearTimeout(hardTimeoutId);
    }

    let hits = [];
    try {
      // Collect hits from every frame (main + iframes) — INIT_SCRIPT runs in
      // all frames, each with its own window.__xss_hits array.
      hits = (await Promise.all(
        page.frames().map(f => f.evaluate(() => window.__xss_hits ?? []).catch(() => []))
      )).flat();
    } catch {
      // Page may have crashed; no hits
    }

    // Playwright-level dialog events (dialogSink) and INIT_SCRIPT hooks both capture dialog sinks.
    // dialogSink takes priority via ?? — if both fired, we prefer the Playwright event.
    const sink = dialogSink ?? (hits.length > 0 ? hits[0].sink : null);
    return { hit: sink !== null, sink };
  } finally {
    await context.close().catch(() => {});
  }
}
