import { Router } from 'express';

export function createAuthRouter(): Router {
  const router = Router();

  router.post('/sync', (req, res) => {
    res.json({ success: true });
  });

  router.get('/profile', (req, res) => {
    res.json({ success: true, data: req.user || null });
  });

  router.patch('/profile', (req, res) => {
    res.json({ success: true });
  });

  return router;
}
