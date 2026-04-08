/**
 * Browser-side init script injected via page.addInitScript() before every navigation.
 * Hooks alert/confirm/prompt, fetch, XHR, and console.error.
 * Writes hits to window.__xss_hits for later evaluation.
 */
export const INIT_SCRIPT = `
(function () {
  window.__xss_hits = [];

  window.alert = window.confirm = window.prompt = function (m) {
    window.__xss_hits.push({ sink: 'dialog', value: String(m) });
  };

  var _fetch = window.fetch;
  window.fetch = function () {
    window.__xss_hits.push({ sink: 'fetch', args: Array.prototype.slice.call(arguments).map(String) });
    return _fetch.apply(this, arguments);
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
