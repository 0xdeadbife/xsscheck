import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeReport } from '../src/output.js';

test('writeReport writes valid JSON to disk', async () => {
  const path = join(tmpdir(), 'xsscheck-test-output.json');
  const meta = { targets: 10, payloads: 5, concurrency: 3, duration_ms: 1234 };
  const findings = [
    {
      url: 'https://example.com/?q=<script>',
      param: 'q',
      surface: 'url_param',
      payload: '<script>alert(1)</script>',
      sink: 'dialog',
      confirmed: true,
      firefox_confirmed: false,
    },
  ];
  const errors = [{ url: 'https://example.com/slow', message: 'Timeout' }];

  await writeReport(path, meta, findings, errors);

  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);

  assert.equal(parsed.meta.targets, 10);
  assert.equal(parsed.meta.payloads, 5);
  assert.equal(parsed.meta.concurrency, 3);
  assert.equal(parsed.meta.duration_ms, 1234);
  assert.ok(typeof parsed.meta.date === 'string');
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].param, 'q');
  assert.equal(parsed.findings[0].confirmed, true);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].message, 'Timeout');

  await unlink(path);
});
