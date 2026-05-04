/**
 * service-worker.js
 * Background service worker (Chrome MV3) / background script (Firefox MV2).
 *
 * Responsibilities:
 *   1. Receive TOKEN_USAGE messages from content scripts.
 *   2. Calculate cost via CostCalculator.
 *   3. Persist records and daily totals via Storage.
 *   4. Update the browser-action badge with today's running cost.
 *   5. Serve popup data requests (GET_POPUP_DATA, CLEAR_DATA).
 *
 * Cross-browser notes:
 *   Chrome MV3 — this file is a service worker; importScripts() pulls in the
 *                lib files because service workers don't have ES-module import.
 *   Firefox MV2 — manifest.firefox.json loads lib scripts before this file,
 *                so CostCalculator / Storage globals are already in scope.
 */

'use strict';

// Pull in shared libs when running as a Chrome MV3 service worker.
// In Firefox MV2 the manifest loads the scripts first, so importScripts is
// not defined there — we guard to avoid a ReferenceError.
if (typeof importScripts === 'function') {
  importScripts('../lib/costCalculator.js', '../lib/storage.js');
}

// ── Message dispatcher ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return false;

  if (message.type === 'TOKEN_USAGE') {
    handleTokenUsage(message, sender);
    // No async response needed for fire-and-forget usage events.
    return false;
  }

  if (message.type === 'GET_POPUP_DATA') {
    getPopupData()
      .then(sendResponse)
      .catch(function (err) { sendResponse({ error: err.message }); });
    return true; // keeps the message channel open for the async reply
  }

  if (message.type === 'CLEAR_DATA') {
    Storage.clearAll()
      .then(function () { return updateBadge(); })
      .then(function () { sendResponse({ ok: true }); })
      .catch(function (err) { sendResponse({ error: err.message }); });
    return true;
  }

  return false;
});

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * Persist a TOKEN_USAGE event and refresh the badge.
 *
 * @param {Object} message  – Payload from content/bridge.js
 * @param {Object} sender   – chrome.runtime MessageSender
 */
function handleTokenUsage(message, sender) {
  var provider     = message.provider     || 'unknown';
  var model        = message.model        || 'unknown';
  var inputTokens  = message.inputTokens  || 0;
  var outputTokens = message.outputTokens || 0;
  var url          = message.url          || (sender.tab ? sender.tab.url : 'unknown');
  var timestamp    = message.timestamp    || Date.now();

  var costs = CostCalculator.calculateCost(model, inputTokens, outputTokens);

  var record = {
    id:           timestamp + '-' + Math.random().toString(36).slice(2, 9),
    timestamp:    timestamp,
    provider:     provider,
    model:        model,
    inputTokens:  inputTokens,
    outputTokens: outputTokens,
    inputCost:    costs.inputCost,
    outputCost:   costs.outputCost,
    totalCost:    costs.totalCost,
    url:          url,
  };

  Storage.saveRecord(record)
    .then(function () { return updateBadge(); })
    .catch(function (err) {
      console.error('[TokenLens] Failed to save record:', err);
    });
}

/**
 * Gather data needed by the popup.
 * @returns {Promise<Object>}
 */
function getPopupData() {
  return Promise.all([
    Storage.getTodaySummary(),
    Storage.getSessions(),
    Storage.getDailyTotals(),
  ]).then(function (results) {
    return {
      todaySummary: results[0],
      sessions:     results[1],
      dailyTotals:  results[2],
    };
  });
}

// ── Badge ─────────────────────────────────────────────────────────────────────

/**
 * Update the toolbar badge to show today's running cost at a glance.
 *   • empty  → no data yet
 *   • "<1¢"  → cost below one cent
 *   • "45¢"  → cost in cents (when < $1)
 *   • "$1.2" → cost in dollars (when ≥ $1)
 */
function updateBadge() {
  return Storage.getTodaySummary().then(function (today) {
    var cost = today.totalCost || 0;
    var text = '';

    if (cost > 0 && cost < 0.01) {
      text = '<1\u00A2';          // <1¢
    } else if (cost >= 0.01 && cost < 1) {
      text = Math.round(cost * 100) + '\u00A2'; // e.g. "45¢"
    } else if (cost >= 1) {
      text = '$' + cost.toFixed(1);             // e.g. "$1.2"
    }

    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: '#6C63FF' });
  }).catch(function () {
    // Badge update is non-critical; swallow errors silently.
  });
}
