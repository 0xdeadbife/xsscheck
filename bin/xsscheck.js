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
  .parse(process.argv);

const opts = program.opts();

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
  const text = await readFile(opts.list, 'utf8');
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

  // Pipe IPC messages from scanner → emitter → TUI
  scanner.on('message', (msg) => {
    emitter.emit(msg.type, msg);
  });

  const allFindings = [];
  const allErrors = [];

  emitter.on('finding', (f) => allFindings.push(f));
  emitter.on('error', (e) => allErrors.push(e));

  // Graceful shutdown on ctrl+c
  process.on('SIGINT', async () => {
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

  // Send config to scanner
  scanner.send({ type: 'config', data: config });

  // Write report when scanner finishes
  scanner.on('message', async (msg) => {
    if (msg.type !== 'done') return;
    if (opts.output) {
      await writeReport(opts.output, {
        targets: urls.length,
        payloads: payloads.length,
        concurrency: opts.concurrency,
        duration_ms: msg.duration_ms,
      }, allFindings, allErrors).catch((err) => {
        process.stderr.write(`Warning: could not write output file: ${err.message}\n`);
      });
    }
  });

  await waitUntilExit();
  scanner.kill();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
