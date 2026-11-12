# Assistant testing strategy and release gates

Proposed verification plan, 2026-11-07. Actual checks performed for this documentation-only review are in [review coverage](review-coverage.md). There is no implemented assistant to test yet. Passing existing chat tests does not prove device-action safety.

## Test environment and evidence

Use disposable SQLite files and a loopback/mock Turso transport, fake OS adapters, synthetic contacts/calendar/messages and blocked outbound providers. Unit tests must inject clocks, IDs, auth context and network clients; no `.env`, user databases or existing root verify/reset scripts. Contract generation can import schemas only. Dedicated sandbox accounts/devices may be used later after scope approval; never use production recipients or accounts for communication tests.

Every test report records commit, dependency lock hashes, build/runtime/channel, OS/API version, device model, locale/timezone, permission state, network/lock/battery condition and observed result. Sanitize artifacts. Record failures/skips explicitly. Emulators cover API/permission logic; physical phones are mandatory for microphone, sleep/Doze, alarms, battery, OEM behavior, audio routing, Siri/assistant role and external composer flows.

## Verification matrix

| Layer | Required cases | Evidence / phase |
| --- | --- | --- |
| Schema and policy unit | Unknown/extra fields, type coercion, overflow, NaN, huge Unicode, unsupported IDs/versions, risk downgrade, arbitrary URLs/intents, missing grants | Python/TS/native common fixture corpus; Phase 2 |
| Deterministic parsing | Exact commands, negation, quotes/untrusted text, correction, date/time ambiguity, DST gaps/overlap, midnight/timezone travel, percent clamping | Golden cases with expected clarify/reject/action; no model needed |
| State machine | Allowed transitions, stale revisions, new identity/device, expiry/clock rollback, permission loss, cancellation before/after dispatch, timeout and unknown results | Property/state-transition tests; no impossible completed state |
| Device binding/auth | Guessed IDs, wrong user/device/origin, copied token, replayed enrollment, missing proof, stale/revoked key, restored backup, guest, legacy client, logout/password change | Cross-user/device tests for every endpoint and adapter |
| Confirmation integrity | Change recipient/body/time/capability/device/policy after approval, forged JS confirmed flag, reused biometric handle, malicious approval deep link | Native confirmation harness; every mutation rejected |
| Concurrency/idempotency | Double tap/ASR repeat, duplicate requests across workers, same key/different args, expired lease, interrupted commit/receipt, reconnect | Atomic claim tests on SQLite and Turso semantics; one winner, uncertain state preserved |
| API integration | Session lifecycle, CSRF/origin/CORS, malformed signatures, budget exhaustion, content limits, error redaction, method restrictions, cookie/bearer migration | Isolated FastAPI and client contract suite; no live provider |
| Voice lifecycle | Denied/revoked mic/speech, local model unavailable, no network mode, ASR error, partial transcript, Bluetooth/wired headset changes, incoming call, lock/background, silent audio | Emulator plus real phone; recording stops and text remains usable |
| OS capabilities | Notifications disabled, exact-alarm access revoked, missing handler/app, fixed-volume route, limited contacts, calendar grant change, deleted object, edited number | Adapter-specific tests per supported OS; honest unsupported/denied result |
| Reliability | Process killed at every ledger/OS transition, reboot, app upgrade/downgrade, offline, provider timeout, partial multi-step failure | Recovery report: no unsafe retries, no invented success, no lost ownership |
| Prompt injection | Direct command injection; hostile PDF/web/calendar/contact text; malicious tool receipts; encoded/Unicode/multilingual payloads; data saying consent granted | Assert zero unconfirmed action, zero unapproved data egress; model bypass cannot bypass policy |
| Voice abuse | TV/podcast/TTS echo, recorded/synthetic owner voice, another speaker, repeated wake word, low-volume/noisy command | Consent/step-up cannot be satisfied by audio replay; raw audio used only in approved lab corpus |
| Privacy | Capture TLS test traffic, SDK egress, logs/crash reports/cache/backups, plaintext token search, cloud-tier fallback, private history export/delete | No sensitive fields outside approved flow; encrypted-at-rest and key-loss/rotation evidence |
| Existing product regressions | Chat/RAG/web/image modes, SSE splits/cancel/message IDs, history/attachments, auth/OTP/Google, guest/temp retention, keyboard/scroll and both storage modes | Existing suites plus end-to-end UI tests; no feature regression hidden by assistant flag |
| Supply chain/release | Dependency/secret/SBOM/license scans, native SDK permissions, container/image scans, JS bundle secret check, update signature/channel/runtime mismatch | CI artifacts, approval/provenance record; no unreviewed privileged dependency |

## Minimum physical-device plan

Before implementation, pin the Expo-supported minimum Android/iOS versions from the actual native build. Test the minimum, latest stable, and relevant behavior boundaries within that supported range. Android coverage includes microphone foreground-service restrictions, notification permission and exact-alarm changes; Pixel/AOSP-like device plus Samsung and at least one battery-aggressive OEM device, including a midrange/low-memory model. iOS includes a supported pre-AlarmKit device/OS if retained, iOS 26+, latest supported OS and a lower-memory supported phone. Feature-detect instead of assuming every device has the same on-device language models or hotword hardware.

Web: current supported Chrome/Edge, Safari and Firefox, Android browser, iOS Safari and Home Screen PWA; feature-absent paths are required. A browser lacking local ASR must not silently start remote ASR. Test expired HTTPS, permission restrictions, background tab suspension and unavailable URL handlers. No claimed parity for unsupported APIs.

Regional language plan: English and Indian English accents first; Hindi/Hinglish only after an approved corpus, time/number/recipient normalization and locale-specific thresholds. Include visually accessible confirmation, screen readers, large text, switch access and interrupted confirmation. Device authentication alternatives must preserve accessibility without accepting ambient voice as proof.

## Measurable acceptance criteria

These are proposed targets to validate, not measured results or platform guarantees. Adjust performance targets only with recorded baseline evidence; security invariants are not tradeable for speed.

| Area | Gate |
| --- | --- |
| Authorization | 100% of registered capability negative-policy cases enforced in server and native conformance suites; zero cross-account/device success; unknown capabilities always rejected |
| Sensitive confirmation | Zero R3 dispatches without exact current confirmation; all bound-field mutations/replays rejected; no automatic retries after ambiguous external submission |
| Injection | At least 500 varied direct/indirect adversarial fixtures plus 100 malicious tool-result fixtures; zero unconfirmed effects or unconsented egress. Passing corpus is not proof against all injection |
| Reliability | Kill/fault injection at every state transition; repeated/parallel submits never create a second executor claim; every ambiguous side effect surfaces outcome_unknown |
| Result truthfulness | 100% of handoffs labelled handoff; scheduled never labelled delivered without evidence; missing handler/cancel/revocation never produces completed |
| Local privacy | Local-only voice tests show zero audio/transcript network egress; no raw recording files after completion; no plaintext credentials/private command payloads in Contexify stores/logs/crash reports |
| Local latency | p95 <= 500 ms from final transcript to simple display/audio action result, excluding human confirmation; baseline on selected midrange phone |
| Voice/cloud latency | Local transcript finalization p95 <= 1.5 s after speech ends; cloud plan ready p95 <= 3 s on defined stable network, hard 30 s timeout; report degraded/offline separately |
| Recognition/intent | >= 95% correct intent + required slots on an approved 500-utterance English corpus; all ambiguous recipient/time cases clarify; high-risk exact content always displayed |
| Wake detection | Before wake beta: <= 1 false activation per 8-hour test window per target device/environment; < 5% misses on agreed phrase corpus; zero resulting unconfirmed R3 actions |
| Battery/memory | PTT disabled adds no active recording/background polling; later wake target <= 3 battery percentage points incremental drain over matched 8-hour screen-off baseline, and <= 50 MiB incremental wake runtime memory; paired repeats across devices |
| Scheduling | OS registration/readback matches intended time and timezone in every fixture; real-device delivery distributions published. Exact-alarm capability stays off if supported-device timing target (proposed ±5 s for 99/100 controlled trials) fails; inexact reminder UI states timing limitations |
| Scale | Starting load target: 20 concurrent planning requests and 5 proposals/s for 30 min, bounded memory/queue, <1% unexpected server errors; isolate quota/429 responses; no account/device isolation failure |
| Recovery | Revoke online permits immediately; outstanding consumed/unknown actions remain reconciled; restore cannot resurrect deleted grants; key rotation and backup restore demonstrated |
| Compatibility | Existing TypeScript/contracts and isolated suites pass; native binary/OTA/runtime mismatch is rejected gracefully; old clients continue existing chat behavior |

Latency excludes user interaction and intentionally does not justify bypassing confirmation. Battery measurements need fixed brightness/network/temperature/audio and idle-control runs with at least three repetitions; report device variance and thermal throttling. False-activation measurements must include long negative audio, not just a handful of wake phrase recordings.

## CI, security assessment and release gates

Proposed CI: isolated Python checks/security tests -> TS/contracts and client tests -> native unit/adapter tests -> SAST and dependency/secret/license scans -> signed test build -> synthetic staging API DAST -> physical-device suite -> gated rollout. The repository has Ruff/ty configuration and locked dependencies, but no tracked CI workflow was found; automation is implementation work. Pin security tool versions and suppress findings only with scoped evidence and expiration.

Gate A: design/security/privacy approvals and ASST readiness findings resolved for the selected scope. Gate B: simulated policy/protocol/concurrency suites. Gate C: real-device PTT and selected R1/R2 capability evidence. Gate D: store/provider approval, privacy notices and legal retention schedule. Gate E: independent mobile/API/AI assessment before R3 production, plus re-test of all critical/high findings. Gate F: rollback, incident and deletion/restore exercises, monitored opt-in rollout. No unresolved critical/high authorization, data leak or unsafe replay finding can be waived into sensitive production release.

Independent assessment must cover native bridge bypass, confirmation spoofing, key storage, device enrollment, provider egress, build/OTA compromise, API authorization and prompt/voice injection; a generic web penetration test is insufficient. After platform/SDK/model/policy changes, rerun affected gates. Newly added capabilities require their own threat/policy/results/permissions tests before flag enablement.
