/**
 * tokenParser.js
 * Extracts token usage data from LLM API response objects.
 *
 * Supports:
 *   - Anthropic (Claude) — response.usage.input_tokens / output_tokens
 *   - OpenAI (ChatGPT, Groq) — response.usage.prompt_tokens / completion_tokens
 *   - Google Gemini — response.usageMetadata.promptTokenCount / candidatesTokenCount
 *   - Ollama (local) — response.prompt_eval_count / eval_count
 *
 * Each function returns null when the expected fields are absent, so callers
 * can safely chain or fall back to other strategies.
 */

'use strict';

/**
 * Parse token usage from a single parsed JSON object.
 *
 * @param {string} provider  One of: 'anthropic' | 'openai' | 'gemini' | 'ollama'
 *                          Note: Groq uses provider key 'openai' (API-compatible format).
 * @param {Object} data      A parsed API response (or a single SSE event payload)
 * @returns {{ inputTokens: number, outputTokens: number, model: string } | null}
 */
function parseTokenUsage(provider, data) {
  if (!data || typeof data !== 'object') return null;

  switch (provider) {
    case 'anthropic':
      // Anthropic Messages API and claude.ai internal both use:
      //   { usage: { input_tokens, output_tokens }, model: "claude-…" }
      if (data.usage &&
          (data.usage.input_tokens !== undefined ||
           data.usage.output_tokens !== undefined)) {
        return {
          inputTokens:  data.usage.input_tokens  || 0,
          outputTokens: data.usage.output_tokens || 0,
          model:        data.model || 'claude',
        };
      }
      // Streaming message_start event: { type:"message_start", message: { usage, model } }
      if (data.type === 'message_start' && data.message && data.message.usage) {
        return {
          inputTokens:  data.message.usage.input_tokens  || 0,
          outputTokens: data.message.usage.output_tokens || 0,
          model:        data.message.model || 'claude',
        };
      }
      // Streaming message_delta event carries the final output token count:
      //   { type:"message_delta", usage: { output_tokens } }
      if (data.type === 'message_delta' && data.usage) {
        return {
          inputTokens:  0, // not repeated in delta; accumulate separately
          outputTokens: data.usage.output_tokens || 0,
          model:        'claude',
        };
      }
      break;

    case 'openai':
      // OpenAI Chat Completions API (also Groq, which is API-compatible):
      //   { usage: { prompt_tokens, completion_tokens }, model: "gpt-…" }
      if (data.usage &&
          (data.usage.prompt_tokens !== undefined ||
           data.usage.completion_tokens !== undefined)) {
        return {
          inputTokens:  data.usage.prompt_tokens     || 0,
          outputTokens: data.usage.completion_tokens || 0,
          model:        data.model || 'gpt',
        };
      }
      break;

    case 'gemini':
      // Google Gemini API:
      //   { usageMetadata: { promptTokenCount, candidatesTokenCount }, modelVersion: "…" }
      if (data.usageMetadata) {
        return {
          inputTokens:  data.usageMetadata.promptTokenCount     || 0,
          outputTokens: data.usageMetadata.candidatesTokenCount || 0,
          model:        data.modelVersion || 'gemini',
        };
      }
      // Streaming wraps items in an array; check the last element
      if (Array.isArray(data) && data.length > 0) {
        const last = data[data.length - 1];
        if (last.usageMetadata) {
          return {
            inputTokens:  last.usageMetadata.promptTokenCount     || 0,
            outputTokens: last.usageMetadata.candidatesTokenCount || 0,
            model:        last.modelVersion || 'gemini',
          };
        }
      }
      break;

    case 'ollama':
      // Ollama local API: { prompt_eval_count, eval_count, model }
      if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
        return {
          inputTokens:  data.prompt_eval_count || 0,
          outputTokens: data.eval_count        || 0,
          model:        data.model || 'ollama',
        };
      }
      break;
  }

  return null;
}

// Export for Node.js tests; expose as a global for importScripts / <script> tags.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTokenUsage };
} else {
  // eslint-disable-next-line no-var
  var TokenParser = { parseTokenUsage };
}
