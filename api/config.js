'use strict';

// Exposes public config to the frontend — no secrets, only the public client_id
// so the frontend always uses the same client_id that the backend has configured.
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();
  res.setHeader('Cache-Control', 'public, max-age=300');

  const clientId = process.env.ROBLOX_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'ROBLOX_CLIENT_ID not configured on server' });
  }

  return res.status(200).json({ clientId });
};
