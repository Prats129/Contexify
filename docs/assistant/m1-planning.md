# M1: non-live secure planning foundation

Date: 2026-11-17. Starting baseline: `189f75c` (M0). Scope: authorized local M1 implementation under the [merged roadmap](merged-implementation-plan.md). The non-live development stage and isolated checks below are complete; live, device and release gates remain open.

The backend planning contract, consent boundary, provider adapter and isolated tests are implemented. **The normal app has no live planning provider attached**, and the feature defaults off. This is not M2's user-facing natural-language integration, model-quality acceptance or permission to send private content to free-tier Gemini. Existing volume/brightness execution and native confirmation are unchanged.

## Contracts and truthful discovery

`backend/app/schemas/assistant_planning.py` defines separate `mode: proposal` actions/feedback, request/response models and planning-grant metadata. The existing simulation contract remains `mode: simulation`; new proposals cannot be submitted as simulation tasks or used as effect credentials. Shared action schemas and dependency validation keep current numeric bounds, application IDs, five-step limit and distinct earlier-only dependencies.

Feedback has fixed status/reason codes, not arbitrary model-generated prose. Model responses cannot supply confirmation, identities, permit/scope/risk overrides, execution state, plan IDs or revisions. The server assigns a fresh plan ID, revision 1, current owner/device and bounded expiry. The response always has `execution: not_authorized`. It is an ephemeral proposal, not a stored/resumable task or cryptographic proof of an OS outcome. Stable effect identities and durable parent-plan recovery remain M4 work.

`planning_catalog.py` reports Android **source** support for media volume and Contexify window brightness, and preview-only app opening. Installed/runtime availability is always `unverified` in M1. Web/iOS surfaces can preview proposals; they do not gain Android capabilities. This catalog does not reuse simulation platform hints as proof of a real handler, permission, enabled binary or device authority.

Both clients and the shared assistant-core package receive additive generated planning declarations. Existing declaration formatting is preserved; the generator's semantic check verifies the full result. There is no new client request path or UI wiring in this stage.

## Consent grant and endpoints

Routes are under `/api/v1/assistant/planning`:

| Method/path | Contract and authorization |
| --- | --- |
| `POST /grants` | Explicit boolean consent, policy version 1 and `synthetic_evaluation` scope, plus a valid assistant security session |
| `POST /grants/{grant_id}/revoke` | Revoke a grant owned by that same user and parent session |
| `GET /grants/{grant_id}/capabilities` | Read the proposal catalog using that grant and parent session |
| `POST /proposals` | Grant ID, bounded command text, instruction provenance and a synthetic-case ID; requires consent/auth again and a configured provider |

The grant is a scoped consent record, **not another bearer credential**. Every endpoint still needs the existing native device-management credential or web HttpOnly assistant cookie with CSRF/exact-origin checks. A grant ID alone, normal account credential, another user's cookie or another management session cannot use it. Web clients do not receive a new bearer token. Native grants retain device binding; server-derived parent/platform data cannot be overridden in the request.

Migration **v5** adds only `assistant_planning_grants` and its indexes. Rows contain opaque IDs, owner/session/device binding, policy version and timestamps; no command, audio, model response or provider key. Grants expire within five minutes and the parent-session lifetime, with four active grants per account and bounded opportunistic cleanup. Parent-session/account/device deletion cascades. This is not a timed-deletion service or a private action-history store. Prior v1-v4 DDL and existing action records are retained.

Consent, parent login, device revocation, policy version, origin and feature state are rechecked at admission and after the provider returns. Expiry, logout, revoke or policy/gate changes discard late output. The schema/transport reject oversize input without truncation or reflecting Pydantic input/context. Text is bounded to 1,024 UTF-16 code units and 3,072 UTF-8 bytes, with the existing 4 KiB HTTP-body cap remaining independently effective.

## Bounded generation and privacy

`planning_engine.py` accepts an injected provider port and has no chat, RAG, history, vector/search, storage or executor dependency. Provider input contains only the command, public synthetic-case ID and platform; it never contains account/device/session/grant IDs or credentials. No model output is persisted.

- At most two provider attempts, including one eligible syntax/structural-schema repair within one 30-second generation deadline. Invalid authority fields, capability/range/dependency violations, refusal, provider failure or quota denial do not trigger repair/fallback.
- Complete output only; strict JSON parsing rejects duplicate fields/nonfinite values, checks the 8 KiB output limit and validates the full proposal schema. No partial streamed response executes or becomes an approved action.
- Two active generations per engine/process, immediate backpressure and no waiting queue. A provider that ignores cancellation retains its slot until it actually settles; late results cannot escape through a subsequent request. This is a per-process concurrency bound, not a distributed lease.
- Disconnect/caller cancellation and deadlines cancel pending generation. Underlying providers remain responsible for cooperative network cancellation; a stuck provider cannot create an unbounded chain of replacement calls.
- Existing shared SQL token buckets bound per-user/global request admission, including repair calls. These are replenishing admission budgets, not promises about provider quota or a monetary/calendar-month ledger. A quota error pauses the engine for a 60-second local cooldown; it never performs a background retry or assumes the provider's quota resets then.
- Errors use fixed public messages. Provider prompts/bodies, exception text and raw validation details are not returned or added to application logs by this implementation. Deployment proxy/access/crash logging still needs its existing release review.

## SDK adapter and the INR 0 decision

`planning_provider.py` implements an explicit Gemini GenerateContent adapter using the existing pinned SDK, initial model `gemini-3.6-flash`, structured JSON, no tools, disabled automatic function execution, HTTP attempts set to one, a remaining-deadline timeout, minimal thinking with no returned thoughts and a 1,024-token output cap. Returned function calls are rejected. No alternate model/provider or chat fallback chain is used. The full application schema remains authoritative even where the provider projection omits Pydantic-specific discriminator annotations. [Structured-output guidance](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [SDK function-calling guidance](https://ai.google.dev/gemini-api/docs/generate-content/function-calling), [thinking controls](https://ai.google.dev/gemini-api/docs/thinking).

The adapter checks the exact case-ID/text pair against an explicit copied, reviewed public corpus **before creating an SDK client**. A caller's `synthetic_case_id` tag alone is insufficient. The mapping is only a data-egress allowlist for an approved evaluation harness; it does not map commands to actions or replace model interpretation. Corpus/schema conformance with a fake provider is not evidence of language understanding or intent accuracy.

There is no automatic API-key lookup or use of the chat singleton. A future live evaluator must supply a key explicitly, confirm the real project/model is free-tier eligible, supply the reviewed synthetic corpus, own/close the adapter and obtain the outstanding live-test approval. Closed adapters do not reopen implicitly. Model/account eligibility, actual API compatibility/latency, quality and privacy traffic inspection are **not established** by mocked SDK tests.

The user's **INR 0/month paid-spend allowance** is retained: M1 attaches no live provider, upgrades no account and makes no real API requests. It does not claim an application flag can control Google billing. Arbitrary private commands cannot use this free-tier evaluation path. Broader private processing and any paid budget retain D4/D8/D9 review. [M0 decisions and provider terms](m0-baseline.md).

## Configuration and compatibility

`ASSISTANT_PLANNING_ENABLED=false` is a single opt-in for the separate planning/data-processing purpose, requires assistant security, and needs neither simulation nor real execution enabled. It is not a per-command gate. Turning it on alone does not bind a provider; proposal requests still fail closed with an unavailable response. No model, price, provider-key or command-specific environment settings were added.

The isolated practice host includes the router with the new gate still off, no live provider, and its existing external-network prohibition. No configured backend was restarted or migrated. Production settings, native binaries, app identities, signing, TLS trust, runtime versions, SDK dependencies and Android/iOS permissions are unchanged. No APK/EAS job, phone access or previously deferred acceptance was performed.

## Verification and remaining work

Completed locally on 2026-11-17, using disposable settings/accounts/databases, loopback Turso and injected providers/SDK factories, not production accounts or external APIs:

| Check | Result and limits |
| --- | --- |
| Backend configuration/security/core/volume/brightness/planning/contracts | **170 passed**: 13 + 17 + 31 + 26 + 30 + 42 + 11; each file run separately through the existing isolated harness |
| Existing authentication security regression suite | **435 passed**; isolated accounts/settings, no production service calls |
| JavaScript suite (`node --test tests/*.test.cjs`) | **111 passed**; simulated host/native ports do not establish device behavior |
| Frontend and mobile TypeScript | Both `tsc --noEmit --incremental false` checks passed |
| Generated API declarations | `scripts/generate_api_contracts.py --check` passed; existing contracts retained |

The 42 planning cases cover native/web authorization, CSRF/origin and account/session isolation; explicit consent, expiry/revocation/logout and late-output rejection; strict schema/Unicode/body limits; malformed/authority-injected/range/dependency output; bounded repair, quotas/backpressure/cancellation/deadlines; no provider/env-key binding; SDK no-tools/retry/timeout controls; exact synthetic-pair egress checks; and SQLite v4-to-v5 rollback/idempotence/record preservation/backup restore. Route checks also run against the existing loopback Turso harness. Public evaluation fixtures are checked against contracts with a fake provider; this is not a live language-quality evaluation.

Python AST parsing passed for 78 backend/script/new-test files. Diff/new-file whitespace, local documentation links/fences and retained stage/decision/scenario ID checks passed. No native source changed, so no new binary was built. Deferred physical tests and production acceptance have not been silently marked complete.

Remaining gates: M2 UI/validated-snapshot wiring and parent lifecycle cancellation; explicit approved live synthetic evaluation if/when requested; model quality and real deployment logging/timeout topology; private-data processing approval; native/device/release acceptance already tracked in [Android acceptance](android-acceptance.md). M1 does not close these by adding contracts or passing mock tests.
