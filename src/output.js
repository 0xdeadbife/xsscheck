import { writeFile } from 'node:fs/promises';

/**
 * Write a JSON report to disk.
 * @param {string} outputPath
 * @param {{ targets: number, payloads: number, concurrency: number, duration_ms: number }} meta
 * @param {Array<{url: string, param: string|null, payload: string, surface: string, sink: string, confirmed: boolean, firefox_confirmed: boolean}>} findings
 * @param {Array<{url: string, message: string}>} errors
 */
export async function writeReport(outputPath, meta, findings, errors) {
  const report = {
    meta: { date: new Date().toISOString(), ...meta },
    findings,
    errors,
  };
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
}
