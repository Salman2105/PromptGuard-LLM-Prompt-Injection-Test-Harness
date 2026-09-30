import { readFile } from 'node:fs/promises';
import { categories } from '../utils/categories.js';
import { classify } from './classifier.js';
import { LlmError } from './llmClient.js';

export async function loadCases(url = new URL('../../tests/prompt-cases.json', import.meta.url)) {
  const cases = JSON.parse(await readFile(url, 'utf8'));
  const seen = new Set();
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 50) throw new Error('Invalid test library');
  for (const entry of cases) {
    if (!entry || !/^[A-Z]{2}-\d{3}$/.test(entry.id) || seen.has(entry.id)
      || !Object.hasOwn(categories, entry.category) || typeof entry.name !== 'string' || !entry.name
      || typeof entry.prompt !== 'string' || !entry.prompt || entry.prompt.length > 4000
      || !['low', 'medium', 'high'].includes(entry.expectedRisk)) throw new Error('Invalid test library');
    seen.add(entry.id);
  }
  return cases;
}

export async function runTests(cases, { client, persistence, onResult = () => {} }) {
  const results = [];
  for (const entry of cases) {
    const started = Date.now();
    const result = {
      testId: entry.id, category: entry.category, name: entry.name,
      timestamp: new Date(), provider: client.provider, model: client.model, isMock: client.isMock,
    };
    try {
      const response = await client.generate(entry.prompt);
      if (typeof response?.text !== 'string' || !response.text.trim()) throw new LlmError('malformed_or_incomplete_response');
      result.executionStatus = 'completed';
      result.responseMetadata = { characterCount: response.text.length, usage: response.usage };
      result.classification = classify(response.text);
    } catch (error) {
      result.executionStatus = 'error';
      result.errorCode = error instanceof LlmError ? error.code : 'execution_error';
      result.classification = { status: 'not_evaluated', indicators: [], notes: 'No completed response to review.' };
    }
    result.durationMs = Date.now() - started;
    // Raw output is analyzed in memory only; neither logged nor persisted.
    let persistenceStatus;
    try { persistenceStatus = await persistence.save(result); }
    catch { persistenceStatus = 'unavailable'; }
    const record = { ...result, persistenceStatus };
    results.push(record);
    onResult(record);
  }
  return { results, summary: {
    executed: results.length,
    completed: results.filter(r => r.executionStatus === 'completed').length,
    errors: results.filter(r => r.executionStatus === 'error').length,
    reviewRequired: results.filter(r => r.classification.status === 'review').length,
    saved: results.filter(r => r.persistenceStatus === 'saved').length,
  } };
}
