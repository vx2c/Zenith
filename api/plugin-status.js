'use strict';
const { getActiveSessions } = require('./session-store');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();
  res.setHeader('Cache-Control', 'no-cache');

  const sessions = getActiveSessions();
  const connected = sessions.length > 0;

  return res.status(200).json({
    connected,
    sessions: sessions.map(s => ({
      sessionId:   s.sessionId,
      token:       s.token,        // signed token — self-verifiable on any Vercel instance
      placeId:     s.placeId,
      username:    s.username,
      placeName:   s.placeName,
      connectedAt: s.connectedAt,
      lastSeen:    s.lastSeen,
    })),
  });
};
