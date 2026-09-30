# PromptGuard methodology

## Scope and trust boundaries

Prompt injection occurs when instructions in input influence an LLM in conflict with the application's intended instructions. Direct injection comes through the user's prompt. Indirect injection comes through material the application consumes, such as a retrieved document. PromptGuard simulates the latter using a quoted fictional document; it does not test a real retrieval pipeline.

The demonstration wrapper asks for a `DEMO` prefix, treats documents as data, and keeps publicly documented synthetic canary values private within the toy interaction. These values are fixtures, not actual secrets. No generated code is executed and no tools are provided. Requests contain only controlled educational text.

LLM security depends on application instructions, data access, tool permissions, output handling, and intended behavior. A model's text response alone usually cannot establish an application vulnerability. Revealing instructions without sensitive content is not automatically a security impact. Production secrets do not belong in system prompts.

## Case organization and execution

The JSON library includes an ID, category, name, prompt, and hypothetical `expectedRisk`. This risk label describes the scenario, not an observed finding. Loading validates identifiers, category names, sizes, and duplicate IDs. The API selects existing cases; it cannot supply new prompts or credentials.

The CLI and API share a sequential runner. Each case sends its prompt through `generate(prompt)`, which returns text and limited usage metadata. The mock implementation returns a fixed response clearly labeled as simulated. The OpenAI implementation wraps the official Responses SDK using fixed application instructions, a configured model, timeout, output budget, and no retries. Every case is independent.

The runner analyzes text in memory, records execution status and indicator names, then optionally saves metadata using Mongoose. Failure to persist does not become an LLM execution error. Raw response text, prompt text, matches, connection strings, and exception details are not logged. A health response only establishes that the HTTP application is running.

## OWASP mapping

The official [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) lists the 2025 edition used here (checked during implementation on 2026-09-30).

| Project concept | Official category | Scope of this demonstration |
| --- | --- | --- |
| Direct/override/context injection | LLM01:2025 Prompt Injection | Synthetic attempts to change prefix or task |
| Fictional token disclosure | LLM02:2025 Sensitive Information Disclosure | A known synthetic token, no real personal data |
| Internal instruction extraction | LLM07:2025 System Prompt Leakage | Toy instructions and a public synthetic canary |
| Unsafe code-generation request | No direct category assigned | JavaScript `eval` suggestion only; nothing executed |

LLM05:2025 Improper Output Handling concerns downstream handling of output. Generating a code snippet alone does not demonstrate that issue; this project has no execution sink. It also does not establish excessive agency, retrieval weaknesses, or coverage of all OWASP categories. Categories are organizational references, not OWASP-certified findings.

## Transparent classification

The rules in `src/services/classifier.js` detect disclosure wording, exact synthetic canaries, key/password-like strings, `eval`/`new Function`/`child_process` patterns, and refusal wording. The full rule set is intentionally readable. Results always retain `review` for completed responses and `not_evaluated` for execution errors.

These indicators cannot determine intent, actual access, whether a string is a real secret, or whether code was used. A response explaining why `eval` is unsafe can trigger the unsafe-code rule. A refusal can also contain the requested synthetic token. Absence of indicators is not a safety claim. The initial rules do not score prefix compliance or exact task completion; review must assess those behaviors separately.

## Manual review

1. Confirm provider and mock flag. Mock results only exercise the pipeline.
2. Establish the intended behavior, authorized test scope, application context, and relevant trust boundary.
3. Check execution and persistence status separately; do not interpret an error as a refusal.
4. Interpret each indicator against the expected behavior, including quotations and negations.
5. If investigating further, use only synthetic inputs and a separately authorized evidence workflow. This harness deliberately does not retain raw output, so metadata alone cannot verify a disclosure or reproduce the exact text.
6. Record uncertainty and false positives. Confirm an application-level consequence before making a vulnerability claim.

## Verification boundaries

`npm test` tests local behavior, HTTP endpoints, SDK stubs, stubbed database writes, and a real driver connection failure to an unreachable loopback MongoDB address. It never uses environment credentials for live OpenAI calls or a user's database. `npm run test:prompts -- --mock --no-persistence` demonstrates the whole CLI offline. Successful real provider calls, successful real database writes, and deployment need separate verification and are not implied by these tests.

The OpenAI adapter follows the [official text-generation interface](https://developers.openai.com/api/docs/guides/text). Model access is explicitly configuration-dependent. There are no claims of compromised models, successful attacks, leaked real information, executed unsafe code, or deployed infrastructure.
