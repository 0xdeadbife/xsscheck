import { enumerateJobs } from './inject.js';
import { runJob } from './worker.js';

/**
 * Fisher-Yates in-place shuffle.
 * @param {any[]} arr
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build a job schedule that interleaves URLs via round-robin, with each
 * URL's payloads in randomized order.
 *
 * @param {string[]} urls
 * @param {string[]} payloads
 * @returns {Array<{url: string, payload: string, surface: string, param: string|null}>}
 */
export function buildSchedule(urls, payloads) {
  const queues = urls.map(url => shuffle(enumerateJobs(url, payloads)));

  const result = [];
  let remaining = queues.filter(q => q.length > 0);
  while (remaining.length > 0) {
    const next = [];
    for (const q of remaining) {
      result.push(q.shift());
      if (q.length > 0) next.push(q);
    }
    remaining = next;
  }
  return result;
}

/**
 * Run a job with a random pre-request delay and automatic retry on 429s.
 *
 * @param {import('playwright').Browser} browser
 * @param {{ url: string, payload: string, surface: string, param: string|null }} job
 * @param {number} timeout
 * @param {{ delayMin: number, delayMax: number, maxRetries: number }} opts
 * @returns {Promise<{ hit: boolean, sink: string|null, confirmed: boolean }>}
 */
export async function runJobWithDelay(browser, job, timeout, opts) {
  const { delayMin, delayMax, maxRetries } = opts;

  // Random pre-request delay
  const delay = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
  await sleep(delay);

  let attempt = 0;
  while (true) {
    try {
      return await runJob(browser, job, timeout);
    } catch (err) {
      const isRateLimit = /429|rate.?limit/i.test(String(err?.message ?? err));
      if (isRateLimit && attempt < maxRetries) {
        const backoff = Math.min(delayMax * Math.pow(2, attempt) + Math.floor(Math.random() * 200), 5000);
        await sleep(backoff);
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
