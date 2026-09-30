import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLlmClient } from '../src/services/llmClient.js';
import { classify } from '../src/services/classifier.js';
import { loadCases, runTests } from '../src/services/testRunner.js';
import { createPersistence } from '../src/services/persistence.js';
import { createApp } from '../src/app.js';
import mongoose from 'mongoose';
import { createTestResultModel } from '../src/models/testResult.js';

const quiet = { warn() {} };
const cases = await loadCases();
const config = loadConfig({});
const client = createLlmClient(config);
const persistence = await createPersistence('', quiet);

test('missing environment defaults to mock; invalid configuration fails without echoing values', () => {
  assert.equal(config.provider, 'mock');
  assert.equal(loadConfig({ OPENAI_API_KEY: 'fixture' }).provider, 'mock');
  assert.throws(() => loadConfig({ PORT: '-1' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ LLM_PROVIDER: 'unknown' }), /Invalid LLM_PROVIDER/);
});

test('case library loads and mock batch completes without fabricated findings', async () => {
  assert.equal(cases.length, 6);
  assert.match((await client.generate('test')).text, /MOCK RESPONSE/);
  const report = await runTests(cases, { client, persistence });
  assert.deepEqual(report.summary, { executed: 6, completed: 6, errors: 0, reviewRequired: 6, saved: 0 });
  assert.ok(report.results.every(r => r.isMock && r.persistenceStatus === 'disabled'));
  assert.ok(report.results.every(r => !Object.hasOwn(r, 'text') && !Object.hasOwn(r, 'prompt')));
});

test('invalid JSON and duplicate IDs in the library are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promptguard-test-'));
  const file = join(directory, 'cases.json');
  try {
    await writeFile(file, '{bad');
    await assert.rejects(loadCases(file));
    await writeFile(file, JSON.stringify([cases[0], cases[0]]));
    await assert.rejects(loadCases(file), /Invalid test library/);
  } finally { await rm(file); await rmdir(directory); }
});

test('classifier preserves contradictory indicators and never asserts vulnerability or safety', () => {
  const result = classify('I cannot reveal it. My system instructions are DEMO_CANARY_LAVENDER. DEMO_PRIVATE_TOKEN_742. eval(input)');
  assert.equal(result.status, 'review');
  for (const indicator of ['refusal_language', 'instruction_disclosure_language', 'synthetic_canary_present', 'synthetic_token_present', 'unsafe_code_pattern']) {
    assert.ok(result.indicators.includes(indicator));
  }
  assert.deepEqual(classify('ordinary text').indicators, []);
  assert.equal(classify('ordinary text').status, 'review');
  assert.ok(classify('api_key=synthetic_example_123').indicators.includes('secret_like_content'));
});

test('OpenAI configuration failures are recorded without a network call', async () => {
  for (const [overrides, code] of [[{}, 'missing_api_key'], [{ apiKey: 'fixture' }, 'missing_model']]) {
    const openai = createLlmClient({ ...config, provider: 'openai', ...overrides });
    const report = await runTests([cases[0]], { client: openai, persistence });
    assert.equal(report.results[0].errorCode, code);
    assert.equal(report.results[0].classification.status, 'not_evaluated');
  }
});

test('OpenAI adapter sends bounded Responses request and reads metadata (SDK stub)', async () => {
  let request;
  const openai = createLlmClient({ ...config, provider: 'openai', apiKey: 'fixture', model: 'test-model' }, {
    sdk: { responses: { async create(body) {
      request = body;
      return { status: 'completed', output_text: 'DEMO response', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, extra: 'not retained' } };
    } } },
  });
  const response = await openai.generate('synthetic prompt');
  assert.equal(request.store, false);
  assert.equal(request.model, 'test-model');
  assert.equal(request.max_output_tokens, 512);
  assert.equal(request.input, 'synthetic prompt');
  assert.deepEqual(response.usage, { input_tokens: 10, output_tokens: 2, total_tokens: 12 });
});

test('OpenAI adapter handles timeout, network, provider, and malformed responses (SDK stubs)', async () => {
  for (const [name, code] of [['APIConnectionTimeoutError', 'timeout'], ['APIConnectionError', 'network_error'], ['Error', 'provider_error']]) {
    const openai = createLlmClient({ ...config, provider: 'openai', apiKey: 'fixture', model: 'test-model' }, {
      sdk: { responses: { async create() { throw Object.assign(new Error('DO_NOT_LOG_THIS'), { name }); } } },
    });
    await assert.rejects(openai.generate('test'), error => error.code === code && !error.message.includes('DO_NOT_LOG_THIS'));
  }
  for (const response of [null, { status: 'completed', output_text: '' }, { status: 'incomplete', output_text: 'partial' }]) {
    const openai = createLlmClient({ ...config, provider: 'openai', apiKey: 'fixture', model: 'test-model' }, {
      sdk: { responses: { async create() { return response; } } },
    });
    await assert.rejects(openai.generate('test'), /malformed_or_incomplete_response/);
  }
});

test('MongoDB save and write failure paths (connection/model stubs)', async () => {
  let stored;
  let fail = false;
  let closed = false;
  const db = await createPersistence('fixture-uri', { ...quiet, connect: async () => ({
    on() {}, model() { return { async create(value) { if (fail) throw new Error('private details'); stored = value; } }; },
    async close() { closed = true; },
  }) });
  const report = await runTests([cases[0]], { client, persistence: db });
  assert.equal(report.summary.saved, 1);
  assert.equal(stored.testId, cases[0].id);
  assert.equal(stored.text, undefined);
  fail = true;
  assert.equal(await db.save(stored), 'unavailable');
  await db.close();
  assert.equal(closed, true);
});

test('real Mongoose schema validates runner metadata and rejects undeclared raw output', async () => {
  const connection = mongoose.createConnection();
  try {
    const Model = createTestResultModel(connection);
    const report = await runTests([cases[0]], { client, persistence });
    const { persistenceStatus: _status, ...record } = report.results[0];
    await new Model(record).validate();
    assert.throws(() => new Model({ ...record, rawResponse: 'must not be stored' }), /strict mode/);
  } finally { await connection.close(); }
});

test('runner continues after provider failure and reports persistence exceptions separately', async () => {
  let calls = 0;
  const flakyClient = { ...client, async generate() {
    calls += 1;
    if (calls === 1) throw new Error('private provider details');
    return client.generate();
  } };
  const report = await runTests(cases.slice(0, 2), {
    client: flakyClient, persistence: { async save() { throw new Error('private database details'); } },
  });
  assert.equal(report.summary.errors, 1);
  assert.equal(report.summary.completed, 1);
  assert.equal(report.results[0].errorCode, 'execution_error');
  assert.ok(report.results.every(result => result.persistenceStatus === 'unavailable'));
  assert.ok(!JSON.stringify(report).includes('private provider details'));
});

test('configured unreachable MongoDB degrades gracefully with real Mongoose driver', async () => {
  // Port 1 on loopback is intentionally not a database; never uses a user's database.
  const db = await createPersistence('mongodb://127.0.0.1:1/promptguard_test', quiet);
  assert.equal(db.status, 'unavailable');
  const report = await runTests([cases[0]], { client, persistence: db });
  assert.equal(report.summary.completed, 1);
  assert.equal(report.results[0].persistenceStatus, 'unavailable');
  await db.close();
});

async function withServer(dependencies, fn) {
  const server = createApp(dependencies).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, body) => fetch(`${base}/api/tests/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('HTTP health, library, mock execution, validation, malformed JSON and size limit', async () => {
  await withServer({ cases, client, persistence, runLimit: 100 }, async base => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', provider: 'mock', isMock: true });
    assert.equal((await (await fetch(`${base}/api/tests`)).json()).tests.length, 6);
    const run = await post(base, { testIds: ['PI-001'] });
    assert.equal(run.status, 200);
    assert.equal((await run.json()).summary.completed, 1);
    for (const body of [{}, [], { testIds: [] }, { testIds: ['unknown'] }, { testIds: ['PI-001', 'PI-001'] }, { testIds: ['PI-001'], model: 'override' }, { testIds: [1] }]) {
      assert.equal((await post(base, body)).status, 400);
    }
    assert.equal((await fetch(`${base}/api/tests/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
    assert.equal((await post(base, { testIds: ['x'.repeat(9000)] })).status, 413);
    assert.equal((await fetch(`${base}/api/tests/run`, { method: 'POST', body: 'hello' })).status, 415);
  });
});

test('HTTP run rate limit', async () => {
  await withServer({ cases, client, persistence, runLimit: 1 }, async base => {
    assert.equal((await post(base, { testIds: ['PI-001'] })).status, 200);
    assert.equal((await post(base, { testIds: ['PI-001'] })).status, 429);
  });
});

test('HTTP rejects concurrent batches and releases its lock afterward', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const slowClient = { ...client, async generate() { entered(); await gate; return client.generate(); } };
  await withServer({ cases, client: slowClient, persistence }, async base => {
    const first = post(base, { testIds: ['PI-001'] });
    await started;
    try { assert.equal((await post(base, { testIds: ['PI-001'] })).status, 409); }
    finally { release(); await first; }
    assert.equal((await post(base, { testIds: ['PI-001'] })).status, 200);
  });
});
