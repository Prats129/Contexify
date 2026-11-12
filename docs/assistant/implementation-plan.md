# Assistant implementation plan and approval record

**2026-11-12 authorization:** the user approved starting Phase 1A. Local security implementation and tests are authorized; deployment, later phases and unresolved processor/region/retention decisions remain gated. See [Phase 1A implementation](phase-1a-security.md) and [verification checkpoint](phase-1a-progress.md).

**Recommendation:** approve a security-foundation phase followed by an Android foreground push-to-talk MVP and restricted web companion. Keep the existing stack. Defer always-on wake, direct communication and cross-device control. This document is a proposal; implementation requires explicit approval.

Planning date: 2026-11-07. Read [feasibility](feasibility.md), [architecture](architecture.md), [threat model](security-threat-model.md), [permissions](permissions.md), [privacy](privacy.md), [test gates](testing-strategy.md), and [current source findings](review-coverage.md). The old AUD-001/AUD-002 descriptions are historical: current code has identity/ownership and Google verification, and selected isolated regressions pass. Do not rebuild those controls from the old audit's assumptions.

## Realistic first release

Registered adult users on a deliberately selected Android device/OS range; English text and push-to-talk; visible recording, transcript correction, no background listening. Support Contexify-owned reminder create/list/cancel, app-window brightness, bounded Android media volume, and a small allowlist of app opens. Reminders are user-confirmed schedules subject to OS notification timing, not a promise of wake-up-alarm precision. Web supports task entry/preview, own app records and supported browser handoffs; it does not control the phone or promise closed-browser alarms.

Reuse local native STT/TTS where tested; text remains available. Cloud planning is opt-in and uses minimal text; sensitive device data stays local. Missing local speech support produces a clear text fallback unless the user separately opts into an approved cloud STT provider. A low-risk action still follows the policy pipeline. No contact/calendar bulk synchronization, SMS send, direct call, personal WhatsApp automation, security setting mutation, shell, remote device control or arbitrary plugin in MVP.

First useful walkthrough: “Remind me to call John tomorrow at 9 AM” -> show exact calendar date/time/timezone and reminder text -> user confirms -> schedule and read back OS/app registration -> say “Reminder scheduled,” with its timing limitations. This does not resolve/contact John or place a call. “Increase volume to 70%” -> parse locally -> check foreground/unlock/consent -> set media stream within guardrails -> show measured achievable value.

## Delivery phases

Effort is an engineering estimate, not a delivery promise: one engineer-week means five focused working days. Estimates assume two experienced engineers, shared QA/security support, physical Android/iOS devices and access to macOS/iOS signing. Phase boundaries are release gates; no estimate authorizes execution.

| Phase | Work, ownership and dependencies | Exit evidence | Estimate |
| --- | --- | --- | --- |
| 1. Audit/design | This documentation, current baseline checks, official-source feasibility, threat model, decisions | Eight documents reviewed; remaining device/legal/commercial unknowns assigned | Planning complete; approval pending |
| 1A. Security readiness | Backend + client owners: secure assistant sessions/storage, release HTTPS/origin validation, prompt/log redaction, encryption/key decisions, device enrollment proof, CSP/CSRF strategy, privacy inventory | ASST-001..005 addressed for assistant path; cross-user/device tests, credential migration and revoke/restore cases pass | 3–5 engineer-weeks |
| 2. Shared core and authorization | Backend/mobile owners: versioned Pydantic schemas/generated TS, pure client core, deterministic parser, proposal planner, catalog, native validator/confirmation skeleton, one-use permits, durable task ledger, idempotency and migrations | Simulated adapters only; zero executable tools from chat/model; replay/TOCTOU/concurrency/unknown-outcome tests pass on SQLite and Turso fixture | 4–6 |
| 3. Foreground voice | Mobile/web owners: native capture/ASR/TTS and browser adapter, explicit consent, transcript editor, interruption/lock/cancel controls, optional approved cloud STT | English corpus and physical-device privacy/latency tests; no audio retention or hidden fallback; text parity | 3–5 |
| 4. Low-risk Android MVP | Mobile owner: app-owned reminders with explicit confirmation, display/audio controls, reviewed app catalog; web restricted UI, history/settings, staged flags | Per-capability physical-device evidence; lifecycle, privacy and existing-chat regressions; bounded beta pilot | 3–5 |
| 5. iOS and native extensions | iOS/native owner: iOS scheduler, supported AlarmKit, App Intents/Shortcuts, Android Clock integration, calendar/contact picker experiments and permission lifecycle | OS-version capability gates, iOS signing/review, own-object cancellation, background limitations verified; no private APIs | 5–8 |
| 6. Sensitive actions | Security + native owners: exact-recipient/content composer flows, device step-up, no-retry reconciliation, sensitive history. Direct/provider APIs only as separately approved subprojects | Independent assessment, store/provider review, no ambiguous success, user trials with synthetic recipients; zero approval bypasses | 4–7 for composers; direct integrations excluded |
| 7. Wake and production hardening | Native/security/QA: approved engine/license, bounded local wake experiment, optional Android default-assistant feasibility, reliability/load/battery tests, operational runbooks, incident exercise | Battery/false-trigger gates and OEM evidence; R3 remains gesture-confirmed; store/policy acceptance; production readiness sign-off | 4–7; hardware/entitlement feasibility may stop background work |

MVP phases 1A–4 total **13–21 engineer-weeks**, approximately **10–16 calendar weeks** with two engineers including integration/QA buffers. Full proposed sequence totals **26–43 engineer-weeks**, approximately **18–30 calendar weeks** with specialist availability; external review/approval delays are additional. A solo engineer should plan at least the summed engineer-week effort plus coordination/testing overhead. These estimates exclude custom ASR training, a WhatsApp Business product, desktop, cross-device execution and a full remediation of every historical audit item.

Do not defer security to Phase 7: authorization, encryption, native policy and replay protection precede any real effects. Stop a capability if official APIs cannot provide a safe supported flow; preserve a composer/manual alternative instead of using UI automation.

## Concrete integration and compatibility sequence

1. Freeze baseline contracts and existing chat behavior with current tests. Add isolated assistant modules rather than modifying `ChatMode` or interpreting ordinary model output as commands. Keep attachments, guest chat, temporary retention, SSE and both clients working.
2. Introduce migration version tracking and additive assistant tables/indexes, then deploy disabled server support. New session/device fields must not make old clients unable to chat. Reject old credentials at assistant endpoints until upgraded/enrolled, rather than weakening the gate.
3. Build native module and secure storage migration. Copy valid legacy session into secure storage only during a controlled upgrade; remove the old copy, rotate/re-enroll where required, and safely force login on failure. Encrypted local assistant state must remain recoverable or explicitly reset without data loss to unrelated chat.
4. Generate shared contracts, publish local package artifacts through existing separate installs, verify Metro/Vite and both TypeScript projects. No new workspace manager, agent framework, message broker, Redis or vector index is required.
5. Produce new EAS binaries with reviewed permissions and runtime. Current `runtimeVersion.policy=appVersion` makes a native change a new compatible binary/version requirement. OTA is for matching runtimes only; verify Android/iOS/platform/channel separately. Review pinning of the EAS CLI and command-shell argument construction before privileged release automation.
6. After restore and schema-compatibility tests, enable internal fake-adapter testing, then internal real-device low-risk adapters. Keep R3, cloud speech, wake and remote-device actions individually off until their gates pass.

## Rollout, rollback and operations

Flags: master assistant, platform/OS adapter, each capability, cloud planner, cloud STT, wake foreground, wake background, native assistant role, sensitive composers. Server is authoritative for new permits; native code also has a compiled minimum policy and user disable. Client UI hiding is not enforcement. Flags and cached discovery cannot widen a compiled capability.

Proposed rollout: staff synthetic accounts -> 20 opt-in users -> 1% -> 5% -> 25% -> 100% of eligible enrolled devices. Each stage has at least seven days of telemetry and review; small cohorts need enough command volume to meet statistical gates, not merely elapsed time. Stop on any unconfirmed sensitive action, private-data leak, cross-account/device access or unexplained duplicate effect. Initial privacy monitoring uses aggregate timings/state counts, never captured transcripts.

Rollback disables new permits/capabilities, expires pending confirmations, and preserves audit/reconciliation and existing chat. Native rollback uses a compatible previous binary/update only; never publish incompatible JS into an older runtime. Keep additive tables/columns until all supported clients migrate; do not drop task state or reverse migrations during an incident. Already scheduled reminders may continue and need an explicit cancellation/reconciliation flow. Prove backup restore in disposable environments, with deletion and revocation records reapplied.

Operations: track planning latency/schema failures, permission denials, confirmation abandonment, execution state/unknowns, replay rejections, receipt delay, schedule reconciliation and provider spend. Alert on auth/nonce anomalies and unexpected capability use. Single-device execution requires no inbound socket or cloud command worker. Capacity tests determine whether existing SQL contention or worker pools need improvement before adding infrastructure.

## Cost model

Illustrative monthly workload: 1,000 active users, 10 commands/day, 30 days = 300,000 commands. Assume 60% deterministic local routing and 40% cloud planning; each cloud call averages 1,000 input + 200 output tokens. At the documented Gemini 2.5 Flash-Lite standard text rates ($0.10/$0.40 per million input/output tokens), **120,000 planning calls cost about $21.60**. This is a pricing benchmark, not approval of that model or verification of the repository's configured models. [Official Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

At eight seconds of audio/command and 25% cloud STT fallback, billable audio is 10,000 minutes. At Google STT v2 standard's first usage tier of $0.016/minute, **STT is about $160/month** before billing rounding and discounts. All-cloud speech would be about $640 for this workload. [Official STT pricing](https://cloud.google.com/speech-to-text/pricing). Prefer local TTS initially; cloud TTS, search grounding and image generation are excluded.

| Scenario | Incremental planning + speech | Backend/storage/security-log allowance | Approximate total before contingency |
| --- | --- | --- | --- |
| 100 active users, same mix | $18.16/month | $30–100/month | $48–118/month |
| 1,000 active users, same mix | $181.60/month | $50–250/month | $232–432/month |
| 10,000 active users, same mix | $1,816/month | $250–1,500/month | $2,066–3,316/month |

Infrastructure ranges are budget assumptions, not provider quotes or measured capacity. They cover incremental API/SQL capacity, encrypted storage/backups, key management and redacted observability; existing chat/RAG infrastructure spend is separate. Add 20–30% contingency for retries, speech billing increments, traffic spikes and schema-repair calls. Formula: `commands * cloud_fraction * ((input_tokens * input_price + output_tokens * output_price) / 1e6) + audio_minutes * stt_price + infrastructure`. Example rates are USD, checked 2026-11-07; tax, FX, egress, build services, store accounts, commercial wake license, security assessment and engineering are excluded. Reprice the approved provider/model before procurement. No free tier is assumed for private assistant data.

Compute/cloud spend is likely smaller than engineering, physical-device QA and independent security review. Avoid GPU servers for MVP. Set hard per-account/global budgets and alerts; cap cloud requests rather than automatically selecting an undisclosed cheaper provider. No purchasing, provider provisioning or infrastructure changes are authorized by this estimate.

## Decisions requiring approval

| Decision | Recommended choice | Consequence / unresolved input |
| --- | --- | --- |
| D1 Scope/order | Android PTT + restricted web first, iOS in Phase 5 | Approve explicit limits on background wake and browser control |
| D2 Security work | Approve Phase 1A before executable capabilities | Changes secure storage/session/transport/privacy boundaries; existing chat compatibility required |
| D3 Users/regions/languages | Adults in India; English initial corpus | Confirm regions, age policy, Hindi/Hinglish priority and minimum supported devices |
| D4 Cloud processing | Local native speech; optional reviewed paid planner; cloud STT separately opt-in | Approve processor/region/retention and spend ceiling; decline -> deterministic/text-only fallback |
| D5 MVP capabilities | Own reminders, window brightness, bounded media volume, reviewed app opens | Exact alarms and external calendar/contacts are later gated additions |
| D6 Communication | Composer handoffs with exact confirmation; direct send/call deferred | Confirm user expectation that “opened draft” does not mean “sent” |
| D7 Wake | Foreground experiment later; Android role/background only if evidence and license pass | No commitment to iOS always-on custom phrase; vendor AccessKey issue unresolved |
| D8 Privacy and retention | Separate private history/security ledger; no raw recording retention | Counsel approves India legal schedule and processor handling before public promises |
| D9 Team/budget | Two engineers plus native QA/security support; staged delivery | Confirm staffing, real-device access, monthly cap and assessment budget |
| D10 Trust/remote control | Same-device execution only; no arbitrary plugins | Cross-device or desktop execution requires a new threat/design approval |

The original planning task stopped at documentation. The subsequent 2026-11-12 instruction authorizes Phase 1A source/dependency/migration-code changes and isolated tests. This does not authorize running migrations against configured data, deployment or later device execution phases. Remaining decisions must be resolved before their dependent work or release.
