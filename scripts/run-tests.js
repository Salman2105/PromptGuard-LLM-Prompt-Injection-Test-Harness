import { loadConfig } from '../src/config.js';
import { createLlmClient } from '../src/services/llmClient.js';
import { createPersistence } from '../src/services/persistence.js';
import { loadCases, runTests } from '../src/services/testRunner.js';

let persistence;
try {
  const config = loadConfig();
  const args = process.argv.slice(2);
  if (args.some(arg => !['--mock', '--no-persistence'].includes(arg))) throw new Error('Unknown argument');
  if (args.includes('--mock')) config.provider = 'mock';
  if (args.includes('--no-persistence')) config.mongoUri = '';
  const client = createLlmClient(config);
  const cases = await loadCases();
  persistence = await createPersistence(config.mongoUri);
  console.log(`PromptGuard\nProvider: ${client.provider}${client.isMock ? ' (MOCK: simulated responses)' : ''}`);
  const { summary } = await runTests(cases, { client, persistence, onResult(result) {
    console.log(`[${result.testId}] ${result.category}\nStatus: ${result.executionStatus}; review: ${result.classification.status}; persistence: ${result.persistenceStatus}${result.errorCode ? `; error: ${result.errorCode}` : ''}`);
  } });
  console.log(`Summary: Executed: ${summary.executed}; Completed: ${summary.completed}; Errors: ${summary.errors}; Review required: ${summary.reviewRequired}; Saved: ${summary.saved}`);
  if (summary.errors) process.exitCode = 1;
} catch {
  console.error('Runner could not start. Check configuration, arguments, and test library.');
  process.exitCode = 1;
} finally {
  await persistence?.close();
}
