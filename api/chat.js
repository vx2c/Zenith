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
    'Available tools:',
    '  TOOL:{"name":"get_tree","args":{}}',
    '    → Returns the list of top-level services in the Explorer.',
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
    'RULES:',
    '1. If the user asks to create, edit, read, or inspect anything in Studio → use the right tool.',
    '2. After outputting TOOL:{...}, STOP and wait. Do NOT continue the response.',
    '3. The system will execute the tool and inject the result. Then you continue.',
    '4. NEVER say "I created X" without having used the create_script tool first.',
    '5. NEVER tell the user to do something manually if a tool can do it.',
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
      return result.result ?? result;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { error: 'Studio plugin did not respond in 10s. Make sure Studio is open and the plugin is connected.' };
}

// ── Parse TOOL:{...} lines from AI text output ─────────────────────────────
function extractToolCall(text) {
  // Match TOOL:{...} on its own line (possibly with leading whitespace)
  const match = text.match(/TOOL:\s*(\{[\s\S]*?\})\s*(?:\n|$)/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ── Stream from OpenRouter, collecting full text ───────────────────────────
async function streamWithCollection(messages, apiKey, model) {
  const chain = [model, ...FALLBACK_CHAIN.filter(m => m !== model)];

  for (const m of chain) {
    const upRes = await fetch(OPENROUTER_BASE, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://xzenith.vercel.app',
        'X-Title':      'Zenith - Roblox Studio AI',
      },
      body: JSON.stringify({ model: m, stream: true, max_tokens: 8192, messages }),
    });

    if (!upRes.ok) continue;

    const reader  = upRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';
    let full      = '';

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
          const text  = chunk.choices?.[0]?.delta?.content;
          if (text) full += text;
        } catch { /* skip */ }
      }
    }

    return { model: m, text: full };
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
    const upRes = await fetch(OPENROUTER_BASE, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://xzenith.vercel.app',
        'X-Title':      'Zenith - Roblox Studio AI',
      },
      body: JSON.stringify({ model: m, stream: true, max_tokens: 8192, messages }),
    });

    if (!upRes.ok) continue;

    writeSSE(res, { provider: 'OpenRouter', model: m });

    const reader  = upRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

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
          const text  = chunk.choices?.[0]?.delta?.content;
          if (text) writeSSE(res, { content: text });
        } catch { /* skip */ }
      }
    }
    writeSSE(res, { done: true });
    res.end();
    return;
  }

  writeSSE(res, { error: 'All AI models are currently unavailable.' });
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

    writeSSE(res, { content: `✅ *Listo.*\n\n` });

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
        'No Studio plugin is connected right now, so you can only give advice and code.',
    },
    ...messages.map(m => ({
      role:    m.role === 'ai' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  await plainStream(openAIMessages, apiKey, model, res);
};
