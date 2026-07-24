'use strict';
// Plugin heartbeat — called every ~2 seconds by the plugin to stay alive and receive commands
const { touchSession, dequeueCommands } = require('./session-store');

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
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
};
