import { Router, type IRouter } from "express";
import { getStatus } from "./aiService";

const router: IRouter = Router();

router.get("/status", (_req, res): void => {
  res.setHeader("Cache-Control", "no-cache");
  res.status(200).json(getStatus());
});

export default router;
