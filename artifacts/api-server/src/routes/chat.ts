import { Router, type IRouter } from "express";
import { streamChat, DEFAULT_MODEL } from "./aiService";
import type { ChatMessage } from "./aiService";
import { getActiveSessions } from "../lib/session-store";

const router: IRouter = Router();

/** Build plugin context string injected into the AI system prompt. */
function buildPluginContext(): string | null {
  const sessions = getActiveSessions();
  if (!sessions.length) return null;
  const s = sessions[0];
  const parts = ["A Roblox Studio plugin is currently connected to Zenith."];
  if (s.placeId)   parts.push(`Place ID: ${s.placeId}.`);
  if (s.username)  parts.push(`Developer (Creator ID): ${s.username}.`);
  if (s.placeName) parts.push(`Place Name: ${s.placeName}.`);
  parts.push(
    "The developer can read/write scripts and query the Explorer tree through the plugin. " +
    "When asked about their project, acknowledge the active Studio connection."
  );
  return parts.join(" ");
}

router.post("/chat", async (req, res): Promise<void> => {
  const { messages = [], model, sessionId }: { messages: ChatMessage[]; model?: string; sessionId?: string } = req.body;
  console.log("SESSION:", sessionId);
  const pluginContext = buildPluginContext();

  res.setHeader("Content-Type",       "text/event-stream");
  res.setHeader("Cache-Control",      "no-cache, no-transform");
  res.setHeader("Connection",         "keep-alive");
  res.setHeader("X-Accel-Buffering",  "no");

  await streamChat(messages, res, model ?? DEFAULT_MODEL, pluginContext);
});

export default router;
