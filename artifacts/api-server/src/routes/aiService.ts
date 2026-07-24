/**
 * Zenith AI Service — OpenRouter provider (Express / TypeScript edition)
 *
 * Architecture mirrors api/aiService.js (Vercel edition) so both
 * environments stay in sync.
 */

import type { Response } from "express";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const SITE_URL        = process.env["SITE_URL"] || "https://zenith-ai.vercel.app";
const SITE_NAME       = "Zenith - Roblox Studio AI";

// ── Model registry ───────────────────────────

export const FALLBACK_CHAIN = [
  "qwen/qwen3-coder:free",
  "deepseek/deepseek-r1:free",
  "google/gemma-3-27b-it:free",
] as const;

export type ModelId = (typeof FALLBACK_CHAIN)[number] | (string & {});

export const DEFAULT_MODEL: ModelId = FALLBACK_CHAIN[0];

// ── Provider registry ────────────────────────

export const PROVIDERS = {
  openrouter: {
    name:   "OpenRouter",
    url:    OPENROUTER_BASE,
    envKey: "OPENROUTER_API_KEY",
  },
} as const;

const ACTIVE_PROVIDER = "openrouter" as const;

// ── System prompt ────────────────────────────

const SYSTEM_PROMPT =
  "You are Zenith, an expert AI assistant for Roblox Studio development. " +
  "You help developers write Lua scripts, debug code, generate GUIs, " +
  "analyze Explorer hierarchies, and automate workflows inside Roblox Studio. " +
  "You know all Roblox APIs (Players, Workspace, ReplicatedStorage, " +
  "ServerScriptService, RunService, TweenService, DataStoreService, etc.), " +
  "Lua 5.1 scripting patterns, Remote Events/Functions, and game design " +
  "best practices. Be concise and practical. When providing code, always use " +
  "triple-backtick fenced code blocks with the language tag (lua, json, etc.).";

// ── Types ────────────────────────────────────

export interface ChatMessage {
  role: "user" | "ai";
  content: string;
}

export interface AIStatus {
  provider: string;
  providerKey: string;
  model: string;
  fallbackChain: readonly string[];
  configured: boolean;
  status: "online" | "missing_key";
}

type StreamOutcome = "success" | "retry" | "fatal";

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────

/**
 * Stream a chat completion via OpenRouter with automatic fallback.
 * Writes SSE events directly to the Express `res` object.
 */
export async function streamChat(
  messages: ChatMessage[],
  res: Response,
  preferredModel: ModelId = DEFAULT_MODEL,
): Promise<void> {
  const provider = PROVIDERS[ACTIVE_PROVIDER];
  const apiKey   = process.env[provider.envKey];

  if (!apiKey) {
    writeSSE(res, { error: "OPENROUTER_API_KEY is not configured on the server." });
    writeSSE(res, { done: true });
    res.end();
    return;
  }

  const chain = buildChain(preferredModel);

  for (const model of chain) {
    const outcome = await tryModel(model, messages, apiKey, res);
    if (outcome === "success") return;
    if (outcome === "fatal")   return;
    // "retry" → try next model in chain
  }

  writeSSE(res, { error: "All AI models are currently unavailable. Please try again later." });
  writeSSE(res, { done: true });
  res.end();
}

/** Return current AI provider/model status (no network call). */
export function getStatus(): AIStatus {
  const provider = PROVIDERS[ACTIVE_PROVIDER];
  const hasKey   = !!process.env[provider.envKey];
  return {
    provider:      provider.name,
    providerKey:   ACTIVE_PROVIDER,
    model:         DEFAULT_MODEL,
    fallbackChain: FALLBACK_CHAIN,
    configured:    hasKey,
    status:        hasKey ? "online" : "missing_key",
  };
}

// ─────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────

function buildChain(preferred: ModelId): ModelId[] {
  const rest = (FALLBACK_CHAIN as readonly string[]).filter(m => m !== preferred) as ModelId[];
  return [preferred, ...rest];
}

function writeSSE(res: Response, obj: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function tryModel(
  model: ModelId,
  messages: ChatMessage[],
  apiKey: string,
  res: Response,
): Promise<StreamOutcome> {
  const body = {
    model,
    stream:     true,
    max_tokens: 8192,
    messages: [
      { role: "system",    content: SYSTEM_PROMPT },
      ...messages.map(m => ({
        role:    m.role === "ai" ? "assistant" : "user",
        content: m.content,
      })),
    ],
  };

  let response: globalThis.Response;
  try {
    response = await fetch(OPENROUTER_BASE, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": SITE_URL,
        "X-Title":      SITE_NAME,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return "retry";
  }

  if (!response.ok) {
    let errText = "";
    try { errText = await response.text(); } catch { /* ignore */ }

    if (response.status === 404 || response.status === 400) return "retry";
    if (response.status === 429) return "retry";

    if (response.status === 401) {
      writeSSE(res, { error: "OpenRouter: Invalid API key (401). Check OPENROUTER_API_KEY." });
      writeSSE(res, { done: true });
      res.end();
      return "fatal";
    }

    writeSSE(res, { error: `OpenRouter error ${response.status}: ${errText.slice(0, 300)}` });
    writeSSE(res, { done: true });
    res.end();
    return "fatal";
  }

  writeSSE(res, { provider: "OpenRouter", model });

  const reader  = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const chunk = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
          const text  = chunk.choices?.[0]?.delta?.content;
          if (text) writeSSE(res, { content: text });
        } catch { /* skip malformed SSE lines */ }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    writeSSE(res, { error: `Stream interrupted: ${msg}` });
    writeSSE(res, { done: true });
    res.end();
    return "fatal";
  }

  writeSSE(res, { done: true });
  res.end();
  return "success";
}
