import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INIT_SCRIPT } from '../src/scanner/hooks.js';

test('INIT_SCRIPT is a non-empty string', () => {
  assert.equal(typeof INIT_SCRIPT, 'string');
  assert.ok(INIT_SCRIPT.length > 0);
});

test('INIT_SCRIPT defines __xss_hits array', () => {
  assert.ok(INIT_SCRIPT.includes('__xss_hits'));
});

test('INIT_SCRIPT hooks window.alert', () => {
  assert.ok(INIT_SCRIPT.includes('window.alert'));
});

test('INIT_SCRIPT hooks window.fetch', () => {
  assert.ok(INIT_SCRIPT.includes('window.fetch'));
});

test('INIT_SCRIPT hooks XMLHttpRequest.prototype.open', () => {
  assert.ok(INIT_SCRIPT.includes('XMLHttpRequest.prototype.open'));
});

test('INIT_SCRIPT hooks console.error', () => {
  assert.ok(INIT_SCRIPT.includes('console.error'));
});
