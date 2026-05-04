/**
 * costCalculator.js
 * Estimates USD costs for LLM API calls based on a pricing table.
 *
 * Pricing is expressed in USD per 1 million tokens and should be kept
 * up to date with provider pricing pages.  Add new models by appending
 * to PRICING_TABLE — the lookup uses longest-prefix matching so a model
 * like "gpt-4o-2024-08-06" automatically resolves to "gpt-4o" pricing.
 *
 * Sources (update regularly):
 *   https://www.anthropic.com/pricing
 *   https://openai.com/pricing
 *   https://ai.google.dev/pricing
 */

'use strict';

/**
 * Pricing table — USD per 1 000 000 tokens.
 * Keys are lowercase model-name prefixes; the lookup uses startsWith().
 *
 * @type {Object.<string, {input: number, output: number}>}
 */
var PRICING_TABLE = {
  // ── Anthropic ────────────────────────────────────────────────────────────
  'claude-opus-4':        { input: 15.00, output: 75.00 },
  'claude-sonnet-4':      { input:  3.00, output: 15.00 },
  'claude-haiku-4':       { input:  0.80, output:  4.00 },
  // Legacy Claude 3 models
  'claude-3-opus':        { input: 15.00, output: 75.00 },
  'claude-3-5-sonnet':    { input:  3.00, output: 15.00 },
  'claude-3-sonnet':      { input:  3.00, output: 15.00 },
  'claude-3-5-haiku':     { input:  0.80, output:  4.00 },
  'claude-3-haiku':       { input:  0.25, output:  1.25 },
  // Generic fallback for unknown Claude versions
  'claude':               { input:  3.00, output: 15.00 },

  // ── OpenAI ───────────────────────────────────────────────────────────────
  'gpt-4o-mini':          { input:  0.15, output:  0.60 },
  'gpt-4o':               { input:  2.50, output: 10.00 },
  'gpt-4-turbo':          { input: 10.00, output: 30.00 },
  'gpt-4':                { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo':        { input:  0.50, output:  1.50 },

  // ── Google Gemini ────────────────────────────────────────────────────────
  'gemini-1.5-pro':       { input:  1.25, output:  5.00 },
  'gemini-1.5-flash':     { input:  0.075, output: 0.30 },
  'gemini-1.0-pro':       { input:  0.50, output:  1.50 },
  'gemini-pro':           { input:  0.50, output:  1.50 },
  // Generic fallback
  'gemini':               { input:  1.25, output:  5.00 },

  // ── Groq (OpenAI-compatible) ─────────────────────────────────────────────
  'llama3-70b':           { input:  0.59, output:  0.79 },
  'llama3-8b':            { input:  0.05, output:  0.10 },
  'mixtral-8x7b':         { input:  0.27, output:  0.27 },

  // ── Ollama (local — always free) ─────────────────────────────────────────
  'ollama':               { input:  0.00, output:  0.00 },
};

/**
 * Find the pricing entry for a model name using longest-prefix matching.
 * Comparison is case-insensitive.
 *
 * @param {string} model  e.g. "gpt-4o-2024-08-06" or "claude-opus-4-5"
 * @returns {{ input: number, output: number }}
 */
function getPricing(model) {
  if (!model) return { input: 0, output: 0 };

  var normalized = model.toLowerCase().trim();

  // Exact match first
  if (PRICING_TABLE[normalized]) return PRICING_TABLE[normalized];

  // Longest-prefix match — so "gpt-4o-mini" beats "gpt-4o" when the model
  // name actually starts with "gpt-4o-mini".
  var bestKey    = null;
  var bestLength = 0;
  var keys = Object.keys(PRICING_TABLE);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (normalized.startsWith(key) && key.length > bestLength) {
      bestKey    = key;
      bestLength = key.length;
    }
  }
  if (bestKey) return PRICING_TABLE[bestKey];

  // Unknown model — return zero so totals still accumulate correctly.
  return { input: 0, output: 0 };
}

/**
 * Calculate the estimated cost of one API call.
 *
 * @param {string} model
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {{ inputCost: number, outputCost: number, totalCost: number }}
 */
function calculateCost(model, inputTokens, outputTokens) {
  var pricing    = getPricing(model);
  var inputCost  = (inputTokens  / 1e6) * pricing.input;
  var outputCost = (outputTokens / 1e6) * pricing.output;
  return {
    inputCost:  inputCost,
    outputCost: outputCost,
    totalCost:  inputCost + outputCost,
  };
}

// Export for Node.js tests; expose as a global for importScripts / <script> tags.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculateCost, getPricing, PRICING_TABLE };
} else {
  // eslint-disable-next-line no-var
  var CostCalculator = { calculateCost: calculateCost, getPricing: getPricing, PRICING_TABLE: PRICING_TABLE };
}
