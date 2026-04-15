/**
 * Browser-side init script injected via page.addInitScript() before every navigation.
 * Hooks alert/confirm/prompt only — the only sinks that reliably indicate XSS payload
 * execution without false positives.
 *
 * fetch/XHR/console.error are intentionally NOT hooked: they fire on virtually every
 * page (analytics, React warnings, API calls) regardless of the payload, producing
 * 100% false positives.
 *
 * NOTE: addInitScript runs in every frame (main + iframes). Each frame gets its own
 * window.__xss_hits array. worker.js collects hits from all frames via page.frames()
 * so that XSS firing inside an iframe is detected correctly.
 */
export const INIT_SCRIPT = `
(function () {
  window.__xss_hits = [];

  window.alert = function (m) {
    window.__xss_hits.push({ sink: 'dialog', value: String(m) });
  };
  window.confirm = function (m) {
    window.__xss_hits.push({ sink: 'dialog', value: String(m) });
    return true;
  };
  window.prompt = function (m) {
    window.__xss_hits.push({ sink: 'dialog', value: String(m) });
    return '';
  };
})();
`;
