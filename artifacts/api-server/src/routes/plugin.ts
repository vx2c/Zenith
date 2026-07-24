import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Called by the Roblox Studio plugin when the user clicks Connect
router.post("/connect", (_req, res): void => {
  res.status(200).json({
    status: "ok",
    connected: true,
    message: "Connected to Zenith AI",
    version: "1.0.0",
  });
});

// Called every ~2 seconds by the plugin to stay alive and receive commands
router.post("/heartbeat", (_req, res): void => {
  res.status(200).json({
    status: "ok",
    commands: [],
  });
});

// Called by the plugin after executing a command from the heartbeat
router.post("/command_result", (_req, res): void => {
  res.status(200).json({ status: "ok" });
});

export default router;
