// Detects payloads that already contain percent-encoded sequences (e.g. %252F, %2F).
// These must be injected raw into the URL string — passing them through URL.searchParams.set()
// would double-encode the % to %25, corrupting the intended WAF bypass.
const PRE_ENCODED_RE = /%[0-9A-Fa-f]{2}/;

/**
 * Replace one query param value with a payload, return modified URL string.
 *
 * If the payload contains existing percent-encoding (e.g. %252F for a double-encoded slash),
 * it is injected raw to preserve the intended encoding. Otherwise URL.searchParams handles it.
 *
 * @param {string} urlStr
 * @param {string} param
 * @param {string} payload
 * @returns {string}
 */
export function injectUrlParam(urlStr, param, payload) {
  const u = new URL(urlStr);

  if (PRE_ENCODED_RE.test(payload)) {
    // Raw injection: build query string manually, slot payload in as-is
    const parts = [];
    let injected = false;
    for (const [k, v] of u.searchParams) {
      if (k === param && !injected) {
        parts.push(`${encodeURIComponent(k)}=${payload}`);
        injected = true;
      } else {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    }
    if (!injected) parts.push(`${encodeURIComponent(param)}=${payload}`);
    return `${u.origin}${u.pathname}?${parts.join('&')}${u.hash}`;
  }

  u.searchParams.set(param, payload);
  return u.toString();
}

/**
 * Build extra HTTP headers with payload injected into common reflection points.
 * @param {string} payload
 * @returns {Record<string, string>}
 */
export function buildHeadersPayload(payload) {
  return {
    'Referer': payload,
    'X-Forwarded-For': payload,
    'User-Agent': payload,
  };
}

/**
 * Return a copy of the cookies array with every value replaced by payload.
 * @param {Array<{name: string, value: string, domain?: string, path?: string}>} cookies
 * @param {string} payload
 * @returns {Array<{name: string, value: string, domain?: string, path?: string}>}
 */
export function buildCookiesPayload(cookies, payload) {
  return cookies.map(c => ({ ...c, value: payload }));
}

/**
 * Enumerate all scan jobs for a single URL across all surfaces.
 * @param {string} urlStr
 * @param {string[]} payloads
 * @returns {Array<{url: string, payload: string, surface: string, param: string|null}>}
 */
export function enumerateJobs(urlStr, payloads) {
  const jobs = [];
  const params = [...new URL(urlStr).searchParams.keys()];

  for (const payload of payloads) {
    for (const param of params) {
      jobs.push({
        url: injectUrlParam(urlStr, param, payload),
        baseUrl: urlStr,
        payload,
        surface: 'url_param',
        param,
      });
    }
    jobs.push({ url: urlStr, baseUrl: urlStr, payload, surface: 'headers', param: null });
    jobs.push({ url: urlStr, baseUrl: urlStr, payload, surface: 'cookies', param: null });
  }

  return jobs;
}
