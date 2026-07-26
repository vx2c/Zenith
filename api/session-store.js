'use strict';
/**
 * Session store backed by Upstash Redis (REST API).
 *
 * Required env vars (set in Vercel project settings):
 *   UPSTASH_REDIS_REST_URL   — e.g. https://xxxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN — your Upstash REST token
 *
 * Why Redis and not in-memory?
 * Vercel serverless functions are stateless. Each endpoint (/connect,
 * /heartbeat, /plugin-status) may run on a different instance, so an
 * in-memory Map is never shared between them. Redis is the fix.
 */

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// How long (seconds) a session lives after its last heartbeat.
// Plugin sends heartbeat every 2s; 300s = 5 minutes of missed heartbeats before expiry.
const SESSION_TTL = 300;
const WORKSPACE_TASK_TTL = 900;

/**
 * Execute one Redis command via the Upstash REST API.
 * @param {...string|number} args — e.g. ('SET', 'key', 'value', 'EX', 10)
 */
async function redisCmd(...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error(
      'Upstash Redis is not configured. Set UPSTASH_REDIS_REST_URL and ' +
      'UPSTASH_REDIS_REST_TOKEN in the Vercel project.'
    );
  }
  const res = await fetch(REDIS_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`Upstash Redis returned HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`Upstash Redis error: ${json.error}`);
  }
  return json.result ?? null;
}

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a new plugin session. Returns the sessionId.
 */
async function createSession({ placeId, username, placeName } = {}) {
  const sessionId = generateId();
  const now = Date.now();
  const session = {
    sessionId,
    placeId:    placeId    || null,
    username:   username   || null,
    placeName:  placeName  || null,
    connectedAt: now,
    lastSeen:    now,
  };
  await redisCmd('SET', `session:${sessionId}`, JSON.stringify(session), 'EX', SESSION_TTL);
  return sessionId;
}

/**
 * Update last-seen timestamp (called on each heartbeat).
 * Returns false if the session doesn't exist (expired).
 */
async function touchSession(sessionId) {
  const raw = await redisCmd('GET', `session:${sessionId}`);
  if (!raw) return false;
  const session = JSON.parse(raw);
  session.lastSeen = Date.now();
  await redisCmd('SET', `session:${sessionId}`, JSON.stringify(session), 'EX', SESSION_TTL);
  return true;
}

/**
 * Return all currently-active sessions.
 */
async function getActiveSessions() {
  const keys = await redisCmd('KEYS', 'session:*');
  if (!keys || !keys.length) return [];
  // Fetch all sessions in one pipeline call
  const pipeline = keys.map(k => ['GET', k]);
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pipeline),
  });
  const results = await res.json();
  if (!res.ok || !Array.isArray(results)) {
    throw new Error(`Upstash Redis pipeline returned HTTP ${res.status}`);
  }
  const pipelineError = results.find(r => r && r.error);
  if (pipelineError) {
    throw new Error(`Upstash Redis pipeline error: ${pipelineError.error}`);
  }
  return results
    .map(r => r.result)
    .filter(Boolean)
    .map(v => JSON.parse(v));
}

/**
 * Queue a command for the plugin to execute on its next heartbeat.
 * Returns the commandId, or null if the session doesn't exist.
 */
async function enqueueCommand(sessionId, type, args = {}) {
  const exists = await redisCmd('EXISTS', `session:${sessionId}`);
  if (!exists) return null;
  const id  = generateId();
  const cmd = JSON.stringify({ id, type, args });
  await redisCmd('RPUSH', `cmds:${sessionId}`, cmd);
  await redisCmd('EXPIRE', `cmds:${sessionId}`, 60);
  return id;
}

/**
 * Drain all pending commands for a session (called on heartbeat).
 */
async function dequeueCommands(sessionId) {
  const len = await redisCmd('LLEN', `cmds:${sessionId}`);
  if (!len) return [];
  const cmds = await redisCmd('LRANGE', `cmds:${sessionId}`, 0, -1);
  await redisCmd('DEL', `cmds:${sessionId}`);
  return (cmds || []).map(c => JSON.parse(c));
}

/**
 * Store the result of a command returned by the plugin.
 */
async function storeResult(commandId, result, error) {
  const data = JSON.stringify({ result, error: error || null, receivedAt: Date.now() });
  await redisCmd('SET', `result:${commandId}`, data, 'EX', 60);
}

/**
 * Retrieve a stored command result.
 */
async function getResult(commandId) {
  const raw = await redisCmd('GET', `result:${commandId}`);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Get a single session by ID.
 */
async function getSession(sessionId) {
  const raw = await redisCmd('GET', `session:${sessionId}`);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Persist the agent's current workspace operation. Tool results are kept
 * briefly so a reconnecting client can rehydrate the latest task state
 * without making the plugin/session architecture responsible for UI state.
 */
async function createWorkspaceTask(sessionId, { taskId, objective, plan = [] } = {}) {
  const id = taskId || generateId();
  const task = {
    taskId: id,
    sessionId,
    objective: objective || '',
    plan: Array.isArray(plan) ? plan : [],
    completedSteps: [],
    pendingSteps: [],
    currentTool: null,
    lastToolResult: null,
    nextAction: 'Select the first tool needed for the objective.',
    status: 'running',
    events: [],
    updatedAt: Date.now(),
  };
  await redisCmd('SET', `workspace-task:${sessionId}:${id}`, JSON.stringify(task), 'EX', WORKSPACE_TASK_TTL);
  return task;
}

async function updateWorkspaceTask(sessionId, taskId, patch = {}) {
  if (!sessionId || !taskId) return null;
  const key = `workspace-task:${sessionId}:${taskId}`;
  const raw = await redisCmd('GET', key);
  if (!raw) return null;
  const current = JSON.parse(raw);
  const next = {
    ...current,
    ...patch,
    plan: Array.isArray(patch.plan) ? patch.plan : current.plan,
    completedSteps: Array.isArray(patch.completedSteps) ? patch.completedSteps : current.completedSteps,
    pendingSteps: Array.isArray(patch.pendingSteps) ? patch.pendingSteps : current.pendingSteps,
    events: Array.isArray(patch.events) ? patch.events.slice(-50) : current.events,
    updatedAt: Date.now(),
  };
  await redisCmd('SET', key, JSON.stringify(next), 'EX', WORKSPACE_TASK_TTL);
  return next;
}

async function getWorkspaceTask(sessionId, taskId) {
  if (!sessionId || !taskId) return null;
  const raw = await redisCmd('GET', `workspace-task:${sessionId}:${taskId}`);
  return raw ? JSON.parse(raw) : null;
}

module.exports = {
  createSession,
  touchSession,
  getActiveSessions,
  enqueueCommand,
  dequeueCommands,
  storeResult,
  getResult,
  getSession,
  createWorkspaceTask,
  updateWorkspaceTask,
  getWorkspaceTask,
};
