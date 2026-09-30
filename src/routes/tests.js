import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { runTests } from '../services/testRunner.js';

export function testsRouter({ cases, client, persistence, runLimit = 10 }) {
  const router = Router();
  let running = false;
  router.get('/', (_req, res) => res.json({ tests: cases }));
  router.post('/run', rateLimit({ windowMs: 60000, limit: runLimit, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Run rate limit exceeded' } }), async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json' });
    const body = req.body;
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !Array.isArray(body.testIds)
      || body.testIds.length < 1 || body.testIds.length > cases.length
      || body.testIds.some(id => typeof id !== 'string' || !cases.some(entry => entry.id === id))
      || new Set(body.testIds).size !== body.testIds.length) {
      return res.status(400).json({ error: 'Provide only testIds: a nonempty array of unique known test IDs' });
    }
    if (running) return res.status(409).json({ error: 'A test batch is already running' });
    running = true;
    try {
      const report = await runTests(body.testIds.map(id => cases.find(entry => entry.id === id)), { client, persistence });
      res.json(report);
    } finally { running = false; }
  });
  return router;
}
