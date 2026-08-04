'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// /agent/parser.js — Módulo 1 de 10 del Zenith Architecture Blueprint.
//
// Responsabilidad única: convertir el texto crudo que devuelve el modelo en
// una estructura de tool call, o determinar por qué no se pudo.
//
// Funciones puras. Sin estado propio, sin llamadas de red, sin dependencia
// de sesión. `SUPPORTED_STUDIO_TOOLS` se recibe como parámetro (no se
// importa) para que este módulo no dependa de nada de chat.js — así se
// puede testear aislado con un simple `node -e`, como venimos haciendo con
// cada pieza de esta sesión.
//
// Extraído de api/chat.js sin cambios de lógica. Ver ZenithArchitectureBlueprint.md.
// ═══════════════════════════════════════════════════════════════════════════

// Extracts a balanced {...} JSON substring starting at `start` (which must
// point at the opening brace). Shared by both extraction paths below.
function extractBalancedJsonAt(text, start) {
  if (text[start] !== '{') return null;
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
  if (end === -1) return null;
  return text.slice(start, end + 1);
}

// Rescues common alternate tool-call envelopes that different models reach
// for instead of our TOOL:{"name":...,"args":...} convention — they've
// clearly seen OTHER agent frameworks' JSON schemas in training and default
// to those under pressure. Recognizes:
//   {"name":X,"args":Y}              (ours — passthrough)
//   {"tool":X,"args":Y}              (wrong key name)
//   {"name":X,"arguments":Y}         (wrong args key)
//   {"tool":X,"arguments":Y}         (both wrong)
//   {"commands":[{...}, ...]}        (multi-command envelope — takes first)
//   {"tool_calls":[{...}, ...]}      (OpenAI-native-style naming)
//   {"actions":[{...}, ...]}
// Returns { name, args } or null — does NOT check tool support, caller does.
function normalizeToolCallShape(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const nameKey = typeof parsed.name === 'string' ? parsed.name : (typeof parsed.tool === 'string' ? parsed.tool : null);
  if (nameKey) {
    const argsVal = parsed.args !== undefined ? parsed.args : (parsed.arguments !== undefined ? parsed.arguments : {});
    return { name: nameKey, args: argsVal };
  }
  const list = Array.isArray(parsed.commands) ? parsed.commands
    : Array.isArray(parsed.tool_calls) ? parsed.tool_calls
    : Array.isArray(parsed.actions) ? parsed.actions
    : null;
  if (list && list.length > 0) return normalizeToolCallShape(list[0]);
  return null;
}

// supportedTools: a Set<string> of valid tool names — passed in, not
// imported, so this module has zero dependency on chat.js's tool registry.
function extractToolCall(text, supportedTools) {
  const prefix = 'TOOL:';
  const idx = text.indexOf(prefix);

  let jsonStr = null;
  if (idx !== -1) {
    let start = idx + prefix.length;
    while (start < text.length && /\s/.test(text[start])) start++;
    jsonStr = extractBalancedJsonAt(text, start);
  } else {
    // No "TOOL:" prefix anywhere. Before giving up, check whether the
    // response is essentially a JSON object the model wrote in place of the
    // prefix convention — either right at the start, or after a legitimate
    // "PLAN: ..." narration line (so a model that narrates AND forgets the
    // prefix doesn't lose the whole tool call over a formatting slip).
    const braceIdx = text.indexOf('{');
    if (braceIdx !== -1) {
      const before = text.slice(0, braceIdx).trim();
      const acceptablePrefix = before === '' || /^PLAN:/i.test(before) || before.length < 40;
      if (acceptablePrefix) jsonStr = extractBalancedJsonAt(text, braceIdx);
    }
  }
  if (!jsonStr) return null;

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
  const normalized = normalizeToolCallShape(parsed);
  if (!normalized) return null;
  if (typeof normalized.name !== 'string' || !supportedTools.has(normalized.name)) return null;
  if (normalized.args !== undefined && (typeof normalized.args !== 'object' || normalized.args === null || Array.isArray(normalized.args))) {
    return null;
  }

  return normalized;
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
  const withoutToolLines = text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('TOOL:'))
    .join('\n')
    .trim();

  // Defense in depth: if what's LEFT (or the original text) is itself a bare
  // JSON object shaped like a tool call attempt, never show that to the
  // user as if it were a real answer — replace it with an honest note.
  // This matters because the retry that would normally catch a malformed
  // tool call is gated on `needsStudio`, which isn't always true for the
  // specific round that produces this text.
  const candidate = withoutToolLines || text.trim();
  if (candidate.startsWith('{') && candidate.endsWith('}')) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && (parsed.tool || parsed.name) && parsed.args !== undefined) {
        return "I tried to run a Studio command but formatted it incorrectly, so nothing executed. Could you try that again?";
      }
    } catch { /* not JSON, or not shaped like a tool call — show as-is */ }
  }
  return withoutToolLines;
}

// ── Detect clarifying questions ────────────────────────────────────────────
// When the agent is ambiguous about the target (many scripts, unnamed button,
// etc.) it is smarter to ask than to guess. We detect this to avoid
// triggering tool enforcement on a valid clarifying response.
function isAskingClarification(text) {
  if (!text || text.length > 500) return false; // Long responses are explanations, not questions
  if (text.includes('TOOL:')) return false;       // Tool calls are not clarifying questions
  if (text.includes('```')) return false;         // Code blocks are not questions

  const lower = text.toLowerCase();

  // Explicit questions ending with ?
  if (text.trim().endsWith('?') || /\?\s*$/.test(text.trim())) return true;

  // Implicit clarification patterns (statements that indicate need for more info)
  const clarificationPatterns = [
    /\bno puedo ver\b.*\bcuál\b/i,           // "no puedo ver cuál..."
    /\bthere (are|is) (multiple|several)\b/i, // "there are multiple..."
    /\bvarios\b.*\bscripts\b/i,               // "varios scripts..."
    /\bwhich one\b/i,                         // "which one..."
    /\bcuál de\b/i,                           // "cuál de..."
    /\bpodría especificar\b/i,                // "podría especificar..."
    /\bneed to know\b/i,                      // "need to know..."
    /\bno estoy seguro\b/i,                   // "no estoy seguro..."
    /\bnot sure\b/i,                          // "not sure..."
    /\bdebería\b.*\b\?/i,                     // "debería...?"
  ];

  return clarificationPatterns.some(re => re.test(lower));
}

// ── Diagnose WHY extractToolCall returned null ─────────────────────────────
// "No TOOL: marker at all" and "wrote a TOOL: but the JSON was broken" need
// different corrective feedback. Lumping them together (as the old code did)
// meant a model that tried a complex nested payload and mangled the JSON
// got the same generic "you must use a tool" nudge as a model that just
// forgot to call one — which doesn't help it avoid repeating the mistake,
// and small/free models attempting large nested create_instance payloads
// with embedded Lua source strings are exactly the case that breaks this way.
function describeToolCallFailure(text, supportedTools) {
  const prefix = 'TOOL:';
  const idx = text.indexOf(prefix);

  let jsonStr = null;
  if (idx !== -1) {
    let start = idx + prefix.length;
    while (start < text.length && /\s/.test(text[start])) start++;
    if (text[start] !== '{') return { attempted: true, reason: 'malformed', detail: 'TOOL: was not followed by a JSON object.' };
    jsonStr = extractBalancedJsonAt(text, start);
    if (!jsonStr) return { attempted: true, reason: 'malformed', detail: 'The TOOL:{...} JSON was never closed (unbalanced braces).' };
  } else {
    const braceIdx = text.indexOf('{');
    if (braceIdx === -1) return { attempted: false };
    const before = text.slice(0, braceIdx).trim();
    const acceptablePrefix = before === '' || /^PLAN:/i.test(before) || before.length < 40;
    if (!acceptablePrefix) return { attempted: false };
    jsonStr = extractBalancedJsonAt(text, braceIdx);
    if (!jsonStr) return { attempted: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return idx !== -1
      ? { attempted: true, reason: 'malformed', detail: `Invalid JSON syntax: ${e.message}` }
      : { attempted: false };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { attempted: true, reason: 'shape', detail: 'TOOL: JSON must be an object, not an array or primitive.' };
  }

  const normalized = normalizeToolCallShape(parsed);
  if (!normalized) {
    return {
      attempted: true,
      reason: 'shape',
      detail: 'Could not find a "name"/"tool" key (or a "commands"/"tool_calls"/"actions" array) anywhere in ' +
        'the JSON you wrote. Use exactly: TOOL:{"name":"...","args":{...}}',
    };
  }
  if (typeof normalized.name !== 'string' || !supportedTools.has(normalized.name)) {
    return { attempted: true, reason: 'shape', detail: `"name" must be one of the supported tools (got ${JSON.stringify(normalized.name)}).` };
  }
  return { attempted: true, reason: 'shape', detail: '"args" must be a JSON object.' };
}

module.exports = {
  extractBalancedJsonAt,
  normalizeToolCallShape,
  extractToolCall,
  hasPlanText,
  sanitizeForDisplay,
  isAskingClarification,
  describeToolCallFailure,
};
