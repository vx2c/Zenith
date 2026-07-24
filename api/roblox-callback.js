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

function decodeJwtPayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = await parseJsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const { code, redirect_uri, client_id: bodyClientId } = body || {};
  if (!code || !redirect_uri) return res.status(400).json({ error: 'Missing required OAuth parameters' });

  // Prefer the client_id the frontend actually used to start OAuth (prevents invalid_grant
  // when the env var differs from the hardcoded id in the frontend JS).
  const clientId     = bodyClientId || process.env.ROBLOX_CLIENT_ID;
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

    return res.status(200).json({
      accessToken:  tokenData.access_token,
      tokenType:    tokenData.token_type,
      expiresIn:    tokenData.expires_in,
      refreshToken: tokenData.refresh_token,
      scope:        tokenData.scope,
      displayName:  claims.name || tokenData.displayName || null,
      username:     claims.preferred_username || null,
      userId:       claims.sub || null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Unable to complete OAuth exchange', details: e.message });
  }
};
