# Assistant security threat model

Planning threat model, 2026-11-07. Applies to the [proposed architecture](architecture.md), not a claim of implemented protections. Source-specific gaps are recorded in [review coverage](review-coverage.md). Security owner and independent assessor must approve residual risks before sensitive capabilities ship.

## Assets, actors and security invariants

Assets: account sessions, device keys, capability grants, approval snapshots, message/recipient content, microphone samples, contacts/calendar, reminders, execution ledger, provider credentials, update signing credentials, encryption keys, backups and user-visible action history.

Adversaries: unauthenticated caller; another account/device; malicious document/webpage/calendar/contact field; person or media near microphone; stolen unlocked device; malicious app/deep link; XSS; compromised AI/provider response; stolen server credential; compromised dependency/build/update account; privileged operator; rooted/jailbroken or otherwise compromised OS. Trust the OS sandbox/crypto only within its stated guarantees. Model output, transcribed speech and all third-party data are untrusted.

Release invariants:

1. A model cannot authorize, execute, change risk, create consent or select an arbitrary endpoint.
2. Sensitive effects require a current account/device, exact transaction confirmation, current permission and a one-use authorization bound to the immutable action.
3. The native executor independently rejects invalid/replayed/stale requests even if JS or the server planner supplies them.
4. Private data cannot enter general chat persistence, embeddings, search queries, logs or training-eligible provider tiers by default.
5. No completed claim without evidence; uncertain external effects are not automatically retried.
6. Revocation, cancellation and permission loss are checked at execution, not merely discovery.
7. Cross-device execution is disabled; an account token alone cannot command another registered device.

## Threat register

Priority is a proposed release priority, not a CVSS score. P0 blocks any exposed action service; P1 blocks the affected capability. “Mitigation” below is required design work unless noted as existing source behavior.

| ID / priority | Attack and boundary | Required mitigation | Residual risk / verification |
| --- | --- | --- | --- |
| TH-01 P0 | Stolen bearer/forged user_id calls another user's action API | Existing principal/ownership controls plus scoped assistant sessions, per-device proof, ownership on every task/permit/receipt | Device compromise can act as user; cross-account/device matrix and legacy-token rejection tests |
| TH-02 P0 | PDF, search snippet, calendar title or tool output says “send secrets” | Separate data from instruction provenance; assistant context isolated from chat; allowlisted schemas; independent resolver/policy; no auto-chaining from tool output | LLM can still propose malicious action; zero execution without genuine request/confirmation in adversarial tests |
| TH-03 P0 | JS/model claims `confirmed`, alters recipient after approval, or reuses biometric result | Native trusted confirmation over frozen canonical snapshot; native signing and policy; digest binds all arguments/versions/device; action-scoped auth handle | Compromised OS can spoof UI; mutate every bound field in tests and reject |
| TH-04 P0 | Replayed permit, double tap, duplicate ASR, concurrent workers/devices | Nonce, expiry, atomic consume, durable local claim, scoped idempotency; reject same key/different payload; compare-and-swap revisions | Crash around side effect cannot ensure exactly once; chaos tests must produce outcome_unknown rather than duplicate send |
| TH-05 P0 | Web session enrolls victim device, backend URL switch steals credentials, remote task targets phone | Fresh-auth enrollment, nonce proof bound to origin/account, secure storage; release HTTPS/approved origin enforcement; no cross-device dispatch | Backend compromise still creates proposals; native consent remains required; test reinstall/restore/server-change |
| TH-06 P1 | XSS reads localStorage bearer or performs confirmed action using user's browser | Move assistant web session to HttpOnly/Secure cookie boundary; CSP, Trusted Types where viable, no HTML from model, safe URL catalog, frame restrictions; native UI for native actions | HttpOnly does not stop same-origin XSS acting as user; browser cannot be a hardware trust anchor |
| TH-07 P1 | Cookie CSRF, malicious deep link or intent starts a privileged flow | CSRF token + Origin checks + explicit CORS; POST mutations; user-gesture intent gating; verified links, nonexported components, minimal exported permissions, no task commands from URL params | Native external app handoffs are outside UI control; test hostile apps, redirect/origin variants |
| TH-08 P1 | Voice replay, synthetic voice, TV or malicious audio triggers action | Wake only activates; bounded recording; no voice-only R3 approval; unlocked foreground native confirmation and step-up; TTS echo suppression | False activations consume battery/disclose transcript if cloud enabled; benchmark and expose stop/mute |
| TH-09 P1 | Permission/consent/lock changes between plan and execute | Recheck all policy immediately before OS call; revoke pending handles; stop capture on lifecycle changes | OS races still possible; treat API failure as denial, not retry; lifecycle race tests |
| TH-10 P1 | Wrong John, transcription error, timezone/DST shifts, Unicode recipient spoof | Local endpoint resolution, collision clarification, canonical destination display, full exact message, timezone preview; freeze selected ID plus current endpoint | Users can approve mistakes; use legible UI and usability tests, no confidence-score bypass |
| TH-11 P1 | Privileged URL/intent or SSRF from generated argument | Catalog IDs only; native templates; no arbitrary schemes/hosts/extras; separate server egress allowlist, redirects/DNS/private-network defenses for approved connectors | Legitimate provider compromise; hostile URL and redirect corpus, no reuse of generic fetch tool |
| TH-12 P1 | Audio/contact/message leaks into SQL, logs, prompts, telemetry or crash reports | Separate assistant path, field-level minimization/encryption, no raw-body logs, no analytics data plane, provider contracts and explicit opt-in | Providers/OS may process submitted content; traffic inspection and data-retention evidence required |
| TH-13 P1 | Stolen database/device backup exposes private actions or credential | Keystore/Keychain, nonexportable keys, encrypted local records; server envelope encryption + managed key separation; backup exclusions; bounded tokens | Unlocked process may decrypt; secure deletion from backups is delayed; restored copies must not resurrect grants |
| TH-14 P1 | Retry after timeout sends twice, cancellation falsely reports undo, partial plan loses state | Separate planned/claimed/executing/verified/handoff/unknown states; no automatic R3 retry; per-step receipts and stop dependents | External provider may not expose definitive receipt; user resolves unknown outcome |
| TH-15 P1 | Provider/model abuse, huge audio/JSON, unbounded plan or database contention | Limits on bytes/time/steps/concurrency/requests/spend; current SQL budgets extended; offline grammar; circuit breaker and cancellation | Paid processing incurred before cut-off; load/abuse tests and alerts |
| TH-16 P1 | Compromised npm/native SDK/model/update gives privileged executor malicious code | Locked deps/hashes, SBOM/license/secret scans, signed builds/updates where supported, protected publisher identities, reproducible artifact provenance, reviewed capability registration | Native signing identity compromise defeats local boundary; independent assessment and emergency release plan |
| TH-17 P1 | Tampered tool result claims success or injects next action | Typed bounded receipts from registered adapter; treat text as untrusted; result state drives UI, not LLM prose | Compromised device may fabricate its own receipt; no claim of cryptographic proof of real-world outcome |
| TH-18 P1 | Logout/deletion leaves OS reminders, contact selections or stale task approvals | Explicit reminder lifecycle choices, wipe sensitive transient data/credentials, revoke device/server permits, encrypted tombstones and reconciliation | Other app drafts/sent messages remain outside deletion boundary; test logout/offline/account deletion |
| TH-19 P1 | Accessibility/overlay or notification actions bypass review | No general accessibility automation; sensitive activity excludes obscured-touch approval where supported; authenticated notification actions only; redact lock-screen content | Accessibility users still need usable flows; OS-level malicious overlays not fully preventable |
| TH-20 P1 | Operator alters ledger or private logs after incident | Least-privilege operator roles, access audit, append-oriented events with integrity checks, restricted retention, key rotation and restore drill | Not absolute nonrepudiation; unauthorized admin and backup-restore tests |

## Standards mapping

Use [OWASP ASVS 5.0](https://asvs.owasp.org/) Level 2 as the web/API verification target, with selected stronger controls for sensitive transactions; freeze exact requirement IDs in implementation review. Map mobile controls to [MASVS](https://mas.owasp.org/MASVS/) storage, crypto, auth, network, platform, code, resilience and privacy groups. Do not claim certification or apply obsolete MASVS levels.

[OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) coverage: API1/3/5 -> object/property/function authorization (TH-01/03/05); API2 -> session/enrollment (TH-01/05); API4/6 -> resource/business-flow limits (TH-15); API7 -> SSRF (TH-11); API8/9 -> secure config and capability inventory (TH-07/16); API10 -> untrusted providers/results (TH-02/17). Prompt filtering is only supplemental: [OWASP prompt-injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) motivates independent authority and data boundaries.

Native key handling follows [Android Keystore](https://developer.android.com/privacy-and-security/keystore) and [Apple Keychain](https://developer.apple.com/documentation/security/keychain-services). Hardware backing is device-dependent; detection must not be presented as a blanket guarantee. TLS certificate validation is mandatory; consider pinning only with rotation/recovery design, since brittle pinning creates outages. No custom cryptographic primitives or insecure fallback.

## Release and incident decisions

All TH-01..05 controls are blocking for any assistant execution beta. R3 stays off until the full affected threat set, OS/store permissions, fresh-auth flow and independent penetration assessment pass. Prompt-injection tests must include retrieved text, indirect calendar/contact injection, malicious tool receipts, multilingual commands, hidden Unicode and audio playback. Any unconfirmed R3 execution or cross-account/device action is a release blocker.

Incident response: remotely disable new server permits by capability and revoke compromised devices/tokens; native short-lived authority bounds sensitive exposure. Stop capture locally immediately. Preserve minimal redacted evidence, rotate relevant credentials and investigate affected actions. Kill switches cannot retract sent messages, undo calls, immediately reach offline clients or cancel all previously registered OS schedules. Disclose those limits in the runbook. Independent review is required before production communication capabilities; this planning review is not that assessment.
