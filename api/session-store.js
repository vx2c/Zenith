'use strict';

/**
 * In-memory session store for Roblox Studio plugin connections.
 *
 * NOTE: Works reliably on single-instance servers (Replit Express).
 * On Vercel (multi-instance serverless), sessions are per-instance —
 * upgrade to Upstash KV / Vercel KV for cross-instance persistence.
 */

// Map<sessionId, SessionData>
const sessions = new Map();

// Pending commands: Map<sessionId, Array<{id, type, args}>>
const commandQueues = new Map();

// Command results: Map<commandId, result>
const commandResults = new Map();

const SESSION_TTL_MS = 10_000; // 10s — if no heartbeat in 10s, session is dead

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Create a new plugin session and return its ID.
 * @param {{ placeId?: string, username?: string, placeName?: string }} info
 */
function createSession(info = {}) {
  const sessionId = generateId();
  sessions.set(sessionId, {
    sessionId,
    placeId:   info.placeId   || null,
    username:  info.username  || null,
    placeName: info.placeName || null,
    connectedAt: Date.now(),
    lastSeen:    Date.now(),
  });
  commandQueues.set(sessionId, []);
  return sessionId;
}

/** Touch last-seen timestamp on heartbeat. */
function touchSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s) s.lastSeen = Date.now();
  return !!s;
}

/** Enqueue a command for the plugin to execute on next heartbeat. */
function enqueueCommand(sessionId, type, args = {}) {
  const queue = commandQueues.get(sessionId);
  if (!queue) return null;
  const id = generateId();
  queue.push({ id, type, args });
  return id;
}

/** Dequeue all pending commands for a session (consumed on heartbeat). */
function dequeueCommands(sessionId) {
  const queue = commandQueues.get(sessionId) || [];
  commandQueues.set(sessionId, []);
  return queue;
}

/** Store a command result from the plugin. */
function storeResult(commandId, result, error) {
  commandResults.set(commandId, { result, error, receivedAt: Date.now() });
  // Auto-cleanup after 60s
  setTimeout(() => commandResults.delete(commandId), 60_000);
}

/** Get all active sessions (heartbeat within TTL). */
function getActiveSessions() {
  const now = Date.now();
  const active = [];
  for (const [, s] of sessions) {
    if (now - s.lastSeen <= SESSION_TTL_MS) active.push(s);
    else sessions.delete(s.sessionId); // lazy cleanup
  }
  return active;
}

/** Get a single session by ID. */
function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

module.exports = {
  createSession,
  touchSession,
  enqueueCommand,
  dequeueCommands,
  storeResult,
  getActiveSessions,
  getSession,
};
