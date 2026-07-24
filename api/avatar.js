// Proxy for Roblox avatar thumbnails (avoids CORS issues in the browser)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const userId = req.query && req.query.userId;
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
};
