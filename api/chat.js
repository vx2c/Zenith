'use strict';
const { DEFAULT_MODEL, OPENROUTER_BASE, FALLBACK_CHAIN } = require('./aiService');
const { getSession, enqueueCommand, getResult } = require('./session-store');

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
function buildSystemPrompt(session) {
  const base =
    'You are Zenith, an expert AI assistant for Roblox Studio development. ' +
    'You help developers write Lua scripts, debug code, generate GUIs, ' +
    'analyze Explorer hierarchies, and automate workflows inside Roblox Studio. ' +
    'You know all Roblox APIs, Lua 5.1 scripting patterns, Remote Events/Functions, ' +
    'and game design best practices. Be concise and practical. When providing code, ' +
    'always use triple-backtick fenced code blocks with the language tag (lua, json, etc.).';

  if (!session) return base;

  const studioContext = [
    '\n\n--- STUDIO CONNECTED ---',
    session.placeId   ? `Place ID: ${session.placeId}` : '',
    session.username  ? `Creator: ${session.username}` : '',
    session.placeName ? `Place: ${session.placeName}` : '',
    '',
    'You have REAL tools to interact with the developer\'s Roblox Studio project.',
    'When the developer asks you to read or create or modify anything in their project,',
    'you MUST use the tool system below. NEVER describe an action without performing it first.',
    '',
    'TOOL SYSTEM:',
    'To call a tool, output a line that looks exactly like this (nothing else on that line):',
    '  TOOL:{"name":"tool_name","args":{...}}',
    '',
    'Available tools (every command runs in Roblox Studio and returns success/data/error):',
    '  TOOL:{"name":"ping","args":{}}',
    '    → Checks that the connected Studio plugin is responding.',
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
    '    → Creates an Instance and optional nested children. Prefer parent + name; full path "StarterGui.MainGui" is also accepted.',
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
    '    → Deletes an Instance only when the user explicitly requested it and confirm is true. Never use speculatively.',
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
    '    → Reads the Studio output history exposed by LogService.',
    '  TOOL:{"name":"clear_output","args":{}}',
    '    → Attempts the Studio clear-output API and reports if Roblox does not expose it.',
    '  TOOL:{"name":"save_place","args":{}}',
    '    → Attempts the Studio save API and reports its actual result.',
    '  TOOL:{"name":"analyze_project","args":{}}',
    '    → Inspects live tree and scripts for common systems.',
    '  TOOL:{"name":"summarize_project","args":{}}',
    '    → Returns a concise summary based on live Studio data.',
    '  TOOL:{"name":"detect_systems","args":{}}',
    '    → Detects Leaderstats, DataStores, RemoteEvents, GUIs, rounds, combat, and inventory.',
    '',
    'RULES:',
    '1. If the user asks to create, edit, read, or inspect anything in Studio → use the right tool.',
    '2. After outputting TOOL:{...}, STOP and wait. Do NOT continue the response.',
    '3. The system will execute the tool and inject the result. Then you continue.',
    '4. NEVER say "I created X" without having used the create_script tool first.',
    '5. NEVER tell the user to do something manually if a tool can do it.',
    '6. Treat TOOL_RESULT as authoritative: if it contains an error or success=false, explain the failure and never claim the change succeeded.',
    '7. For broad project questions, call get_tree or find_instances before making assumptions.',
    '8. Use create_instance with nested children to build complete GUIs in one verified operation.',
    '9. Never delete or overwrite user content unless the user explicitly asks for that exact change.',
  ].filter(Boolean).join('\n');

  return base + studioContext;
}

// ── Execute one Studio command via the plugin ──────────────────────────────
async function executeStudioTool(sessionId, toolName, args) {
  const commandId = await enqueueCommand(sessionId, toolName, args || {});
  if (!commandId) return { error: 'Session expired — plugin disconnected.' };

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await getResult(commandId);
    if (result !== null) {
      if (result.error) return { error: result.error };
      // The plugin historically returned execution failures as
      // { result: { error: "..." }, error: null }. Treat that as a failure,
      // otherwise the UI falsely reports "Listo" and the agent continues as
      // if Roblox Studio was changed.
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
    await new Promise(r => setTimeout(r, 500));
  }
  return { error: 'Studio plugin did not respond in 10s. Make sure Studio is open and the plugin is connected.' };
}

// ── Parse TOOL:{...} lines from AI text output ─────────────────────────────
function extractToolCall(text) {
  // Find "TOOL:" then extract a balanced JSON object.
  // The old regex /TOOL:\s*(\{[\s\S]*?\})/ was non-greedy and stopped at
  // the FIRST closing brace, breaking any tool call whose args contain nested
  // JSON objects (e.g. create_script with an args object). This parser counts
  // braces so it always finds the correct closing brace.
  const prefix = 'TOOL:';
  const idx = text.indexOf(prefix);
  if (idx === -1) return null;

  let start = idx + prefix.length;
  // Skip optional whitespace between "TOOL:" and "{"
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

  if (end === -1) return null; // unbalanced braces — AI truncated the JSON

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
      continue;
    }

    if (!upRes.ok) {
      let errBody = '';
      try { errBody = await upRes.text(); } catch { /* ignore */ }
      console.warn(`[chat/collect] model ${m} HTTP ${upRes.status}: ${errBody.slice(0, 200)} — trying next`);
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
            // OpenRouter sometimes returns HTTP 200 but with an error in the body
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
      continue;
    }
    if (full) return { model: m, text: full };

    console.warn(`[chat/collect] model ${m} returned empty content — trying next`);
  }
  return null;
}

// ── Stream pre-built text to client via SSE ────────────────────────────────
function streamTextToClient(res, model, text) {
  writeSSE(res, { provider: 'OpenRouter', model });
  // Stream in small chunks so the UI feels alive
  const CHUNK = 40;
  for (let i = 0; i < text.length; i += CHUNK) {
    writeSSE(res, { content: text.slice(i, i + CHUNK) });
  }
}

// ── Plain streaming (no Studio) ────────────────────────────────────────────
async function plainStream(messages, apiKey, model, res) {
  const chain = [model, ...FALLBACK_CHAIN.filter(m => m !== model)];

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
      continue;
    }

    if (!upRes.ok) {
      let errBody = '';
      try { errBody = await upRes.text(); } catch { /* ignore */ }
      console.warn(`[chat] model ${m} HTTP ${upRes.status}: ${errBody.slice(0, 200)} — trying next`);
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
            // Detect OpenRouter in-stream errors (HTTP 200 but error in body)
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
    } catch { /* stream interrupted — fall through */ }

    if (streamErr) {
      console.warn(`[chat] model ${m} in-stream error: ${streamErr} — trying next`);
      continue;
    }
    if (gotContent) {
      writeSSE(res, { done: true });
      res.end();
      return;
    }

    console.warn(`[chat] model ${m} returned empty content — trying next`);
  }

  writeSSE(res, { error: 'All AI models are currently unavailable. Try again in a moment.' });
  writeSSE(res, { done: true });
  res.end();
}

// ── Agentic loop: call AI → check for TOOL → execute → repeat ─────────────
async function agentLoop(messages, apiKey, model, sessionId, res) {
  const MAX_ROUNDS = 6; // prevent infinite loops

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await streamWithCollection(messages, apiKey, model);

    if (!result) {
      writeSSE(res, { error: 'All AI models are currently unavailable.' });
      writeSSE(res, { done: true });
      res.end();
      return;
    }

    const { text, model: usedModel } = result;

    // Check if AI wants to call a tool
    const toolCall = extractToolCall(text);

    if (!toolCall) {
      // No tool call — this is the final answer, stream it to the client
      streamTextToClient(res, usedModel, text);
      writeSSE(res, { done: true });
      res.end();
      return;
    }

    // Show the user that a tool is running
    const textBeforeTool = text.split(/TOOL:\s*\{/)[0].trim();
    if (textBeforeTool) {
      if (round === 0) writeSSE(res, { provider: 'OpenRouter', model: usedModel });
      writeSSE(res, { content: textBeforeTool + '\n' });
    } else if (round === 0) {
      writeSSE(res, { provider: 'OpenRouter', model: usedModel });
    }

    writeSSE(res, { content: `\n⚙️ *Ejecutando \`${toolCall.name}\` en Studio...*\n` });

    // Execute the tool
    const toolResult = await executeStudioTool(sessionId, toolCall.name, toolCall.args || {});

    if (toolResult && toolResult.error) {
      writeSSE(res, { content: `❌ *Error en Studio:* ${toolResult.error}\n\n` });
    } else {
      writeSSE(res, { content: `✅ *Listo.*\n\n` });
    }

    // Inject the result back into the conversation
    messages = [
      ...messages,
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: `TOOL_RESULT for ${toolCall.name}:\n${JSON.stringify(toolResult, null, 2)}\n\nNow continue your response to the developer based on this result.`,
      },
    ];
  }

  writeSSE(res, { error: 'Too many tool calls in one response.' });
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
    // Never enter the agentic branch with an unknown session. A stale browser
    // session must not make the model emit TOOL: text that cannot execute.
    if (!session) {
      writeSSE(res, {
        error: 'Studio session expired. Reconnect the plugin before asking Zenith to edit the project.',
      });
      writeSSE(res, { done: true });
      return res.end();
    }
    const systemPrompt = buildSystemPrompt(session);

    const openAIMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role:    m.role === 'ai' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    await agentLoop(openAIMessages, apiKey, model, sessionId, res);
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
