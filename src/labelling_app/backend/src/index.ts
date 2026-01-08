import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import { createRouter } from './routes/index.js';
import { config } from './config/server.js';

const app: Express = express();

app.use(cors({
  origin: config.corsOrigins.length ? config.corsOrigins : true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

app.use(createRouter());

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    console.info(`Backend listening on ${config.port}`);
  });
}

export default app;

