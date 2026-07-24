'use strict';

/**
 * Session store for Roblox Studio plugin connections.
 *
 * ## Vercel stateless problem & solution
 * Vercel serverless functions are stateless — each invocation may run on a
 * different instance, so pure in-memory maps drop sessions on cold starts.
 *
 * Solution: `createSession` returns a SIGNED TOKEN (HMAC-SHA256 over
 * SESSION_SECRET) that encodes all session data.  Any Vercel instance can
 * verify the token without shared state, so the plugin never gets an
 * unexpected "session not found" disconnect.
 *
 * Command queues are still kept in memory (best-effort).  On a cold start
 * the queue is empty, but the plugin stays connected — commands queued
 * before the cold start are simply not delivered (acceptable trade-off
 * without an external KV store).
 */

const crypto = require('crypto');

// ── Secret ────────────────────────────────────
const SECRET = process.env.SESSION_SECRET || 'zenith-fallback-secret';

// ── In-memory store (best-effort on Vercel, reliable on single-instance) ──
const sessions     = new Map(); // Map<sessionId, SessionData>
const commandQueues  = new Map(); // Map<sessionId, Array<{id,type,args}>>
const commandResults = new Map(); // Map<commandId, {result,error,receivedAt}>

const SESSION_TTL_MS = 30_000; // 30 s — more forgiving for cold starts

// ─────────────────────────────────────────────
//  Signed-token helpers (stateless across instances)
// ─────────────────────────────────────────────

function _sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/** Returns the decoded payload or null if the token is invalid / tampered. */
function _verify(token) {
  if (!token || typeof token !== 'string') return null;
  const dot  = token.lastIndexOf('.');
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { return null; }
}

function _resolveSessionId(tokenOrId) {
  const p = _verify(tokenOrId);
  return p ? p.sessionId : tokenOrId; // fall back to treating it as a plain ID
}

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Create a new plugin session.
 * Returns a SIGNED TOKEN that encodes all session data.
 * Vercel: any instance can verify it without shared state.
 */
function createSession(info = {}) {
  const sessionId = generateId();
  const payload = {
    sessionId,
    placeId:     info.placeId   || null,
    username:    info.username  || null,
    placeName:   info.placeName || null,
    connectedAt: Date.now(),
  };
  const token = _sign(payload);
  // Mirror into local memory so getActiveSessions() works on this instance
  sessions.set(sessionId, { ...payload, lastSeen: Date.now(), token });
  commandQueues.set(sessionId, []);
  return token; // signed token IS the sessionId returned to the plugin
}

/**
 * Touch the session on heartbeat.
 * Accepts either a signed token OR a plain sessionId (legacy plugins).
 * On a cold Vercel instance the token is re-hydrated from its payload.
 */
function touchSession(tokenOrId) {
  // Try stateless token first
  const payload = _verify(tokenOrId);
  if (payload) {
    const { sessionId } = payload;
    if (!sessions.has(sessionId)) {
      // Cold start: re-hydrate session from the signed token
      sessions.set(sessionId, { ...payload, lastSeen: Date.now(), token: tokenOrId });
      commandQueues.set(sessionId, []);
    } else {
      sessions.get(sessionId).lastSeen = Date.now();
    }
    return true;
  }
  // Fallback: plain sessionId (old plugins without token support)
  const s = sessions.get(tokenOrId);
  if (s) { s.lastSeen = Date.now(); return true; }
  return false;
}

/** Enqueue a command for the plugin to execute on next heartbeat. */
function enqueueCommand(tokenOrId, type, args = {}) {
  const sid   = _resolveSessionId(tokenOrId);
  if (!commandQueues.has(sid)) commandQueues.set(sid, []);
  const id = generateId();
  commandQueues.get(sid).push({ id, type, args });
  return id;
}

/** Dequeue all pending commands for a session (consumed on heartbeat). */
function dequeueCommands(tokenOrId) {
  const sid   = _resolveSessionId(tokenOrId);
  const queue = commandQueues.get(sid) || [];
  commandQueues.set(sid, []);
  return queue;
}

/** Store a command result from the plugin. */
function storeResult(commandId, result, error) {
  commandResults.set(commandId, { result, error, receivedAt: Date.now() });
  setTimeout(() => commandResults.delete(commandId), 60_000);
}

/** Get all active sessions (heartbeat within TTL). */
function getActiveSessions() {
  const now = Date.now();
  const active = [];
  for (const [, s] of sessions) {
    if (now - s.lastSeen <= SESSION_TTL_MS) {
      active.push(s);
    } else {
      sessions.delete(s.sessionId);
      commandQueues.delete(s.sessionId);
    }
  }
  return active;
}

/** Get a single session by token or ID. */
function getSession(tokenOrId) {
  const sid = _resolveSessionId(tokenOrId);
  return sessions.get(sid) || null;
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
