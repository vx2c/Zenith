import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter   from "./auth";
import chatRouter   from "./chat";
import pluginRouter from "./plugin";
import statusRouter from "./status";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(chatRouter);
router.use(pluginRouter);
router.use(statusRouter);

export default router;
