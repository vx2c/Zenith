function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      if (!body) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return response.status(400).json({ error: 'Invalid JSON body' });
  }

  const { code, redirect_uri } = body || {};
  if (!code || !redirect_uri) {
    return response.status(400).json({ error: 'Missing required OAuth parameters' });
  }

  const clientId = process.env.ROBLOX_CLIENT_ID || '1113911995308598210';
  const clientSecret = process.env.ROBLOX_CLIENT_SECRET || 'RBX-AwpfZAVRLkqB2qAWPnsP1StPh-NGqECozY-N_xHIqEucsH_IKLrM9ehWtlVgG2Cx';
  const tokenUrl = 'https://apis.roblox.com/oauth/v1/token';

  const params = new URLSearchParams();
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', redirect_uri);
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);

  try {
    const fetchResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.text();
      return response.status(502).json({ error: 'Token exchange failed', details: errorData });
    }

    const tokenData = await fetchResponse.json();
    return response.status(200).json({
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
      refreshToken: tokenData.refresh_token,
      scope: tokenData.scope,
      displayName: tokenData.displayName || null,
    });
  } catch (error) {
    return response.status(500).json({ error: 'Unable to complete OAuth exchange', details: error.message });
  }
};
