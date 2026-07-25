import { Router, type IRouter, type Response } from "express";
import { collectCompletion, DEFAULT_MODEL } from "./aiService";
import type { ChatMessage } from "./aiService";
import {
  enqueueCommand,
  getActiveSessions,
  getResult,
  getSession,
} from "../lib/session-store";

const router: IRouter = Router();

/** Build plugin context string injected into the AI system prompt. */
function buildPluginContext(sessionId?: string): string | null {
  const s = sessionId ? getSession(sessionId) : getActiveSessions()[0];
  if (!s) return null;
  const parts = ["A Roblox Studio plugin is currently connected to Zenith."];
  if (s.placeId)   parts.push(`Place ID: ${s.placeId}.`);
  if (s.username)  parts.push(`Developer (Creator ID): ${s.username}.`);
  if (s.placeName) parts.push(`Place Name: ${s.placeName}.`);
  parts.push(
    "The developer can read/write scripts and query the Explorer tree through the plugin. " +
    "When asked about their project, acknowledge the active Studio connection."
  );
  return parts.join(" ");
}

const SUPPORTED_STUDIO_TOOLS = new Set([
  "ping", "request_script_injection", "get_tree", "find_instances",
  "get_selection", "search_scripts", "read_script", "create_script",
  "update_script", "append_script", "create_module", "format_script",
  "get_properties", "get_attributes", "set_properties", "set_attributes",
  "create_instance", "create_gui", "create_ui_element", "update_ui_element",
  "create_part", "create_model", "create_spawn", "create_remote_event",
  "create_remote_function", "create_folder", "rename_instance", "move_instance",
  "clone_instance", "delete_instance", "get_output_logs", "clear_output",
  "save_place", "analyze_project", "summarize_project", "detect_systems",
]);

function extractToolCall(text: string): { name: string; args: Record<string, unknown> } | null {
  const marker = "TOOL:";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  let start = markerIndex + marker.length;
  while (start < text.length && /\s/.test(text[start])) start++;
  if (text[start] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && inString) { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      name?: unknown;
      args?: unknown;
    };
    if (typeof parsed.name !== "string" || !parsed.args || typeof parsed.args !== "object" || Array.isArray(parsed.args)) {
      return null;
    }
    return { name: parsed.name, args: parsed.args as Record<string, unknown> };
  } catch {
    return null;
  }
}

function validateToolCall(name: string, args: Record<string, unknown>): string | null {
  if (!SUPPORTED_STUDIO_TOOLS.has(name)) return `Unsupported Studio tool "${name}".`;
  if (name === "delete_instance" && args.confirm !== true) {
    return "delete_instance requires confirm:true and an explicit user request.";
  }
  for (const key of ["path", "parent"]) {
    const value = args[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      return `Invalid ${key} for "${name}".`;
    }
    if (typeof value === "string" && value.includes("..")) {
      return `Invalid ${key} for "${name}": parent traversal is not allowed.`;
    }
  }
  for (const key of ["source", "query", "name", "className", "type"]) {
    if (args[key] !== undefined && typeof args[key] !== "string") {
      return `Invalid ${key} for "${name}": expected a string.`;
    }
  }
  if (typeof args.source === "string" && args.source.length > 100_000) {
    return `Source for "${name}" is too large.`;
  }
  return null;
}

async function executeStudioTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const validationError = validateToolCall(name, args);
  if (validationError) return { error: validationError };
  const commandId = enqueueCommand(sessionId, name, args);
  if (!commandId) return { error: "Studio session expired — reconnect the plugin." };

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = getResult(commandId);
    if (result) {
      if (result.error) return { error: result.error };
      if (result.result && typeof result.result === "object") {
        const nested = result.result as { error?: string; success?: boolean; message?: string };
        if (nested.error || nested.success === false) {
          return { error: nested.error ?? nested.message ?? "Studio command failed." };
        }
      }
      return result.result;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { error: "Studio plugin did not respond in 10s. Make sure Studio is open and connected." };
}

function sendSse(res: Response, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function runAgent(
  messages: ChatMessage[],
  sessionId: string,
  model: string | undefined,
  res: Response,
): Promise<void> {
  const pluginContext = buildPluginContext(sessionId);
  let conversation = messages;
  for (let round = 0; round < 6; round++) {
    const result = await collectCompletion(conversation, model ?? DEFAULT_MODEL, pluginContext);
    if ("error" in result) {
      sendSse(res, { error: result.error });
      sendSse(res, { done: true });
      res.end();
      return;
    }

    sendSse(res, { provider: "OpenRouter", model: result.model });
    const toolCall = extractToolCall(result.text);
    if (!toolCall) {
      for (let index = 0; index < result.text.length; index += 40) {
        sendSse(res, { content: result.text.slice(index, index + 40) });
      }
      sendSse(res, { done: true });
      res.end();
      return;
    }

    const beforeTool = result.text.split(/TOOL:\s*\{/)[0].trim();
    if (beforeTool) sendSse(res, { content: `${beforeTool}\n` });
    sendSse(res, { content: `\n⚙️ *Ejecutando \`${toolCall.name}\` en Studio...*\n` });
    const toolResult = await executeStudioTool(sessionId, toolCall.name, toolCall.args);
    if (toolResult && typeof toolResult === "object" && "error" in toolResult) {
      sendSse(res, { content: `❌ *Error en Studio:* ${(toolResult as { error: string }).error}\n\n` });
    } else {
      sendSse(res, { content: "✅ *Listo.*\n\n" });
    }
    conversation = [
      ...conversation,
      { role: "ai", content: result.text },
      { role: "user", content: `TOOL_RESULT for ${toolCall.name}:\n${JSON.stringify(toolResult, null, 2)}\n\nContinue based only on this result.` },
    ];
  }
  sendSse(res, { error: "Too many Studio tool calls in one response." });
  sendSse(res, { done: true });
  res.end();
}

router.post("/chat", async (req, res): Promise<void> => {
  const { messages = [], model, sessionId }: { messages: ChatMessage[]; model?: string; sessionId?: string } = req.body;
  console.log("SESSION:", sessionId);
  res.setHeader("Content-Type",       "text/event-stream");
  res.setHeader("Cache-Control",      "no-cache, no-transform");
  res.setHeader("Connection",         "keep-alive");
  res.setHeader("X-Accel-Buffering",  "no");

  if (sessionId) {
    if (!getSession(sessionId)) {
      sendSse(res, { error: "Studio session expired. Reconnect the plugin before editing the project." });
      sendSse(res, { done: true });
      res.end();
      return;
    }
    await runAgent(messages, sessionId, model, res);
    return;
  }

  const result = await collectCompletion(messages, model ?? DEFAULT_MODEL, null);
  if ("error" in result) {
    sendSse(res, { error: result.error });
  } else {
    sendSse(res, { provider: "OpenRouter", model: result.model, content: result.text });
  }
  sendSse(res, { done: true });
  res.end();
});

export default router;
