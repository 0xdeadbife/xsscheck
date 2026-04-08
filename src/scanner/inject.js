/**
 * Replace one query param value with a payload, return modified URL string.
 * @param {string} urlStr
 * @param {string} param
 * @param {string} payload
 * @returns {string}
 */
export function injectUrlParam(urlStr, param, payload) {
  const u = new URL(urlStr);
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
        payload,
        surface: 'url_param',
        param,
      });
    }
    jobs.push({ url: urlStr, payload, surface: 'headers', param: null });
    jobs.push({ url: urlStr, payload, surface: 'cookies', param: null });
  }

  return jobs;
}
