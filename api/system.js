'use strict';
/**
 * api/system.js — Consolidated system/utility handler
 *
 * Routes (via _r query param added by vercel.json rewrites):
 *   /api/config          → _r=config
 *   /api/status          → _r=status
 *   /api/debug-models    → _r=debug-models
 *   /api/roblox-callback → _r=roblox-callback
 */

const { getStatus } = require('./aiService');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const DEBUG_MODELS = [
  'openai/gpt-5-mini',
  'openrouter/auto',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'openai/gpt-oss-20b:free',
];

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

// GET /api/config — Exposes public config (ROBLOX_CLIENT_ID) to the frontend
function handleConfig(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'public, max-age=300');

  const clientId = process.env.ROBLOX_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'ROBLOX_CLIENT_ID not configured on server' });
  }
  return res.status(200).json({ clientId });
}

// GET /api/status — Returns AI provider/model status
function handleStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).json(getStatus());
}

// GET /api/debug-models — Tests availability of OpenRouter models
async function handleDebugModels(req, res) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });

  const results = [];

  for (const model of DEBUG_MODELS) {
    try {
      const r = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://xzenith.vercel.app',
          'X-Title': 'Zenith',
        },
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      let body = '';
      try { body = await r.text(); } catch { body = '(unreadable)'; }

      results.push({ model, status: r.status, body: body.slice(0, 300) });

      // Stop after first success
      if (r.ok && body.includes('"content"')) break;
    } catch (err) {
      results.push({ model, status: 'network_error', body: err.message });
    }
  }

  return res.status(200).json({ results });
}

// POST /api/roblox-callback — OAuth2 token exchange with Roblox
function decodeJwtPayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch { return {}; }
}

async function handleRobloxCallback(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = await parseJsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { code, redirect_uri } = body || {};
  if (!code || !redirect_uri) return res.status(400).json({ error: 'Missing required OAuth parameters' });

  const clientId     = process.env.ROBLOX_CLIENT_ID;
  const clientSecret = process.env.ROBLOX_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return res.status(500).json({ error: 'Server misconfigured: missing Roblox credentials' });

  const params = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  try {
    const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(502).json({ error: 'Token exchange failed', details: err });
    }

    const tokenData = await tokenRes.json();
    const claims    = tokenData.id_token ? decodeJwtPayload(tokenData.id_token) : {};
    const userId    = claims.sub || null;

    // Fetch the profile picture too, so the client never has to make a
    // second round trip before it can show a real avatar. Previously this
    // field was simply never populated — roblox-callback.html's
    // `if (data.picture) ...` check silently no-op'd on every login, so
    // the Main Menu always fell back to the initial-letter placeholder.
    let picture = null;
    if (userId) {
      try {
        const thumbRes = await fetch(
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(userId)}&size=150x150&format=Png`,
        );
        if (thumbRes.ok) {
          const thumbData = await thumbRes.json();
          picture = thumbData?.data?.[0]?.imageUrl || null;
        }
      } catch {
        // Non-fatal — the client falls back to the initial-letter avatar,
        // and initApp()/loadAvatar() will retry via /api/avatar later.
      }
    }

    return res.status(200).json({
      accessToken:  tokenData.access_token,
      tokenType:    tokenData.token_type,
      expiresIn:    tokenData.expires_in,
      refreshToken: tokenData.refresh_token,
      scope:        tokenData.scope,
      displayName:  claims.name || tokenData.displayName || null,
      username:     claims.preferred_username || null,
      userId,
      picture,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Unable to complete OAuth exchange', details: e.message });
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
    case 'config':           return handleConfig(req, res);
    case 'status':           return handleStatus(req, res);
    case 'debug-models':     return handleDebugModels(req, res);
    case 'roblox-callback':  return handleRobloxCallback(req, res);
    default:                 return res.status(404).json({ error: `Unknown system route: ${route}` });
  }
};
