'use strict';
/**
 * api/studio.js — Consolidated Studio protocol handler
 *
 * Routes (via _r query param added by vercel.json rewrites):
 *   /api/connect        → _r=connect
 *   /api/heartbeat      → _r=heartbeat
 *   /api/command_result → _r=command_result
 *   /api/plugin-status  → _r=plugin-status
 *   /api/queue-command  → _r=queue-command
 *   /api/avatar         → _r=avatar
 */

const {
  createSession,
  touchSession,
  dequeueCommands,
  storeResult,
  getActiveSessions,
  enqueueCommand,
} = require('./session-store');

// ── Shared helpers ─────────────────────────────────────────────────────────

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

function getRoute(req) {
  const qs = (req.url || '').split('?')[1] || '';
  return new URLSearchParams(qs).get('_r') || '';
}

// ── Sub-handlers ───────────────────────────────────────────────────────────

// POST /api/connect — Plugin connect endpoint
async function handleConnect(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = {};
  try { body = await parseJsonBody(req); } catch { /* ignore */ }

  const { placeId, username, placeName } = body || {};
  const sessionId = await createSession({ placeId, username, placeName });

  return res.status(200).json({
    status:    'ok',
    connected: true,
    message:   'Connected to Zenith AI',
    version:   '1.0.0',
    sessionId,
  });
}

// POST /api/heartbeat — Plugin heartbeat (called every ~2s)
async function handleHeartbeat(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = {};
  try { body = await parseJsonBody(req); } catch { /* ignore */ }

  const { sessionId } = body || {};

  if (sessionId) {
    const found = await touchSession(sessionId);
    if (!found) {
      // Session expired — tell plugin to reconnect
      return res.status(200).json({ status: 'ok', commands: [], reconnect: true });
    }
    const commands = await dequeueCommands(sessionId);
    return res.status(200).json({ status: 'ok', commands });
  }

  // No sessionId — legacy fallback (plugin without sessionId support)
  return res.status(200).json({ status: 'ok', commands: [] });
}

// POST /api/command_result — Plugin reports result of an executed command
async function handleCommandResult(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = {};
  try { body = await parseJsonBody(req); } catch { /* ignore */ }

  const { id, result, error } = body || {};
  if (id) await storeResult(id, result, error || null);

  return res.status(200).json({ status: 'ok' });
}

// GET /api/plugin-status — Returns all active plugin sessions
async function handlePluginStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-cache');

  const sessions = (await getActiveSessions())
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  const connected = sessions.length > 0;

  return res.status(200).json({
    connected,
    sessions: sessions.map(s => ({
      sessionId:   s.sessionId,
      token:       s.token || null,
      placeId:     s.placeId,
      username:    s.username,
      placeName:   s.placeName,
      connectedAt: s.connectedAt,
      lastSeen:    s.lastSeen,
    })),
  });
}

// POST /api/queue-command — Dashboard queues a command for the plugin
async function handleQueueCommand(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try { body = await parseJsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { sessionId, type, args } = body || {};
  if (!type) return res.status(400).json({ error: 'Missing command type' });

  let targetSession = sessionId;
  if (!targetSession) {
    const active = (await getActiveSessions())
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    if (!active.length) return res.status(404).json({ error: 'No plugin connected' });
    targetSession = active[0].sessionId;
  }

  const commandId = await enqueueCommand(targetSession, type, args || {});
  if (!commandId) return res.status(404).json({ error: 'Session not found' });

  return res.status(200).json({ status: 'ok', commandId, sessionId: targetSession });
}

// GET /api/avatar — Proxy for Roblox avatar thumbnails (avoids CORS)
async function handleAvatar(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const qs = (req.url || '').split('?')[1] || '';
  const userId = new URLSearchParams(qs).get('userId');
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    const r = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(userId)}&size=150x150&format=Png`,
    );
    if (!r.ok) return res.status(502).json({ imageUrl: null });
    const data = await r.json();
    const imageUrl = data?.data?.[0]?.imageUrl || null;
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({ imageUrl });
  } catch {
    res.status(502).json({ imageUrl: null });
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const route = getRoute(req);

  switch (route) {
    case 'connect':        return handleConnect(req, res);
    case 'heartbeat':      return handleHeartbeat(req, res);
    case 'command_result': return handleCommandResult(req, res);
    case 'plugin-status':  return handlePluginStatus(req, res);
    case 'queue-command':  return handleQueueCommand(req, res);
    case 'avatar':         return handleAvatar(req, res);
    default:               return res.status(404).json({ error: `Unknown studio route: ${route}` });
  }
};
