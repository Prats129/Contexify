# Android volume acceptance checkpoint

Updated 2026-11-16. Applies only to **Contexify Volume Test** (`ai.contexify.app.assistantvolumetest`) on the user's Samsung S25, reported Android 17 / One UI 9. No USB/debugging, remote phone access, cloud build or production enablement is authorized. The user performs phone checks. Keep the PC hotspot and isolated HTTPS backend running.

**Status: coding/build verification complete; remaining phone acceptance DEFERRED at the user's request.** Preserve the individual results below. Do not run or request more manual checks, submit cloud builds or enable production to close this deferral. Resume the postponed verification when the user asks. The hotspot/backend are needed when testing resumes, not a requirement to keep testing now.

## Confirmed evidence

- User reports actual media volume changes after the reviewed command and exact native approval. The screenshot shows both execution controls; the subsequent user report confirms a successful effect. This is user-observed behavior, not an independent hardware measurement or general release approval.
- The initial 1.4.3 APK built locally and passed signature/package/permissions/metadata/bundle/TLS/backup-rule inspection. Its separate preserved artifact is `Contexify-Volume-Test-1.4.3-initial.apk` with SHA-256 `74fbd685ed68dc97c41e43b800cf64211e0d74c7e9b5e9d1e36b22e06ae673b7`. That is the build covered by the user's initial successful phone report.
- Current isolated backend suite: **74 tests passed**, including scope separation, invalid ranges, cancellation, replay/concurrent claims, revocation/logout, changed origin/policy and receipts. Disposable SQLite and loopback Turso fixtures only; no configured database/provider was used. This run took 80.388 seconds.
- Current Node checks: **105 tests passed** (11 volume/client, 14 security/storage, 33 voice, 9 readiness, 8 build isolation, 30 shared core). Mobile TypeScript passed. These use synthetic platform/network/storage ports and do not establish physical phone behavior.

## Changes found during verification

The native-security HTTP timeout originally ended at response headers. It now includes body decoding and final origin/account checks. Cancelling the assistant or forgetting the binding aborts pending requests and settles them even when a transport ignores abort; late responses cannot reach the executor. Four added regressions cover stalled-body timeout, cancellation/late response, origin change during body arrival and forgetting the device during setup. Existing account-switch and duplicate-dispatch checks still pass.

Guest mode now explains that sign-in is needed for voice and device controls, instead of blaming a disabled build. These source changes require an updated test APK; the installed initial APK does not acquire them automatically. Native confirmation, 0–70% limits and one-use authorization remain unchanged. No automatic voice execution or additional capability is added.

The user additionally reports that reviewing 90% showed no new feedback. The preview now dismisses the keyboard on Review and repeats idle/non-proposed command feedback directly beside that button, while keeping the pinned voice/status area. The existing controller/policy tests verify rejection and its limit message; whether this resolves the reported visibility problem on the phone remains a manual check for the updated APK.

The first follow-up local build failed while Ninja read a 263-character React Native cached-header path. The Gradle cache was moved within the workspace to ignored `backend/.pytest_cache/g`, reducing that header path to 234 characters; the builder uses the shorter cache. Only generated `.ninja_deps` files in the app and Expo Core build directories were cleared to remove old absolute references. SDK/JDK/Gradle distribution downloads and the initial APK were preserved. The failed attempt and retry logs are `local-build-acceptance.log` and `local-build-acceptance-short-cache.log`. These are local attempts, not EAS submissions.

The retry **built successfully** in 11m 6s. The updated manual-install artifact is `backend/.pytest_cache/assistant-local-android/Contexify-Volume-Test-1.4.3-acceptance.apk` (64,462,204 bytes), SHA-256 `40edc9e2c572a04d2f59fc819bdb05ab28ac7826739351b7c53cd2771de9fc09`. APK inspection passed again. The initial and updated APK signing certificates match; install as an update to **Contexify Volume Test**, preserving its app identity/data. The new guest guidance exists in the packaged bytecode, and the generated source map contains the keyboard/inline-feedback and full-response cancellation changes. `apk-inspection.json` records the updated artifact; initial inspection remains in `apk-inspection-initial.json`. Native module reports contain 4 volume-policy and 7 speech-language cases with no failures/errors. The updated APK has not yet been accepted on the phone.

The user asked why the remaining microphone/lock/logout tests are needed. They verify that closing the app stops capture/clears private text, an unapproved action cannot run while locked, and signed-out sessions lose device controls. These three checks remain pending; no result was inferred from that question.

## Phone checks deferred for later

All unconfirmed portions of the cases below are deferred. This includes accepting the updated APK/90% feedback, negative/multi-step inputs, duplicate dispatch, lock/close/process restart, microphone privacy, read-only support, logout/account change, revocation/key loss/restore and OS/network restrictions. Existing PASS reports and automated results stay recorded; postponement adds no PASS result.

Before each test, note the current **media** volume. Report only PASS/FAIL and the visible error if any; account credentials, key material and recordings are unnecessary.

| Check | Manual procedure and expected result | State |
| --- | --- | --- |
| Basic execution | Review 50%, request confirmation, approve native dialog. Media volume changes; readback may round down to a representable Android step. | User reports passed on initial APK |
| Cancel / dismiss | Review 40%, request confirmation, Cancel or dismiss **before approving**. Media volume remains unchanged; no delayed action. | User confirms native Cancel worked correctly on initial APK |
| Limits / invalid input | Review 90%, a negative value and a multi-step volume/app command. No volume execution is offered for an invalid/non-single action. | Automated passed; user reports 90% caused no action, but explicit rejection feedback is not yet confirmed; negative/multi-step phone cases pending |
| Duplicate pending requests | Tap Confirm twice quickly on one reviewed command; approve once. At most one native operation; no second automatic dispatch. A deliberately reviewed new command is a new request. | Automated passed; phone pending |
| Home / lock / close | With the native dialog open **before approving**, press Home or lock the phone. Return: old approval is dismissed, no volume change, fresh deliberate review/approval required. Repeat with modal Close/Clear before approval. | User confirms Home/return dismissed the popup on initial APK; lock and modal Close/Clear cases pending |
| App/process restart | Leave a request unapproved, leave the app and force-stop only **Contexify Volume Test** in Android settings, then reopen. No automatic volume action or restored transcript. Do not clear/uninstall the production app. | Pending |
| Microphone privacy | Give session consent, start speaking, then Stop, Clear, close, background and lock in separate attempts. Recording/indicator stops; no late transcript, no automatic recording restart; reopening resets consent and text. | JS cases passed; hardware pending |
| Read-only support | Run Check Android support; no setting changes, app launches or permission requests. Leave/close during a check; old reports must not return. | Service cases passed; hardware pending |
| Logout / account change | Sign out of the test account during pending work. Returning requires authentication and fresh confirmation. Another test account cannot use the old binding. | Isolated auth/security cases passed; hardware pending |
| Revocation / lost key / restore | Controlled test-device revocation and test-app reinstall/backup restore must invalidate old credentials/keys and never replay old tasks. Requires a separate, deliberate recovery test and a supported management procedure; ordinary logout does not erase enrollment. | Backend/storage cases passed; operational/device pending |
| OS restrictions / interrupted network | Route/fixed-volume/safe-volume/DND and lost acknowledgements produce failed/uncertain results and no automatic retry. Do not infer network privacy or exact crash timing from manual happy-path success. | Fixture coverage only; hardware/instrumented evidence pending |

Cancellation after approval may race an already-dispatched effect. In that case check actual media volume; do not claim that cancellation undoes a completed action, and never automatically repeat an uncertain request.

## Completion boundary

The source implementation batch can be closed **with deferred acceptance**. Do not mark the full verification checkpoint or production readiness complete from the basic volume success, automated totals or user-directed postponement. Physical privacy/lifecycle/key/restore tests, iOS and deployed operational gates remain on [the implementation plan](implementation-plan.md). No permission to simplify confirmation policy or enable production execution is inferred from this deferral.

## M3 additional physical acceptance — deferred

The M3 settings-context source and native unit compilation are recorded in [M3](m3-context-clarification.md). These checks are **Deferred** until the user resumes device testing and a compatible binary is separately delivered; they do not replace the existing checklist above.

- Verify one local media-volume read occurs only after the separate consent, and the reported indexes match the phone. Raw context/relative-answer fields must not enter AI/planning requests or persist as new context history. The existing execution backend still receives the final target and result evidence.
- From the same baseline, compare 10 percentage points versus 10 percent of current value; inspect rounding/Android-step disclosure and the exact native target. No out-of-policy clamping or unrepresentable/no-op success is allowed.
- Change physical/media volume or device limits while native confirmation is open; approval must not apply a target derived from a mismatched baseline. Check context expiry, Cancel, lock, background/return and account/key changes. There must be no automatic recomputation or effect replay.
- Check one-use/replaced context IDs and an old APK: relative requests must fail safely without substituting an absolute write. Existing absolute volume/brightness controls must retain their own scopes and native confirmation.
- Verify ambiguous inputs and prior-target references require explicit selection; brightness/browser restrictions and Clear/Close/local-read withdrawal guidance remain visible and accessible. Test actual AudioManager/routing races; unit tests do not establish hardware guarantees.
