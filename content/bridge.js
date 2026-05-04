/**
 * bridge.js
 * Runs in the ISOLATED content-script world (default for content scripts).
 *
 * Two jobs:
 *   1. Inject injector.js into the MAIN world so it can intercept the page's
 *      own fetch / XHR calls.  We do this by creating a <script src="…"> tag
 *      because ISOLATED scripts can't directly patch window.fetch on the page.
 *
 *   2. Listen for postMessage events from the injector (MAIN → ISOLATED) and
 *      relay them to the background service worker via chrome.runtime.sendMessage.
 *      Only messages tagged with source:"tokenlens-injector" are accepted.
 *
 * Why two worlds?  chrome.runtime is unavailable in MAIN world scripts; the
 * bridge acts as a trusted relay between untrusted page code and the extension.
 */

(function () {
  'use strict';

  // ── 1. Inject the MAIN-world interceptor ────────────────────────────────────

  var script    = document.createElement('script');
  // chrome.runtime.getURL works in both Chrome and Firefox content scripts.
  script.src    = chrome.runtime.getURL('content/injector.js');
  script.onload = function () { script.remove(); }; // clean up the DOM element
  (document.head || document.documentElement).appendChild(script);

  // ── 2. Bridge postMessage → chrome.runtime ──────────────────────────────────

  window.addEventListener('message', function (event) {
    // Only accept messages from the same window (not iframes, not other tabs).
    if (event.source !== window) return;

    // Validate the envelope to avoid acting on arbitrary page messages.
    if (!event.data || event.data.source !== 'tokenlens-injector') return;

    var payload = event.data.payload;
    if (!payload || payload.type !== 'TOKEN_USAGE') return;

    // Forward to the background service worker.
    // We swallow send errors: the background may be temporarily unavailable
    // (e.g. during service-worker restart) and will recover on the next event.
    chrome.runtime.sendMessage(payload, function () {
      var _err = chrome.runtime.lastError; // consume to suppress console noise
      void _err;
    });
  });

})();
