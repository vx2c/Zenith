import { Router, type IRouter, type Response } from "express";
import { collectCompletion, DEFAULT_MODEL } from "./aiService";
import type { ChatMessage } from "./aiService";
import {
  enqueueCommand,
  getResult,
  getSession,
} from "../lib/session-store";

const router: IRouter = Router();

// ── Supported tools (mirrors api/chat.js allow-list) ──────────────────────
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

// ── Intent classifier ─────────────────────────────────────────────────────
const STUDIO_ACTION_PATTERNS: RegExp[] = [
  /\b(crea[r]?|agrega[r]?|a[ñn]ade|añadir|insertar|haz|make|create|add|insert|build)\b/i,
  /\b(modifica[r]?|cambia[r]?|edita[r]?|actualiza[r]?|modify|change|edit|update|rename)\b/i,
  /\b(elimina[r]?|borra[r]?|quita[r]?|delete|remove|destroy|clear)\b/i,
  /\b(mueve[r]?|clona[r]?|copi[ae][r]?|move|clone|copy|duplicate)\b/i,
  /\b(lee[r]?|muéstrame|muestra|dame|obtén|obtener|ver|mira[r]?)\s+(el|la|los|las|mi|mis|el\s+código|el\s+script|el\s+árbol|el\s+explorer)/i,
  /\b(read|show\s+me|get|fetch|inspect|list)\s+(my|the|current|all)\b.*\b(script|tree|explorer|instance|part|gui|folder|remote)/i,
  /\b(en\s+(studio|el\s+proyecto|mi\s+proyecto|workspace|roblox)|in\s+(studio|my\s+project|workspace|roblox\s+studio))\b/i,
  /\b(el\s+árbol|el\s+explorer|el\s+explorador|mi\s+juego|mi\s+proyecto)\b/i,
  /\b(the\s+(explorer|tree|workspace|game|project|place))\b/i,
  /\b(ServerScriptService|StarterGui|ReplicatedStorage|Workspace|StarterPlayer|SoundService|Teams|Players)\b/,
  /\b(qué\s+hay|qué\s+tiene|qué\s+contiene|what('s|\s+is)\s+in|show\s+the|inspect|debug\s+my)\b/i,
];

function detectStudioIntent(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return false;
  const text = last.content ?? "";
  return STUDIO_ACTION_PATTERNS.some(re => re.test(text));
}

// ── System prompt ─────────────────────────────────────────────────────────
function buildSystemPrompt(
  session: ReturnType<typeof getSession>,
  needsStudio: boolean,
): string {
  const base =
    "You are Zenith, an expert AI assistant for Roblox Studio development. " +
    "You help developers write Lua scripts, debug code, generate GUIs, " +
    "analyze Explorer hierarchies, and automate workflows inside Roblox Studio. " +
    "You know all Roblox APIs, Lua 5.1 scripting patterns, Remote Events/Functions, " +
    "and game design best practices. Be concise and practical. When providing code, " +
    "always use triple-backtick fenced code blocks with the language tag (lua, json, etc.).";

  if (!session) return base;

  const intentNote = needsStudio
    ? "\n\n⚠️  INTENT DETECTED: The developer is asking for a Studio action. You MUST use a tool before responding. Do NOT describe the action, explain it, or write code first. Execute the tool immediately."
    : "";

  const studioLines = [
    "\n\n--- STUDIO CONNECTED ---",
    session.placeId   ? `Place ID: ${session.placeId}` : "",
    session.username  ? `Creator: ${session.username}` : "",
    session.placeName ? `Place: ${session.placeName}` : "",
    "",
    "You have REAL tools to interact with the developer's Roblox Studio project.",
    "When the developer asks you to read, create, or modify anything in their project,",
    "you MUST use the tool system below. NEVER describe, simulate, or imagine an action.",
    "",
    "TOOL SYSTEM:",
    "To call a tool, output a line that looks exactly like this (nothing else on that line):",
    "  TOOL:{\"name\":\"tool_name\",\"args\":{...}}",
    "",
    "CRITICAL TOOL EXECUTION RULES:",
    "  T1. If the developer asks to create, edit, read, or inspect anything in Studio → use the right tool IMMEDIATELY.",
    "  T2. After outputting TOOL:{...}, STOP. Do NOT continue writing. Wait for TOOL_RESULT.",
    "  T3. Never output TOOL:{...} more than once per response. One tool call per response.",
    "  T4. TOOL_RESULT is the only source of truth. Never invent or guess the result.",
    "  T5. If TOOL_RESULT contains success=false or an \"error\" field → explain the failure. Never claim success.",
    "  T6. If TOOL_RESULT is successful, then and ONLY then describe what was done.",
    "  T7. Never tell the user to do something manually if a tool can do it.",
    "  T8. For questions about the project (tree, scripts, GUIs), call get_tree or find_instances first.",
    "  T9. Before the first mutating call, output one line starting with \"PLAN:\" listing the steps.",
    " T10. Never delete or overwrite content unless the user explicitly asked for that exact change.",
    " T11. Never invent Roblox property values, paths, or class names you haven't read from TOOL_RESULT.",
    "",
    "Available tools:",
    "  TOOL:{\"name\":\"ping\",\"args\":{}}",
    "    → Checks that the connected Studio plugin is responding.",
    "",
    "  TOOL:{\"name\":\"get_tree\",\"args\":{}}",
    "    → Returns the recursive Explorer tree. Optional args: path, maxDepth, maxNodes.",
    "    Example: TOOL:{\"name\":\"get_tree\",\"args\":{\"path\":\"Workspace\",\"maxDepth\":4}}",
    "",
    "  TOOL:{\"name\":\"find_instances\",\"args\":{\"query\":\"button\",\"className\":\"TextButton\",\"maxResults\":50}}",
    "    → Searches instances by name/path and optional className.",
    "  TOOL:{\"name\":\"search_scripts\",\"args\":{\"query\":\"leader\",\"maxResults\":50}}",
    "    → Searches Lua source containers by name/path and source text.",
    "  TOOL:{\"name\":\"get_selection\",\"args\":{}}",
    "    → Returns the objects currently selected in Roblox Studio.",
    "",
    "  TOOL:{\"name\":\"read_script\",\"args\":{\"path\":\"ServerScriptService.MyScript\"}}",
    "    → Returns the Lua source code of the script at that path.",
    "",
    "  TOOL:{\"name\":\"create_script\",\"args\":{\"path\":\"ServerScriptService.MyScript\",\"type\":\"Script\",\"source\":\"-- lua code here\"}}",
    "    → Creates a new script. type can be Script, LocalScript, or ModuleScript.",
    "",
    "  TOOL:{\"name\":\"update_script\",\"args\":{\"path\":\"ServerScriptService.MyScript\",\"source\":\"-- new lua code\"}}",
    "    → Overwrites the source of an existing script.",
    "",
    "  TOOL:{\"name\":\"append_script\",\"args\":{\"path\":\"ServerScriptService.MyScript\",\"source\":\"-- code to append\"}}",
    "    → Appends source to an existing Script, LocalScript, or ModuleScript.",
    "  TOOL:{\"name\":\"create_module\",\"args\":{\"path\":\"ReplicatedStorage.Modules.Inventory\",\"source\":\"return {}\"}}",
    "    → Creates a ModuleScript.",
    "  TOOL:{\"name\":\"format_script\",\"args\":{\"path\":\"ServerScriptService.MyScript\"}}",
    "    → Applies safe source formatting and verifies the write.",
    "",
    "  TOOL:{\"name\":\"get_properties\",\"args\":{\"path\":\"Workspace.Part\"}}",
    "    → Reads common Roblox properties and attributes from an Instance.",
    "  TOOL:{\"name\":\"get_attributes\",\"args\":{\"path\":\"Workspace.Part\"}}",
    "    → Reads custom Attributes from an Instance.",
    "",
    "  TOOL:{\"name\":\"set_properties\",\"args\":{\"path\":\"Workspace.Part\",\"properties\":{\"Name\":\"SpawnPart\",\"Anchored\":true}}}",
    "    → Changes properties. Typed values include Color3, Vector2, Vector3, UDim, UDim2, CFrame and Enum.",
    "",
    "  TOOL:{\"name\":\"create_instance\",\"args\":{\"parent\":\"StarterGui\",\"name\":\"MainGui\",\"className\":\"ScreenGui\",\"properties\":{\"ResetOnSpawn\":false},\"children\":[]}}",
    "    → Creates an Instance and optional nested children.",
    "",
    "  TOOL:{\"name\":\"set_attributes\",\"args\":{\"path\":\"Workspace.Part\",\"attributes\":{\"ZenithManaged\":true}}}",
    "    → Sets custom Attributes on an Instance.",
    "",
    "  TOOL:{\"name\":\"rename_instance\",\"args\":{\"path\":\"Workspace.Part\",\"name\":\"SpawnPart\"}}",
    "    → Renames an existing Instance after checking for sibling conflicts.",
    "  TOOL:{\"name\":\"move_instance\",\"args\":{\"path\":\"Workspace.Part\",\"parent\":\"ReplicatedStorage\"}}",
    "    → Moves an existing Instance to another parent.",
    "",
    "  TOOL:{\"name\":\"clone_instance\",\"args\":{\"path\":\"ReplicatedStorage.Template\",\"parent\":\"Workspace\",\"name\":\"Copy\"}}",
    "    → Clones an existing Instance and its descendants into another parent.",
    "",
    "  TOOL:{\"name\":\"delete_instance\",\"args\":{\"path\":\"Workspace.OldPart\",\"confirm\":true}}",
    "    → Deletes an Instance. Only when user explicitly requested deletion and confirm is true.",
    "",
    "  TOOL:{\"name\":\"create_folder\",\"args\":{\"parent\":\"ReplicatedStorage\",\"name\":\"Systems\"}}",
    "    → Creates a Folder.",
    "  TOOL:{\"name\":\"create_gui\",\"args\":{\"parent\":\"StarterGui\",\"name\":\"ZenithGui\",\"children\":[]}}",
    "    → Convenience alias for creating a ScreenGui hierarchy.",
    "  TOOL:{\"name\":\"create_ui_element\",\"args\":{\"parent\":\"StarterGui.ZenithGui\",\"name\":\"PlayButton\",\"className\":\"TextButton\",\"properties\":{\"Text\":\"Play\"}}}",
    "    → Creates a GUI element under an existing GUI parent.",
    "  TOOL:{\"name\":\"update_ui_element\",\"args\":{\"path\":\"StarterGui.ZenithGui.PlayButton\",\"properties\":{\"Text\":\"Start\"}}}",
    "    → Updates GUI properties using the same typed property format.",
    "",
    "  TOOL:{\"name\":\"create_part\",\"args\":{\"parent\":\"Workspace\",\"name\":\"SpawnPart\",\"properties\":{\"Anchored\":true}}}",
    "    → Creates a Part.",
    "  TOOL:{\"name\":\"create_model\",\"args\":{\"parent\":\"Workspace\",\"name\":\"Enemy\"}}",
    "    → Creates a Model.",
    "  TOOL:{\"name\":\"create_spawn\",\"args\":{\"parent\":\"Workspace\",\"name\":\"SpawnLocation\"}}",
    "    → Creates a SpawnLocation.",
    "  TOOL:{\"name\":\"create_remote_event\",\"args\":{\"parent\":\"ReplicatedStorage\",\"name\":\"RoundEvent\"}}",
    "    → Creates a RemoteEvent.",
    "  TOOL:{\"name\":\"create_remote_function\",\"args\":{\"parent\":\"ReplicatedStorage\",\"name\":\"GetData\"}}",
    "    → Creates a RemoteFunction.",
    "",
    "  TOOL:{\"name\":\"get_output_logs\",\"args\":{\"maxResults\":100}}",
    "    → Reads the Studio output/log history.",
    "  TOOL:{\"name\":\"clear_output\",\"args\":{}}",
    "    → Clears the Studio output.",
    "  TOOL:{\"name\":\"save_place\",\"args\":{}}",
    "    → Saves the current place in Studio.",
    "  TOOL:{\"name\":\"analyze_project\",\"args\":{}}",
    "    → Inspects live tree and scripts for common systems.",
    "  TOOL:{\"name\":\"summarize_project\",\"args\":{}}",
    "    → Returns a concise summary based on live Studio data.",
    "  TOOL:{\"name\":\"detect_systems\",\"args\":{}}",
    "    → Detects Leaderstats, DataStores, RemoteEvents, GUIs, rounds, combat, and inventory.",
    "",
    "HALLUCINATION PREVENTION:",
    "  - You have NEVER seen this developer's project before unless a TOOL_RESULT shows it.",
    "  - Do not assume any script exists, any instance exists, or any path is valid.",
    "  - Every fact about the project must come from a TOOL_RESULT in this conversation.",
    "  - If you are unsure whether something exists, use find_instances or get_tree to check.",
    "  - NEVER say \"I created X\", \"I added Y\", or \"Done\" without a successful TOOL_RESULT confirming it.",
  ].filter(Boolean).join("\n");

  return base + intentNote + studioLines;
}

// ── Tool validation ───────────────────────────────────────────────────────
function validateToolCall(name: string, args: Record<string, unknown>): string | null {
  if (!SUPPORTED_STUDIO_TOOLS.has(name)) return `Unsupported Studio tool "${name}".`;
  if (name === "delete_instance" && args["confirm"] !== true) {
    return "delete_instance requires confirm:true and an explicit user request.";
  }
  for (const key of ["path", "parent"]) {
    const value = args[key];
    if (value !== undefined && (typeof value !== "string" || !String(value).trim())) {
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
  if (typeof args["source"] === "string" && (args["source"] as string).length > 100_000) {
    return `Source for "${name}" is too large.`;
  }
  return null;
}

// ── Execute Studio tool with retry ────────────────────────────────────────
async function executeStudioTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 12_000,
  retries = 1,
): Promise<unknown> {
  const validationError = validateToolCall(name, args);
  if (validationError) return { error: validationError };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const commandId = enqueueCommand(sessionId, name, args);
    if (!commandId) return { error: "Studio session expired — reconnect the plugin." };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = getResult(commandId);
      if (result !== null) {
        if (result.error) return { error: result.error };
        if (result.result && typeof result.result === "object") {
          const nested = result.result as { error?: string; success?: boolean; message?: string };
          if (nested.error || nested.success === false) {
            return { error: nested.error ?? nested.message ?? "Studio command failed." };
          }
        }
        return result.result;
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    if (attempt < retries) {
      console.warn(`[chat] tool ${name} timeout on attempt ${attempt + 1}, retrying...`);
    }
  }

  return {
    error:
      "Studio plugin did not respond within the timeout. " +
      "Make sure Roblox Studio is open, the plugin is connected, and the place is loaded.",
  };
}

// ── Parse TOOL:{...} from AI text ─────────────────────────────────────────
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
    const parsed = JSON.parse(text.slice(start, end + 1)) as { name?: unknown; args?: unknown };
    if (typeof parsed.name !== "string" || !parsed.args || typeof parsed.args !== "object" || Array.isArray(parsed.args)) {
      return null;
    }
    return { name: parsed.name, args: parsed.args as Record<string, unknown> };
  } catch {
    return null;
  }
}

// ── SSE helper ────────────────────────────────────────────────────────────
function sendSse(res: Response, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ── Timeline label map ────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  ping:                   "Checking Studio connection",
  get_tree:               "Reading Explorer tree",
  find_instances:         "Searching instances",
  get_selection:          "Getting selection",
  search_scripts:         "Searching scripts",
  read_script:            "Reading script",
  create_script:          "Creating script",
  update_script:          "Updating script",
  append_script:          "Appending to script",
  create_module:          "Creating module",
  format_script:          "Formatting script",
  get_properties:         "Reading properties",
  get_attributes:         "Reading attributes",
  set_properties:         "Setting properties",
  set_attributes:         "Setting attributes",
  create_instance:        "Creating instance",
  create_gui:             "Creating GUI",
  create_ui_element:      "Creating UI element",
  update_ui_element:      "Updating UI element",
  create_part:            "Creating part",
  create_model:           "Creating model",
  create_spawn:           "Creating spawn",
  create_remote_event:    "Creating RemoteEvent",
  create_remote_function: "Creating RemoteFunction",
  create_folder:          "Creating folder",
  rename_instance:        "Renaming instance",
  move_instance:          "Moving instance",
  clone_instance:         "Cloning instance",
  delete_instance:        "Deleting instance",
  get_output_logs:        "Reading output logs",
  clear_output:           "Clearing output",
  save_place:             "Saving place",
  analyze_project:        "Analyzing project",
  summarize_project:      "Summarizing project",
  detect_systems:         "Detecting systems",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name}`;
}

// ── TOOL_RESULT injection message ─────────────────────────────────────────
function buildToolResultMessage(toolName: string, toolResult: unknown, isError: boolean): string {
  const resultJson = JSON.stringify(toolResult, null, 2);
  if (isError) {
    return (
      `TOOL_RESULT [${toolName}] — FAILED\n${resultJson}\n\n` +
      `The tool did NOT succeed. You MUST NOT claim the action was completed.\n` +
      `Options:\n` +
      `  1. Explain the error to the developer clearly.\n` +
      `  2. If recoverable, use a different tool (e.g. get_tree to find the correct path).\n` +
      `  3. Never fabricate a success message after a failure.\n` +
      `Respond now based on this failure result.`
    );
  }
  return (
    `TOOL_RESULT [${toolName}] — SUCCESS\n${resultJson}\n\n` +
    `The tool executed successfully. The above data is the authoritative result from Roblox Studio.\n` +
    `Rules:\n` +
    `  - Base your response ONLY on this result, not on assumptions.\n` +
    `  - If more tools are needed to complete the task, output the next TOOL:{...} call now.\n` +
    `  - If the task is complete, summarize what was done based on this result. Be specific.\n` +
    `  - Do NOT say "Done" or "Listo" without referencing what the result shows.\n` +
    `Respond now.`
  );
}

// ── Tool enforcement message ───────────────────────────────────────────────
function buildToolEnforcementMessage(userContent: string): string {
  return (
    `SYSTEM: Your last response did not include a TOOL: call, but the developer's request ` +
    `requires a Studio action:\n"${userContent}"\n\n` +
    `You MUST use a tool. Do NOT describe the action or write example code instead.\n` +
    `Look at the available tools in the system prompt and call the appropriate one now.\n` +
    `Output ONLY the TOOL:{...} line.`
  );
}

// ── Agentic loop ──────────────────────────────────────────────────────────
async function runAgent(
  messages: ChatMessage[],
  sessionId: string,
  model: string | undefined,
  res: Response,
  session: ReturnType<typeof getSession>,
  needsStudio: boolean,
): Promise<void> {
  const MAX_ROUNDS = 12;
  const MAX_TOOL_ENFORCEMENT_RETRIES = 1;
  const systemPrompt = buildSystemPrompt(session, needsStudio);

  let conversation = messages;
  let headerSent = false;
  let toolEnforcementRetries = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await collectCompletion(
      conversation,
      model ?? DEFAULT_MODEL,
      null,
      systemPrompt,
    );

    if ("error" in result) {
      sendSse(res, { error: result.error });
      sendSse(res, { done: true });
      res.end();
      return;
    }

    const { text, model: usedModel } = result;
    const toolCall = extractToolCall(text);

    if (!toolCall) {
      // ── Tool enforcement: AI skipped a required tool ──────────────────
      if (needsStudio && round < MAX_ROUNDS - 1 && toolEnforcementRetries < MAX_TOOL_ENFORCEMENT_RETRIES) {
        toolEnforcementRetries++;
        const lastUserMsg = [...conversation].reverse().find(
          m => m.role === "user" &&
               !m.content.startsWith("TOOL_RESULT") &&
               !m.content.startsWith("SYSTEM:")
        );
        if (lastUserMsg) {
          conversation = [
            ...conversation,
            { role: "ai" as const, content: text },
            { role: "user" as const, content: buildToolEnforcementMessage(lastUserMsg.content) },
          ];
          continue;
        }
      }

      // Final answer — stream to client
      if (!headerSent) {
        sendSse(res, { provider: "OpenRouter", model: usedModel });
        headerSent = true;
      }
      for (let i = 0; i < text.length; i += 40) {
        sendSse(res, { content: text.slice(i, i + 40) });
      }
      sendSse(res, { done: true });
      res.end();
      return;
    }

    // ── Tool call detected ────────────────────────────────────────────────
    const toolMarkerIdx = text.indexOf("TOOL:");
    const textBeforeTool = toolMarkerIdx > 0 ? text.slice(0, toolMarkerIdx).trim() : "";

    if (!headerSent) {
      sendSse(res, { provider: "OpenRouter", model: usedModel });
      headerSent = true;
    }

    // Stream any PLAN: or reasoning text before the tool call
    if (textBeforeTool) {
      const planMatch = textBeforeTool.match(/^PLAN:\s*.+/m);
      if (planMatch) {
        sendSse(res, { timeline: { id: round, label: planMatch[0].replace(/^PLAN:\s*/, ""), status: "plan" } });
      }
    }

    // Timeline: tool running
    const label = toolLabel(toolCall.name);
    sendSse(res, { timeline: { id: round, label, status: "running", tool: toolCall.name } });

    const toolResult = await executeStudioTool(sessionId, toolCall.name, toolCall.args);
    const isError = toolResult !== null &&
      typeof toolResult === "object" &&
      "error" in (toolResult as object);

    // Timeline: tool done or error
    sendSse(res, {
      timeline: {
        id: round,
        label,
        status: isError ? "error" : "done",
        tool: toolCall.name,
        ...(isError ? { error: (toolResult as { error: string }).error } : {}),
      },
    });

    conversation = [
      ...conversation,
      { role: "ai" as const, content: text },
      {
        role: "user" as const,
        content: buildToolResultMessage(toolCall.name, toolResult, isError),
      },
    ];
  }

  sendSse(res, { error: "Too many tool rounds. Please try again." });
  sendSse(res, { done: true });
  res.end();
}

// ── Route ─────────────────────────────────────────────────────────────────
router.post("/chat", async (req, res): Promise<void> => {
  const {
    messages = [],
    model,
    sessionId,
  }: { messages: ChatMessage[]; model?: string; sessionId?: string } = req.body;

  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache, no-transform");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // ── Studio connected: agentic tool loop ──────────────────────────────────
  if (sessionId) {
    const session = getSession(sessionId);
    if (!session) {
      sendSse(res, { error: "Studio session expired. Reconnect the plugin before editing the project." });
      sendSse(res, { done: true });
      res.end();
      return;
    }

    const needsStudio = detectStudioIntent(messages);
    await runAgent(messages, sessionId, model, res, session, needsStudio);
    return;
  }

  // ── No Studio: plain streaming with minimal system prompt ────────────────
  const noStudioPrompt =
    "You are Zenith, an expert AI assistant for Roblox Studio development. " +
    "You help developers write Lua scripts, debug code, generate GUIs, " +
    "analyze Explorer hierarchies, and automate workflows inside Roblox Studio. " +
    "No Studio plugin is connected right now, so you can only give advice and code. " +
    "Do not output TOOL: lines or claim that you changed the project.";

  const result = await collectCompletion(messages, model ?? DEFAULT_MODEL, null, noStudioPrompt);
  if ("error" in result) {
    sendSse(res, { error: result.error });
  } else {
    sendSse(res, { provider: "OpenRouter", model: result.model });
    for (let i = 0; i < result.text.length; i += 40) {
      sendSse(res, { content: result.text.slice(i, i + 40) });
    }
  }
  sendSse(res, { done: true });
  res.end();
});

export default router;
