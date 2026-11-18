# M0: baseline and initial decisions

Date: 2026-11-16. Source baseline: `4f2ac1f` (`feat(assistant): add foreground voice and guarded Android controls`). The working tree was clean when this stage started.

**2026-11-17 follow-up:** after direct 3.6 Flash 503/504 failures and user-authorized candidate work, the explicit public-test planning pin is now `gemini-3.5-flash-lite` with MEDIUM reasoning. The three required interpretation cases passed across an interrupted run plus a delayed check; one transient 503 remains recorded. The user approved an opt-in 30/day shared public-test cap for Flash-Lite, retaining INR 0, the same counter, public-only input and all native authority gates. See [current evidence](live-public-evaluation.md). The initial decision table below is historical; no production/default live binding or private-cloud approval is inferred.

**Status:** development baseline and initial free-tier/budget choices recorded. Live-provider enablement, private cloud processing and release acceptance remain gated. This checkpoint starts the [merged roadmap](merged-implementation-plan.md); it does not implement the M1 backend connection or M2 user-facing dynamic planning.

## 1. Authorization and ownership

The user authorized implementing the merged plan one stage at a time, confirmed **free-tier Gemini API**, and asked to set the budget accordingly. The initial assistant-planning paid-spend allowance is **INR 0/month**. This is a requirement for the new planner, not a change to the existing chat account, Google billing or a claim that a spending control has already been deployed.

Engineering owns local implementation and automated evidence. The user owns provider-account verification, budget/scope decisions and manual phone acceptance when resumed. Public-launch privacy/legal, independent security assessment, platform/store review and operations sign-off still need their appropriate reviewers; local engineering checks do not supply those approvals.

No `.env` values, API keys, provider account, production endpoint, configured database, phone or billing settings were accessed. No live model request, build or deployment is part of this checkpoint.

## 2. First visible target

**M2's first real action will be Android media volume**, reusing the existing native method and its exact confirmation. Choose this before brightness delivery because basic volume execution already has user-reported phone evidence, while the brightness binary/device checks remain deferred.

Example: “put my media sound halfway” -> a validated `media_volume.set` action with `schema_version: 1` and `percent: 50` -> the existing trusted confirmation/one-use execution flow. Language understanding changes; native approval and numeric limits do not.

The first slice permits one complete, supported volume action. It must clarify ambiguous values, reject 90%, avoid interpreting questions/negation/quoted or untrusted content as commands, and avoid silently executing part of a compound request. Relative commands requiring state reads wait for M3; resumable multi-step effects wait for M4.

[Synthetic evaluation cases](../../tests/fixtures/assistant-planner-evaluation.json) capture these expectations. They are test data for the future planner evaluation harness, **not a phrase-to-action lookup implementation**. Their outcome labels are an evaluation rubric, not a new wire protocol or authorization. No model accuracy has been measured from these cases.

## 3. Current contracts and compatibility boundary

| Area | Verified source baseline | M1/M2 must preserve or change deliberately |
| --- | --- | --- |
| Simulation | `backend/app/schemas/assistant.py`: protocol 1, `mode: simulation`, typed actions, at most five steps and distinct earlier dependencies | Preserve v1 simulation. A new non-authoritative planning contract must not reinterpret simulation as execution authority |
| Security | `security:manage`, device/account/install/origin binding, native proof and restricted web cookie/CSRF flow | Add an explicit planning-only scope/consent boundary. Do not use ordinary account credentials or a model response as effect authority |
| Real controls | Separate `assistant:volume` / `assistant:brightness` scopes, proof purposes and task ledgers; policy version 1 | Preserve existing routes, action shapes, isolated scopes, native validation and one-use claims |
| Database | Assistant migrations through version 4; v3 volume and v4 brightness | Additive migration only if M1 needs persistent planning grants/budgets. Recheck the latest version before allocating the next one; no configured database is migrated here |
| Native bridge | Optional `executeVolume`, `cancelVolume`, `executeBrightness`, `cancelBrightness`; native owns confirmation/network/claim/effect/evidence | Reuse volume for M2. Do not expose arbitrary URLs, permits, streams or generated code through a new bridge |
| Shared execution gate | Server and compiled native opt-in, default off; simulation remains independent | No environment toggle for every command. Planner enablement, if needed, controls a distinct external-processing purpose |
| Current understanding | `voice.ts` calls `planCommand`; mobile volume/brightness helpers reparse transcripts with the same grammar | M2 must select actions from the same validated plan snapshot reviewed by the user, rather than reparsing the original phrase |
| Provider port | `planWithProvider` exists, bounded to 1,024 characters, 8 KiB output, two attempts including one schema repair and 30 seconds overall | This port is not a live integration. Link cancellation and keep repair within the same deadline |
| Capability discovery | Existing descriptors describe **simulation**, including platform hints | Do not advertise their platform list or `execution: simulation_only` as a real-executor catalog. M1 needs explicit planning/support metadata |
| Results and recovery | Typed outcomes, independent native readback, unknown markers, no automatic effect replay | Model prose cannot report completion. Current per-invocation task UUIDs must not be reused as a resumable-plan design; stable coordination waits for M4 |

No client API, handler, schema, scope, permission, native confirmation requirement or database table changes in M0.

## 4. Provider, privacy and zero-paid-spend decision

| Decision | Initial disposition | Remaining enablement requirement |
| --- | --- | --- |
| D1 / D5: first implementation slice | Existing Android volume first; web can display a non-executing plan; English text/PTT input | Actual M2 integration and compatible runtime/device evidence |
| D4: provider/tier | User-selected Gemini **free tier**. Reuse the installed `google-genai==2.22.0` SDK; no provider framework or new dependency | Verify account/model eligibility before a live opt-in test; source cannot establish the user's actual Google billing state |
| D4 / D14: model | Initial development model `gemini-3.6-flash`, explicit Standard text/JSON use, with no alternate-model chain | Mock/schema evaluation first, then an approved synthetic-only live check; live availability/quality are not established. Do not silently inherit chat defaults or an alias that is known to redirect |
| D8: initial cloud data scope | Public, fabricated test commands only. Personal/confidential commands, raw audio, contacts, messages, schedules, credentials and chat history are excluded | Private-command cloud processing is not approved by choosing the free tier. Resolve its provider/data/region/retention and user-consent design before enabling it |
| D9: spending | INR 0/month **paid** assistant-planning budget; no paid model/tool/provider fallback and no billing upgrade | The real API project must remain free-tier. If its billing status changes, pause and review; an application setting cannot control Google account billing |
| D14: quota/retry | Stop on 429/quota, unavailable model or denied provider policy; no retry storm or automatic upgrade. At most one eligible schema-repair attempt within the common deadline | Enforce this in M1. Provider quotas vary; no daily request entitlement is promised or inferred from Expo/EAS limits |
| D2 / D11: existing security | Keep exact native approval, replay protection and current scoped sessions | Deferred tests remain blockers for dependent device acceptance or reduced confirmation |

Google's pricing page lists Standard Gemini 3.6 Flash text input/output as free-tier eligible, and its model page identifies the stable model code and structured-output support. Actual availability is account-dependent; the exact installed SDK still needs adapter/conformance tests. [Model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.6-flash).

The repository's chat default is `gemini-3.5-flash`. Google's current notice says that model is deprecated and API calls are routed to 3.6 Flash. **Do not inherit that alias for the new planner.** Existing chat configuration is outside this change and remains untouched. [Deprecation notice](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash).

Google's unpaid-service terms permit product-improvement use and human review of submitted content and prohibit submitting sensitive/confidential/personal information; regional exceptions do not establish this project's eligibility. Paid processing also has retention/data-location conditions, so upgrading alone would not finish a private-data design. The initial free-tier scope is therefore synthetic-only, with no automatic private-command upload. This is a data-flow restriction, not a legal/privacy certification. [Gemini API terms](https://ai.google.dev/gemini-api/terms).

Billing reports can lag usage; alerts are not the new planner's hard spending enforcement. Do not enable paid billing, grounding, code execution, computer use, file search, remote tools or another service to work around free quota. No provider request is made by M0. [Billing documentation](https://ai.google.dev/gemini-api/docs/billing).

## 5. Installed SDK checks for M1

Read-only inspection of the pinned SDK found `response_json_schema`, `AutomaticFunctionCallingConfig.disable` and `HttpOptions.retry_options`. Its `HttpRetryOptions.attempts` describes a default of five attempts; automatic function calling is enabled unless disabled and has a remote-call limit. These defaults must not escape the application's smaller request budget.

The M1 adapter must therefore explicitly disable automatic function execution, supply no executable tools, set HTTP attempts to one, use one approved model and bound each request to the remaining overall deadline. The one schema repair is controlled by Contexify, not an additional SDK retry loop. No SDK client or network request was created to inspect these definitions.

## 6. Verification and handoff

M0 verification records baseline behavior, fixture validity and contract compatibility; it does not test model quality or phone behavior. Fresh checks at the source baseline passed:

- **116 backend cases:** 12 isolated configuration, 17 assistant security, 31 shared-core/protocol, 26 volume and 30 brightness cases. Fixtures use disposable SQLite and loopback Turso rather than configured services.
- **111 JavaScript cases:** 30 core, 33 voice, 14 security clients, 12 volume, 5 brightness, 9 readiness and 8 build-isolation cases.
- Both client TypeScript checks and generated API-contract verification.
- All **24 synthetic evaluation cases**: unique IDs, bounded text, recognized scenario/provenance/outcome labels, valid proposed action schemas and no action attached to negative/deferred cases. These validate the dataset, not a model's answers.
- Local documentation links, Markdown fences, whitespace and preservation of all M0-M8 / D1-D14 / S01-S45 identifiers. Source `HEAD` and staging remained unchanged.

No native source changed, so native compilation was not repeated; earlier native evidence remains in [Phase 4C](phase-4c-brightness.md). Existing authentication regression counts are not added to this M0 run, and no physical-device or model-quality result is inferred from the passing baseline.

Existing manual checks stay in [Android acceptance](android-acceptance.md) and are **Deferred** until the user resumes them. Do not reconnect the phone, run ADB, rebuild an APK or consume EAS quota to close M0. Brightness remains source/module-verified with binary/device acceptance open.

Next is **M1's non-live foundation**: separate proposal contracts and a truthful catalog, isolated authenticated planning path/scope, consent/privacy checks, bounded/cancellable provider adapter with automatic execution/retries disabled, fake-provider tests and evaluation support for the synthetic corpus. Live requests remain a separate opt-in gate, and M2 is where the user-facing natural-language path is connected. Follow [the merged roadmap](merged-implementation-plan.md) rather than expanding command handlers during M0.
