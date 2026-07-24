import { Router, type IRouter } from "express";
import { streamChat, DEFAULT_MODEL } from "./aiService";
import type { ChatMessage } from "./aiService";

const router: IRouter = Router();

router.post("/chat", async (req, res): Promise<void> => {
  const { messages = [], model }: { messages: ChatMessage[]; model?: string } = req.body;

  res.setHeader("Content-Type",       "text/event-stream");
  res.setHeader("Cache-Control",      "no-cache, no-transform");
  res.setHeader("Connection",         "keep-alive");
  res.setHeader("X-Accel-Buffering",  "no");

  await streamChat(messages, res, model ?? DEFAULT_MODEL);
});

export default router;
