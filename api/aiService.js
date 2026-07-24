'use strict';

// ─────────────────────────────────────────────
//  Zenith AI Service — OpenRouter provider
//  Supports streaming, fallback chain, future
//  provider switching.
// ─────────────────────────────────────────────

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const SITE_URL        = process.env.SITE_URL || 'https://zenith-ai.vercel.app';
const SITE_NAME       = 'Zenith - Roblox Studio AI';

// ── Model registry ───────────────────────────
/** Primary model and ordered fallback chain. */
const FALLBACK_CHAIN = [
  'qwen/qwen3-coder:free',
  'deepseek/deepseek-r1:free',
  'google/gemma-3-27b-it:free',
];

const DEFAULT_MODEL = FALLBACK_CHAIN[0];

// ── System prompt ────────────────────────────
const SYSTEM_PROMPT =
  'You are Zenith, an expert AI assistant for Roblox Studio development. ' +
  'You help developers write Lua scripts, debug code, generate GUIs, ' +
  'analyze Explorer hierarchies, and automate workflows inside Roblox Studio. ' +
  'You know all Roblox APIs (Players, Workspace, ReplicatedStorage, ' +
  'ServerScriptService, RunService, TweenService, DataStoreService, etc.), ' +
  'Lua 5.1 scripting patterns, Remote Events/Functions, and game design ' +
  'best practices. Be concise and practical. When providing code, always use ' +
  'triple-backtick fenced code blocks with the language tag (lua, json, etc.).';

// ── Provider registry (for future expansion) ─
const PROVIDERS = {
  openrouter: {
    name:    'OpenRouter',
    url:     OPENROUTER_BASE,
    envKey:  'OPENROUTER_API_KEY',
    format:  'openai',   // request/response format family
  },
  // gemini: { ... }  ← add future providers here
};

const ACTIVE_PROVIDER = 'openrouter';

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────

/**
 * Stream a chat completion via OpenRouter with automatic fallback.
 *
 * Writes SSE events to `res`:
 *   data: { provider, model }          ← emitted once at start
 *   data: { content: "..." }           ← one or more text chunks
 *   data: { error: "..." }             ← on failure
 *   data: { done: true }               ← always last
 *
 * @param {Array<{role:'user'|'ai', content:string}>} messages
 * @param {import('http').ServerResponse} res
 * @param {string} [preferredModel]
 */
async function streamChat(messages, res, preferredModel = DEFAULT_MODEL) {
  const apiKey = process.env[PROVIDERS[ACTIVE_PROVIDER].envKey];
  if (!apiKey) {
    _writeSSE(res, { error: 'OPENROUTER_API_KEY is not configured on the server.' });
    _writeSSE(res, { done: true });
    res.end();
    return;
  }

  const chain = _buildChain(preferredModel);

  for (const model of chain) {
    const outcome = await _tryModel(model, messages, apiKey, res);
    if (outcome === 'success')       return; // stream finished normally
    if (outcome === 'fatal')         return; // unrecoverable error, already written
    // outcome === 'retry' → model unavailable, try next
  }

  _writeSSE(res, { error: 'All AI models are currently unavailable. Please try again later.' });
  _writeSSE(res, { done: true });
  res.end();
}

/**
 * Return current AI provider/model status (no network call).
 */
function getStatus() {
  const provider = PROVIDERS[ACTIVE_PROVIDER];
  const hasKey   = !!process.env[provider.envKey];
  return {
    provider:      provider.name,
    providerKey:   ACTIVE_PROVIDER,
    model:         DEFAULT_MODEL,
    fallbackChain: FALLBACK_CHAIN,
    configured:    hasKey,
    status:        hasKey ? 'online' : 'missing_key',
  };
}

module.exports = { streamChat, getStatus, DEFAULT_MODEL, FALLBACK_CHAIN, PROVIDERS };

// ─────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────

function _buildChain(preferred) {
  const rest = FALLBACK_CHAIN.filter(m => m !== preferred);
  return [preferred, ...rest];
}

function _writeSSE(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/**
 * Attempt to stream from a single model.
 * @returns {'success'|'retry'|'fatal'}
 */
async function _tryModel(model, messages, apiKey, res) {
  const body = {
    model,
    stream:     true,
    max_tokens: 8192,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map(m => ({
        role:    m.role === 'ai' ? 'assistant' : 'user',
        content: m.content,
      })),
    ],
  };

  let response;
  try {
    response = await fetch(OPENROUTER_BASE, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  SITE_URL,
        'X-Title':       SITE_NAME,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    // Network failure — skip this model
    return 'retry';
  }

  if (!response.ok) {
    let errText = '';
    try { errText = await response.text(); } catch { /* ignore */ }

    // 404 / 400 often means model is unavailable → try fallback
    if (response.status === 404 || response.status === 400) return 'retry';

    // 401 Unauthorized → API key problem, stop chain
    if (response.status === 401) {
      _writeSSE(res, { error: `OpenRouter: Invalid API key (401). Check OPENROUTER_API_KEY.` });
      _writeSSE(res, { done: true });
      res.end();
      return 'fatal';
    }

    // 429 Rate limited → try next model
    if (response.status === 429) return 'retry';

    // Other errors → stop chain and report
    _writeSSE(res, { error: `OpenRouter error ${response.status}: ${errText.slice(0, 300)}` });
    _writeSSE(res, { done: true });
    res.end();
    return 'fatal';
  }

  // Announce which model is responding
  _writeSSE(res, { provider: 'OpenRouter', model });

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const chunk = JSON.parse(raw);
          // OpenAI-compatible SSE chunk
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) _writeSSE(res, { content: text });
        } catch { /* skip malformed SSE lines */ }
      }
    }
  } catch (streamErr) {
    _writeSSE(res, { error: `Stream interrupted: ${streamErr.message}` });
    _writeSSE(res, { done: true });
    res.end();
    return 'fatal';
  }

  _writeSSE(res, { done: true });
  res.end();
  return 'success';
}
