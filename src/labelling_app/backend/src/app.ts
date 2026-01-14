import express from "express";
import cors from "cors";
import healthRouter from "./routes/health";
import apiRouter from "./routes/api";
import { authenticate } from "./middleware/auth";
import { errorHandler, notFound } from "./middleware/error";
import { config } from "./config";

const app = express();

const corsOptions = config.allowedOrigins.length
  ? { origin: config.allowedOrigins, credentials: true }
  : { origin: true };

const jsonLimitMb = Math.max(10, Math.ceil(config.maxImageMb * 1.5));

app.use(cors(corsOptions));
app.use(express.json({ limit: `${jsonLimitMb}mb` }));
app.use(express.urlencoded({ extended: true }));

app.use(healthRouter);
app.use("/api", authenticate, apiRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
