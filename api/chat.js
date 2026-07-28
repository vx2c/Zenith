'use strict';
const { DEFAULT_MODEL, OPENROUTER_BASE, FALLBACK_CHAIN } = require('./aiService');
const {
  getSession,
  enqueueCommand,
  getResult,
  createWorkspaceTask,
  updateWorkspaceTask,
} = require('./session-store');

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

const WRITE_INTENT_PATTERNS = [
  /\b(crea[r]?|agrega[r]?|a[ñn]ade|añadir|insertar|haz|make|create|add|insert|build)\b/i,
  /\b(modifica[r]?|cambia[r]?|edita[r]?|actualiza[r]?|modify|change|edit|update|rename|rename)\b/i,
  /\b(elimina[r]?|borra[r]?|quita[r]?|delete|remove|destroy|clear)\b/i,
  /\b(mueve[r]?|clona[r]?|copi[ae][r]?|move|clone|copy|duplicate)\b/i,
];
function hasWriteIntent(text) {
  return !!text && WRITE_INTENT_PATTERNS.some(re => re.test(text));
}

// Server-side compound-deliverable detector. The PLAN: mechanism relies on
// the model itself recognizing "this request has multiple parts" and
// enumerating them — a small/free model can just skip that and announce a
// single generic step instead, which is exactly what happened here: it
// built the RemoteEvent/handler/script trio and never even acknowledged
// the GUI was a separate promised deliverable. Detecting this from the raw
// request text (not the model's self-report) means the checklist exists
// even when the model doesn't bother writing one.
const DELIVERABLE_BUCKETS = [
  { key: 'gui',   label: 'Create the GUI/interface (screen, button, etc.) described in the request', re: /\b(gui|screengui|bot[oó]n\w*|button|interfaz|textbutton|frame)\b/i },
  { key: 'logic', label: 'Create/wire the backend logic (script, RemoteEvent, leaderstats, etc.) described in the request', re: /\b(leaderstats|dinero|money|remoteevent|evento|script|servidor|handler|server\s*script)\b/i },
];
function detectCompoundDeliverables(text) {
  if (!text) return [];
  const matched = DELIVERABLE_BUCKETS.filter(b => b.re.test(text));
  return matched.length >= 2 ? matched.map(b => b.label) : [];
}

// Small/free fallback models are heavily RLHF'd to disclaim real-world
// capability ("I don't have real-time access", "I'm just an AI") and can
// say this even when the system prompt explicitly states the opposite.
// Catch it and correct it rather than let a false denial reach the user.
const CAPABILITY_DENIAL_PATTERNS = [
  /no\s+(estoy|tengo)\s+.{0,20}(conectad|acceso)/i,
  /not\s+(actually\s+)?connected\s+to\s+(your|the)\s+(roblox|studio)/i,
  /(don'?t|do\s+not)\s+have\s+(real-?time\s+)?access\s+to\s+(your|the)\s+(roblox|studio|project)/i,
  /i\s+(can'?t|cannot)\s+execute\s+(tools|actions|commands)\s+(inside|in|within)\s+(it|studio|your\s+project)/i,
  /tendrías\s+que\s+implementarlo\s+tú\s+mismo/i,
  /you('ll|\s+will)\s+need\s+to\s+implement\s+this\s+yourself/i,
];
function deniesCapability(text) {
  return !!text && CAPABILITY_DENIAL_PATTERNS.some(re => re.test(text));
}

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

// ── Context sufficiency check ──────────────────────────────────────────────
// Returns true when the user's message already contains enough identifying
// information to act without asking a clarifying question.
// Prevents the agent from asking "which script?" when the user already said
// "ServerScriptService.LeaderstatsSystem" or mentioned a specific name.
function hasEnoughContext(text) {
  if (!text) return false;
  // Dot-path like "ServerScriptService.LeaderstatsSystem" or "StarterGui.Frame.Button"
  if (/\b[A-Z][a-zA-Z]+\.[A-Z][a-zA-Z0-9_]/.test(text)) return true;
  // Quoted name: "LeaderstatsSystem" or 'MyScript'
  if (/["'][A-Za-z][A-Za-z0-9_]+["']/.test(text)) return true;
  // Roblox services mentioned with context (implies a specific target location)
  if (/\b(ServerScriptService|StarterGui|StarterPlayerScripts|ReplicatedStorage|Workspace|Players|SoundService|Teams|Lighting)\b/i.test(text)) return true;
  return false;
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
    ? '\n\n⚠️  STUDIO ACTION DETECTED: Use the appropriate tool to handle this request.\n' +
      'SMART AGENT RULE: If the request is ambiguous — e.g. the developer says "my script" or "that button" but you ' +
      'do not know which instance they mean — ask ONE short clarifying question instead of guessing or running ' +
      'get_tree blindly. Example: "I can see multiple scripts — which one do you mean: ServerScript, LocalScript, or ModuleScript?" ' +
      'After they answer, execute the tool immediately. When the target is clear, execute without asking.'
    : '';

  const studioContext = [
    '\n\n--- STUDIO CONNECTED ---',
    'You ARE connected to the developer\'s live Roblox Studio session RIGHT NOW, through a real plugin. ' +
      'NEVER say things like "I don\'t have real-time access", "I can\'t execute tools", "I\'m not connected", ' +
      'or "you\'ll need to implement this yourself" — all of that is FALSE while this section is present in your ' +
      'instructions. If the developer asks whether you\'re connected, confirm YES and name the place below.',
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
    '  T8. For questions about the project (tree, scripts, GUIs), call get_tree or find_instances first. ' +
      'NEVER call get_tree with no "path" on a real project — always target the specific service/folder ' +
      'relevant to the request (e.g. "StarterGui", "ServerScriptService", "Workspace") with maxDepth 2-3. ' +
      'A full untargeted tree wastes context and makes you lose track of the task. Widen the path only if ' +
      'the scoped call comes back empty.',
    '  T9. Before the first mutating call, output one line starting with "PLAN:" listing the steps.',
    ' T10. Never delete or overwrite content unless the user explicitly asked for that exact change.',
    ' T11. Never invent Roblox property values, paths, or class names you haven\'t read from TOOL_RESULT.',
    ' T12. After a WRITE tool succeeds: confirm in 1–2 sentences. NEVER show the Lua source code you wrote.',
    ' T13. After a READ tool succeeds: summarize findings. Show code only if the developer asked to see it.',
    ' T14. NEVER put a Script/LocalScript/ModuleScript with a "source" field inside create_instance/create_gui ' +
      '"children" — nested children do NOT execute source and will be created EMPTY. Build the instance tree ' +
      'first (structure only, no scripts), THEN call create_script separately for each script\'s logic, using ' +
      'the exact path you just created.',
    ' T15. CLARIFICATION OVER GUESSING: If the developer\'s request is ambiguous (e.g. "my script", "that button", ' +
      '"the error") AND their message contains NO dot-path (e.g. ServerScriptService.X), quoted name, or specific ' +
      'Roblox service name, ask ONE concise clarifying question. NEVER ask for info the user already provided — ' +
      'if they gave a path or name, use find_instances/search_scripts immediately without asking.',
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
    '    → Creates a new script. REQUIRED: path, type, source.',
    '    → path MUST be "ParentService.ScriptName" — the parent container must already exist in Studio.',
    '    → type must be exactly: Script | LocalScript | ModuleScript.',
    '    → If unsure whether the parent exists, call get_tree first.',
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
    '    → Creates an Instance and optional nested children. REQUIRED: parent, name, className.',
    '    → className must be a valid Roblox class name (e.g. ScreenGui, TextLabel, Part, Frame, RemoteEvent).',
    '    → children are for structural instances ONLY (Frames, TextLabels, TextButtons, etc.). Do NOT put a Script/LocalScript/ModuleScript with "source" here — see T14. Add scripts afterward with a separate create_script call.',
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

  // ── Tool-specific required fields ──────────────────────────────────────
  // create_script: path must be "ParentService.ScriptName"; type is mandatory.
  if (toolName === 'create_script') {
    if (!args.path || typeof args.path !== 'string' || !args.path.trim()) {
      return '"create_script" requires a "path" in the form "ParentService.ScriptName" (e.g. "ServerScriptService.MyScript").';
    }
    if (!args.path.includes('.')) {
      return (
        '"create_script" path must include the parent service: use "ParentService.ScriptName", not just "ScriptName". ' +
        'The parent container (e.g. ServerScriptService) must already exist in Studio. ' +
        'If unsure, call get_tree first to verify.'
      );
    }
    const VALID_SCRIPT_TYPES = new Set(['Script', 'LocalScript', 'ModuleScript']);
    if (!args.type || !VALID_SCRIPT_TYPES.has(args.type)) {
      return '"create_script" requires "type" to be one of: Script, LocalScript, ModuleScript.';
    }
  }

  // create_instance / create_ui_element: className is mandatory.
  if (toolName === 'create_instance' || toolName === 'create_ui_element') {
    if (!args.className || typeof args.className !== 'string' || !args.className.trim()) {
      return `"${toolName}" requires a non-empty "className" (e.g. "ScreenGui", "TextLabel", "Part", "Frame"). ` +
        `Correct shape: TOOL:{"name":"create_instance","args":{"parent":"StarterGui","name":"MyGui","className":"ScreenGui"}}`;
    }
    if (!args.name || typeof args.name !== 'string' || !args.name.trim()) {
      return `"${toolName}" requires a non-empty "name" for the new instance. ` +
        `Correct shape: TOOL:{"name":"create_instance","args":{"parent":"StarterGui","name":"MyGui","className":"ScreenGui"}}. ` +
        `If you're adding a piece (e.g. a button) to something you just created, do NOT call create_instance again for it — ` +
        `use a "children" array on the parent's create_instance call instead, or set "parent" to the exact path that was ` +
        `just returned in the previous TOOL_RESULT.`;
    }
    if (!args.parent || typeof args.parent !== 'string' || !args.parent.trim()) {
      return `"${toolName}" requires a non-empty "parent" path where the instance will be created. ` +
        `Use the exact "path" value returned by the previous successful TOOL_RESULT (e.g. "StarterGui.MyGui"), ` +
        `not a guessed name. Correct shape: TOOL:{"name":"create_instance","args":{"parent":"StarterGui.MyGui","name":"MyButton","className":"TextButton"}}`;
    }
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
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  // ── Shape validation ────────────────────────────────────────────────────
  // JSON.parse succeeding is not enough. If the model emits the wrong key
  // (e.g. "tool" instead of "name") or a non-string/unsupported name, this
  // used to fall through as { name: undefined, ... } and only get caught
  // much later inside executeStudioTool → validateToolCall, after already
  // being counted as an executed tool round (toolsExecuted++). That both
  // produced the opaque "Unsupported Studio tool undefined" error AND
  // prematurely flipped the agent loop into EXPLANATION_DIRECTIVE.
  //
  // Returning null here instead makes this indistinguishable from "no tool
  // call at all", which routes back into the existing tool-enforcement
  // retry path (see agentLoop) so the model gets a clean second chance to
  // emit a correctly-shaped TOOL:{...} line — without burning a real round.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.name !== 'string' || !SUPPORTED_STUDIO_TOOLS.has(parsed.name)) return null;
  if (parsed.args !== undefined && (typeof parsed.args !== 'object' || parsed.args === null || Array.isArray(parsed.args))) {
    return null;
  }

  return parsed;
}

// ── Detect PLAN text in AI response ───────────────────────────────────────
// Returns true when the AI wrote a multi-step plan (e.g. "PLAN:\n1. ...\n2. ...")
// without emitting a TOOL call. Used to force the agent to start executing.
function hasPlanText(text) {
  if (!text) return false;
  return /PLAN\s*:/i.test(text) && /\d+\.\s+\S/.test(text);
}

// ── Strip raw TOOL: lines from text shown to the user ─────────────────────
// Prevents malformed/unsupported TOOL:{...} JSON from appearing as plain text
// in the chat bubble when a tool call fails to parse.
function sanitizeForDisplay(text) {
  if (!text) return text;
  return text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('TOOL:'))
    .join('\n')
    .trim();
}

// ── Detect clarifying questions ────────────────────────────────────────────
// When the agent is ambiguous about the target (many scripts, unnamed button,
// etc.) it is smarter to ask than to guess. We detect this to avoid
// triggering tool enforcement on a valid clarifying response.
function isAskingClarification(text) {
  if (!text || text.length > 500) return false; // Long responses are explanations, not questions
  if (text.includes('TOOL:')) return false;       // Tool calls are not clarifying questions
  if (text.includes('```')) return false;         // Code blocks are not questions
  // Must end with a question mark (possibly followed by whitespace)
  const trimmed = text.trim();
  return trimmed.endsWith('?') || /\?\s*$/.test(trimmed);
}

// ── Diagnose WHY extractToolCall returned null ─────────────────────────────
// "No TOOL: marker at all" and "wrote a TOOL: but the JSON was broken" need
// different corrective feedback. Lumping them together (as the old code did)
// meant a model that tried a complex nested payload and mangled the JSON
// got the same generic "you must use a tool" nudge as a model that just
// forgot to call one — which doesn't help it avoid repeating the mistake,
// and small/free models attempting large nested create_instance payloads
// with embedded Lua source strings are exactly the case that breaks this way.
function describeToolCallFailure(text) {
  const prefix = 'TOOL:';
  const idx = text.indexOf(prefix);
  if (idx === -1) return { attempted: false };

  let start = idx + prefix.length;
  while (start < text.length && /\s/.test(text[start])) start++;
  if (text[start] !== '{') return { attempted: true, reason: 'malformed', detail: 'TOOL: was not followed by a JSON object.' };

  let depth = 0, inString = false, escape = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { attempted: true, reason: 'malformed', detail: 'The TOOL:{...} JSON was never closed (unbalanced braces).' };

  const jsonStr = text.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return { attempted: true, reason: 'malformed', detail: `Invalid JSON syntax: ${e.message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { attempted: true, reason: 'shape', detail: 'TOOL: JSON must be an object, not an array or primitive.' };
  }
  if (typeof parsed.name !== 'string' || !SUPPORTED_STUDIO_TOOLS.has(parsed.name)) {
    return { attempted: true, reason: 'shape', detail: `"name" must be one of the supported tools (got ${JSON.stringify(parsed.name)}).` };
  }
  return { attempted: true, reason: 'shape', detail: '"args" must be a JSON object.' };
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
// Small/free models lose track of the original task when a single
// TOOL_RESULT dumps tens of thousands of tokens of raw JSON (a get_tree on
// a real game can easily return 500+ nodes). Cap what actually goes into
// the conversation and teach the model to scope its next query down
// instead of re-requesting the same giant tree.
const MAX_RESULT_CHARS = 6000;

function truncateResultForModel(toolName, resultJson) {
  if (resultJson.length <= MAX_RESULT_CHARS) return { text: resultJson, wasTruncated: false };
  const cut = resultJson.slice(0, MAX_RESULT_CHARS);
  const hint =
    toolName === 'get_tree'
      ? 'This tree was too large to show in full. On your NEXT get_tree call, pass a specific "path" ' +
        '(e.g. "StarterGui", "ServerScriptService", a named folder) and a small "maxDepth" (2-3) to ' +
        'narrow down to just the area you actually need — do not re-request the whole game root.'
      : 'This result was too large to show in full. Narrow your next query (e.g. a more specific path, ' +
        'name filter, or search term) instead of requesting everything again.';
  return {
    text: `${cut}\n…[TRUNCATED — ${resultJson.length} chars total, showing first ${MAX_RESULT_CHARS}]\n\n${hint}`,
    wasTruncated: true,
  };
}

function buildToolResultMessage(toolName, toolResult, isError) {
  const rawJson = JSON.stringify(toolResult, null, 2);
  const { text: resultJson, wasTruncated } = truncateResultForModel(toolName, rawJson);

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
function buildToolEnforcementMessage(userContent, failure) {
  const detail = failure?.attempted
    ? `Your last TOOL: attempt was invalid — ${failure.detail}\n` +
      `Do NOT retry the exact same payload. Simplify it.\n` +
      `IMPORTANT: create_instance/create_gui "children" do NOT support a "source" ` +
      `field — nested Script/LocalScript/ModuleScript children are created EMPTY. ` +
      `Never put Lua code inside a nested child. Create the instance tree first ` +
      `(no source), then call create_script separately for any script logic.\n\n`
    : '';
  return (
    `SYSTEM: Your last response did not include a valid TOOL: call, but the developer's request ` +
    `requires a Studio action:\n"${userContent}"\n\n` +
    detail +
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
  'First check: does this request have MULTIPLE distinct deliverables (e.g. "a script AND a GUI", ' +
  '"a system that does X and also Y")? \n' +
  '  • If YES → start with a full numbered plan covering every deliverable: ' +
  '"PLAN: 1. <deliverable one> 2. <deliverable two> ..." — this becomes your checklist. You must complete ' +
  'every numbered item before the task is done; you may not treat item 1 alone as finishing the task.\n' +
  '  • If NO (a single deliverable) → a one-sentence "PLAN: <what and why>" is enough.\n' +
  'This PLAN line IS shown to the developer as your reasoning, so make it specific and useful, never generic ' +
  'filler like "PLAN: Working on it".\n' +
  'Then output the TOOL:{...} JSON line needed to fulfil the FIRST step of this request.\n' +
  'Do NOT write Lua code, explanations, or commentary beyond the PLAN line.\n' +
  'Do NOT call more than one tool — one TOOL:{...} per response, then stop.\n' +
  'EXCEPTION — CLARIFY FIRST: If the target is genuinely ambiguous (developer said "my script" or "the button" ' +
  'without any specific name, path, or Roblox service — and there could be many matches), output a single short ' +
  'question instead of a TOOL call. Do NOT ask if the user already gave a dot-path, service name, or quoted name — ' +
  'use find_instances/search_scripts immediately. One sentence ending with "?" — no code, no lists.';

// CONTINUE mode — a tool has run AND the original plan still has unfinished
// steps. Leads with "keep executing", not "respond now", so the model
// doesn't treat the first successful TOOL_RESULT as the end of the task.
const CONTINUE_DIRECTIVE =
  'DIRECTIVE — CONTINUE EXECUTION MODE:\n' +
  'You have received a TOOL_RESULT, but the plan is NOT finished yet.\n' +
  'Do NOT write a final response. Do NOT stop here.\n' +
  'Start with a "PLAN: <one short sentence>" line saying what you\'re about to do NEXT and why, based on what ' +
  'you just learned — this line IS shown to the developer as your reasoning (e.g. "PLAN: StarterGui is empty, ' +
  'creating the GUI now."). Never generic filler.\n' +
  'Then output the next TOOL:{...} JSON line required to complete the ' +
  'original request (e.g. after finding/checking something, proceed to ' +
  'create/update whatever the plan requires next).\n' +
  'Only skip TOOL:{...} and explain instead if the TOOL_RESULT reveals the ' +
  'task is impossible or genuinely already complete.';

const EXPLANATION_DIRECTIVE =
  'DIRECTIVE — EXPLANATION MODE:\n' +
  'You have received a TOOL_RESULT and the objective is fully satisfied. ' +
  'Respond to the developer now.\n' +
  'WRITE tools (update_script, create_script, append_script, create_instance, etc.):\n' +
  '  • 1–2 sentences confirming what was done. Name the path or instance.\n' +
  '  • Do NOT show Lua source code. Do NOT open a code block.\n' +
  '  • Do NOT show raw JSON output.\n' +
  'READ tools (read_script, get_tree, find_instances, get_properties, etc.):\n' +
  '  • Summarize key findings briefly.\n' +
  '  • Show code only if the developer explicitly asked to see it.\n' +
  'ALL cases:\n' +
  '  • If, on reflection, another tool is actually still needed, output TOOL:{...} instead of explaining.\n' +
  '  • Never claim success beyond what the TOOL_RESULT confirms.\n' +
  '  • Never reproduce the full TOOL_RESULT verbatim.';

// Stronger than CONTINUE_DIRECTIVE: used when the AI itself already announced
// specific remaining steps (via PLAN: lines) that have not been done yet.
// CONTINUE_DIRECTIVE's "genuinely already complete" escape hatch is exactly
// what let the agent stop after writing just ONE piece of a multi-part
// request (e.g. the money-on-death script, but not the GUI it also promised)
// — that escape hatch does not apply here, because the AI's own prior
// statements are proof the task isn't done.
function buildPendingStepsDirective(pendingSteps) {
  const list = pendingSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  return (
    'DIRECTIVE — UNFINISHED PLAN MODE:\n' +
    'You previously said you would do the following, and these are NOT done yet:\n' +
    list + '\n\n' +
    'Do NOT write a final response. Do NOT say the task is complete. The "genuinely already complete" ' +
    'exception does not apply — you announced this work yourself and a developer is relying on you to ' +
    'finish it. Start with a short "PLAN: <one sentence>" line naming which of the above you\'re doing next, ' +
    'then output the TOOL:{...} JSON line for it.'
  );
}

function buildCallMessages(messages, toolsExecuted, pendingSteps) {
  // Three phases:
  //   0 tools executed yet                → TOOL_CALL_DIRECTIVE       (pick first tool)
  //   tools executed, steps still pending  → PENDING_STEPS_DIRECTIVE   (finish what you announced — no bail-out)
  //   tools executed, nothing pending      → CONTINUE_DIRECTIVE        (keep going until AI decides done)
  const directive =
    toolsExecuted === 0
      ? TOOL_CALL_DIRECTIVE
      : (pendingSteps && pendingSteps.length > 0)
        ? buildPendingStepsDirective(pendingSteps)
        : CONTINUE_DIRECTIVE;
  // Merge the directive INTO the first system message content rather than
  // appending a new system message at the end of the conversation.
  // Most models (including gpt-oss-20b) only honour system messages at
  // position 0 — a mid-conversation system message causes the model to
  // produce truncated or empty responses ("stops writing").
  return messages.map((m, i) =>
    i === 0 && m.role === 'system'
      ? { ...m, content: m.content + '\n\n' + directive }
      : m
  );
}

// ── Tool label map ─────────────────────────────────────────────────────────
const TOOL_LABELS_MAP = {
  ping:                   'Checking Studio connection',
  get_tree:               'Reading Explorer tree',
  find_instances:         'Searching instances',
  get_selection:          'Getting selection',
  search_scripts:         'Searching scripts',
  read_script:            'Reading script',
  create_script:          'Creating script',
  update_script:          'Updating script',
  append_script:          'Appending to script',
  create_module:          'Creating module',
  format_script:          'Formatting script',
  get_properties:         'Reading properties',
  get_attributes:         'Reading attributes',
  set_properties:         'Setting properties',
  set_attributes:         'Setting attributes',
  create_instance:        'Creating instance',
  create_gui:             'Creating GUI',
  create_ui_element:      'Creating UI element',
  update_ui_element:      'Updating UI element',
  create_part:            'Creating part',
  create_model:           'Creating model',
  create_spawn:           'Creating spawn',
  create_remote_event:    'Creating RemoteEvent',
  create_remote_function: 'Creating RemoteFunction',
  create_folder:          'Creating folder',
  rename_instance:        'Renaming instance',
  move_instance:          'Moving instance',
  clone_instance:         'Cloning instance',
  delete_instance:        'Deleting instance',
  get_output_logs:        'Reading output logs',
  clear_output:           'Clearing output',
  save_place:             'Saving place',
  analyze_project:        'Analyzing project',
  summarize_project:      'Summarizing project',
  detect_systems:         'Detecting systems',
};

function toolLabelFor(name) {
  return TOOL_LABELS_MAP[name] ?? `Running ${name}`;
}

function toolDetailFor(name, args) {
  const path   = typeof args.path   === 'string' ? args.path   : undefined;
  const parent = typeof args.parent === 'string' ? args.parent : undefined;
  const iName  = typeof args.name   === 'string' ? args.name   : undefined;
  const query  = typeof args.query  === 'string' ? args.query  : undefined;
  const last   = (p) => p?.split('.').pop();

  switch (name) {
    case 'read_script': case 'update_script': case 'append_script':
    case 'format_script': case 'get_properties': case 'get_attributes':
    case 'set_properties': case 'set_attributes': case 'rename_instance':
    case 'move_instance': case 'clone_instance': case 'delete_instance':
    case 'create_script': case 'create_module':
      return last(path);
    case 'create_instance': case 'create_gui': case 'create_ui_element':
    case 'update_ui_element': case 'create_part': case 'create_model':
    case 'create_spawn': case 'create_remote_event': case 'create_remote_function':
    case 'create_folder':
      return iName ?? last(parent);
    case 'get_tree':
      return path ? last(path) : 'Explorer';
    case 'find_instances': case 'search_scripts':
      return query ? `"${query}"` : undefined;
    default:
      return undefined;
  }
}

// ── Agentic loop: call AI → check for TOOL → execute → repeat ─────────────
async function agentLoop(messages, apiKey, model, sessionId, res, needsStudio, task) {
  const MAX_ROUNDS = 12;        // increased for complex multi-step workflows
  const MAX_TOOL_ENFORCEMENT_RETRIES = 2; // inject reminder if tool skipped/malformed
  const MAX_CONSECUTIVE_READS = 3;        // force a write after this many read-only rounds
  let headerSent = false;
  let toolEnforcementRetries = 0;
  let pendingStepsForcedRounds = 0; // safety cap — see MAX_PENDING_STEPS_ROUNDS below
  const MAX_PENDING_STEPS_ROUNDS = 6; // pendingStep text-matching is fuzzy; don't let a stale
  let toolsExecuted = 0; // how many tools have actually run this turn
  let writeToolsExecuted = 0; // how many of those were successful WRITE_TOOLS (create/update/etc.)
  let consecutiveReadRounds = 0; // read-only tools in a row without any write
  const completedSteps = [];
  const taskEvents = [];
  const pendingSteps = Array.isArray(task?.plan) ? [...task.plan] : [];

  async function persistTask(patch) {
    if (!task?.taskId) return;
    try {
      await updateWorkspaceTask(sessionId, task.taskId, {
        ...patch,
        completedSteps,
        pendingSteps,
        events: taskEvents,
      });
    } catch (error) {
      // Redis persistence must never interrupt the plugin/tool execution loop.
      console.warn(`[chat] workspace task persistence failed: ${error.message}`);
    }
  }

  function emitWorkspaceEvent(event) {
    const enriched = { ...event, taskId: task?.taskId, timestamp: Date.now() };
    taskEvents.push(enriched);
    writeSSE(res, { workspace_event: enriched });
  }

  if (task?.taskId) {
    emitWorkspaceEvent({
      id: 'workspace-plan',
      type: 'plan',
      status: 'running',
      label: 'Planning workspace task',
      detail: task.objective,
    });
    await persistTask({ status: 'running', nextAction: 'Choose the first tool required by the objective.' });
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // ── Read-loop guard: force write after MAX_CONSECUTIVE_READS read-only tools ──
    // Prevents the model from looping on get_tree / find_instances / read_script
    // without ever transitioning to create_gui / create_script / update_script.
    if (consecutiveReadRounds >= MAX_CONSECUTIVE_READS) {
      const readCount = consecutiveReadRounds;
      consecutiveReadRounds = 0;
      messages = [
        ...messages,
        {
          role: 'user',
          content:
            `SYSTEM: You have called ${readCount} read-only tools in a row without writing or creating anything. ` +
            'You already have enough context to build. Your next response MUST output a write/create TOOL call: ' +
            'create_script, create_instance, create_gui, update_script, append_script, set_properties, or similar. ' +
            'Do NOT call get_tree, find_instances, read_script, search_scripts, or any other read tool.',
        },
      ];
    }

    // Inject the per-phase directive as the final system message so the
    // model always reads the current-phase instruction last.
    if (pendingSteps.length > 0) {
      if (pendingStepsForcedRounds >= MAX_PENDING_STEPS_ROUNDS) {
        // The fuzzy label-matching likely never cleared these — trust the
        // model's own judgment from here instead of forcing more rounds.
        pendingSteps.length = 0;
      } else {
        pendingStepsForcedRounds++;
      }
    }
    const callMessages = buildCallMessages(messages, toolsExecuted, pendingSteps);
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
      const failure = describeToolCallFailure(text);

      // ── False capability denial: correct it, don't let it reach the user ──
      // agentLoop only ever runs when a real, currently-valid session was
      // already confirmed by the caller (sessionId is only passed through
      // from the `if (session)` branch). If the model claims it has no
      // access anyway, that's a hallucinated refusal from the underlying
      // model, not a true system state — correct it immediately.
      if (sessionId && deniesCapability(text) && round < MAX_ROUNDS - 1 && toolEnforcementRetries < MAX_TOOL_ENFORCEMENT_RETRIES) {
        toolEnforcementRetries++;
        messages = [
          ...messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content:
              'SYSTEM: That is FALSE — you ARE connected to a live Roblox Studio session right now via a real ' +
              'plugin, and you DO have working tools (get_tree, create_instance, create_script, etc.). Do not ' +
              'say otherwise again in this conversation. Answer the developer\'s actual question, and if their ' +
              'request needs a Studio action, use the appropriate TOOL:{...} now.',
          },
        ];
        continue;
      }

      // ── Clarifying question: agent decided to ask instead of guessing ─────
      // This is VALID intelligent behavior. If the AI responded with a short
      // question (no tool, no code), stream it and let the user answer.
      // Only allow it if the user's message genuinely lacks a specific target
      // (no dot-path, quoted name, or Roblox service) — otherwise the agent
      // should use find_instances/search_scripts instead of asking.
      // Do NOT treat this as a failed tool call.
      const lastUserMsgForCheck = [...messages].reverse().find(m => m.role === 'user' && !m.content?.startsWith('TOOL_RESULT') && !m.content?.startsWith('SYSTEM:'));
      if (needsStudio && toolsExecuted === 0 && isAskingClarification(text) && !hasEnoughContext(lastUserMsgForCheck?.content || '')) {
        if (!headerSent) {
          writeSSE(res, { provider: 'OpenRouter', model: usedModel });
          headerSent = true;
        }
        streamTextToClient(res, usedModel, text, { headerAlreadySent: true });
        writeSSE(res, { done: true });
        res.end();
        return;
      }

      // ── Tool enforcement: AI skipped a required tool, or botched the JSON ──
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
            { role: 'user', content: buildToolEnforcementMessage(lastUserMsg.content, failure) },
          ];
          continue;
        }
      }

      // ── After tools ran: AI used an invalid/unsupported tool name ──────────
      // This happens when the model writes TOOL:{"name":"get_script",...}
      // (wrong name) instead of TOOL:{"name":"read_script",...}. The JSON
      // parses fine but shape-validation rejects it. Give the AI one retry
      // with an explicit list of valid tool names.
      if (toolsExecuted > 0 && text.includes('TOOL:') && round < MAX_ROUNDS - 1) {
        const supported = [...SUPPORTED_STUDIO_TOOLS].slice(0, 20).join(', ');
        messages = [
          ...messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content:
              'SYSTEM: Your TOOL:{...} call used an unsupported or malformed tool name. ' +
              'Valid tool names include: ' + supported + '. ' +
              'Output a corrected TOOL:{...} line now — one TOOL per response.',
          },
        ];
        continue;
      }

      // ── After tools ran: AI wrote a PLAN but forgot the TOOL call ────────
      // The model planned its next steps in prose (PLAN: 1. ... 2. ...) but
      // did not emit a TOOL:{...} line to start executing. Force the first step.
      if (toolsExecuted > 0 && hasPlanText(text) && round < MAX_ROUNDS - 1) {
        messages = [
          ...messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content:
              'SYSTEM: You wrote a PLAN but did not emit a TOOL:{...} call. ' +
              'Do NOT restate the plan. Output ONLY the first TOOL:{...} line to begin executing step 1 now.',
          },
        ];
        continue;
      }

      // ── After tools ran: read-only exploration, but the objective needed a build ──
      // The classic failure mode: get_tree/find_instances/read_script succeed,
      // the model produces a plain summary, and the loop was about to mark the
      // task "completed" — even though the developer asked to CREATE/EDIT
      // something and zero write tools ever ran. Give one explicit nudge
      // before accepting that as done. Scanning the WHOLE conversation (not
      // just the latest message) matters here: after a clarifying question,
      // the latest user message is just the answer (e.g. "StarterGui porfa"),
      // and the actual "crear una Gui…" request is a few turns back.
      const anyWriteIntent = messages.some(m => m.role === 'user' && hasWriteIntent(m.content || ''));
      if (
        toolsExecuted > 0 &&
        writeToolsExecuted === 0 &&
        anyWriteIntent &&
        round < MAX_ROUNDS - 1 &&
        toolEnforcementRetries < MAX_TOOL_ENFORCEMENT_RETRIES
      ) {
        toolEnforcementRetries++;
        messages = [
          ...messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content:
              'SYSTEM: You only inspected the project so far (read-only tools) — you have not built or changed ' +
              'anything yet. The developer\'s request requires creating/editing something. Do NOT summarize or ' +
              'stop here. Using what you just learned from the tree/search, output the next TOOL:{...} to start ' +
              'building (e.g. create_instance, create_script). Output ONLY that line.',
          },
        ];
        continue;
      }

      // No tool enforcement possible/left, and nothing ever actually ran.
      // Do NOT report this as a completed task — that was misleading the
      // developer into thinking Studio was updated when the plugin never
      // even received a command. Report it as failed instead.
      const neverExecuted = toolsExecuted === 0;
      const readOnlyDespiteWriteIntent = !neverExecuted && writeToolsExecuted === 0 && anyWriteIntent;
      const taskStatus = neverExecuted ? 'failed' : readOnlyDespiteWriteIntent ? 'incomplete' : 'completed';
      if (task?.taskId) {
        await persistTask({
          status: taskStatus,
          currentTool: null,
          lastToolResult: null,
          nextAction:
            taskStatus === 'failed'
              ? 'The AI could not produce a valid tool call. Try again, possibly with a simpler request.'
              : taskStatus === 'incomplete'
                ? 'The AI only inspected the project and never made the requested change. Ask it to continue/retry.'
                : 'Task complete. Review the verified result above.',
        });
        emitWorkspaceEvent({
          id: 'workspace-task',
          type: 'task',
          status: taskStatus === 'completed' ? 'completed' : 'error',
          label:
            taskStatus === 'failed'
              ? 'Workspace task failed — no Studio action was executed'
              : taskStatus === 'incomplete'
                ? 'Workspace task incomplete — only inspected, nothing was built'
                : 'Workspace task completed',
          ...(taskStatus !== 'completed' && failure?.detail ? { error: failure.detail } : {}),
        });
      }
      if (neverExecuted && needsStudio) {
        writeSSE(res, {
          error:
            'Zenith could not generate a valid Studio command for this request ' +
            '(the AI\'s tool call was malformed). Nothing was changed in Studio. ' +
            'Try rephrasing, or ask for a simpler step at a time.',
        });
        writeSSE(res, { done: true });
        res.end();
        return;
      }
      // Strip any raw TOOL: lines that weren't executed so they don't show
      // as plain JSON in the chat bubble (e.g. unsupported tool after retries exhausted)
      const displayText = sanitizeForDisplay(text);
      streamTextToClient(res, usedModel, displayText, { headerAlreadySent: headerSent });
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

    // PLAN: line → timeline plan card (not raw text)
    if (safePreText) {
      const planText = safePreText.replace(/^PLAN:\s*/i, '');
      writeSSE(res, { timeline: { id: round, label: planText, status: 'plan' } });
      if (task?.taskId) {
        // A numbered plan ("1. ... 2. ... 3. ...") lists multiple distinct
        // deliverables — split it into separate checklist entries so each
        // one survives independently. Previously the whole blob was pushed
        // as ONE entry and got removed the instant the FIRST tool matched
        // any part of it, silently dropping the rest of the checklist.
        const numberedItems = [...planText.matchAll(/\d+\.\s*([^\d].*?)(?=\s*\d+\.|$)/gs)]
          .map(m => m[1].trim())
          .filter(Boolean);
        const stepsToAdd = numberedItems.length > 1 ? numberedItems : [planText];
        task.plan = [...(task.plan || []), ...stepsToAdd];
        pendingSteps.push(...stepsToAdd);
        emitWorkspaceEvent({
          id: 'workspace-plan',
          type: 'plan',
          status: 'running',
          label: 'Agent plan',
          detail: planText,
        });
        await persistTask({ plan: task.plan, nextAction: planText });
      }
    }

    // Timeline: tool running (mini card)
    const tlLabel  = toolLabelFor(toolCall.name);
    const tlDetail = toolDetailFor(toolCall.name, toolCall.args || {});
    writeSSE(res, { timeline: { id: round, label: tlLabel, status: 'running', tool: toolCall.name, ...(tlDetail ? { detail: tlDetail } : {}) } });
    if (task?.taskId) {
      emitWorkspaceEvent({
        id: `workspace-tool-${round}`,
        type: 'tool',
        status: 'running',
        tool: toolCall.name,
        label: tlLabel,
        detail: tlDetail,
        step: round + 1,
      });
      await persistTask({
        currentTool: toolCall.name,
        nextAction: `Waiting for ${tlLabel.toLowerCase()} to finish.`,
      });
    }

    // Execute the tool
    const toolResult = await executeStudioTool(sessionId, toolCall.name, toolCall.args || {});
    const isError = !!(toolResult && toolResult.error);
    toolsExecuted++;
    if (!isError && WRITE_TOOLS.has(toolCall.name)) writeToolsExecuted++;

    // Track consecutive read-only rounds for the read-loop guard
    const READ_ONLY_TOOLS = new Set([
      'ping', 'get_tree', 'find_instances', 'get_selection', 'search_scripts',
      'read_script', 'get_properties', 'get_attributes', 'get_output_logs',
      'analyze_project', 'summarize_project', 'describe_instance',
    ]);
    if (!isError && READ_ONLY_TOOLS.has(toolCall.name)) {
      consecutiveReadRounds++;
    } else {
      consecutiveReadRounds = 0; // any write tool resets the counter
    }

    // Timeline: tool done or error (updates the card)
    writeSSE(res, { timeline: {
      id: round,
      label: tlLabel,
      status: isError ? 'error' : 'done',
      tool: toolCall.name,
      ...(tlDetail ? { detail: tlDetail } : {}),
      ...(isError ? { error: toolResult.error } : {}),
    } });
    if (task?.taskId) {
      const stepLabel = tlDetail ? `${tlLabel}: ${tlDetail}` : tlLabel;
      if (!isError) {
        completedSteps.push(stepLabel);
        const pendingIndex = pendingSteps.findIndex(step => step === stepLabel || step.includes(tlLabel));
        if (pendingIndex >= 0) pendingSteps.splice(pendingIndex, 1);
      }
      emitWorkspaceEvent({
        id: `workspace-tool-${round}`,
        type: 'tool',
        status: isError ? 'error' : 'completed',
        tool: toolCall.name,
        label: tlLabel,
        detail: tlDetail,
        step: round + 1,
        ...(isError ? { error: toolResult.error } : {}),
      });
      const serializedResult = JSON.stringify(toolResult);
      await persistTask({
        currentTool: null,
        lastToolResult: serializedResult.length > 4000 ? serializedResult.slice(0, 4000) + '…' : toolResult,
        nextAction: isError
          ? 'Evaluate the tool error and choose a safe recovery or explain the failure.'
          : 'Evaluate TOOL_RESULT and continue until the objective is verified.',
      });
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

  if (task?.taskId) {
    await persistTask({
      status: 'blocked',
      currentTool: null,
      nextAction: 'Tool limit reached. Start a new request to continue the task.',
    });
    emitWorkspaceEvent({
      id: 'workspace-task',
      type: 'task',
      status: 'error',
      label: 'Workspace task needs continuation',
      error: 'Tool limit reached.',
    });
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

  const { messages = [], model = DEFAULT_MODEL, sessionId, taskId } = body;

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
    const objective = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    let workspaceTask = null;
    try {
      workspaceTask = await createWorkspaceTask(sessionId, { taskId, objective });
    } catch (error) {
      console.warn(`[chat] workspace task initialization failed: ${error.message}`);
      workspaceTask = { taskId: taskId || null, objective, plan: [] };
    }
    // Force-seed the checklist for compound requests (GUI + backend logic)
    // instead of relying solely on the model to enumerate them itself.
    const forcedDeliverables = detectCompoundDeliverables(objective);
    if (forcedDeliverables.length > 0 && workspaceTask) {
      workspaceTask.plan = [...(workspaceTask.plan || []), ...forcedDeliverables];
    }

    const openAIMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role:    m.role === 'ai' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    await agentLoop(openAIMessages, apiKey, model, sessionId, res, needsStudio, workspaceTask);
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
