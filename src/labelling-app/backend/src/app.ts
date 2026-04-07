/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Configure and export the Express application with middleware and routes.
 */
import express from "express";
import cors from "cors";
import healthRouter from "./routes/health";
import apiRouter from "./routes/api";
import { authenticate } from "./middleware/auth";
import { errorHandler, notFound } from "./middleware/error";
import { config } from "./config";

const app = express();

const corsOptions =
  config.allowAllOrigins || config.allowedOrigins.length === 0
    ? { origin: true }
    : { origin: config.allowedOrigins, credentials: true };

const jsonLimitMb = Math.max(10, Math.ceil(config.maxImageMb * 1.5));
const getGc = () =>
  (globalThis as typeof globalThis & { gc?: () => void }).gc;
const maybeRunGc = () => {
  if (config.memoryGcThresholdMb <= 0) {
    return;
  }
  const gc = getGc();
  if (!gc) {
    return;
  }
  const usedMb = process.memoryUsage().heapUsed / (1024 * 1024);
  if (usedMb >= config.memoryGcThresholdMb) {
    gc();
  }
};

app.use(cors(corsOptions));
app.use(express.json({ limit: `${jsonLimitMb}mb` }));
app.use(express.urlencoded({ extended: true }));

if (config.memoryGcThresholdMb > 0) {
  app.use((req, res, next) => {
    res.on("finish", maybeRunGc);
    next();
  });
}

if (config.memoryGcIntervalMs > 0) {
  const interval = setInterval(maybeRunGc, config.memoryGcIntervalMs);
  interval.unref?.();
}

app.use(healthRouter);
app.use("/api", authenticate, apiRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
