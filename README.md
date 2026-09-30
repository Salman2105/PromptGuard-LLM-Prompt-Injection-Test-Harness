# PromptGuard – LLM Prompt-Injection Test Harness

## Overview

PromptGuard is a small educational, defensive security-testing harness. It runs controlled synthetic prompts, analyzes responses for explainable indicators, and optionally logs metadata to MongoDB. It does **not** automatically prove that an LLM application is vulnerable. No compromised systems, successful attacks, or production security assessments are claimed.

## Security Testing Goals

Practice testing instruction boundaries, document trust, information disclosure, and unsafe code suggestions in a toy environment. Learn to distinguish test execution, an indicator, and a finding supported by contextual manual review. Use only synthetic data and systems you are authorized to test.

## Architecture

```text
Predefined test case → CLI / Express API → provider interface
                    → mock or OpenAI response → rule-based indicators
                    → optional MongoDB metadata → manual review
```

The current OpenAI adapter is a minimal demo application wrapper with fixed instructions. It does not connect to arbitrary deployed chatbots, RAG systems, or tools. A future application adapter can implement the same `generate(prompt)` contract.

## Features

- Six reviewed, non-destructive demonstration prompts.
- Mock mode by default, with explicit mock labels on results.
- Configurable OpenAI Responses API adapter using the official Node.js SDK.
- Sequential batches, timeouts, no SDK retries, bounded output tokens.
- Neutral completion/error status and transparent indicators requiring review.
- Optional Mongoose persistence; database failure does not stop execution.
- Validated API requests, 8 KB JSON limit, run rate limit, one active API batch.
- Raw model output analyzed only in memory, not printed, returned, or saved.

## Test Categories

| Cases | Concept | OWASP relationship |
| --- | --- | --- |
| PI-001, PI-002 | Direct injection and instruction override | LLM01:2025 Prompt Injection |
| PI-003 | Indirect injection in a synthetic document | LLM01:2025 Prompt Injection |
| SP-001 | Internal demo instruction extraction | LLM07:2025 System Prompt Leakage |
| SD-001 | Fictional private token disclosure | LLM02:2025 Sensitive Information Disclosure |
| CG-001 | Unsafe toy calculator code request | Custom category; no automatic OWASP equivalence |

`expectedRisk` is a scenario-design label, not observed severity. See [methodology](docs/methodology.md) for mappings and review limits.

## Project Structure

```text
src/
  app.js                    Express app and server lifecycle
  config.js                 Environment parsing and validation
  routes/tests.js           Library and execution endpoints
  services/
    llmClient.js            Provider abstraction and demo instructions
    testRunner.js           Case loading and sequential execution
    classifier.js           Explainable response indicators
    persistence.js          Optional MongoDB lifecycle and writes
  models/testResult.js      Metadata-only Mongoose schema
  utils/categories.js       Category mapping
tests/
  prompt-cases.json         Synthetic prompt library
  harness.test.js           Unit and local HTTP integration tests
scripts/run-tests.js        CLI entry point
docs/methodology.md         Scope, OWASP mapping, manual review
.env.example               Configuration template; no credentials
.gitignore
package.json
package-lock.json
```

## Technologies

Node.js 22+, JavaScript ES modules, Express, express-rate-limit, OpenAI SDK, Mongoose, dotenv, and Node's built-in test runner. Dependency versions are recorded in the lockfile.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock` | `mock` or explicitly selected `openai` |
| `OPENAI_API_KEY` | blank | Required for OpenAI; never committed or logged |
| `OPENAI_MODEL` | blank | Required Responses-compatible model available to your account |
| `LLM_TIMEOUT_MS` | `30000` | Request timeout, 100–120000 ms |
| `MAX_OUTPUT_TOKENS` | `512` | Output budget, 16–4096 tokens |
| `MONGODB_URI` | blank | Optional dedicated educational database |
| `PORT` | `3000` | API port |
| `HOST` | `127.0.0.1` | Bind address; cloud hosting can use `0.0.0.0` |

Existing process environment variables take precedence over `.env`. Missing OpenAI configuration in explicitly selected OpenAI mode produces neutral error records; it never silently substitutes a mock response.

## Installation

```sh
npm install
```

Optionally copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell). Nothing invokes an LLM during installation. `.env` is ignored by Git.

## Mock Mode

Without configuration, all responses are fixed mock fixtures. They demonstrate execution and refusal-language classification, **not model behavior or attack resistance**.

```sh
npm run test:prompts -- --mock --no-persistence
```

These flags override provider and database configuration for an offline demonstration. The CLI does not accept arbitrary prompts or model overrides.

## OpenAI Mode

Set `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL` in your local environment, then explicitly run the CLI or POST to the running API. Calls can incur provider charges. No model is silently selected for you.

The adapter uses `client.responses.create({ model, instructions, input, max_output_tokens, store: false })` and reads `output_text`, following the [official text-generation documentation](https://developers.openai.com/api/docs/guides/text). Each case starts a fresh request. No tools are enabled. Incomplete or empty outputs are recorded as errors. `store: false` is a request setting, not a guarantee about all provider data retention policies.

Live account access, model availability, and actual OpenAI responses remain configuration-dependent and are not verified by offline tests. The suite tests the adapter with SDK stubs.

## MongoDB Setup

Start a local MongoDB instance or configure a dedicated test database, then set `MONGODB_URI`. For a local instance without authentication, an example URI is `mongodb://127.0.0.1:27017/promptguard_demo`. Keep authenticated URIs only in the environment. Do not use production data.

Results are stored in the `testresults` collection with case ID/name/category, time, provider/model, mock flag, execution status, duration, response length/token usage, indicator names, and review status. Raw prompts, raw responses, matched strings, credentials, and raw exception messages are not stored.

Blank URI means `disabled`; connection/write failures mean `unavailable`; a completed write means `saved`. Failed writes are not retried or queued. The CLI reports the number actually saved. Successful persistence against a live database must be verified separately; stubbed writes do not prove live MongoDB operation.

## Running the CLI

```sh
npm run test:prompts
npm test
```

The CLI loads all six cases, prints ID/category and neutral execution/review/persistence status, and summarizes completed tests, errors, and saves. Exit code is 1 for startup or LLM execution errors; unavailable optional persistence alone does not fail the run.

## Running the API

```sh
npm start
```

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | Process health and provider/mock label; does not probe OpenAI or MongoDB |
| `GET /api/tests` | Predefined test library |
| `POST /api/tests/run` | Run a nonempty list of unique known IDs |

PowerShell example:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod http://127.0.0.1:3000/api/tests/run -Method Post -ContentType 'application/json' -Body '{"testIds":["PI-001","PI-003"]}'
```

Only `testIds` is accepted. Arbitrary prompts, credentials, and model configuration are rejected. Runs are limited to 10 requests per minute per IP and one active batch per process. Validation errors return 400, unsupported content type 415, oversize JSON 413, concurrent batch 409, and rate limiting 429. A valid batch returns 200 with per-case execution errors in its report; inspect `summary.errors`.

This is a local educational API without authentication. Before exposing it, add authenticated access and shared usage limits at a trusted gateway. Rate limits are in memory and reset on restart; reverse-proxy trust is not enabled. `HOST=0.0.0.0` and platform-provided `PORT` prepare it for future hosting, but no Railway deployment has been performed.

## Example Output

Abbreviated mock output (not an OpenAI result):

```text
PromptGuard
Provider: mock (MOCK: simulated responses)
[PI-001] Prompt Injection
Status: completed; review: review; persistence: disabled
...
Summary: Executed: 6; Completed: 6; Errors: 0; Review required: 6; Saved: 0
```

## Result Interpretation

`completed` means a response was received and analyzed. `review` means human review is required, even with no indicators. Rules flag disclosure language, known synthetic canaries, credential-like strings, unsafe JavaScript patterns, and refusal language. Negated examples, quotations, and educational explanations can trigger rules. A refusal can coexist with disclosure. No attack-success score or automatic vulnerability verdict is produced.

## Limitations

Only six synthetic scenarios; no production application integration, real retrieval pipeline, tool execution, multilingual testing, or coverage claim. Regex indicators have false positives and false negatives. Fixed mocks cannot assess security. Metadata-only retention protects against saving generated secrets but prevents replaying original responses; detailed investigations need a separately designed, access-controlled evidence workflow. No live OpenAI result or successful live MongoDB write is asserted by the default tests.

## Future Improvements

Add authorized application adapters, richer benign baselines and contextual review rubrics, opt-in redacted evidence handling, authenticated access for shared deployments, and integration tests against a disposable MongoDB service. Railway is a possible future deployment target, not a verified deployment.
