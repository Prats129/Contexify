# M2: command-screen and validated-volume integration

Date: 2026-11-17. Starting baseline: `ab37e44` (M1). Scope: authorized local implementation of the [merged plan](merged-implementation-plan.md). **Source integration and isolated automated checks are complete; live-model and physical acceptance remain open.** No live provider is attached, no production setting is enabled, and no device/build/deployment work was performed.

## Behavior implemented

The web and Android command screens now accept an optional authenticated planner. AI processing needs a separate, initially unchecked session consent, independent of microphone consent. Guest mode keeps local review. Without AI consent the existing local command grammar remains available; an opted-in planner failure never silently falls back to that grammar.

With an enabled backend/provider and compatible enrolled Android build, the intended flow is:

1. Type a command and select **Send command**, or finish on-device speech with both consents enabled.
2. The client submits the transcript to the isolated M1 planning endpoint. Audio, chat history and native device keys are not submitted.
3. The shared client validates the response owner/device, protocol/mode, expiry, actions, ranges, dependency graph and unknown fields. Screen descriptions come from registered action formatters, not model prose.
4. One complete media-volume action can open the **existing exact native confirmation** directly. There is no additional JavaScript “Confirm volume change” button in AI mode. The native module independently obtains its real execution scope, confirmation, one-use claim and result evidence.
5. Only native readback/receipt results can report execution. Cancellation, failure and unknown outcomes retain their existing messages and never trigger automatic effect retries.

The browser displays proposals and has no device-effect path. Dynamic brightness/app-opening and multi-step plans remain previews; a compound request never executes only its first action. Existing local Android volume/brightness review remains available with its previous native controls. Relative state/context and multi-step orchestration remain M3/M4 work.

## Reviewed snapshot and lifecycle

`packages/assistant-core/src/planning.ts` supplies the authenticated planning port, strict wire validation, fixed feedback/error messages and immutable reviewed-action snapshots. Both percentage selectors now consume that snapshot instead of reparsing the transcript. `takeReviewedPercent` checks foreground-session state, Android platform, expiry and single-action eligibility, then consumes the review before awaiting native work. A consumed review cannot be submitted again by a second tap or render.

Generation checks and abort signals cover edits, Clear/cancel, Close, background/page hide/blur, account-bound context changes, consent withdrawal and disposal. Editing remains available during AI planning; it cancels the old request and preserves the new draft. Backgrounding clears both consents and private text. Resuming never automatically replays an action. Rejected/late provider or HTTP-body results cannot replace a newer review.

The 35-second client deadline includes connection/bootstrap, grant acquisition, proposal headers/body and binding checks. M1 retains its separate 30-second generation budget; human native approval remains outside planning. Clients make no provider repairs or HTTP retry/fallback loop: the server owns its already bounded repair policy. One in-memory planning grant is reused while valid; interrupted edits and ordinary service/quota errors need not create a grant per attempt. Expiry/authorization/context failures require a fresh context.

Clearing/withdrawing consent forgets local grants and attempts bounded server revocation. Native cancellation can still revoke the old grant, while new planning stays blocked; host, parent login, expiry and server ownership checks remain mandatory. Revocation is best effort when offline/interrupted. Existing server grants expire within five minutes/parent lifetime and cannot be used without their parent authority. This is not a promise of immediate network-delivered deletion.

## Authentication and privacy boundary

- Native planning opens the existing proof-bound `security:manage` session, checks its binding and holds its credential only in memory. Planning requests use that credential, not an ordinary account bearer or an execution permit. Requests and late bodies recheck origin, login, expiry and cancellation.
- Web planning bootstraps the existing HttpOnly assistant cookie, then sends only cookie/CSRF authority to fixed planning paths. Account bearer use stays confined to session bootstrap. Host/login/session changes invalidate later work. No browser planning bearer storage was introduced.
- Fixed paths and registered action schemas prevent model-provided URLs/tools/code from becoming transport or execution instructions. No raw provider/server errors or arbitrary model feedback prose are rendered. Planning response bodies have a 16 KiB client limit; proposal output retains M1's 8 KiB server limit.
- This batch adds no dependencies, command-specific environment switches, native permissions, bridge methods, migrations or persistent command/history store. Existing chat/RAG/SSE flows are not used for planning.

## Live processing remains disabled

The existing `ASSISTANT_PLANNING_ENABLED` default remains false and the engine still has no live provider. Changing that flag alone is insufficient. No real `.env` value, key, account/billing setting, configured database or production URL was accessed.

Interactive requests now omit `synthetic_case_id` instead of falsely labeling user text as approved synthetic material. That field is additive/optional in the request/generated types, preserving existing callers that supply a case ID. The Gemini adapter **rejects a missing case ID before creating an SDK client**, and still requires an exact reviewed case-ID/text pair for approved evaluation. A general command matching an example does not acquire processing consent by text matching. No phrase-to-action lookup was added.

Consequently, the normal app cannot currently send arbitrary commands to free-tier Gemini, even if someone attaches the evaluation adapter. The UI explains the temporary public-test-only boundary. Public corpus evaluation needs an explicit approved harness/provider activation; broader private-command processing remains a separate privacy decision. INR 0 paid-spend policy and all M0/M1 provider gates remain unchanged. Fake response tests below do not establish language understanding or live support.

## Verification

Completed offline/local checks, 2026-11-17:

| Check | Evidence |
| --- | --- |
| Assistant JavaScript regression files | **138 passed**: existing 111 cases plus 18 planning/session/transport and 9 actual-component handler cases; each file executed with `node tests/<file>.test.cjs` using `node:test` without spawning a test-runner worker |
| Backend planning regressions | **45 passed**, including SQLite and loopback Turso; omitted synthetic IDs work only with injected providers and are denied by the real adapter before SDK construction |
| API contract regressions | **11 passed**, plus generator `--check`; optional field is synchronized across web/mobile/core |
| TypeScript and Python diagnostics | Both client `tsc --noEmit --incremental false` checks passed; Ruff lint/format and ty passed for all three changed Python files; changed Python AST parsing passed |

New tests cover paraphrases through a fake port without reparsing; exact-once review consumption; account/device/expiry and authority-field rejection; invalid 90% output and fixed policy feedback; guest/no-consent/denial paths; compound/dynamic-brightness preview restrictions; grant reuse/revocation; client deadlines, late bodies/replies, account/host change; browser cookie/CSRF versus native management authority; and real component Send/Close/edit/background/blur handlers with simulated host views.

The component harness verifies behavior and handler wiring. It is not DOM/native layout, screen-reader, live speech/model or physical-device acceptance. Native confirmation/OS/network ports are simulated; no phone setting was changed during these checks.

Prettier checks passed for the new TypeScript/test code and touched component sections. Diff/new-file whitespace, local documentation links/fences and retained M0-M8/D1-D14/S01-S45 coverage checks passed. All changes remain unstaged; no actual `.env`, lockfile or native source was modified. Existing full-auth test counts from M1 are historical and are not added to this batch's 56 backend cases.

## Remaining acceptance and next work

Before marking the complete M2 exit gate done: approved live synthetic model evaluation and account/tier verification, a compatible delivered app and user-approved physical confirmation/cancel/lifecycle checks, and deployed origin/privacy/logging/timeout validation are still required. Previously deferred checks remain in [Android acceptance](android-acceptance.md); none was silently resumed or closed.

M3 context/relative values and M4 resumable orchestration remain later stages. This batch does not turn previews, mocked native results or source completion into a production-ready assistant claim.
