# M5 alarm slice: reviewed Android Clock requests

Source checkpoint: 2026-11-19. This implements the merged plan's **public alarm handoff first** boundary. Clock owns creation, sound, dismissal and cancellation. Contexify-owned ringing, timers, full M5 acceptance and previously deferred checks remain unfinished. The older code-5 reminder APK cannot run this handler; the delivered code-6 APK is required.

## User-facing behaviour

Open **Assistant → Alarms in Clock** or **Profile → Alarms in Clock**, sign into the enrolled Android account and enable assistant device setup if needed. Enter an explicit 24-hour clock time, optional private label and optional repeat weekdays. No repeat days means once. Select Samsung, Google or Android Clock, or use Auto only when exactly one reviewed handler supports the request. Missing or multiple handlers produce guidance before any effect.

The foreground native confirmation names the selected Clock package, label, time zone, resolved next date/time and repetition. Times too close for review and ambiguous/nonexistent daylight-saving times are rejected. The next occurrence is recalculated immediately before dispatch; a changed clock, zone or next occurrence requires a new review. Future dated alarms and DST ambiguity can be handled directly in Clock. Repeat-day and future travel/DST behaviour ultimately belong to that Clock app.

After approval, an explicit `ACTION_SET_ALARM` request carries only compiled standard extras, with `EXTRA_SKIP_UI=false`. A Clock app may create or reuse the alarm immediately; opening its UI is not an unscheduled-draft guarantee. The normal `com.android.alarm.permission.SET_ALARM` permission is declared. No exact-alarm or full-screen special access is added. These are the public platform handoff semantics, not a ringing or delivery guarantee. [Android AlarmClock reference](https://developer.android.com/reference/android/provider/AlarmClock).

**Open Clock to view or cancel alarms** sends only the reviewed `ACTION_SHOW_ALARMS` action. It never guesses an alarm identity or requests dismissal. Edit/delete in Clock. Signing out of Contexify deletes its own reminder details as before, but does **not** cancel external Clock alarms; this is disclosed before handoff. Private form fields are cleared when leaving, backgrounding or changing accounts. There is no automatic retry or continuation after a handoff.

This form is an input surface for private parameters, not a new command-phrase parser. It sends no alarm text to chat, Gemini or account reminder storage. The public-only live Gemini corpus and INR 0 budget are unchanged. Private voice/AI interpretation remains dependent on the retained processing-consent/provider decision; recognition of an unsupported alarm command does not grant execution.

## Authority and failure handling

`/assistant/alarm` has separate device-scoped sessions and additive v8 task/session tables. It reuses the existing online control protocol, execution/security gates, current account/device/parent checks, policy binding, immutable operation identity, signed exact challenge, one-use claim and signed receipt. There is no per-command environment flag. Server storage contains only request kind, reviewed package and a fresh salted native commitment; it receives no time, label, repeat days or time zone.

`ReviewedHandoffExecutor` is the shared implementation extracted from the existing application executor. Existing plan/app-opening call signatures, capability discovery and recovery records remain compatible. The alarm adapter selects its own compiled mode, scope, execution and challenge purposes. The native worker verifies the installed package/component/version/update/signing snapshot immediately before launch, enforces foreground/unlocked secure-device state, rejects obscured approval touches, and shares the existing single-operation guard. Reviewed package IDs and change detection do not constitute publisher attestation.

The effect is terminal. After dispatch, expected backgrounding can finish only the bounded receipt; no following effect can run. Lost claim/receipt responses remain unknown and never trigger another launch. A successful `startActivity` reports **handoff_requested**, never **verified**, **alarm created** or **rang**. Alarm outcomes are transient screen evidence; Contexify has no Clock alarm ID/readback and does not claim persistent alarm ownership or automatic crash recovery. After interruption/process loss, inspect Clock before deliberately approving another request. Existing seven-day backend operation tombstones prevent replay of the same claimed identity.

The offline verification app blocks the new normal alarm permission and retains its disabled execution/network boundaries. Web, iOS and older Android binaries show unsupported native functionality. A compatible new APK is required; OTA cannot supply these native changes.

## Owned ringing feasibility and retained gates

An owned Android alarm is technically feasible but is a separate product/operational boundary. It requires exact-access discovery and denial/revocation handling, durable owned identities, reboot/clock/DST reconciliation, authenticated snooze/dismiss controls, sound/audio-focus lifecycle, bounded ringing/service work, notification/lock-screen behaviour and deletion/revocation semantics. Exact-alarm access is not automatically granted to many new installs or restored devices; it must not be treated as an ordinary runtime permission. [Exact-alarm access changes](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms).

Full-screen alarms also require separate eligibility/access checks and an explicit fallback. Android limits default full-screen access to appropriate alarm/call functionality. This slice requests none of that access. [Android full-screen intent limits](https://source.android.com/docs/core/permissions/fsi-limits). The retained exact-timing/OEM/Doze/force-stop/key-recovery/release gates must be met before offering owned ringing; a reminder notification is not used as a substitute or relabelled as an alarm.

## Verification and bounded pending phone batch

Passed: **245 backend/contract/launcher tests** in isolated processes (16 alarm, 17 security, 31 core/migration, 26 volume, 30 brightness, 16 application, 21 reminder, 22 operations, 51 planning, 11 contracts and 4 local-launcher cases); **345 client tests**; **54 native JVM cases** (47 device-security, including eight new alarm-time cases, plus seven unchanged voice cases). Both client TypeScript checks, generated-contract verification, changed Python Ruff/ty checks, source parsing and the PowerShell build-helper syntax check passed. The DST regression covers a still-future second occurrence after the first repeated-hour occurrence has passed. Generated contract additions retain existing declaration order, with semantic generation checks passing.

Evidence: ignored `m5-alarm-backend.log`, the passing security/core sections of `m5-alarm-regressions.log`, `m5-alarm-regressions-final.log`, `m5-alarm-client-final.log`, `m5-alarm-types.log` and the final native XML reports. The final regression log supersedes stale version-7 migration-count expectations during development. Host/JVM tests do not execute a real Clock app or prove ringing. No phone access, private Gemini request, cloud build, EAS credit, OTA or production deployment is part of this checkpoint. The test backend/installed APK are not assumed updated merely because source changed.

On the delivered compatible APK and verified separate test backend, use one bounded manual batch (AI planning is not needed). The three basic cases below now have positive user reports and this bounded batch is closed; the evidence and its limits are recorded below:

1. Choose an unused alarm time at least five minutes ahead, request one synthetic alarm, select the installed Clock explicitly, approve the native disclosure, then verify the enabled time/label/repetition and eventual sound in Clock. Record Clock behaviour, including any extra UI; remove only this synthetic alarm there afterwards.
2. Cancel native approval, then separately press Home before approval: neither case should add/change a Clock alarm. No automatic launch should occur on return. A previously approved external alarm is unaffected.
3. Use the view/cancel button. It should open the selected Clock's alarms view without creating/dismissing an alarm. Inspect or remove only the synthetic test alarm. Returning must not repeat a request or reveal cleared private form fields.

Missing/multiple/changed handlers, lock/interruption/claim-loss cases, OS/OEM acceptance and the existing release gates remain recorded as pending beyond that basic batch. Completion of this slice does not silently close earlier reminder, M2/M3/M4, app-opening or production acceptance.

## Compatible local test APK - 2026-11-19

The implementation was packaged with the existing offline local toolchain. An initial package was followed by an incremental final rebuild containing the added repeated-hour regression fix and final Clock disclosure; the final build passed in **4m 27s**, with 408 tasks (20 executed, 388 up-to-date). No Expo/EAS credit was used. Only the final artifact/hash below should be delivered.

Artifact: `backend/.pytest_cache/assistant-local-android/Contexify-Assistant-M5-Alarms-Test-1.4.3-6.apk`, version **1.4.3-assistant-test6**, code **6**, **62984321 bytes**. SHA-256: `3873521076f677bdb7bc3c938c566c4325c03a59b0c201ddaa07fe133b1c668b`. Verified signer SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching code 5. Package/name remain **Contexify Volume Test** (`ai.contexify.app.assistantvolumetest`). Install over that test app without uninstalling; the production app retains its separate identity. The code-5 artifact and its inspection report remain preserved.

Actual APK inspection passed package/version/signature, embedded alarm/reminder/settings/recovery code, normal `SET_ALARM` permission, absence of exact-alarm/full-screen/other prohibited permissions, non-exported reminder receivers, execution enabled/OTA disabled, scoped test CA/cleartext refusal and SecureStore backup exclusions. Test TLS private key, protected Gemini credential and protected/decrypted private-storage key material were checked absent from packaged entries. The code-6 report is ignored `apk-inspection-code6.json`; final build/inspection log is `m5-alarm-apk-final.log` under the local tool directory.

**Connection gate at delivery:** the PC's `192.168.137.1` hotspot address was inactive. The user was asked to switch Windows Mobile hotspot on and connect the S25. The existing isolated server/account/database/certificate were left intact; its in-memory app is not assumed to include the new routes. Restart only that service with the existing `--live-planner --confirm-free-tier --flash-lite-evaluation --account-storage` profile after the address returns, then run the prepared ignored `check-alarm-backend.py` probe. It verifies trusted HTTPS, scoped alarm identity, cross-scope/anonymous refusal and retained reminder storage without an alarm/reminder operation or Gemini request, then revokes its temporary software test identity and logs it out. This live probe and the bounded phone batch remain pending until the connection gate is satisfied. No phone installation or alarm behaviour has been claimed.


## Connection restored and live API verified - 2026-11-19

The user reported Windows Mobile hotspot on and the S25 connected. The private PC address was verified active. Only the identified isolated backend launcher/worker were restarted, retaining the existing test account, database, TLS identity, protected account-storage key and public-only Flash-Lite profile. The additive v8 migration applies to this test database; production was not contacted or changed.

The prepared certificate-verified HTTPS probe passed real health, temporary device-bound `assistant:alarm` session/identity checks, cross-scope and anonymous refusal, and retained reminder storage availability with device-only default. Its temporary software verification device was revoked and its login ended. No alarm/reminder operation, phone access or model request was performed. Evidence: ignored `m5-alarm-backend-readiness.json`, with startup logs in `m5-alarm-backend.stdout.log` / `m5-alarm-backend.stderr.log`. This resolves the delivery connection gate above; subsequent phone reports are recorded separately below.

## Basic alarm creation/ringing - user-reported PASS, 2026-11-19

The user initially showed the code-6 alarm form's minimum-one-minute warning with a selected time one displayed minute ahead. The request was rejected before native approval, consistent with the time being fewer than 60 seconds away. The user was instructed to select Samsung Clock and choose a time ten minutes ahead, then review/approve again. They reported: "the alarm is set and it rang on time."

Record the basic creation and audible alarm outcome as user-reported passed on the S25. Exact alert latency, the label/repeat readback and any additional Clock UI were not independently described or measured. This is not remote phone observation or a general OEM/exact-timing guarantee. The cancellation/Home reports below subsequently close those basic cases; the subsequent view-only report closes the basic batch, while full M5 and the previously deferred release checks remain open.


## Basic approval cancellation and Home interruption - user-reported PASS, 2026-11-19

The user was instructed to choose a new unused time ten minutes ahead, review it, cancel native approval and manually check Samsung Clock for absence of that new alarm. They replied "done". They then followed the separate Home-before-approval instructions: review another unused future time, press Home while the popup is open without approving, return to a dismissed popup and manually check Clock for no new alarm. They again replied "done". Record these as user-reported passes of the instructed basic cases, not independently observed phone state or coverage of interruption after a claimed effect. The subsequent view-only report below closes the final basic case; detailed privacy/lifecycle release checks retain their own evidence requirements.


## Basic view-only handoff and batch closure - user-reported PASS, 2026-11-19

The user was instructed to select Samsung Clock, enter a synthetic label, approve the view/cancel handoff, check that Clock opens without adding/changing alarms and return to a cleared form without automatic reopening. They first asked about the popup; it was explained as the expected native confirmation. After approving, they confirmed it took them to Clock and did not create an alarm, identifying that popup as the permission/approval step. Record the concrete view-only outcome as passed. Form clearing, absence of replay, label/repetition readback and precise latency were not separately detailed; do not expand this report into independently observed evidence of those conditions.

This closes the agreed basic three-case Samsung Clock batch: creation/ringing, Cancel/Home before approval, and view-only handoff. No further cases are added to this batch. Missing/multiple/changed handlers, claimed/in-flight interruption, broader clock/DST/OEM/restore/security acceptance, earlier deferred checks and full M5 remain open. Contexify-owned ringing and timers remain separate conditional work, not implemented by this external Clock integration.
