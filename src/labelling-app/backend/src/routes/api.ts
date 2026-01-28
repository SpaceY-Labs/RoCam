import { Router } from "express";
import projectsRouter from "./projects";

const router = Router();

router.use("/projects", projectsRouter);

export default router;
