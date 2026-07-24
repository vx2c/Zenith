'use strict';
const { streamChat, DEFAULT_MODEL, OPENROUTER_BASE, FALLBACK_CHAIN } = require('./aiService');
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

// ── Studio tools exposed to the AI ────────────────────────────────────────
const STUDIO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_tree',
      description: 'Get the list of top-level services in the Roblox Explorer. Use this to see what services exist before reading scripts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_script',
      description: 'Read the full Lua source code of a script in Roblox Studio.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Dot-separated path to the script, e.g. "ServerScriptService.MainScript" or "ReplicatedStorage.Modules.Utils"',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_script',
      description: 'Create a new script inside Roblox Studio at the specified path.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Full path including the script name, e.g. "ServerScriptService.MyScript"',
          },
          type: {
            type: 'string',
            enum: ['Script', 'LocalScript', 'ModuleScript'],
            description: 'Type of script to create. Default is Script.',
          },
          source: {
            type: 'string',
            description: 'Lua source code for the new script.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_script',
      description: 'Overwrite the source code of an existing script in Roblox Studio.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Dot-separated path to the script to update.',
          },
          source: {
            type: 'string',
            description: 'New Lua source code to write.',
          },
        },
        required: ['path', 'source'],
      },
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function writeSSE(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function buildSystemPrompt(session) {
  const base =
    'You are Zenith, an expert AI assistant for Roblox Studio development. ' +
    'You help developers write Lua scripts, debug code, generate GUIs, ' +
    'analyze Explorer hierarchies, and automate workflows inside Roblox Studio. ' +
    'You know all Roblox APIs (Players, Workspace, ReplicatedStorage, ' +
    'ServerScriptService, RunService, TweenService, DataStoreService, etc.), ' +
    'Lua 5.1 scripting patterns, Remote Events/Functions, and game design ' +
    'best practices. Be concise and practical. When providing code, always use ' +
    'triple-backtick fenced code blocks with the language tag (lua, json, etc.).';

  if (!session) return base;

  const parts = [
    'A Roblox Studio plugin is currently connected.',
  ];
  if (session.placeId)   parts.push(`Place ID: ${session.placeId}.`);
  if (session.username)  parts.push(`Creator ID: ${session.username}.`);
  if (session.placeName) parts.push(`Place Name: ${session.placeName}.`);
  parts.push(
    'You have REAL tools to interact with this project: get_tree, read_script, create_script, update_script. ' +
    'ALWAYS use these tools when the developer asks you to read or modify their project. ' +
    'NEVER pretend to have done something — only report actions after the tool confirms them.'
  );

  return base + '\n\n--- STUDIO CONNECTION ---\n' + parts.join(' ');
}

/**
 * Execute a single Studio command via the plugin and wait for the result.
 * The plugin heartbeats every 2s, so 8s is enough for two missed beats.
 */
async function executeStudioTool(sessionId, toolName, args) {
  const commandId = await enqueueCommand(sessionId, toolName, args || {});
  if (!commandId) return { error: 'Session expired — plugin disconnected.' };

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await getResult(commandId);
    if (result !== null) {
      if (result.error) return { error: result.error };
      return result.result ?? result;
    }
    await new Promise(r => setTimeout(r, 600));
  }
  return { error: 'Studio plugin did not respond in time. Make sure Studio is open and connected.' };
}

/**
 * Non-streaming call to OpenRouter with tool support.
 * Returns the first choice message.
 */
async function callWithTools(messages, apiKey, model) {
  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://xzenith.vercel.app',
      'X-Title':      'Zenith - Roblox Studio AI',
    },
    body: JSON.stringify({
      model,
      stream:      false,
      max_tokens:  4096,
      tools:       STUDIO_TOOLS,
      tool_choice: 'auto',
      messages,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message ?? null;
}

/**
 * Stream from OpenRouter given a full messages array (already includes tool results).
 */
async function streamFromMessages(messages, apiKey, model, sseRes) {
  // Try the model chain for reliability
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

    writeSSE(sseRes, { provider: 'OpenRouter', model: m });

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
          if (text) writeSSE(sseRes, { content: text });
        } catch { /* skip */ }
      }
    }
    writeSSE(sseRes, { done: true });
    sseRes.end();
    return;
  }

  writeSSE(sseRes, { error: 'All AI models are currently unavailable.' });
  writeSSE(sseRes, { done: true });
  sseRes.end();
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

  // ── Studio-connected path: real tool calling ──────────────────────────
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

    // Phase 1: non-streaming call to check for tool use
    let assistantMsg;
    try {
      assistantMsg = await callWithTools(openAIMessages, apiKey, model);
    } catch {
      assistantMsg = null;
    }

    if (assistantMsg && assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      // Execute each tool call against the Studio plugin
      const toolResults = [];
      for (const tc of assistantMsg.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }

        writeSSE(res, { content: `\n⚙️ *Running \`${tc.function.name}\` in Studio...*\n` });

        const result = await executeStudioTool(sessionId, tc.function.name, args);

        writeSSE(res, { content: `\n📦 *Result received.*\n\n` });

        toolResults.push({
          role:         'tool',
          tool_call_id: tc.id,
          content:      JSON.stringify(result),
        });
      }

      // Phase 2: stream the AI's final response with tool results injected
      const followUpMessages = [
        ...openAIMessages,
        assistantMsg,
        ...toolResults,
      ];
      await streamFromMessages(followUpMessages, apiKey, model, res);
      return;
    }

    // No tool calls — model returned a plain text answer.
    // If we got content from the non-streaming call, send it; otherwise fall through to streaming.
    if (assistantMsg && assistantMsg.content) {
      writeSSE(res, { provider: 'OpenRouter', model });
      writeSSE(res, { content: assistantMsg.content });
      writeSSE(res, { done: true });
      return res.end();
    }

    // Fallback: plain streaming with plugin context in prompt
    await streamFromMessages(openAIMessages, apiKey, model, res);
    return;
  }

  // ── No Studio connected: plain streaming ──────────────────────────────
  await streamChat(messages, res, model, null);
};
