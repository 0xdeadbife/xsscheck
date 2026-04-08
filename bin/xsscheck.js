#!/usr/bin/env node
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from '../src/tui/App.js';
import { loadPayloads } from '../src/payload.js';
import { writeReport } from '../src/output.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();
program
  .name('xsscheck')
  .description('XSS validator using real headless browser execution')
  .option('--url <url>', 'Single target URL')
  .option('--list <file>', 'File with one URL per line')
  .option('--payloads <file>', 'Payload wordlist (default: ./payloads.txt)')
  .option('--output <file>', 'Write JSON report to file')
  .option('--concurrency <n>', 'Worker count', (v) => parseInt(v, 10), 5)
  .option('--headful', 'Run browser in headful mode', false)
  .option('--confirm-firefox', 'Re-verify hits in Firefox', false)
  .option('--timeout <ms>', 'Per-request timeout in ms', (v) => parseInt(v, 10), 8000)
  .option('--delay-min <ms>', 'Min random delay between requests in ms', (v) => parseInt(v, 10), 50)
  .option('--delay-max <ms>', 'Max random delay between requests in ms', (v) => parseInt(v, 10), 300)
  .option('--max-retries <n>', 'Max retries on 429 / rate-limit', (v) => parseInt(v, 10), 2)
  .parse(process.argv);

const opts = program.opts();

if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
  console.error('Error: --concurrency must be a positive integer');
  process.exit(1);
}
if (!Number.isInteger(opts.timeout) || opts.timeout < 1) {
  console.error('Error: --timeout must be a positive integer');
  process.exit(1);
}
if (!Number.isInteger(opts.delayMin) || opts.delayMin < 0) {
  console.error('Error: --delay-min must be a non-negative integer');
  process.exit(1);
}
if (!Number.isInteger(opts.delayMax) || opts.delayMax < 0) {
  console.error('Error: --delay-max must be a non-negative integer');
  process.exit(1);
}
if (opts.delayMin > opts.delayMax) {
  console.error('Error: --delay-min must be <= --delay-max');
  process.exit(1);
}
if (!Number.isInteger(opts.maxRetries) || opts.maxRetries < 0) {
  console.error('Error: --max-retries must be a non-negative integer');
  process.exit(1);
}

// Validate: --url and --list are mutually exclusive; one is required
if (!opts.url && !opts.list) {
  console.error('Error: provide --url <url> or --list <file>');
  process.exit(1);
}
if (opts.url && opts.list) {
  console.error('Error: --url and --list are mutually exclusive');
  process.exit(1);
}

// Load URLs
async function loadUrls() {
  if (opts.url) return [opts.url];
  const text = await readFile(opts.list, 'utf8').catch((err) => {
    if (err.code === 'ENOENT') {
      console.error(`Error: URL list file not found: ${opts.list}`);
      process.exit(1);
    }
    throw err;
  });
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
}

// Resolve payload file
function resolvePayloadFile() {
  if (opts.payloads) return opts.payloads;
  const defaultPath = path.resolve(process.cwd(), 'payloads.txt');
  if (!existsSync(defaultPath)) {
    console.error('Error: no payload file found. Provide --payloads <file> or create ./payloads.txt');
    process.exit(1);
  }
  return defaultPath;
}

async function main() {
  const urls = await loadUrls();
  if (urls.length === 0) {
    console.error('Error: URL list is empty after filtering');
    process.exit(1);
  }
  const payloadFile = resolvePayloadFile();
  const payloads = await loadPayloads(payloadFile);

  if (payloads.length === 0) {
    console.error('Error: payload file is empty');
    process.exit(1);
  }

  const config = {
    urls,
    payloads,
    concurrency: opts.concurrency,
    timeout: opts.timeout,
    headful: opts.headful,
    confirmFirefox: opts.confirmFirefox,
    delayMin: opts.delayMin,
    delayMax: opts.delayMax,
    maxRetries: opts.maxRetries,
  };

  const emitter = new EventEmitter();
  const target = opts.url ?? opts.list;

  // Mount Ink TUI
  const { waitUntilExit } = render(
    React.createElement(App, {
      emitter,
      target,
      payloadCount: payloads.length,
      concurrency: opts.concurrency,
    })
  );

  // Fork scanner child process
  const scanner = fork(
    path.resolve(__dirname, '../src/scanner/index.js'),
    { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }
  );

  const allFindings = [];
  const allErrors = [];

  emitter.on('finding', (f) => allFindings.push(f));
  emitter.on('error', (e) => allErrors.push(e));

  // Graceful shutdown on ctrl+c
  let shuttingDown = false;
  process.on('SIGINT', async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    scanner.kill();
    if (opts.output) {
      await writeReport(opts.output, {
        targets: urls.length,
        payloads: payloads.length,
        concurrency: opts.concurrency,
        duration_ms: 0,
      }, allFindings, allErrors).catch(() => {});
    }
    process.exit(0);
  });

  // Pipe IPC messages from scanner → emitter → TUI
  scanner.on('message', async (msg) => {
    if (msg.type === 'done' && opts.output) {
      await writeReport(opts.output, {
        targets: urls.length,
        payloads: payloads.length,
        concurrency: opts.concurrency,
        duration_ms: msg.duration_ms,
      }, allFindings, allErrors).catch((err) => {
        process.stderr.write(`Warning: could not write output file: ${err.message}\n`);
      });
    }
    emitter.emit(msg.type, msg);
  });

  // Emit a synthetic done if the scanner crashes so the TUI doesn't hang
  scanner.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      emitter.emit('done', { total: 0, findings: 0, errors: 1, duration_ms: 0 });
    }
  });

  // Send config to scanner
  scanner.send({ type: 'config', data: config });

  await waitUntilExit();
  scanner.kill();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
