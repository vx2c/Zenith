'use strict';
const { enqueueCommand, getActiveSessions } = require('./session-store');

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

// Dashboard calls this to queue a command for the plugin.
// Body: { sessionId?, type, args? }
// If sessionId is omitted, broadcasts to first active session.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  let body;
  try { body = await parseJsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { sessionId, type, args } = body || {};
  if (!type) return res.status(400).json({ error: 'Missing command type' });

  let targetSession = sessionId;
  if (!targetSession) {
    const active = getActiveSessions();
    if (!active.length) return res.status(404).json({ error: 'No plugin connected' });
    targetSession = active[0].sessionId;
  }

  const commandId = enqueueCommand(targetSession, type, args || {});
  if (!commandId) return res.status(404).json({ error: 'Session not found' });

  return res.status(200).json({ status: 'ok', commandId, sessionId: targetSession });
};
