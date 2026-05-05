/**
 * storage.js
 * Abstraction layer over chrome.storage.local for TokenLens.
 *
 * Schema
 * ──────
 * tokenlens_sessions  – Array of individual API-call records (capped at MAX_SESSIONS)
 * tokenlens_daily     – Object keyed by "YYYY-MM-DD" with per-day totals
 *
 * Record shape:
 *   { id, timestamp, provider, model, inputTokens, outputTokens,
 *     inputCost, outputCost, totalCost, url }
 *
 * Daily total shape:
 *   { inputTokens, outputTokens, totalCost,
 *     byProvider: { [provider]: { inputTokens, outputTokens, totalCost } } }
 */

'use strict';

var STORAGE_KEYS = {
  SESSIONS:     'tokenlens_sessions',
  DAILY_TOTALS: 'tokenlens_daily',
};

// Keep at most this many individual session records to bound storage use.
var MAX_SESSIONS = 500;

/** @returns {string} Today as "YYYY-MM-DD" in local time */
function todayKey() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Persist a new token-usage record and update the daily summary.
 *
 * @param {Object} record
 * @returns {Promise<void>}
 */
function saveRecord(record) {
  return new Promise(function (resolve, reject) {
    var keys = [STORAGE_KEYS.SESSIONS, STORAGE_KEYS.DAILY_TOTALS];
    chrome.storage.local.get(keys, function (result) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      // ── Session list ────────────────────────────────────────────────────
      var sessions = result[STORAGE_KEYS.SESSIONS] || [];
      sessions.push(record);
      // Trim to cap
      if (sessions.length > MAX_SESSIONS) {
        sessions.splice(0, sessions.length - MAX_SESSIONS);
      }

      // ── Daily totals ────────────────────────────────────────────────────
      var dailyTotals = result[STORAGE_KEYS.DAILY_TOTALS] || {};
      var today = todayKey();
      if (!dailyTotals[today]) {
        dailyTotals[today] = {
          inputTokens:  0,
          outputTokens: 0,
          totalCost:    0,
          byProvider:   {},
        };
      }
      var day = dailyTotals[today];
      day.inputTokens  += record.inputTokens;
      day.outputTokens += record.outputTokens;
      day.totalCost    += record.totalCost;

      if (!day.byProvider[record.provider]) {
        day.byProvider[record.provider] = {
          inputTokens:  0,
          outputTokens: 0,
          totalCost:    0,
        };
      }
      var prov = day.byProvider[record.provider];
      prov.inputTokens  += record.inputTokens;
      prov.outputTokens += record.outputTokens;
      prov.totalCost    += record.totalCost;

      var toStore = {};
      toStore[STORAGE_KEYS.SESSIONS]     = sessions;
      toStore[STORAGE_KEYS.DAILY_TOTALS] = dailyTotals;

      chrome.storage.local.set(toStore, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Retrieve all stored session records.
 * @returns {Promise<Array>}
 */
function getSessions() {
  return new Promise(function (resolve, reject) {
    chrome.storage.local.get(STORAGE_KEYS.SESSIONS, function (result) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result[STORAGE_KEYS.SESSIONS] || []);
      }
    });
  });
}

/**
 * Retrieve all daily totals.
 * @returns {Promise<Object>}
 */
function getDailyTotals() {
  return new Promise(function (resolve, reject) {
    chrome.storage.local.get(STORAGE_KEYS.DAILY_TOTALS, function (result) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result[STORAGE_KEYS.DAILY_TOTALS] || {});
      }
    });
  });
}

/**
 * Retrieve today's aggregated summary (or an empty summary if none exists).
 * @returns {Promise<Object>}
 */
function getTodaySummary() {
  return getDailyTotals().then(function (totals) {
    return totals[todayKey()] || {
      inputTokens:  0,
      outputTokens: 0,
      totalCost:    0,
      byProvider:   {},
    };
  });
}

/**
 * Erase all TokenLens data from storage.
 * @returns {Promise<void>}
 */
function clearAll() {
  return new Promise(function (resolve, reject) {
    var keys = [STORAGE_KEYS.SESSIONS, STORAGE_KEYS.DAILY_TOTALS];
    chrome.storage.local.remove(keys, function () {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Export for Node.js tests; expose as a global for importScripts / <script> tags.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { saveRecord, getSessions, getDailyTotals, getTodaySummary, clearAll, STORAGE_KEYS };
} else {
  // eslint-disable-next-line no-var
  var Storage = {
    saveRecord:      saveRecord,
    getSessions:     getSessions,
    getDailyTotals:  getDailyTotals,
    getTodaySummary: getTodaySummary,
    clearAll:        clearAll,
    STORAGE_KEYS:    STORAGE_KEYS,
  };
}
