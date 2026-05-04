/**
 * popup.js
 * Renders the TokenLens popup UI.
 *
 * Data flow: popup → chrome.runtime.sendMessage(GET_POPUP_DATA) → background
 * → response → render helpers below.
 *
 * All cost/token data is pre-calculated by the background service worker and
 * stored in chrome.storage; the popup only reads and formats it.
 */

'use strict';

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Format an integer with thousand-separator commas. */
function fmtNum(n) {
  return Math.round(n || 0).toLocaleString();
}

/**
 * Format a USD cost value.
 *   $0.00   → "$0.00"
 *   < $0.01 → "<$0.01"
 *   otherwise → "$X.XXXX" (4 decimal places to show micro-costs)
 */
function fmtCost(cost) {
  if (!cost || cost === 0) return '$0.00';
  if (cost < 0.01)         return '<$0.01';
  return '$' + cost.toFixed(4);
}

/**
 * Format a unix-ms timestamp as a human-readable relative time.
 *   < 1 min  → "just now"
 *   < 1 h    → "Xm ago"
 *   < 1 day  → "Xh ago"
 *   otherwise → locale date string
 */
function fmtTime(ts) {
  var diff = Date.now() - ts;
  if (diff < 60e3)    return 'just now';
  if (diff < 3600e3)  return Math.floor(diff / 60e3)   + 'm ago';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

// ── Provider display metadata ─────────────────────────────────────────────────

var PROVIDER_META = {
  anthropic: { label: 'Anthropic / Claude', color: '#D4A373' },
  openai:    { label: 'OpenAI / ChatGPT',   color: '#74C0FC' },
  gemini:    { label: 'Google Gemini',      color: '#63E6BE' },
  ollama:    { label: 'Ollama (local)',      color: '#A9E34B' },
  groq:      { label: 'Groq',               color: '#FF8FAB' },
};

function providerMeta(key) {
  return PROVIDER_META[key] || { label: key, color: '#aaaaaa' };
}

// ── Render functions ──────────────────────────────────────────────────────────

/** Populate the "Today" summary stat cards. */
function renderToday(summary) {
  document.getElementById('today-input').textContent  = fmtNum(summary.inputTokens);
  document.getElementById('today-output').textContent = fmtNum(summary.outputTokens);
  document.getElementById('today-cost').textContent   = fmtCost(summary.totalCost);
}

/** Render the provider-breakdown rows. */
function renderProviders(summary) {
  var container  = document.getElementById('provider-list');
  var byProvider = summary.byProvider || {};
  var keys       = Object.keys(byProvider);

  if (keys.length === 0) {
    container.innerHTML = '<p class="empty-state">No data yet. Start a chat!</p>';
    return;
  }

  // Sort providers by total cost descending so the biggest spender is first.
  keys.sort(function (a, b) {
    return (byProvider[b].totalCost || 0) - (byProvider[a].totalCost || 0);
  });

  container.innerHTML = keys.map(function (key) {
    var d    = byProvider[key];
    var meta = providerMeta(key);
    return (
      '<div class="provider-row">' +
        '<span class="provider-dot" style="background:' + meta.color + '"></span>' +
        '<span class="provider-name">' + escHtml(meta.label) + '</span>' +
        '<span class="provider-tokens">' + fmtNum(d.inputTokens + d.outputTokens) + ' tok</span>' +
        '<span class="provider-cost">'   + fmtCost(d.totalCost) + '</span>' +
      '</div>'
    );
  }).join('');
}

/** Render the last 10 session rows in reverse-chronological order. */
function renderSessions(sessions) {
  var container = document.getElementById('sessions-list');

  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<p class="empty-state">No sessions recorded yet.</p>';
    return;
  }

  var recent = sessions.slice().reverse().slice(0, 10);

  container.innerHTML = recent.map(function (s) {
    var meta  = providerMeta(s.provider);
    var color = meta.color;
    return (
      '<div class="session-row">' +
        '<div class="session-header">' +
          '<span class="session-model">' + escHtml(s.model || 'unknown') + '</span>' +
          '<span class="session-time">'  + fmtTime(s.timestamp) + '</span>' +
        '</div>' +
        '<div class="session-stats">' +
          '<span class="session-tokens">' +
            '<span style="color:' + color + '" aria-hidden="true">▲</span>' +
            fmtNum(s.inputTokens) + '&thinsp;' +
            '<span style="color:' + color + '" aria-hidden="true">▼</span>' +
            fmtNum(s.outputTokens) +
          '</span>' +
          '<span class="session-cost">' + fmtCost(s.totalCost) + '</span>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Basic HTML escaping to prevent XSS from stored model/provider strings. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadData() {
  chrome.runtime.sendMessage({ type: 'GET_POPUP_DATA' }, function (response) {
    if (chrome.runtime.lastError) {
      console.error('[TokenLens popup]', chrome.runtime.lastError.message);
      return;
    }
    if (!response || response.error) {
      console.error('[TokenLens popup] Error from background:', response && response.error);
      return;
    }
    renderToday(response.todaySummary     || {});
    renderProviders(response.todaySummary || {});
    renderSessions(response.sessions      || []);
  });
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById('btn-clear').addEventListener('click', function () {
  // eslint-disable-next-line no-alert
  if (!confirm('Clear all TokenLens usage data?')) return;

  chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }, function (response) {
    if (chrome.runtime.lastError) {
      console.error('[TokenLens popup]', chrome.runtime.lastError.message);
      return;
    }
    if (response && response.ok) loadData();
  });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

loadData();
