# M3: local settings context and clarification

Date: 2026-11-17. Starting baseline: `652ad70` (M2). Scope: local implementation for the currently supported settings flow. **Settings clarification and relative-volume source/tests are complete. Live-model, compatible-binary and physical acceptance remain open.** Earlier M1/M2/deployment/phone gates are not closed by this batch.

## User flow and scope

When the existing planner returns `needs_clarification` for a missing target/value, ambiguity or a relative value, the screen asks for explicit fields. It does not infer a default meaning for “a little,” a direction, an amount or a unit. Refused/unsupported/non-action responses cannot open this form. Choosing fields deliberately replaces the earlier draft with **one settings action**; other requested actions are not executed as a hidden partial plan.

The user chooses media volume or app-window brightness, an exact target or increase/decrease, a whole-number amount, and (for relative changes) percentage points versus percent of the current value. Exact values use the existing action validator. Relative volume can perform one expressly consented local device read, resolve a bounded absolute value, and request the existing exact native approval through the new context-aware method. An updated, execution-enabled enrolled Android build is required for relative changes. Unsupported/old builds never substitute the old absolute bridge for a relative request.

Example: a reading of 40% reduced by **10 percentage points** resolves to 30%; reduced by **10% of its current value** resolves to 36%. Numeric limits are checked **before** whole-percentage rounding. No silent clamping is allowed. The preview explains rounding and Android steps; native confirmation shows the requested percentage, target step and base reading. An unrepresentable/no-op change asks for another amount rather than claiming an effect.

The browser can clarify an exact settings preview; it cannot read or control a phone. Relative app-window brightness asks for an exact percentage and remains a preview in this dynamic flow. The previously supported local Android absolute volume/brightness controls retain their existing methods and guards.

## Minimal session context

- Clarifications have a locally assigned question ID and a **60-second** answer window. Answers must match the current question; consumed, edited, expired or replaced questions cannot dispatch work.
- The previous reference is only the most recently reviewed supported settings **capability ID**, retained for at most **60 seconds**. A visible “Use previous reviewed target” choice is explicit; “that one” does not automatically select or repeat a prior action/value.
- Last-target state, pending questions, read consent and reviews are memory-only. Clear, account/screen disposal, background and planning-consent withdrawal remove them. Device reads/replies are cancelled or rejected on edit/lifecycle changes; late values cannot replace newer work.
- Only the selected structured answer is resolved locally. There is no chat-memory import, automatic transcript concatenation, recursive agent loop or conversational-history upload. A spoken follow-up is still a new command; this slice uses the explicit clarification form for replies.
- Contacts, recipient collisions, calendar targets and date/time/time-zone interpretation are not invented without their real adapters. Their context/picker/permission work remains with the relevant M5/M7 capabilities. This settings slice does not claim those integrations are implemented.

## Local read and native precondition

`clarification.ts` validates typed answers and the strictly bounded bridge response. Each relative answer permits **one local read**, with a **3-second** client deadline and explicit one-read consent reset after submission. There are **zero additional model calls** for clarification. M1's existing two-attempt/30-second generation budget and M2's 35-second client planning budget are unchanged; this is not approval of the roadmap's optional four-call context loop.

`readVolumeContext` reads only the Android media stream's current/minimum/maximum indexes. It requires the existing native execution opt-in, permission, foreground/unlocked/passcode requirements and matching enrolled origin/user/installation. It is not a backend request. The returned opaque context ID is not a permit. Native state includes its binding, generation and monotonic **30-second** expiry; none is persisted or sent to a provider.

The main-thread `VolumeContextStore` holds at most one reading. A new read replaces the old one; cancellation invalidates earlier generations, and starting work consumes the chosen ID exactly once. Old cancellation callbacks cannot delete a newer reading. Absolute operations also discard pending context.

`executeVolumeFromContext` preserves the existing native-owned HTTPS scope/challenge/confirmation/claim/journal/OS-write/receipt sequence and its immutable requested percentage. It checks the base indexes/binding/lifetime before planning the native transaction, when approving confirmation, before authorization, and immediately before the OS write. A changed/expired/cancelled base stops the request; it is never silently recalculated or retried. Confirmation time is bounded by the remaining native context lifetime. A pre-effect stop after an uncertain/consumed claim retains the existing conservative `outcome_unknown` behavior.

These are checks at defined points, not a claim of atomic compare-and-set support from Android or continuous audio-route/history tracking. Hardware/routing changes can race OS calls; physical acceptance remains required. Existing v1 absolute methods remain available for compatibility; the trusted new relative UI always uses the context-aware method and never discards its precondition.

## Privacy, compatibility and unchanged gates

Clarification processing is local: raw base-state context, context IDs and relative amount/unit are not added to AI/planning requests. Tests assert no context fields or extra proposal calls on that transport. The final absolute target and native result evidence still use the existing execution backend for authorization/receipts; an exact clarified answer becomes that target. This is not a promise that derived targets/evidence disclose no information about device state. Existing task/evidence retention remains unchanged. No contacts, files, messages, schedules, application history or new system brightness data are read. No new Android permission, provider/framework dependency, per-command environment switch, backend route/schema/migration or persistent store was added.

Live Gemini remains unattached/default off. The INR 0/free-tier/synthetic-only scope from M0-M2 is unchanged; local context has not been approved for cloud processing. No actual `.env` value, account/billing setting, configured database or production endpoint was accessed, and no APK, EAS job, OTA update, installation, phone/ADB access or backend restart was performed. Native-only compilation uses the existing project-local tools/caches in offline mode.

An existing APK will not acquire these native methods through a JavaScript-only update. When delivery is separately authorized, produce a compatible binary/runtime and retain old-build denial tests. Source completion is not installed support or permission to resume previously deferred device checks.

## Verification and remaining acceptance

- **157 assistant JavaScript cases passed:** the prior 138 plus 14 clarification/context/transport cases and five actual-component handler cases. Includes consent, units/math/rounding/no clamping, malformed/accessor/coercible fields, expiry/stale-question/replay, cancelled/late reads, target-reference clearing, no context egress, old builds, conditional-method dispatch and browser preview.
- Both frontend/mobile TypeScript checks, generated API contract verification and **11 offline API-contract tests** passed. Prettier, changed-file whitespace, local Markdown links/fences, retained M0-M8/D1-D14/S01-S45 coverage and unstaged scope checks passed. No backend application/authentication regression totals from previous stages are counted as new M3 tests.
- **Native compilation and 17 JUnit cases passed**, zero failures/errors: seven new context/store cases, four existing volume-policy and six brightness-policy cases. The offline `:assistant-device-security:testDebugUnitTest` task compiled the real module, executing 5 of 60 Gradle tasks. Log: ignored `backend/.pytest_cache/assistant-local-android/m3-native-tests.log`. No APK assembled and no device accessed. Pure tests check state/owner/expiry/generation rejection, single-use/replacement and cancellation ordering; they do not simulate Android AudioManager or a physical confirmation dialog.

Before live acceptance: approved M2 model evaluation, a compatible delivered binary, context-read consent and real volume/step/route behavior, changing volume during confirmation, expiry/Cancel/lock/background/account transitions, and deployed privacy/evidence checks remain open. Existing deferred checks stay in [Android acceptance](android-acceptance.md); M3-specific physical cases are added there. Richer natural-language follow-up/target/time context must follow the actual capability adapters and its own evaluation, rather than guessing unavailable data.

M4's stable multi-step operation identity/recovery remains a separate later stage. No resumable multi-action execution, standing consent or reduced native approval is introduced here.
