# TokenLens 🔭

> **See every token. Know every cost.**

A Chrome & Firefox browser extension (Manifest V3) that intercepts LLM API
calls made by web UIs and estimates the cost of every request in real-time.

---

## Features

| Feature | Detail |
|---|---|
| **Multi-provider** | Anthropic Claude, OpenAI ChatGPT, Google Gemini, Groq, Ollama |
| **Streaming support** | Correctly parses SSE streams (not just final JSON responses) |
| **Live badge** | Toolbar badge shows today's running cost at a glance |
| **Popup dashboard** | Today's totals, per-provider breakdown, last 10 calls |
| **Persistent storage** | Daily totals + session history via `chrome.storage.local` |
| **Cross-browser** | Chrome MV3 + Firefox MV2 (via `manifest.firefox.json`) |

---

## Project structure

```
TokenLens/
├── manifest.json              # Chrome MV3
├── manifest.firefox.json      # Firefox MV2
├── background/
│   └── service-worker.js      # Aggregates data, calculates costs, updates badge
├── content/
│   ├── bridge.js              # ISOLATED-world relay: injects injector + forwards postMessage
│   └── injector.js            # MAIN-world fetch/XHR interceptor + SSE stream parser
├── lib/
│   ├── tokenParser.js         # Extract token counts from API response shapes
│   ├── costCalculator.js      # USD cost from (model, inputTokens, outputTokens)
│   └── storage.js             # chrome.storage.local helpers
└── popup/
    ├── index.html
    ├── popup.js
    └── popup.css
```

---

## Supported providers

| Provider | Endpoint(s) | Format |
|---|---|---|
| Anthropic / Claude | `api.anthropic.com`, `claude.ai` | SSE + JSON |
| OpenAI / ChatGPT | `api.openai.com`, `chat.openai.com` | SSE + JSON |
| Google Gemini | `generativelanguage.googleapis.com` | SSE + JSON |
| Groq | `api.groq.com` (OpenAI-compatible) | SSE + JSON |
| Ollama (local) | `localhost:11434` | JSON |

---

## Installation (development)

### Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder

### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `manifest.firefox.json`

---

## Pricing data

Pricing is maintained in `lib/costCalculator.js` in the `PRICING_TABLE`
constant (USD per 1 M tokens).  Update the table whenever provider rates
change — the lookup uses longest-prefix matching so new model versions
(e.g. `gpt-4o-2024-08-06`) resolve automatically.

---

## Architecture

```
Page fetch/XHR
      │
      ▼
content/injector.js   ← MAIN world; patches window.fetch, reads SSE streams
      │  window.postMessage({ source:"tokenlens-injector", payload })
      ▼
content/bridge.js     ← ISOLATED world; validates envelope, calls chrome.runtime
      │  chrome.runtime.sendMessage({ type:"TOKEN_USAGE", … })
      ▼
background/service-worker.js  ← calculates cost, persists, refreshes badge
      │  chrome.storage.local
      ▼
popup/popup.js        ← reads via GET_POPUP_DATA message, renders UI
```
