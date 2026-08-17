'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// /agent/intentClassifier.js — Módulo del Zenith Architecture Blueprint.
//
// Responsabilidad única: decidir QUÉ TIPO de pedido es esto, antes de que
// corra cualquier tool — bug report vs. construir algo nuevo, pedido
// compuesto o simple, si el usuario ya mencionó un target específico.
//
// Extraído por necesidad, no por orden: se detectó un bug real (ver
// diagnóstico en la conversación — pedido de "Walk for Money + GUI + efecto
// +1" con 43 palabras, 0 términos técnicos, 1 sola cláusula partible, que
// no disparó NINGUNA de las 2 señales existentes y terminó marcado
// "completed" con solo 2 tool calls de 6+ piezas necesarias). El fix
// pertenece a este módulo, no a chat.js — moverlo junto con la extracción
// en vez de parchear chat.js directamente.
// ═══════════════════════════════════════════════════════════════════════════

const WRITE_INTENT_PATTERNS = [
  /\b(crea[r]?|agrega[r]?|a[ñn]ade|añadir|insertar|haz|make|create|add|insert|build)\b/i,
  /\b(modifica[r]?|cambia[r]?|edita[r]?|actualiza[r]?|modify|change|edit|update|rename|rename)\b/i,
  /\b(elimina[r]?|borra[r]?|quita[r]?|delete|remove|destroy|clear)\b/i,
  /\b(mueve[r]?|clona[r]?|copi[ae][r]?|move|clone|copy|duplicate)\b/i,
];
function hasWriteIntent(text) {
  return !!text && WRITE_INTENT_PATTERNS.some(re => re.test(text));
}

// Companion to hasWriteIntent: detects "I have something that already
// exists and it's broken" framing, as opposed to "build me something new".
const BUG_REPORT_PATTERNS = [
  /\b(no funciona|no anda|no sirve|se rompi[oó]|est[aá] roto|no me deja|sigue fallando|sigue sin funcionar)\b/i,
  /\b(doesn'?t work|isn'?t working|is broken|stopped working|keeps failing|still fails|still broken)\b/i,
  /\bcuando\s+\w+.{0,30}\bno\s+(muero|funciona|pasa|recibo|gano|obtengo)\b/i,
  /\bwhen\s+\w+.{0,30}\bdoesn'?t\s+(work|happen|trigger|fire)\b/i,
  /\btengo un (problema|bug|error)\b/i,
  /\b(hay un bug|tiene un bug|hay un error)\b/i,
];
function hasBugReportIntent(text) {
  return !!text && BUG_REPORT_PATTERNS.some(re => re.test(text));
}

// Domain-agnostic compound-request detection. Three independent, purely
// structural signals — none needs to know what any Roblox concept IS:
//
//   1. splitActionClauses — finds multiple independent clauses joined by
//      conjunctions ("crea X y crea Y"), each with its own action verb.
//
//   2. countTechnicalTerms — counts distinct CamelCase/ALL-CAPS tokens
//      (TextLabel, WalkMoney, GUI, RemoteEvent, ...) — catches requests
//      that reference several EXISTING named pieces in one flowing sentence.
//
//   3. countTriggerPhrases — NEW. Counts repeated "cada vez que"/"every
//      time"/"whenever" style trigger phrases. Catches requests that
//      describe MULTIPLE distinct reactive behaviors for something being
//      built from scratch (no existing names to reference yet, so #2 is
//      blind; no clean "y crea X" split, so #1 is blind too). Confirmed
//      with real data: the failing request ("cada vez que camine gano
//      dinero... cada vez que camine aparecen +1...") has 2 occurrences;
//      a genuinely simple, single-purpose request tested alongside it
//      only ever has 0-1.
const CLAUSE_SPLIT_PATTERN = /,?\s+(?:y\s+(?:tambi[ée]n\s+)?|adem[aá]s\s+(?:de\s+)?|y\s+luego\s+|luego\s+|despu[eé]s\s+|and\s+(?:also\s+)?|then\s+|also\s+)/i;

function splitActionClauses(text) {
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const clauses = [];
  for (const sentence of sentences) {
    const parts = sentence.split(CLAUSE_SPLIT_PATTERN).map(p => p.trim()).filter(Boolean);
    clauses.push(...parts);
  }
  return clauses.filter(c => hasWriteIntent(c) && c.length > 8);
}

function countTechnicalTerms(text) {
  if (!text) return [];
  const matches = text.match(/\b[A-Z]{2,}\b|\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/g) || [];
  return [...new Set(matches)];
}

function countTriggerPhrases(text) {
  if (!text) return 0;
  const matches = text.match(/\b(cada\s+ve[sz]\s+que|cada\s+vez|every\s+time|whenever|cuando\s+el|cuando\s+la|when\s+the)\b/gi) || [];
  return matches.length;
}

function detectCompoundDeliverables(text) {
  const clauses = splitActionClauses(text);
  return clauses.length >= 2 ? clauses : [];
}

// True when a request looks complex but splitActionClauses/countTechnicalTerms
// couldn't literally extract separate steps from it. We can't seed good
// checklist items ourselves here without guessing, so this signal is used
// to make the round-0 directive REQUIRE the model to write its own detailed
// numbered plan instead of just suggesting it.
function looksComplexButUnstructured(text) {
  if (detectCompoundDeliverables(text).length > 0) return false; // already structured, handled elsewhere
  if (countTechnicalTerms(text).length >= 3) return true;
  if (countTriggerPhrases(text) >= 2) return true; // NEW — the fix
  return false;
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
function hasEnoughContext(text) {
  if (!text) return false;
  if (/\b[A-Z][a-zA-Z]+\.[A-Z][a-zA-Z0-9_]/.test(text)) return true;
  if (/["'][A-Za-z][A-Za-z0-9_]+["']/.test(text)) return true;
  if (/\b(ServerScriptService|StarterGui|StarterPlayerScripts|ReplicatedStorage|Workspace|Players|SoundService|Teams|Lighting)\b/i.test(text)) return true;
  return false;
}

// ── Extract mentioned script/system names from user query ─────────────────
function extractMentionedTargets(messages) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return [];
  const text = last.content || '';

  const targets = new Set();

  const dotPathRegex = /\b([A-Z][a-zA-Z0-9_]*\.[A-Z][a-zA-Z0-9_]*)\b/g;
  for (const match of text.matchAll(dotPathRegex)) {
    targets.add(match[1]);
  }

  const quotedRegex = /["']([A-Za-z][A-Za-z0-9_]*)["']/g;
  for (const match of text.matchAll(quotedRegex)) {
    targets.add(match[1]);
  }

  const systemKeywords = /\b(script|system|handler|manager|module|service)\b/i;
  if (systemKeywords.test(text)) {
    const camelCaseRegex = /\b([A-Z][a-zA-Z0-9]*(?:Handler|Manager|Script|System|Module|Service))\b/g;
    for (const match of text.matchAll(camelCaseRegex)) {
      targets.add(match[1]);
    }
  }

  return Array.from(targets);
}

// ── classify — single entry point, per ZenithArchitectureBlueprint.md ─────
function classify(messages) {
  const last = messages[messages.length - 1];
  const text = (last && last.role === 'user') ? (last.content || '') : '';
  return {
    needsStudio: detectStudioIntent(messages),
    isBugReport: hasBugReportIntent(text),
    isCompound: detectCompoundDeliverables(text).length > 0,
    seedChecklist: detectCompoundDeliverables(text),
    needsDetailedPlan: looksComplexButUnstructured(text),
    mentionedTargets: extractMentionedTargets(messages),
    hasWriteIntent: hasWriteIntent(text),
    hasEnoughContext: hasEnoughContext(text),
  };
}

module.exports = {
  hasWriteIntent,
  hasBugReportIntent,
  splitActionClauses,
  countTechnicalTerms,
  countTriggerPhrases,
  detectCompoundDeliverables,
  looksComplexButUnstructured,
  detectStudioIntent,
  hasEnoughContext,
  extractMentionedTargets,
  classify,
};
