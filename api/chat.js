'use strict';
const { DEFAULT_MODEL, OPENROUTER_BASE, FALLBACK_CHAIN } = require('./aiService');
const { getSession, enqueueCommand, getResult } = require('./session-store');

// This is the allow-list implemented by AIConnector.plugin.lua. Never pass
// an arbitrary model-generated name to the plugin: a typo should become a
// visible assistant error, not an opaque Roblox-side failure.
const SUPPORTED_STUDIO_TOOLS = new Set([
  'ping',
  'request_script_injection',
  'get_tree',
  'find_instances',
  'get_selection',
  'search_scripts',
  'read_script',
  'append_script',
  'format_script',
  'create_module',
  'get_properties',
  'get_attributes',
  'create_script',
  'update_script',
  'set_properties',
  'set_attributes',
  'create_instance',
  'create_gui',
  'create_ui_element',
  'update_ui_element',
  'create_part',
  'create_model',
  'create_spawn',
  'create_remote_event',
  'create_remote_function',
  'create_folder',
  'rename_instance',
  'move_instance',
  'clone_instance',
  'delete_instance',
  'get_output_logs',
  'clear_output',
  'save_place',
  'detect_systems',
  'analyze_project',
  'summarize_project',
]);

// ── Intent classifier ──────────────────────────────────────────────────────
// Returns true when the user's last message clearly requires executing a
// Studio action — not just asking for advice or code examples.

const STUDIO_ACTION_PATTERNS = [
  // Mutation verbs
  /\b(crea[r]?|agrega[r]?|a[ñn]ade|añadir|insertar|haz|make|create|add|insert|build)\b/i,
  /\b(modifica[r]?|cambia[r]?|edita[r]?|actualiza[r]?|modify|change|edit|update|rename|rename)\b/i,
  /\b(elimina[r]?|borra[r]?|quita[r]?|delete|remove|destroy|clear)\b/i,
  /\b(mueve[r]?|clona[r]?|copi[ae][r]?|move|clone|copy|duplicate)\b/i,
  // Read verbs targeting the live project
  /\b(lee[r]?|muéstrame|muestra|dame|obtén|obtener|ver|mira[r]?)\s+(el|la|los|las|mi|mis|el\s+código|el\s+script|el\s+árbol|el\s+explorer)/i,
  /\b(read|show\s+me|get|fetch|inspect|list)\s+(my|the|current|all)\b.*\b(script|tree|explorer|instance|part|gui|folder|remote)/i,
  // Direct project references
  /\b(en\s+(studio|el\s+proyecto|mi\s+proyecto|workspace|roblox)|in\s+(studio|my\s+project|workspace|roblox\s+studio))\b/i,
  /\b(el\s+árbol|el\s+explorer|el\s+explorador|mi\s+juego|mi\s+proyecto)\b/i,
  /\b(the\s+(explorer|tree|workspace|game|project|place))\b/i,
  // Common Roblox nouns that imply project context
  /\b(ServerScriptService|StarterGui|ReplicatedStorage|Workspace|StarterPlayer|SoundService|Teams|Players)\b/,
  // Inspect / debug
  /\b(qué\s+hay|qué\s+tiene|qué\s+contiene|what('s|\s+is)\s+in|show\s+the|inspect|debug\s+my)\b/i,
];

function detectStudioIntent(messages) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return false;
  const text = last.content || '';
  return STUDIO_ACTION_PATTERNS.some(re => re.test(text));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── SSE helper ─────────────────────────────────────────────────────────────
function writeSSE(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// ── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt(session, needsStudio) {
  const base =
    'You are Zenith, an expert AI assistant for Roblox Studio development. ' +
    'You help developers write Lua scripts, debug code, generate GUIs, ' +
    'analyze Explorer hierarchies, and automate workflows inside Roblox Studio. ' +
    'You know all Roblox APIs, Lua 5.1 scripting patterns, Remote Events/Functions, ' +
    'and game design best practices. Be concise and practical. When providing code, ' +
    'always use triple-backtick fenced code blocks with the language tag (lua, json, etc.).';

  if (!session) return base;

  const intentNote = needsStudio
    ? '\n\n⚠️  INTENT DETECTED: The developer is asking for a Studio action. You MUST use a tool before responding. Do NOT describe the action, explain it, or write code first. Execute the tool immediately.'
    : '';

  const studioContext = [
    '\n\n--- STUDIO CONNECTED ---',
    session.placeId   ? `Place ID: ${session.placeId}` : '',
    session.username  ? `Creator: ${session.username}` : '',
    session.placeName ? `Place: ${session.placeName}` : '',
    '',
    'You have REAL tools to interact with the developer\'s Roblox Studio project.',
    'When the developer asks you to read, create, or modify anything in their project,',
    'you MUST use the tool system below. NEVER describe, simulate, or imagine an action.',
    '',
    'TOOL SYSTEM:',
    'To call a tool, output a line that looks exactly like this (nothing else on that line):',
    '  TOOL:{"name":"tool_name","args":{...}}',
    '',
    'CRITICAL TOOL EXECUTION RULES:',
    '  T1. If the developer asks to create, edit, read, or inspect anything in Studio → use the right tool IMMEDIATELY.',
    '  T2. After outputting TOOL:{...}, STOP. Do NOT continue writing. Wait for TOOL_RESULT.',
    '  T3. Never output TOOL:{...} more than once per response. One tool call per response.',
    '  T4. TOOL_RESULT is the only source of truth. Never invent or guess the result.',
    '  T5. If TOOL_RESULT contains success=false or an "error" field → explain the failure. Never claim success.',
    '  T6. If TOOL_RESULT is successful, then and ONLY then describe what was done.',
    '  T7. Never tell the user to do something manually if a tool can do it.',
    '  T8. For questions about the project (tree, scripts, GUIs), call get_tree or find_instances first.',
    '  T9. Before the first mutating call, output one line starting with "PLAN:" listing the steps.',
    ' T10. Never delete or overwrite content unless the user explicitly asked for that exact change.',
    ' T11. Never invent Roblox property values, paths, or class names you haven\'t read from TOOL_RESULT.',
    ' T12. After a WRITE tool succeeds: confirm in 1–2 sentences. NEVER show the Lua source code you wrote.',
    ' T13. After a READ tool succeeds: summarize findings. Show code only if the developer asked to see it.',
    '',
    'Available tools:',
    '  TOOL:{"name":"ping","args":{}}',
    '    → Checks that the connected Studio plugin is responding.',
    '',
    '  TOOL:{"name":"get_tree","args":{}}',
    '    → Returns the recursive Explorer tree. Optional args: path, maxDepth, maxNodes.',
    '    Example: TOOL:{"name":"get_tree","args":{"path":"Workspace","maxDepth":4}}',
    '',
    '  TOOL:{"name":"find_instances","args":{"query":"button","className":"TextButton","maxResults":50}}',
    '    → Searches instances by name/path and optional className.',
    '  TOOL:{"name":"search_scripts","args":{"query":"leader","maxResults":50}}',
    '    → Searches Lua source containers by name/path and source text.',
    '  TOOL:{"name":"get_selection","args":{}}',
    '    → Returns the objects currently selected in Roblox Studio.',
    '',
    '  TOOL:{"name":"read_script","args":{"path":"ServerScriptService.MyScript"}}',
    '    → Returns the Lua source code of the script at that path.',
    '',
    '  TOOL:{"name":"create_script","args":{"path":"ServerScriptService.MyScript","type":"Script","source":"-- lua code here"}}',
    '    → Creates a new script. type can be Script, LocalScript, or ModuleScript.',
    '',
    '  TOOL:{"name":"update_script","args":{"path":"ServerScriptService.MyScript","source":"-- new lua code"}}',
    '    → Overwrites the source of an existing script.',
    '',
    '  TOOL:{"name":"append_script","args":{"path":"ServerScriptService.MyScript","source":"-- code to append"}}',
    '    → Appends source to an existing Script, LocalScript, or ModuleScript.',
    '  TOOL:{"name":"create_module","args":{"path":"ReplicatedStorage.Modules.Inventory","source":"return {}"}}',
    '    → Creates a ModuleScript.',
    '  TOOL:{"name":"format_script","args":{"path":"ServerScriptService.MyScript"}}',
    '    → Applies safe source formatting and verifies the write.',
    '',
    '  TOOL:{"name":"get_properties","args":{"path":"Workspace.Part"}}',
    '    → Reads common Roblox properties and attributes from an Instance.',
    '  TOOL:{"name":"get_attributes","args":{"path":"Workspace.Part"}}',
    '    → Reads custom Attributes from an Instance.',
    '',
    '  TOOL:{"name":"set_properties","args":{"path":"Workspace.Part","properties":{"Name":"SpawnPart","Anchored":true,"Color":{"type":"Color3","r":0,"g":1,"b":1}}}}',
    '    → Changes properties. Typed values include Color3, Vector2, Vector3, UDim, UDim2, CFrame and Enum.',
    '',
    '  TOOL:{"name":"create_instance","args":{"parent":"StarterGui","name":"MainGui","className":"ScreenGui","properties":{"ResetOnSpawn":false},"children":[{"name":"Title","className":"TextLabel","properties":{"Text":"Welcome","Size":{"type":"UDim2","x":{"scale":0,"offset":300},"y":{"scale":0,"offset":60}}}}]}}',
    '    → Creates an Instance and optional nested children.',
    '',
    '  TOOL:{"name":"set_attributes","args":{"path":"Workspace.Part","attributes":{"ZenithManaged":true,"Role":"Spawn"}}}',
    '    → Sets custom Attributes on an Instance.',
    '',
    '  TOOL:{"name":"rename_instance","args":{"path":"Workspace.Part","name":"SpawnPart"}}',
    '    → Renames an existing Instance after checking for sibling conflicts.',
    '  TOOL:{"name":"move_instance","args":{"path":"Workspace.Part","parent":"ReplicatedStorage"}}',
    '    → Moves an existing Instance to another parent.',
    '',
    '  TOOL:{"name":"clone_instance","args":{"path":"ReplicatedStorage.Template","parent":"Workspace","name":"Copy"}}',
    '    → Clones an existing Instance and its descendants into another parent.',
    '',
    '  TOOL:{"name":"delete_instance","args":{"path":"Workspace.OldPart","confirm":true}}',
    '    → Deletes an Instance. Only when user explicitly requested deletion and confirm is true.',
    '',
    '  TOOL:{"name":"create_folder","args":{"parent":"ReplicatedStorage","name":"Systems"}}',
    '    → Creates a Folder.',
    '  TOOL:{"name":"create_gui","args":{"parent":"StarterGui","name":"ZenithGui","children":[]}}',
    '    → Convenience alias for creating a ScreenGui hierarchy.',
    '  TOOL:{"name":"create_ui_element","args":{"parent":"StarterGui.ZenithGui","name":"PlayButton","className":"TextButton","properties":{"Text":"Play"}}}',
    '    → Creates a GUI element under an existing GUI parent.',
    '  TOOL:{"name":"update_ui_element","args":{"path":"StarterGui.ZenithGui.PlayButton","properties":{"Text":"Start"}}}',
    '    → Updates GUI properties using the same typed property format.',
    '',
    '  TOOL:{"name":"create_part","args":{"parent":"Workspace","name":"SpawnPart","properties":{"Anchored":true}}}',
    '    → Creates a Part.',
    '  TOOL:{"name":"create_model","args":{"parent":"Workspace","name":"Enemy"}}',
    '    → Creates a Model.',
    '  TOOL:{"name":"create_spawn","args":{"parent":"Workspace","name":"SpawnLocation"}}',
    '    → Creates a SpawnLocation.',
    '  TOOL:{"name":"create_remote_event","args":{"parent":"ReplicatedStorage","name":"RoundEvent"}}',
    '    → Creates a RemoteEvent.',
    '  TOOL:{"name":"create_remote_function","args":{"parent":"ReplicatedStorage","name":"GetData"}}',
    '    → Creates a RemoteFunction.',
    '',
    '  TOOL:{"name":"get_output_logs","args":{"maxResults":100}}',
    '    → Reads the Studio output/log history.',
    '  TOOL:{"name":"clear_output","args":{}}',
    '    → Clears the Studio output.',
    '  TOOL:{"name":"save_place","args":{}}',
    '    → Saves the current place in Studio.',
    '  TOOL:{"name":"analyze_project","args":{}}',
    '    → Inspects live tree and scripts for common systems.',
    '  TOOL:{"name":"summarize_project","args":{}}',
    '    → Returns a concise summary based on live Studio data.',
    '  TOOL:{"name":"detect_systems","args":{}}',
    '    → Detects Leaderstats, DataStores, RemoteEvents, GUIs, rounds, combat, and inventory.',
    '',
    'HALLUCINATION PREVENTION:',
    '  - You have NEVER seen this developer\'s project before unless a TOOL_RESULT shows it.',
    '  - Do not assume any script exists, any instance exists, or any path is valid.',
    '  - Every fact about the project must come from a TOOL_RESULT in this conversation.',
    '  - If you are unsure whether something exists, use find_instances or get_tree to check.',
    '  - NEVER say "I created X", "I added Y", or "Done" without a successful TOOL_RESULT confirming it.',
  ].filter(Boolean).join('\n');

  return base + intentNote + studioContext;
}

// ── Execute one Studio command via the plugin ──────────────────────────────
async function executeStudioTool(sessionId, toolName, args, { timeoutMs = 12000, retries = 1 } = {}) {
  const validationError = validateToolCall(toolName, args);
  if (validationError) return { error: validationError };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const commandId = await enqueueCommand(sessionId, toolName, args || {});
    if (!commandId) return { error: 'Session expired — plugin disconnected.' };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await getResult(commandId);
      if (result !== null) {
        // Normalise nested error patterns
        if (result.error) return { error: result.error };
        if (result.result && typeof result.result === 'object') {
          if (result.result.error) return { error: result.result.error };
          if (result.result.success === false) {
            return { error: result.result.error || result.result.message || 'Studio command failed.' };
          }
        } else if (result.success === false) {
          return { error: result.error || result.message || 'Studio command failed.' };
        }
        return result.result ?? result;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    // On timeout, retry once before giving up
    if (attempt < retries) {
      console.warn(`[chat] tool ${toolName} timeout on attempt ${attempt + 1}, retrying...`);
    }
  }

  return {
    error:
      'Studio plugin did not respond within the timeout. ' +
      'Make sure Roblox Studio is open, the plugin is connected, and the place is loaded.',
  };
}

function validateToolCall(toolName, args) {
  if (!SUPPORTED_STUDIO_TOOLS.has(toolName)) {
    return `Unsupported Studio tool "${String(toolName)}". Use only the tools listed in the system prompt.`;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return `Invalid arguments for "${toolName}": args must be a JSON object.`;
  }
  if (toolName === 'delete_instance' && args.confirm !== true) {
    return 'delete_instance requires confirm:true and an explicit user request.';
  }

  for (const key of ['path', 'parent']) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || !args[key].trim())) {
      return `Invalid "${key}" for "${toolName}": expected a non-empty path string.`;
    }
  }
  if (args.path && args.path.includes('..')) {
    return `Invalid path for "${toolName}": parent traversal is not allowed.`;
  }
  if (args.parent && args.parent.includes('..')) {
    return `Invalid parent for "${toolName}": parent traversal is not allowed.`;
  }
  for (const key of ['source', 'query', 'name', 'className', 'type']) {
    if (args[key] !== undefined && typeof args[key] !== 'string') {
      return `Invalid "${key}" for "${toolName}": expected a string.`;
    }
  }
  if (typeof args.source === 'string' && args.source.length > 100_000) {
    return `Source for "${toolName}" is too large (maximum 100,000 characters).`;
  }
  return null;
}

// ── Parse TOOL:{...} lines from AI text output ─────────────────────────────
// Counts braces so nested JSON objects are handled correctly.
function extractToolCall(text) {
  const prefix = 'TOOL:';
  const idx = text.indexOf(prefix);
  if (idx === -1) return null;

  let start = idx + prefix.length;
  while (start < text.length && /\s/.test(text[start])) start++;
  if (text[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end === -1) return null;

  const jsonStr = text.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

// ── Stream from OpenRouter, collecting full text ───────────────────────────
async function streamWithCollection(messages, apiKey, model) {
  const chain = [model, ...FALLBACK_CHAIN.filter(m => m !== model)];
  const failures = [];

  for (const m of chain) {
    let upRes;
    try {
      upRes = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://xzenith.vercel.app',
          'X-Title':      'Zenith - Roblox Studio AI',
        },
        body: JSON.stringify({ model: m, stream: true, max_tokens: 4096, messages }),
      });
    } catch (err) {
      console.warn(`[chat/collect] model ${m} network error: ${err.message} — trying next`);
      failures.push(`${m}: network error (${err.message || 'request failed'})`);
      continue;
    }

    if (!upRes.ok) {
      let errBody = '';
      try { errBody = await upRes.text(); } catch { /* ignore */ }
      console.warn(`[chat/collect] model ${m} HTTP ${upRes.status}: ${errBody.slice(0, 200)} — trying next`);
      failures.push(`${m}: HTTP ${upRes.status}`);
      continue;
    }

    const reader  = upRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';
    let full      = '';
    let streamError = null;

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
            if (chunk.error) {
              streamError = `${chunk.error.message || JSON.stringify(chunk.error)} (code ${chunk.error.code || '?'})`;
              break;
            }
            const text = chunk.choices?.[0]?.delta?.content;
            if (text) full += text;
          } catch { /* skip malformed SSE line */ }
        }
        if (streamError) break;
      }
    } catch { /* stream interrupted */ }

    if (streamError) {
      console.warn(`[chat/collect] model ${m} in-stream error: ${streamError} — trying next`);
      failures.push(`${m}: ${streamError.slice(0, 160)}`);
      continue;
    }
    if (full) return { model: m, text: full };

    console.warn(`[chat/collect] model ${m} returned empty content — trying next`);
    failures.push(`${m}: empty response`);
  }

  const allRateLimited =
    failures.length > 0 && failures.every(f => f.includes(': HTTP 429'));
  if (allRateLimited) {
    return {
      error:
        'OpenRouter is rate-limiting every free model (HTTP 429). ' +
        'Wait for the daily limit to reset or add OpenRouter credits.',
    };
  }
  return { error: failures.join('; ') || 'no model response' };
}

// ── Stream pre-built text to client via SSE ────────────────────────────────
function streamTextToClient(res, model, text, { headerAlreadySent = false } = {}) {
  if (!headerAlreadySent) {
    writeSSE(res, { provider: 'OpenRouter', model });
  }
  const CHUNK = 40;
  for (let i = 0; i < text.length; i += CHUNK) {
    writeSSE(res, { content: text.slice(i, i + CHUNK) });
  }
}

// ── Plain streaming (no Studio) ────────────────────────────────────────────
async function plainStream(messages, apiKey, model, res) {
  const chain = [model, ...FALLBACK_CHAIN.filter(m => m !== model)];
  const failures = [];

  for (const m of chain) {
    let upRes;
    try {
      upRes = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://xzenith.vercel.app',
          'X-Title':      'Zenith - Roblox Studio AI',
        },
        body: JSON.stringify({ model: m, stream: true, max_tokens: 4096, messages }),
      });
    } catch (err) {
      console.warn(`[chat] model ${m} network error: ${err.message} — trying next`);
      failures.push(`${m}: network error`);
      continue;
    }

    if (!upRes.ok) {
      let errBody = '';
      try { errBody = await upRes.text(); } catch { /* ignore */ }
      failures.push(`${m}: HTTP ${upRes.status}`);
      console.warn(`[chat] model ${m} HTTP ${upRes.status} — trying next`);
      continue;
    }

    const reader   = upRes.body.getReader();
    const decoder  = new TextDecoder();
    let buffer     = '';
    let sentHeader = false;
    let gotContent = false;
    let streamErr  = null;

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
            if (chunk.error) {
              streamErr = `${chunk.error.message || JSON.stringify(chunk.error)} (code ${chunk.error.code || '?'})`;
              break;
            }
            const text = chunk.choices?.[0]?.delta?.content;
            if (text) {
              if (!sentHeader) {
                writeSSE(res, { provider: 'OpenRouter', model: m });
                sentHeader = true;
              }
              gotContent = true;
              writeSSE(res, { content: text });
            }
          } catch { /* skip malformed SSE line */ }
        }
        if (streamErr) break;
      }
    } catch { /* stream interrupted */ }

    if (streamErr) {
      failures.push(`${m}: ${streamErr}`);
      continue;
    }
    if (gotContent) {
      writeSSE(res, { done: true });
      res.end();
      return;
    }
    failures.push(`${m}: empty response`);
  }

  const allRateLimited =
    failures.length > 0 && failures.every(f => f.includes(': HTTP 429'));
  const error = allRateLimited
    ? 'OpenRouter is rate-limiting every free model (HTTP 429). Wait for the daily limit to reset or add OpenRouter credits.'
    : `All AI models are currently unavailable. ${failures.join('; ') || 'No model response.'}`;
  writeSSE(res, { error });
  writeSSE(res, { done: true });
  res.end();
}

// ── Write tool classification ──────────────────────────────────────────────
// Write tools mutate Studio. After they succeed the AI must NOT reproduce
// the source code it just wrote — that creates a slow, cluttered response
// and is identical to hallucination from the developer's perspective.
const WRITE_TOOLS = new Set([
  'update_script', 'create_script', 'append_script', 'create_module',
  'format_script', 'create_instance', 'create_gui', 'create_ui_element',
  'update_ui_element', 'create_part', 'create_model', 'create_spawn',
  'create_remote_event', 'create_remote_function', 'create_folder',
  'rename_instance', 'move_instance', 'clone_instance', 'delete_instance',
  'set_properties', 'set_attributes', 'save_place', 'clear_output',
]);

// ── Build TOOL_RESULT injection message ───────────────────────────────────
// Framing is write-tool-aware: write tools get a strict "no code" rule,
// read tools get a summarize rule that allows referencing content.
function buildToolResultMessage(toolName, toolResult, isError) {
  const resultJson = JSON.stringify(toolResult, null, 2);

  if (isError) {
    return (
      `TOOL_RESULT [${toolName}] — FAILED\n` +
      `${resultJson}\n\n` +
      `RESPONSE RULES:\n` +
      `  - Explain the error in plain language (1–2 sentences).\n` +
      `  - Do NOT show Lua code or JSON data.\n` +
      `  - If recoverable (wrong path, etc.), output a TOOL:{...} fix immediately.\n` +
      `  - Never claim the action succeeded.`
    );
  }

  if (WRITE_TOOLS.has(toolName)) {
    return (
      `TOOL_RESULT [${toolName}] — SUCCESS\n` +
      `${resultJson}\n\n` +
      `RESPONSE RULES (WRITE OPERATION — STRICT):\n` +
      `  - Confirm what was done in 1–2 sentences. Name the specific instance or path.\n` +
      `  - Do NOT reproduce or display any Lua source code — not even a snippet.\n` +
      `  - Do NOT show raw JSON data from the result.\n` +
      `  - Do NOT open a code block. Do NOT say "Here is the code:" or similar.\n` +
      `  - If another tool is still needed, output TOOL:{...} now instead of explaining.\n` +
      `  - Base your answer ONLY on this TOOL_RESULT. Do not invent details.`
    );
  }

  // Read / inspect tools (read_script, get_tree, find_instances, etc.)
  return (
    `TOOL_RESULT [${toolName}] — SUCCESS\n` +
    `${resultJson}\n\n` +
    `RESPONSE RULES (READ OPERATION):\n` +
    `  - Summarize the key findings concisely.\n` +
    `  - Show code only if the developer explicitly asked to see the source.\n` +
    `  - Do NOT reproduce the full output verbatim.\n` +
    `  - If another tool is needed to complete the task, output TOOL:{...} now.\n` +
    `  - Base your answer ONLY on this TOOL_RESULT.`
  );
}

// ── Detect when AI skipped a required tool ────────────────────────────────
// If we're in studio mode, the request clearly needed a tool, and the AI
// responded with no TOOL: call, inject a reminder and retry once.
function buildToolEnforcementMessage(userContent) {
  return (
    `SYSTEM: Your last response did not include a TOOL: call, but the developer's request ` +
    `requires a Studio action:\n"${userContent}"\n\n` +
    `You MUST use a tool. Do NOT describe the action or write example code instead.\n` +
    `Look at the available tools in the system prompt and call the appropriate one now.\n` +
    `Output ONLY the TOOL:{...} line.`
  );
}

// ── Per-round mode directives ──────────────────────────────────────────────
// These are injected as the final system message in each AI call so the
// model always reads the current-phase instruction last.
//
// TOOL_CALL phase  — before any tool has run: output ONLY the tool call.
// EXPLANATION phase — after TOOL_RESULT: respond without source-code dumps.

const TOOL_CALL_DIRECTIVE =
  'DIRECTIVE — TOOL SELECTION MODE:\n' +
  'Output ONLY the next TOOL:{...} JSON line needed to fulfil this request.\n' +
  'One optional "PLAN: ..." prefix line is allowed (one sentence, no code).\n' +
  'Do NOT write Lua code, explanations, or commentary of any kind.\n' +
  'Do NOT call more than one tool — one TOOL:{...} per response, then stop.';

const EXPLANATION_DIRECTIVE =
  'DIRECTIVE — EXPLANATION MODE:\n' +
  'You have received a TOOL_RESULT. Respond to the developer now.\n' +
  'WRITE tools (update_script, create_script, append_script, create_instance, etc.):\n' +
  '  • 1–2 sentences confirming what was done. Name the path or instance.\n' +
  '  • Do NOT show Lua source code. Do NOT open a code block.\n' +
  '  • Do NOT show raw JSON output.\n' +
  'READ tools (read_script, get_tree, find_instances, get_properties, etc.):\n' +
  '  • Summarize key findings briefly.\n' +
  '  • Show code only if the developer explicitly asked to see it.\n' +
  'ALL cases:\n' +
  '  • If another tool is still needed, output TOOL:{...} instead of explaining.\n' +
  '  • Never claim success beyond what the TOOL_RESULT confirms.\n' +
  '  • Never reproduce the full TOOL_RESULT verbatim.';

function buildCallMessages(messages, toolsExecuted) {
  const directive = toolsExecuted === 0 ? TOOL_CALL_DIRECTIVE : EXPLANATION_DIRECTIVE;
  return [...messages, { role: 'system', content: directive }];
}

// ── Agentic loop: call AI → check for TOOL → execute → repeat ─────────────
async function agentLoop(messages, apiKey, model, sessionId, res, needsStudio) {
  const MAX_ROUNDS = 12;        // increased for complex multi-step workflows
  const MAX_TOOL_ENFORCEMENT_RETRIES = 1; // inject reminder if tool skipped
  let headerSent = false;
  let toolEnforcementRetries = 0;
  let toolsExecuted = 0; // how many tools have actually run this turn

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Inject the per-phase directive as the final system message so the
    // model always reads the current-phase instruction last.
    const callMessages = buildCallMessages(messages, toolsExecuted);
    const result = await streamWithCollection(callMessages, apiKey, model);

    if (!result || result.error) {
      writeSSE(res, {
        error: `All AI models are currently unavailable. ${result?.error || 'No model response.'}`,
      });
      writeSSE(res, { done: true });
      res.end();
      return;
    }

    const { text, model: usedModel } = result;

    // Check if AI wants to call a tool
    const toolCall = extractToolCall(text);

    if (!toolCall) {
      // ── Tool enforcement: AI skipped a required tool ──────────────────
      // Only enforce on the first round, and only if intent detection says
      // a Studio action was required.
      if (needsStudio && toolsExecuted === 0 && round < MAX_ROUNDS - 1 && toolEnforcementRetries < MAX_TOOL_ENFORCEMENT_RETRIES) {
        toolEnforcementRetries++;
        // The last user message is the most recent original request
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user' && !m.content.startsWith('TOOL_RESULT') && !m.content.startsWith('SYSTEM:'));
        if (lastUserMsg) {
          // Stream the AI text so far, but append an enforcement nudge
          if (!headerSent) {
            writeSSE(res, { provider: 'OpenRouter', model: usedModel });
            headerSent = true;
          }
          // Don't stream the response — it's a skipped-tool response, ask AI to retry
          messages = [
            ...messages,
            { role: 'assistant', content: text },
            { role: 'user', content: buildToolEnforcementMessage(lastUserMsg.content) },
          ];
          continue;
        }
      }

      // No tool enforcement needed — this is the final answer
      streamTextToClient(res, usedModel, text, { headerAlreadySent: headerSent });
      headerSent = true;
      writeSSE(res, { done: true });
      res.end();
      return;
    }

    // ── Tool call detected ────────────────────────────────────────────────

    // Only emit pre-tool text if it is a PLAN: line.
    // Any other text before TOOL: is a hallucinated pre-execution claim
    // (e.g. "I'll update your script.") and must be discarded — it appears
    // to the user as success before the tool has even run.
    const toolMarkerIdx = text.indexOf('TOOL:');
    const rawPreText = toolMarkerIdx > 0 ? text.slice(0, toolMarkerIdx).trim() : '';
    const safePreText = rawPreText.startsWith('PLAN:') ? rawPreText : '';

    if (!headerSent) {
      writeSSE(res, { provider: 'OpenRouter', model: usedModel });
      headerSent = true;
    }
    if (safePreText) {
      writeSSE(res, { content: safePreText + '\n' });
    }

    writeSSE(res, { content: `\n⚙️ *Ejecutando \`${toolCall.name}\`...*\n` });

    // Execute the tool
    const toolResult = await executeStudioTool(sessionId, toolCall.name, toolCall.args || {});
    const isError = !!(toolResult && toolResult.error);
    toolsExecuted++;

    if (isError) {
      writeSSE(res, { content: `❌ *Error: ${toolResult.error}*\n\n` });
    } else {
      writeSSE(res, { content: `✅ *Resultado recibido de Studio.*\n\n` });
    }

    // Inject the result back into the conversation with strong framing
    messages = [
      ...messages,
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: buildToolResultMessage(toolCall.name, toolResult, isError),
      },
    ];
  }

  writeSSE(res, { error: 'Demasiadas llamadas a herramientas en una respuesta. Por favor, intenta de nuevo.' });
  writeSSE(res, { done: true });
  res.end();
}

// ── Main handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  let body;
  try { body = await parseJsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { messages = [], model = DEFAULT_MODEL, sessionId } = body;

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache, no-transform');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    writeSSE(res, { error: 'OPENROUTER_API_KEY is not configured.' });
    writeSSE(res, { done: true });
    return res.end();
  }

  // ── Studio connected: use agentic tool loop ───────────────────────────
  if (sessionId) {
    const session = await getSession(sessionId);
    if (!session) {
      writeSSE(res, {
        error: 'Studio session expired. Reconnect the plugin before asking Zenith to edit the project.',
      });
      writeSSE(res, { done: true });
      return res.end();
    }

    // Detect whether the user's request clearly requires a Studio tool call.
    // Used to enforce tool use and inject intent hint into the system prompt.
    const needsStudio = detectStudioIntent(messages);
    const systemPrompt = buildSystemPrompt(session, needsStudio);

    const openAIMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role:    m.role === 'ai' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    await agentLoop(openAIMessages, apiKey, model, sessionId, res, needsStudio);
    return;
  }

  // ── No Studio: plain streaming ────────────────────────────────────────
  const openAIMessages = [
    {
      role: 'system',
      content:
        'You are Zenith, an expert AI assistant for Roblox Studio development. ' +
        'You help developers write Lua scripts, debug code, generate GUIs, ' +
        'analyze Explorer hierarchies, and automate workflows inside Roblox Studio. ' +
        'No Studio plugin is connected right now, so you can only give advice and code. ' +
        'Do not output TOOL: lines or claim that you changed the project.',
    },
    ...messages.map(m => ({
      role:    m.role === 'ai' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  await plainStream(openAIMessages, apiKey, model, res);
};
