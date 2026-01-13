import { Router } from "express";
import projectsRouter from "./projects";
import segmentRouter from "./segment";

const router = Router();

router.use("/projects", projectsRouter);
router.use("/segment", segmentRouter);

export default router;
