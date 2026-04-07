/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Health check endpoint that returns server status for monitoring.
 */
import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

export default router;
