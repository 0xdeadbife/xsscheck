import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPayloads } from '../src/payload.js';

test('loadPayloads strips blank lines and comments', async () => {
  const tmp = join(tmpdir(), 'payloads-test.txt');
  await writeFile(tmp, [
    '# this is a comment',
    '',
    '<script>alert(1)</script>',
    '  ',
    'javascript:alert(1)',
    '# another comment',
  ].join('\n'));

  const result = await loadPayloads(tmp);
  await unlink(tmp);

  assert.deepEqual(result, [
    '<script>alert(1)</script>',
    'javascript:alert(1)',
  ]);
});

test('loadPayloads throws when file does not exist', async () => {
  await assert.rejects(
    () => loadPayloads('/nonexistent/payloads.txt'),
    { code: 'ENOENT' }
  );
});
