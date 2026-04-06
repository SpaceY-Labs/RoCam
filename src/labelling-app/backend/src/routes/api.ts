/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Top-level API router that mounts sub-routers for each resource.
 */
import { Router } from "express";
import projectsRouter from "./projects";

const router = Router();

router.use("/projects", projectsRouter);

export default router;
