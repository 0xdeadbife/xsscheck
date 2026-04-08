import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  injectUrlParam,
  buildHeadersPayload,
  buildCookiesPayload,
  enumerateJobs,
} from '../src/scanner/inject.js';

test('injectUrlParam replaces the given param value', () => {
  const result = injectUrlParam(
    'https://example.com/search?q=hello&page=1',
    'q',
    '<script>alert(1)</script>'
  );
  const u = new URL(result);
  assert.equal(u.searchParams.get('q'), '<script>alert(1)</script>');
  assert.equal(u.searchParams.get('page'), '1');
});

test('injectUrlParam leaves other params untouched', () => {
  const result = injectUrlParam('https://example.com/?a=1&b=2', 'a', 'X');
  const u = new URL(result);
  assert.equal(u.searchParams.get('a'), 'X');
  assert.equal(u.searchParams.get('b'), '2');
});

test('buildHeadersPayload returns the three header keys', () => {
  const headers = buildHeadersPayload('XSS');
  assert.equal(headers['Referer'], 'XSS');
  assert.equal(headers['X-Forwarded-For'], 'XSS');
  assert.equal(headers['User-Agent'], 'XSS');
});

test('buildCookiesPayload replaces all cookie values', () => {
  const cookies = [
    { name: 'session', value: 'abc', domain: 'example.com', path: '/' },
    { name: 'user', value: 'bob', domain: 'example.com', path: '/' },
  ];
  const result = buildCookiesPayload(cookies, 'PAYLOAD');
  assert.equal(result[0].value, 'PAYLOAD');
  assert.equal(result[1].value, 'PAYLOAD');
  assert.equal(result[0].name, 'session');
  assert.equal(result[1].name, 'user');
});

test('enumerateJobs produces url_param jobs for each param × payload', () => {
  const jobs = enumerateJobs(
    'https://example.com/?a=1&b=2',
    ['P1', 'P2']
  );

  const urlParamJobs = jobs.filter(j => j.surface === 'url_param');
  assert.equal(urlParamJobs.length, 4); // 2 params × 2 payloads

  const headerJobs = jobs.filter(j => j.surface === 'headers');
  assert.equal(headerJobs.length, 2); // 1 per payload

  const cookieJobs = jobs.filter(j => j.surface === 'cookies');
  assert.equal(cookieJobs.length, 2); // 1 per payload
});

test('injectUrlParam preserves pre-encoded payload without double-encoding', () => {
  // %252F is a double-encoded slash (%25 = literal %, 2F = /) — used for WAF bypass.
  // Passing through URL.searchParams would encode the % again to %25, giving %25252F.
  const result = injectUrlParam('https://example.com/?q=x', 'q', '%252F');
  assert.ok(result.includes('%252F'), 'pre-encoded payload must appear verbatim in URL');
  assert.ok(!result.includes('%25252F'), 'must not double-encode the percent sign');
});

test('enumerateJobs produces no url_param jobs for URLs with no params', () => {
  const jobs = enumerateJobs('https://example.com/', ['P1']);
  const urlParamJobs = jobs.filter(j => j.surface === 'url_param');
  assert.equal(urlParamJobs.length, 0);
});
