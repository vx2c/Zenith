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

const SYSTEM = `You are Zenith, an expert AI assistant for Roblox Studio development. You help developers write Lua scripts, debug code, design game systems, and automate workflows in Roblox Studio. You know all Roblox APIs (Players, Workspace, ReplicatedStorage, ServerScriptService, RunService, TweenService, DataStoreService, etc.), Lua scripting patterns, Remote Events/Functions, and game design best practices. Be concise, practical, and provide working code examples when helpful. Format code blocks with triple backticks and the language name.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try { body = await parseJsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { messages = [] } = body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  // Build Gemini contents array
  const contents = [
    { role: 'user',  parts: [{ text: SYSTEM }] },
    { role: 'model', parts: [{ text: "Understood! I'm Zenith, your Roblox Studio AI companion. Ready to help with scripting, debugging, and game development!" }] },
    ...messages.map(m => ({
      role:  m.role === 'ai' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // Flush headers immediately so Vercel starts streaming instead of buffering
  res.flushHeaders();

  try {
    const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:streamGenerateContent?alt=sse&key=${apiKey}`;
    const geminiRes = await fetch(streamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 8192 } }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      res.write(`data: ${JSON.stringify({ error: `Gemini API error ${geminiRes.status}: ${errText.slice(0, 200)}` })}\n\n`);
      res.end();
      return;
    }

    const reader  = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw);
          const text   = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        } catch { /* skip malformed lines */ }
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message || 'Unknown error contacting Gemini' })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
};
