# M5 first slice: reviewed Android app opening

Source checkpoint: 2026-11-18. This implements the app-opening part of M5, not reminders, scheduling, alarms or full M5 acceptance.

## Behavior

A validated AI plan can open Spotify or a reviewed Clock app after exact native confirmation. A supported volume/brightness prefix can run first, but app opening must be the final step. Multiple app opens or any action after a handoff leave the entire plan as a preview; no supported prefix runs. Local-parser app commands remain previews in this slice. AI consent, the reviewed public test corpus, INR 0 budget and the existing provider admission cap are unchanged.

Native capability discovery is additive. An older APK without `operationCapabilitiesV2` retains settings support and previews the entire app-containing plan. Browser/iOS behavior remains preview-only. Compiled support is a hint, never enrollment, permission, current availability or execution authority.

The complete graph is preflighted before its first effect. Missing reviewed launchers or multiple installed reviewed Clock handlers stop it with visible guidance to open the intended app manually. The Android catalog is shared with readiness: Spotify, Google Clock, Android Clock and Samsung Clock. No arbitrary package, URI, intent, extras, shell command, accessibility control or installed-app enumeration is accepted. No new permission or dependency was added.

The native resolver requires an enabled, exported launcher in one reviewed package. It snapshots the explicit component, installed version/update time and signing certificates, then checks that snapshot again immediately before `startActivity`. This detects a changed target during approval; it is not publisher attestation or an atomic package-update/launch guarantee. Confirmation names the compiled app label and exact package. Model output supplies only the catalog family ID; native code selects the installed handler.

## Authority and recovery

`/assistant/application` has its own short-lived device scope and additive v6 SQL tables. It reuses the existing control authorization protocol, current parent/device checks, immutable arguments, stable operation identity, native ECDSA proof, one-use claim, expiry and signed receipt. Existing volume/brightness URLs, scopes, payloads and session isolation are preserved. All routes remain behind the shared execution/security gates; no per-command environment switch was added.

The shared native HTTPS/proof validator is extracted from percent execution. It enforces the fixed HTTPS origin, compiled capability/mode, immutable arguments, purpose, revision, device/key/session binding, bounded responses and no redirects or ambiguous retries.

The encrypted coordinator writes unknown evidence before dispatch. `startActivity` returning reports **handoff_requested**, never verified visibility, playback, alarm creation or delivery. Expected backgrounding may finish only that bounded receipt and local checkpoint. It cannot authorize, launch or resume another step. Cancellation before dispatch blocks the launch; losing the process/claim/evidence remains unknown and is never replayed automatically. Returning to Contexify requires a deliberate read-only history check.

Encrypted record format 2 adds application IDs and typed handoff evidence. Existing format-1 percent records remain readable with the same key/AAD; reads do not rewrite or execute them. Existing retention, no-backup storage, account binding and forget behavior remain. Android storage/restore behavior still requires physical acceptance; host tests do not establish it. D8 production key/retention/restore approval remains open.

## Verification and remaining work

Passed: **204 backend tests** in separate isolated processes (17 security, 31 core/migration, 26 volume, 30 brightness, 22 operations, 16 application, 51 planning and 11 contracts); **176 client tests**; **28 native JUnit tests**, with Android module compilation offline. Both client TypeScript checks, generated-contract verification, Ruff/ty for the touched Python boundary and AST parsing of 80 backend files passed. Native final log: ignored `backend/.pytest_cache/m5-native-final.log`; client log: ignored `backend/.pytest_cache/m5-client-final.log`.

Coverage includes signed application receipts, replay/concurrent claim refusal, scope/revocation/policy isolation, strict catalog pairs, read-only recovery, terminal graph validation, old-binary refusal, client evidence validation and real component handler wiring. Migration tests now expect version 6 and still verify rollback/repeat/restore preservation. Native unit tests exercise graph/evidence/encryption behavior; they do not execute a real launcher or Android Keystore recovery. These checks do not establish physical/OEM behavior or production readiness.

At the initial source checkpoint, no APK was assembled or installed, no EAS build/OTA/deployment or live Gemini call was made, and the test backend was not restarted. See the later authorized delivery below. The installed M4 APK cannot execute this new native handler. A compatible future APK/backend and an explicitly resumed physical batch must verify actual Spotify/Samsung Clock launch, cancel/Home/lock, missing/changed handler, expected handoff/backgrounding, one launch per approval and saved evidence after return. Existing deferred M2/M3/M4 cases remain listed in [Android acceptance](android-acceptance.md); this work does not mark them passed or request that testing resume.

Next independent M5 work: owned reminders and schedule lifecycle, including time resolution, permissions, reboot/time-zone changes, cancellation, deletion/logout, encrypted private metadata and truthful delivery evidence. D8 private-storage decisions and D12 offline-authority decisions remain prerequisites for their dependent activation. Public alarm handoff and later owned-alarm feasibility remain separate M5 work.

Android references: [launcher resolution](<https://developer.android.com/reference/android/content/pm/PackageManager#getLaunchIntentForPackage(java.lang.String)>), [explicit main activity intent](<https://developer.android.com/reference/android/content/Intent#makeMainActivity(android.content.ComponentName)>), [background activity security](https://developer.android.com/guide/components/activities/secure-bal).

## Authorized test APK delivery - 2026-11-18

The user requested the compatible APK. The completed local offline retry succeeded in **3m 8s**, with 408 tasks (14 executed, 394 up-to-date). An earlier restricted-shell attempt stalled in child tools and failed after its owned native step was stopped. Its bundle step was recovered by rerunning the installed Expo export with identical arguments and waiting for the full export promise before ending that helper; the successful retry outside the restricted process sandbox reused the completed bundle. No dependency or application-source workaround was added. The underlying stall cause is not established. Logs: ignored `m5-apk-build.log` and `m5-apk-build-recovery.log`.

Artifact: `backend/.pytest_cache/assistant-local-android/Contexify-Assistant-M5-Test-1.4.3-4.apk`, version **1.4.3-assistant-test4**, code **4**, **62534361 bytes**. SHA-256: `0b19cd965a27404ad1dc677f51c8a4b7b9d6a068a2a55ce38501fc327ba2d4a9`. It updates **Contexify Volume Test** (`ai.contexify.app.assistantvolumetest`), separately from production. Verified signer SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching M4/code 3. Install over the test app without uninstalling it. The previous M4 APK/hash and code-3 inspection report are preserved.

Actual APK inspection passed: package/version/signature, permissions and execution/OTA flags, embedded M4/M5 client integration, native app-opening/coordinator/context/brightness code, scoped test CA and cleartext refusal, SecureStore backup exclusions, and absence of the protected Gemini key and private test TLS key. Report: ignored `apk-inspection.json`. Native unit-test tasks cover **35 tests** (voice plus device security, no failures); unchanged tasks/results were cached. The eight build-isolation cases, helper Ruff/ty and PowerShell syntax checks passed. These checks do not establish phone acceptance.

The isolated backend was restarted with the updated application routes, retaining its test account/database/certificate and the previously approved Flash-Lite public-only 30/day profile. Certificate-verified HTTPS health returned 200; unauthenticated application identity/status requests returned 401 and a valid unauthenticated planning-grant request was denied with 403. Delivery probes issued no grants and made no model-generation requests. Readiness: ignored `m5-backend-readiness.json`. The user confirmed PC hotspot/S25 connection and closing unused apps. No cloud build, OTA, production deployment, phone access or installation was performed. New-APK installation and physical app-opening evidence remain pending; earlier deferred acceptance remains deferred.


## M5 code-4 basic phone batch - user-reported PASS, 2026-11-18

On the delivered M5/code-4 test APK and S25, the user confirmed all three instructed checks worked as intended:

1. With AI planning enabled, `set volume to 50 percent then open Spotify`, followed by both native approvals, set media volume to approximately 50% and opened Spotify.
2. Returning to Contexify and selecting Check previous actions showed saved results without reopening Spotify or requesting another approval.
3. Sending the same command again, approving volume and cancelling the app-opening confirmation left Spotify unopened by that request. The already approved volume step is not rolled back.

Evidence is the user's report, not remote observation, device access or instrumentation. This closes the agreed three-check basic Spotify batch; no further cases are added to it. It does not verify Clock handlers, missing/changed packages, app-handoff Home/lock races, claimed/in-flight loss, key/backup/restore or all other OEM/release behavior. Those and previously deferred M2/M3/M4 checks retain their existing gates. Broader M5 reminders/scheduling/alarms remain pending. Recording this report made no provider request, build, backend change or device action.
