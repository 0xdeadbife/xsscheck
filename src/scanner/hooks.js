/**
 * Browser-side init script injected via page.addInitScript() before every navigation.
 * Hooks alert/confirm/prompt, fetch, XHR, and console.error.
 * Writes hits to window.__xss_hits for later evaluation.
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

  var _fetch = window.fetch;
  window.fetch = function () {
    window.__xss_hits.push({ sink: 'fetch', args: Array.prototype.slice.call(arguments).map(String) });
    if (_fetch) return _fetch.apply(this, arguments);
  };

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    window.__xss_hits.push({ sink: 'xhr', args: Array.prototype.slice.call(arguments).map(String) });
    return _open.apply(this, arguments);
  };

  var _cerr = console.error;
  console.error = function () {
    window.__xss_hits.push({ sink: 'console.error', args: Array.prototype.slice.call(arguments).map(String) });
    _cerr.apply(console, arguments);
  };
})();
`;
