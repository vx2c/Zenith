'use strict';
const { getActiveSessions } = require('./session-store');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();
  res.setHeader('Cache-Control', 'no-cache');

  // Prefer the Studio instance that most recently heartbeated. This keeps a
  // stale/old Studio window from receiving a new command when several
  // sessions exist.
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
};
