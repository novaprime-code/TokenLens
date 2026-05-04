/**
 * injector.js
 * Runs in the MAIN world (same JS context as the page).
 *
 * Intercepts fetch() and XMLHttpRequest calls made by the host page to LLM
 * API endpoints.  Handles both regular JSON responses and SSE (Server-Sent
 * Events) streaming responses, which is the common path for all modern LLM
 * streaming UIs.
 *
 * Token data is forwarded to bridge.js (ISOLATED world) via window.postMessage
 * using a tagged envelope, which then relays it to the background service
 * worker via chrome.runtime.sendMessage.
 *
 * Why MAIN world?  Chrome/Firefox content-script fetch overrides run in an
 * isolated JS context that does not share the page's fetch reference.
 * To intercept the *page's* own API calls we must patch window.fetch inside
 * the page's execution context.
 */

(function (global) {
  'use strict';

  // ── Endpoint registry ───────────────────────────────────────────────────────
  // Each entry maps a URL pattern to a provider key understood by the background.

  var ENDPOINTS = [
    // Anthropic direct API + claude.ai internal
    { re: /api\.anthropic\.com\/v1\/messages/,           provider: 'anthropic' },
    { re: /claude\.ai\/api\/[^/]+\/messages/,            provider: 'anthropic' },
    // OpenAI direct API + ChatGPT web app
    { re: /api\.openai\.com\/v1\/chat\/completions/,      provider: 'openai' },
    { re: /chat\.openai\.com\/backend-api\/conversation/, provider: 'openai' },
    // Google Gemini
    { re: /generativelanguage\.googleapis\.com\/.+\/models\/.+:/, provider: 'gemini' },
    // Groq — fully OpenAI-compatible; mapped to 'openai' provider key
    { re: /api\.groq\.com\/openai\/v1\/chat\/completions/, provider: 'openai' },
    // Ollama local server (default port 11434)
    { re: /localhost:\d+\/api\/(chat|generate)/,          provider: 'ollama' },
    { re: /127\.0\.0\.1:\d+\/api\/(chat|generate)/,      provider: 'ollama' },
  ];

  /**
   * Return the provider string if the URL belongs to a known LLM endpoint,
   * or null otherwise.
   * @param {string} url
   * @returns {string|null}
   */
  function matchProvider(url) {
    if (!url) return null;
    for (var i = 0; i < ENDPOINTS.length; i++) {
      if (ENDPOINTS[i].re.test(url)) return ENDPOINTS[i].provider;
    }
    return null;
  }

  // ── Token extraction ────────────────────────────────────────────────────────

  /**
   * Extract { inputTokens, outputTokens, model } from a parsed JSON object.
   * Returns null if no recognisable token fields are present.
   *
   * @param {string} provider
   * @param {Object} data
   * @returns {{ inputTokens: number, outputTokens: number, model: string }|null}
   */
  function extractTokens(provider, data) {
    if (!data || typeof data !== 'object') return null;

    if (provider === 'anthropic') {
      if (data.usage) {
        return {
          inputTokens:  data.usage.input_tokens  || 0,
          outputTokens: data.usage.output_tokens || 0,
          model: data.model || 'claude',
        };
      }
    }

    if (provider === 'openai') {
      if (data.usage) {
        return {
          inputTokens:  data.usage.prompt_tokens     || 0,
          outputTokens: data.usage.completion_tokens || 0,
          model: data.model || 'gpt',
        };
      }
    }

    if (provider === 'gemini') {
      if (data.usageMetadata) {
        return {
          inputTokens:  data.usageMetadata.promptTokenCount     || 0,
          outputTokens: data.usageMetadata.candidatesTokenCount || 0,
          model: data.modelVersion || 'gemini',
        };
      }
    }

    if (provider === 'ollama') {
      if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
        return {
          inputTokens:  data.prompt_eval_count || 0,
          outputTokens: data.eval_count        || 0,
          model: data.model || 'ollama',
        };
      }
    }

    return null;
  }

  // ── Reporting ───────────────────────────────────────────────────────────────

  /**
   * Send collected token data to bridge.js (ISOLATED world) via postMessage.
   * The bridge forwards it to the background service worker.
   *
   * @param {string} provider
   * @param {{ inputTokens: number, outputTokens: number, model: string }} tokens
   * @param {string} url
   */
  function report(provider, tokens, url) {
    global.postMessage({
      source: 'tokenlens-injector',
      payload: {
        type:         'TOKEN_USAGE',
        provider:     provider,
        model:        tokens.model,
        inputTokens:  tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        url:          url,
        timestamp:    Date.now(),
      },
    }, '*');
  }

  // ── SSE stream parser ───────────────────────────────────────────────────────

  /**
   * Consume a cloned SSE response body, accumulating token counts across all
   * events.  Reports once when the stream ends (or is aborted).
   *
   * Different providers place usage data in different event types:
   *   Anthropic — message_start (input tokens) + message_delta (output tokens)
   *   OpenAI    — final chunk when stream_options.include_usage is set
   *   Gemini    — every candidate chunk carries updated usageMetadata
   *
   * @param {ReadableStreamDefaultReader} reader  Reader from response.clone()
   * @param {string}                      provider
   * @param {string}                      url
   * @returns {Promise<void>}
   */
  async function consumeSSE(reader, provider, url) {
    var decoder      = new TextDecoder();
    var buf          = '';
    var inputTokens  = 0;
    var outputTokens = 0;
    var model        = 'unknown';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        var result = await reader.read();
        if (result.done) break;
        buf += decoder.decode(result.value, { stream: true });

        // Process complete lines from the buffer
        var lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete trailing line

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();

          // Standard SSE "data:" line
          if (line.startsWith('data: ')) {
            var raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            parseSSEChunk(raw, provider);
          }

          // Gemini streams newline-delimited JSON without the "data:" prefix
          if (provider === 'gemini' && line.startsWith('{')) {
            parseSSEChunk(line, provider);
          }
        }
      }

      // Flush any remaining buffer content
      if (buf.trim()) {
        var tail = buf.trim();
        if (tail.startsWith('data: ')) tail = tail.slice(6).trim();
        if (tail && tail !== '[DONE]') parseSSEChunk(tail, provider);
      }
    } catch (_e) {
      // Stream may be aborted by the page navigating away; that is fine.
    }

    if (inputTokens > 0 || outputTokens > 0) {
      report(provider, { inputTokens: inputTokens, outputTokens: outputTokens, model: model }, url);
    }

    /**
     * Parse one raw SSE data string and accumulate token counts.
     * Closes over inputTokens, outputTokens, model.
     */
    function parseSSEChunk(raw, prov) {
      var parsed;
      try { parsed = JSON.parse(raw); } catch (_e) { return; }
      if (!parsed || typeof parsed !== 'object') return;

      if (prov === 'anthropic') {
        // message_start carries input token count
        if (parsed.type === 'message_start' && parsed.message) {
          if (parsed.message.usage) {
            inputTokens = parsed.message.usage.input_tokens || inputTokens;
          }
          if (parsed.message.model) model = parsed.message.model;
        }
        // message_delta carries the final output token count
        if (parsed.type === 'message_delta' && parsed.usage) {
          outputTokens = parsed.usage.output_tokens || outputTokens;
        }
      } else if (prov === 'openai') {
        // Usage block in the final SSE chunk (requires stream_options.include_usage)
        if (parsed.usage) {
          inputTokens  = parsed.usage.prompt_tokens     || inputTokens;
          outputTokens = parsed.usage.completion_tokens || outputTokens;
        }
        if (parsed.model) model = parsed.model;
      } else if (prov === 'gemini') {
        // Every Gemini chunk may update usageMetadata
        if (parsed.usageMetadata) {
          inputTokens  = parsed.usageMetadata.promptTokenCount     || inputTokens;
          outputTokens = parsed.usageMetadata.candidatesTokenCount || outputTokens;
        }
        if (parsed.modelVersion) model = parsed.modelVersion;
      } else {
        // Generic fallback: grab whatever looks like a token count
        var generic = extractTokens(prov, parsed);
        if (generic) {
          inputTokens  = generic.inputTokens  || inputTokens;
          outputTokens = generic.outputTokens || outputTokens;
          model        = generic.model        || model;
        }
      }
    }
  }

  // ── fetch() override ────────────────────────────────────────────────────────

  var _origFetch = global.fetch;

  global.fetch = async function tokenlens_fetch(input, init) {
    // Resolve the URL string regardless of whether input is a string, URL, or Request
    var url =
      typeof input === 'string' ? input :
      input instanceof URL      ? input.href :
      (input && input.url)      ? input.url  : '';

    var provider = matchProvider(url);

    // Not a tracked endpoint — pass straight through
    if (!provider) {
      return _origFetch.apply(this, arguments);
    }

    var response = await _origFetch.apply(this, arguments);

    // Clone before the page consumes the body, so we can read it independently
    var cloned      = response.clone();
    var contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // SSE streaming path — run asynchronously so we never block the caller
      consumeSSE(cloned.body.getReader(), provider, url).catch(function () {});
    } else {
      // Regular JSON path
      cloned.json().then(function (data) {
        var tokens = extractTokens(provider, data);
        if (tokens) report(provider, tokens, url);
      }).catch(function () {});
    }

    return response;
  };

  // ── XMLHttpRequest override ─────────────────────────────────────────────────
  // Some older or non-streaming integrations still use XHR.

  var _origOpen = XMLHttpRequest.prototype.open;
  var _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function tokenlens_open(method, url) {
    this._tl_url      = url;
    this._tl_provider = matchProvider(url);
    return _origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function tokenlens_send() {
    if (this._tl_provider) {
      var self = this;
      this.addEventListener('load', function () {
        try {
          var data   = JSON.parse(self.responseText);
          var tokens = extractTokens(self._tl_provider, data);
          if (tokens) report(self._tl_provider, tokens, self._tl_url);
        } catch (_e) {
          // Non-JSON or empty body — not an error worth surfacing
        }
      });
    }
    return _origSend.apply(this, arguments);
  };

})(window);
