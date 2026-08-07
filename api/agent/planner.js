'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// /agent/planner.js — Módulo 2 de 10 del Zenith Architecture Blueprint.
//
// Responsabilidad única: dueño del checklist de la tarea — crearlo,
// actualizarlo, y decidir si un item está resuelto.
//
// CAMBIO DE COMPORTAMIENTO REAL (no solo extracción):
//   El matching de "¿está esto resuelto?" que vivía en chat.js comparaba
//   contra un LABEL genérico ("Creating instance"), no contra los datos
//   reales de la tool ejecutada. Se probó con datos reales de
//   ZenithValidationLog.md (Evidencia #2) que esto fallaba incluso en el
//   caso más simple: "Gui" (del pedido del usuario) vs "MoneyGui"/
//   "ScreenGui" (los args reales de create_instance) nunca hacía match.
//   markCompleted() ahora también compara contra los ARGS reales de la
//   tool (className/name/path/query), no solo contra el label de display.
//
//   Límite real, documentado en vez de escondido: esto no resuelve brechas
//   de idioma (p.ej. "boton" en el pedido del usuario vs "TextButton" en
//   el className real) — ningún matching de texto resuelve eso sin un
//   diccionario de traducciones a mano, que es la trampa de mantenimiento
//   que ya descartamos. Para esos casos, la responsabilidad se transfiere
//   a la autoevaluación del modelo (Layer 3 aquí abajo), que sí entiende
//   el idioma en vez de comparar strings.
// ═══════════════════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  'the','a','an','and','or','with','described','request','etc',
  'de','la','el','en','una','un','con','que','para','ese','esa','del',
]);

function normalizeWords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

// ── markCompleted ───────────────────────────────────────────────────────
// Two-stage matching, in order of confidence:
//   1. Label-based keyword overlap (the original approach — kept, it does
//      catch some real cases, e.g. when the model's plan text happens to
//      share display-label wording).
//   2. NEW: args-based substring matching — compares the plan item's words
//      against the tool's actual arguments (className, name, path, query),
//      not the generic display label. This is what catches "Gui" matching
//      a created "MoneyGui"/"ScreenGui" that stage 1 misses entirely.
// Returns { pendingSteps: <updated array>, matchedIndex, matchedVia } —
// matchedVia is 'label' | 'args' | null, kept for debugging/evidence logs.
function markCompleted(pendingSteps, { toolName, args = {}, tlLabel, tlDetail }) {
  const stepLabel = tlDetail ? `${tlLabel}: ${tlDetail}` : tlLabel;
  const labelLower = stepLabel.toLowerCase();
  const labelWords = normalizeWords(stepLabel);

  const argBlob = [args.name, args.className, args.path, args.query]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ]+/g, '');

  let matchedIndex = -1;
  let matchedVia = null;

  for (let i = 0; i < pendingSteps.length; i++) {
    const step = pendingSteps[i];
    const stepLower = step.toLowerCase();

    // Stage 1 — label-based (original behaviour, kept)
    if (step === stepLabel || stepLower.includes(labelLower)) {
      matchedIndex = i; matchedVia = 'label'; break;
    }
    const stepWords = normalizeWords(step);
    const labelOverlap = stepWords.filter(w => labelWords.includes(w)).length;
    if (labelOverlap >= 2) {
      matchedIndex = i; matchedVia = 'label'; break;
    }

    // Stage 2 — NEW: args-based substring matching
    if (argBlob) {
      const stepWordsForArgs = normalizeWords(step);
      const hit = stepWordsForArgs.some(w => argBlob.includes(w));
      if (hit) { matchedIndex = i; matchedVia = 'args'; break; }
    }
  }

  if (matchedIndex === -1) return { pendingSteps, matchedIndex: -1, matchedVia: null };
  const updated = pendingSteps.slice();
  updated.splice(matchedIndex, 1);
  return { pendingSteps: updated, matchedIndex, matchedVia };
}

// ── parseModelPlan ──────────────────────────────────────────────────────
// Splits a numbered "1. ... 2. ... 3. ..." PLAN: line into separate items.
// Falls back to treating the whole text as ONE item if it isn't numbered.
function parseModelPlan(planText) {
  const numberedItems = [...planText.matchAll(/\d+\.\s*([^\d].*?)(?=\s*\d+\.|$)/gs)]
    .map(m => m[1].trim())
    .filter(Boolean);
  return numberedItems.length > 1 ? numberedItems : [planText];
}

// ── mergeOrReplace ──────────────────────────────────────────────────────
// The model's own detailed plan REPLACES a server-auto-seeded generic
// checklist the first time it appears (per user-approved design), instead
// of piling on top of it. Subsequent model plans just append normally.
function mergeOrReplace(currentPlan, modelItems, wasAutoSeeded) {
  if (modelItems.length > 1 && wasAutoSeeded) {
    return { plan: modelItems, pendingSteps: [...modelItems], stillAutoSeeded: false };
  }
  const plan = [...(currentPlan || []), ...modelItems];
  return { plan, pendingSteps: modelItems, stillAutoSeeded: wasAutoSeeded };
}

// ── buildContinuationDirective ──────────────────────────────────────────
function buildContinuationDirective(pendingSteps) {
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

// ── Layer 3: self-evaluation ─────────────────────────────────────────────
// The authoritative fallback for exactly what markCompleted's text-matching
// cannot resolve (language gaps like "boton" vs "TextButton") — the model
// understands the language, our regex does not. One attempt per task
// (state/cap lives in chat.js's orchestration loop, not here — this module
// stays stateless).
function buildSelfEvalRequest(pendingSteps) {
  return (
    'SYSTEM: Before finishing, confirm the real status of everything from your plan. Reply with ' +
    'EXACTLY this checklist, one line per item below, marking each [x] (verified done) or [ ] (not ' +
    'done) based on what you actually did — not what you assume:\n\n' +
    pendingSteps.map(s => `[ ] ${s}`).join('\n') + '\n\n' +
    'Output ONLY the checklist, nothing else.'
  );
}

// Returns { outcome: 'all_done' } | { outcome: 'still_pending', items } | { outcome: 'soft_pass' }
function parseSelfEvalResponse(text) {
  const checklistLines = [...text.matchAll(/\[( |x|X)\]\s*(.+)/g)];
  if (checklistLines.length === 0) return { outcome: 'soft_pass' };
  const stillPending = checklistLines.filter(m => m[1].trim().toLowerCase() !== 'x');
  if (stillPending.length === 0) return { outcome: 'all_done' };
  return { outcome: 'still_pending', items: stillPending.map(m => m[2].trim()) };
}

module.exports = {
  markCompleted,
  parseModelPlan,
  mergeOrReplace,
  buildContinuationDirective,
  buildSelfEvalRequest,
  parseSelfEvalResponse,
};
