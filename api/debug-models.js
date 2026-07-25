'use strict';
// TEMPORARY debug endpoint — remove after diagnosing model failures
// GET /api/debug-models

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS = [
  'openrouter/auto',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'openai/gpt-oss-20b:free',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });

  const results = [];

  for (const model of MODELS) {
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
};
