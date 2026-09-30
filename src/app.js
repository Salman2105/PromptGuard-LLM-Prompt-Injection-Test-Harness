import express from 'express';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createLlmClient } from './services/llmClient.js';
import { createPersistence } from './services/persistence.js';
import { loadCases } from './services/testRunner.js';
import { testsRouter } from './routes/tests.js';

export function createApp(dependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb', strict: true }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', provider: dependencies.client.provider, isMock: dependencies.client.isMock }));
  app.use('/api/tests', testsRouter(dependencies));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: status === 413 ? 'Request too large' : status === 400 ? 'Invalid JSON' : 'Internal error' });
  });
  return app;
}

export async function startServer() {
  const config = loadConfig();
  const cases = await loadCases();
  const client = createLlmClient(config);
  const persistence = await createPersistence(config.mongoUri);
  const app = createApp({ cases, client, persistence });
  const server = app.listen(config.port, config.host, () => console.log(`PromptGuard API listening on port ${config.port}; provider: ${client.provider}${client.isMock ? ' (MOCK)' : ''}`));
  server.on('error', async () => {
    console.error('Server could not listen. Check HOST and PORT.');
    await persistence.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(async () => { await persistence.close(); });
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(() => { console.error('Server could not start. Check configuration and test library.'); process.exitCode = 1; });
}
