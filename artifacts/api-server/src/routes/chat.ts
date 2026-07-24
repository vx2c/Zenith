import { Router, type IRouter } from "express";

const router: IRouter = Router();

const SYSTEM = `You are Zenith, an expert AI assistant for Roblox Studio development. You help developers write Lua scripts, debug code, design game systems, and automate workflows in Roblox Studio. You know all Roblox APIs (Players, Workspace, ReplicatedStorage, ServerScriptService, RunService, TweenService, DataStoreService, etc.), Lua scripting patterns, Remote Events/Functions, and game design best practices. Be concise, practical, and provide working code examples when helpful. Format code blocks with triple backticks and the language name.`;

router.post("/chat", async (req, res): Promise<void> => {
  const { messages = [] } = req.body as { messages: { role: string; content: string }[] };

  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    return;
  }

  // Build Gemini contents array
  const contents = [
    { role: "user", parts: [{ text: SYSTEM }] },
    {
      role: "model",
      parts: [
        {
          text: "Understood! I'm Zenith, your Roblox Studio AI companion. Ready to help with scripting, debugging, and game development!",
        },
      ],
    },
    ...messages.map((m) => ({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:streamGenerateContent?alt=sse&key=${apiKey}`;
    const geminiRes = await fetch(streamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: 8192 } }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      req.log.error({ status: geminiRes.status, details: errText }, "Gemini API error");
      res.write(`data: ${JSON.stringify({ error: `Gemini error ${geminiRes.status}: ${errText}` })}\n\n`);
      res.end();
      return;
    }

    const reader = geminiRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        } catch {
          /* skip malformed lines */
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Chat stream error");
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
