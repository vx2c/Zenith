'use strict';
const { streamChat } = require('./aiService');
const { getSession } = require('./session-store');

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

/** Build plugin context string injected into the AI system prompt. */
function buildPluginContext(sessionId) {
    if (!sessionId) return null;

    const s = getSession(sessionId);

    if (!s) return null;

    const parts = [
        'A Roblox Studio plugin is currently connected to Zenith.'
    ];

    if (s.placeId)
        parts.push(`Place ID: ${s.placeId}.`);

    if (s.username)
        parts.push(`Developer (Creator ID): ${s.username}.`);

    if (s.placeName)
        parts.push(`Place Name: ${s.placeName}.`);

    parts.push(
        'The developer can read/write scripts and query the Explorer tree through the plugin.'
    );

    return parts.join(' ');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  let body;
  try { body = await parseJsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const {
    messages = [],
    model,
    sessionId
} = body;

console.log("SESSION:", sessionId);
const pluginContext =
    buildPluginContext(sessionId);
  res.setHeader('Content-Type',       'text/event-stream');
  res.setHeader('Cache-Control',      'no-cache, no-transform');
  res.setHeader('Connection',         'keep-alive');
  res.setHeader('X-Accel-Buffering',  'no');
  res.flushHeaders();

  await streamChat(messages, res, model, pluginContext);
};
