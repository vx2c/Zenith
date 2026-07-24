import { Router, type IRouter, type Request, type Response } from "express";
import {
  createSession,
  touchSession,
  dequeueCommands,
  storeResult,
  enqueueCommand,
  getActiveSessions,
} from "../lib/session-store";

const router: IRouter = Router();

// ── POST /connect ─────────────────────────────────────────────────────────────
// Called by the Roblox Studio plugin when the user clicks Connect
router.post("/connect", (req: Request, res: Response): void => {
  const { placeId, username, placeName } = (req.body ?? {}) as Record<string, string>;
  const sessionId = createSession({ placeId, username, placeName });
  res.status(200).json({
    status:    "ok",
    connected: true,
    message:   "Connected to Zenith AI",
    version:   "1.0.0",
    sessionId,
  });
});

// ── POST /heartbeat ───────────────────────────────────────────────────────────
// Called every ~2 seconds by the plugin to stay alive and receive commands
router.post("/heartbeat", (req: Request, res: Response): void => {
  const { sessionId } = (req.body ?? {}) as { sessionId?: string };

  if (sessionId) {
    const found = touchSession(sessionId);
    if (!found) {
      res.status(200).json({ status: "ok", commands: [], reconnect: true });
      return;
    }
    const commands = dequeueCommands(sessionId);
    res.status(200).json({ status: "ok", commands });
    return;
  }

  // Legacy fallback (plugin without sessionId)
  res.status(200).json({ status: "ok", commands: [] });
});

// ── POST /command_result ──────────────────────────────────────────────────────
// Called by the plugin after executing a command from the heartbeat
router.post("/command_result", (req: Request, res: Response): void => {
  const { id, result, error } = (req.body ?? {}) as { id?: string; result?: unknown; error?: string };
  if (id) storeResult(id, result, error ?? null);
  res.status(200).json({ status: "ok" });
});

// ── GET /plugin-status ────────────────────────────────────────────────────────
// Polled by the dashboard to show the Studio connection badge
router.get("/plugin-status", (_req: Request, res: Response): void => {
  res.setHeader("Cache-Control", "no-cache");
  const activeSessions = getActiveSessions();
  res.status(200).json({
    connected: activeSessions.length > 0,
    sessions:  activeSessions.map(s => ({
      sessionId:   s.sessionId,
      placeId:     s.placeId,
      username:    s.username,
      placeName:   s.placeName,
      connectedAt: s.connectedAt,
      lastSeen:    s.lastSeen,
    })),
  });
});

// ── POST /queue-command ───────────────────────────────────────────────────────
// Called by the dashboard to send a command to the plugin
router.post("/queue-command", (req: Request, res: Response): void => {
  const { sessionId, type, args } = (req.body ?? {}) as {
    sessionId?: string;
    type?: string;
    args?: Record<string, unknown>;
  };

  if (!type) {
    res.status(400).json({ error: "Missing command type" });
    return;
  }

  let targetSession = sessionId;
  if (!targetSession) {
    const active = getActiveSessions();
    if (!active.length) {
      res.status(404).json({ error: "No plugin connected" });
      return;
    }
    targetSession = active[0].sessionId;
  }

  const commandId = enqueueCommand(targetSession, type, args ?? {});
  if (!commandId) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.status(200).json({ status: "ok", commandId, sessionId: targetSession });
});

export default router;
