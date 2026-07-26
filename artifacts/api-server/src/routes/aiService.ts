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

// Fallback chain ordered by reliability and capability for Roblox Studio tasks.
// Free-tier models rotate availability — multiple backups prevent empty responses.
export const FALLBACK_CHAIN = [
  "deepseek/deepseek-chat:free",          // #1: strongest free model for code + multi-step reasoning
  "google/gemma-3-27b-it:free",           // #2: solid instruction-following
  "meta-llama/llama-3.3-70b-instruct:free", // #3: large llama, reliable
  "qwen/qwen3-8b:free",                   // #4: fast fallback
  "openai/gpt-oss-20b:free",              // #5: gpt backup
  "meta-llama/llama-3.1-8b-instruct:free", // #6: small llama final fallback
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

const BASE_SYSTEM_PROMPT =
  "You are Zenith, an expert AI assistant for Roblox Studio development. " +
  "You help developers write Lua scripts, debug code, generate GUIs, " +
  "analyze Explorer hierarchies, and automate workflows inside Roblox Studio. " +
  "You know all Roblox APIs (Players, Workspace, ReplicatedStorage, " +
  "ServerScriptService, RunService, TweenService, DataStoreService, etc.), " +
  "Lua 5.1 scripting patterns, Remote Events/Functions, and game design " +
  "best practices. Be concise and practical. When providing code, always use " +
  "triple-backtick fenced code blocks with the language tag (lua, json, etc.).";

function buildSystemPrompt(pluginContext: string | null): string {
  if (!pluginContext) return BASE_SYSTEM_PROMPT;
  return (
    BASE_SYSTEM_PROMPT +
    "\n\n--- PLUGIN CONNECTION ---\n" +
    pluginContext + "\n" +
    "You CAN see and interact with the connected Roblox Studio project through the plugin. " +
    "When the developer asks about their project, Explorer tree, or scripts, acknowledge " +
    "that you have an active Studio connection and can read/write scripts via the plugin." +
    `

You have real tools that execute in the connected Roblox Studio project.
Call a tool by outputting exactly one line in this format:
TOOL:{"name":"tool_name","args":{...}}
After a TOOL line, stop and wait for TOOL_RESULT.

Supported tools:
ping, request_script_injection, get_tree, find_instances, get_selection,
search_scripts, read_script, create_script, update_script, append_script,
create_module, format_script, get_properties, get_attributes, set_properties,
set_attributes, create_instance, create_gui, create_ui_element,
update_ui_element, create_part, create_model, create_spawn,
create_remote_event, create_remote_function, create_folder, rename_instance,
move_instance, clone_instance, delete_instance, get_output_logs, clear_output,
save_place, analyze_project, summarize_project, detect_systems.

Rules:
1. For any request to inspect, create, edit, or modify Studio, use the appropriate tool.
2. Before the first mutating tool, output a concise line beginning with PLAN: listing intended steps.
3. Never invent a tool, path, or command. Use only the exact names above.
4. Never claim success unless TOOL_RESULT says success:true. Explain errors honestly.
5. Never delete or overwrite user content without an explicit request for that exact change.
6. For broad project questions, inspect the live project before making assumptions.
`
  );
}

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
  pluginContext: string | null = null,
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
    const outcome = await tryModel(model, messages, apiKey, res, pluginContext);
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

export interface CompletionResult {
  model: string;
  text: string;
}

export async function collectCompletion(
  messages: ChatMessage[],
  preferredModel: ModelId = DEFAULT_MODEL,
  pluginContext: string | null = null,
  /** When provided, overrides the generated system prompt entirely. */
  overrideSystemPrompt?: string,
): Promise<CompletionResult | { error: string }> {
  const provider = PROVIDERS[ACTIVE_PROVIDER];
  const apiKey = process.env[provider.envKey];
  if (!apiKey) return { error: "OPENROUTER_API_KEY is not configured on the server." };

  const systemContent = overrideSystemPrompt ?? buildSystemPrompt(pluginContext);

  const failures: string[] = [];
  for (const model of buildChain(preferredModel)) {
    let response: globalThis.Response;
    try {
      response = await fetch(OPENROUTER_BASE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": SITE_URL,
          "X-Title": SITE_NAME,
        },
        body: JSON.stringify({
          model,
          stream: true,
          max_tokens: 8192,
          messages: [
            { role: "system", content: systemContent },
            ...messages.map(message => ({
              role: message.role === "ai" ? "assistant" : "user",
              content: message.content,
            })),
          ],
        }),
      });
    } catch {
      failures.push(`${model}: network error`);
      continue;
    }

    if (!response.ok) {
      let details = "";
      try { details = await response.text(); } catch { /* ignore */ }
      failures.push(`${model}: HTTP ${response.status} ${details.slice(0, 160)}`);
      continue;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      failures.push(`${model}: empty response body`);
      continue;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let streamError = "";
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
            const chunk = JSON.parse(raw) as {
              error?: { message?: string; code?: string | number };
              choices?: { delta?: { content?: string } }[];
            };
            if (chunk.error) {
              streamError = `${chunk.error.message ?? "provider error"} (code ${chunk.error.code ?? "?"})`;
              break;
            }
            text += chunk.choices?.[0]?.delta?.content ?? "";
          } catch { /* skip malformed SSE lines */ }
        }
        if (streamError) break;
      }
    } catch (error: unknown) {
      streamError = error instanceof Error ? error.message : String(error);
    }

    if (streamError) {
      failures.push(`${model}: ${streamError.slice(0, 180)}`);
      continue;
    }
    if (text.trim()) return { model, text };
    failures.push(`${model}: empty response`);
  }

  const allRateLimited =
    failures.length > 0 && failures.every(failure => failure.includes(": HTTP 429"));
  return {
    error: allRateLimited
      ? "OpenRouter is rate-limiting every free model for this account (HTTP 429). Wait for the daily limit to reset or add OpenRouter credits to unlock more requests."
      : `All AI models are currently unavailable. ${failures.join("; ") || "No model response."}`,
  };
}

function writeSSE(res: Response, obj: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function tryModel(
  model: ModelId,
  messages: ChatMessage[],
  apiKey: string,
  res: Response,
  pluginContext: string | null = null,
): Promise<StreamOutcome> {
  const body = {
    model,
    stream:     true,
    max_tokens: 8192,
    messages: [
      { role: "system",    content: buildSystemPrompt(pluginContext) },
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
