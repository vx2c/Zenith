'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// /agent/goalManager.js — Módulo 3 de 10 del Zenith Architecture Blueprint.
//
// Responsabilidad única: decidir el estado de la tarea — 'running', 'failed',
// 'incomplete', 'completed', 'blocked' — y el label/nextAction que le
// corresponde a cada uno.
//
// Funciones puras. No conoce Redis, no conoce `res`, no hace I/O. chat.js le
// pasa datos, este módulo devuelve la decisión, chat.js ejecuta la
// persistencia/emisión con lo que le devuelve — nunca decide él mismo.
//
// Extraído de agentLoop() en api/chat.js sin cambiar el criterio de decisión
// (ese criterio — neverExecuted/readOnlyDespiteWriteIntent — ya se probó y
// documentó en ZenithValidationLog.md). Esta extracción mueve la lógica de
// negocio fuera de chat.js; no re-decide nada distinto todavía.
// ═══════════════════════════════════════════════════════════════════════════

function computeStartState(objective) {
  return {
    status: 'running',
    label: 'Planning workspace task',
    nextAction: 'Choose the first tool required by the objective.',
    detail: objective,
  };
}

function computeFinalState({ toolsExecuted, writeToolsExecuted, anyWriteIntent, pendingSteps = [], pendingVerifications = [], evidence = [], failedToolCalls = 0, failureDetail }) {
  const neverExecuted = toolsExecuted === 0;
  const readOnlyDespiteWriteIntent = !neverExecuted && writeToolsExecuted === 0 && anyWriteIntent;
  const hasUnverifiedWrites = pendingVerifications.length > 0 || (writeToolsExecuted > 0 && evidence.length < writeToolsExecuted);
  const hasToolFailures = failedToolCalls > 0;
  const status = neverExecuted
    ? 'failed'
    : readOnlyDespiteWriteIntent || pendingSteps.length > 0 || hasUnverifiedWrites || hasToolFailures
      ? 'incomplete'
      : 'completed';

  const nextAction =
    status === 'failed'
      ? 'The AI could not produce a valid tool call. Try again, possibly with a simpler request.'
      : status === 'incomplete'
        ? 'The AI only inspected the project and never made the requested change. Ask it to continue/retry.'
        : 'Task complete. Every requested change has verified evidence.';

  const label =
    status === 'failed'
      ? 'Workspace task failed — no Studio action was executed'
      : status === 'incomplete'
        ? 'Workspace task incomplete — only inspected, nothing was built'
        : 'Workspace task completed - all changes verified';

  const eventStatus = status === 'completed' ? 'completed' : 'error';

  return {
    status,
    label,
    nextAction,
    eventStatus,
    neverExecuted, // exposed — chat.js needs this to decide whether to send the
                    // "could not generate a valid command" SSE error separately
    ...(status !== 'completed' && failureDetail ? { error: failureDetail } : {}),
  };
}

function computeBlockedState(toolsExecuted) {
  return {
    status: 'blocked',
    label: `Workspace task paused after ${toolsExecuted} step${toolsExecuted === 1 ? '' : 's'} — reached the per-message limit`,
    nextAction: 'Tool limit reached for this message. Send "continue" to keep going — nothing was lost.',
    eventStatus: 'error',
    error: 'Tool call limit reached for this message.',
  };
}

module.exports = {
  computeStartState,
  computeFinalState,
  computeBlockedState,
};
