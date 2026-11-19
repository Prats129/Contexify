# Local Android test delivery

**Latest alarm delivery, 2026-11-19:** the code-6 [Clock handoff test APK](m5-alarm-handoffs.md#compatible-local-test-apk---2026-11-19) is built and inspected, including the final daylight-saving regression fix. Install over Contexify Volume Test without uninstalling. The user restored the hotspot/S25 connection; the isolated backend was restarted with its retained public-test/account-storage profile, and trusted HTTPS/alarm-scope checks passed. The user subsequently completed the agreed basic Samsung Clock batch (creation/ringing, Cancel/Home before approval, and view-only opening); advanced acceptance remains pending. No AI planning is needed for the private alarm form. No EAS credit, OTA, production deployment or phone access was used. See the linked delivery record for the exact artifact/hash and pending connection gate.

**Reminder checkpoint, updated 2026-11-19:** the code-5 [reminder test APK](m5-reminders.md#authorized-reminder-test-apk-delivery---2026-11-18) was delivered. Basic device-only reminder and optional encrypted account-copy phone batches are user-reported complete; the protected test-storage key is configured. Advanced physical/release checks remain pending. Older delivery entries below are historical.

**Latest M4 delivery, 2026-11-18:** the code-3 APK is built/inspected and the isolated backend updated. See [M4 delivery](#authorized-m4-test-apk-delivery---2026-11-18). Code-2 and earlier checkpoints below remain historical.

**Latest delivery, 2026-11-17:** [post-M3 public live evaluation](live-public-evaluation.md) records the inspected version-code-2 APK, active isolated test server and resumed manual S25 checkpoint. The user confirmed installation/test sign-in and, after the reviewed Flash-Lite switch, the live single-volume AI command: native approval, actual volume change and inline result. Earlier provider/interpretation failures remain historical evidence; M3 relative-state and remaining release acceptance stay open. Earlier artifact/checkpoint details below are historical. No EAS job or phone access was used.

Started 2026-11-15. The user authorized local setup/build, accepted Android SDK licensing, declined USB debugging/phone access, and chose the PC's hotspot for manual installation/testing. Do not run ADB/device enumeration, install onto the phone, inspect phone data or submit EAS builds. The user installs and tests the APK themselves.

**2026-11-16 deferral:** the user postponed all remaining manual phone checks. The local coding/build batch is complete; unconfirmed device/recovery/privacy results remain deferred in [Android acceptance](android-acceptance.md). Commands and manual procedures below are retained for a future user-requested resumption, not instructions to restart testing/building automatically.

## Ready artifact and next manual step

The initial local ARM64 debug build **succeeded** and is preserved as `backend/.pytest_cache/assistant-local-android/Contexify-Volume-Test-1.4.3-initial.apk` (62,412,997 bytes, about 59.5 MiB). SHA-256: `74fbd685ed68dc97c41e43b800cf64211e0d74c7e9b5e9d1e36b22e06ae673b7`. The successful initial log is `local-build-short-paths.log`; its preserved inspection evidence is `apk-inspection-initial.json`.

The updated follow-up artifact is **`Contexify-Volume-Test-1.4.3-acceptance.apk`**, in the same ignored tool directory (64,462,204 bytes, about 61.5 MiB), SHA-256 `40edc9e2c572a04d2f59fc819bdb05ab28ac7826739351b7c53cd2771de9fc09`. It contains full-response timeout/cancellation, clear guest guidance and visible rejected-command feedback. The initial signing certificate matches, so install over **Contexify Volume Test**. Do not uninstall/update the production or offline test app for this. Its log is `local-build-acceptance-short-cache.log` and current report is `apk-inspection.json`. Basic execution, native Cancel and Home dismissal were user-confirmed on the initial build; acceptance of this update remains pending. See [current acceptance](android-acceptance.md) before repeating any completed check. Do not rebuild just to recover either completed artifact after a restart.

Actual APK inspection passed for its distinct package/name/version, Android signature, required/forbidden permissions, execution enabled and updates disabled metadata, embedded JavaScript and native volume code, hostname-specific public test CA and cleartext refusal. The leaf private key and test credential/config filenames were absent. The manifest references the inspected SecureStore rules excluding credentials from both backup and device transfer. These checks do not establish actual phone backup/restore behavior. Native module JUnit reports show 11 cases with no failures/errors; all 12 settings tests passed. PC-side certificate-verified HTTPS health, registration (201), password login (200) and logout also passed against only the isolated backend.

Manual acceptance:

1. Keep the PC hotspot and local test backend running. Connect the S25 to that hotspot.
2. Transfer the APK yourself and install **Contexify Volume Test**. Its identity differs from both the production app and **Contexify Assistant Test**, so it installs alongside them. File transfer does not require USB debugging or granting this agent phone access.
3. Create a fresh test account in this app using its normal registration form (a test email and a new test password). Production credentials are unnecessary. The isolated backend does not send mail or expose AI/chat providers.
4. Open the app menu → **Assistant preview**. Tap **Enable volume control on this device**, enter `set volume to 50%`, then **Review command** → **Confirm volume change** and approve the exact native Android dialog.
5. Check the actual **media** volume slider and the reported observed result. Android volume steps can round 50% down. Repeat with a different reviewed percentage and cancel the native dialog **before approval**; media volume should stay unchanged.

Phone-to-PC/firewall reachability, enrollment, confirmation and actual media-volume effects are still pending user confirmation. Never bypass TLS if the phone cannot connect. Remaining recovery, privacy and lifecycle checks stay on the combined checklist; completing the build does not close them.

## Phone sign-in timeout, 2026-11-16

The user confirmed opening **Contexify Volume Test**, using guest mode, then seeing a 30-second timeout when trying registration/login after joining the PC hotspot. Guest mode intentionally has no authenticated volume controls; the voice adapter also incorrectly describes its disabled guest state as "not enabled in this build." The APK's inspected bytecode has both voice and execution build gates enabled. Connecting to the hotspot alone does not authenticate the user.

PC-side certificate-verified HTTPS health still returns 200. The PC has `192.168.137.1` and an explicit inbound **Public / TCP / Any port** block for the actual Windows Store Python executable running the isolated backend. This is a likely phone-reachability blocker, not proof of a completed phone connection. [Windows gives explicit block rules precedence over conflicting allow rules](https://learn.microsoft.com/en-za/windows/security/operating-system-security/network-security/windows-firewall/rules).

`scripts/assistant-local-firewall.ps1` prepares a reversible exception for only the backend Python image, hotspot interface/address, TCP 443 and remote `192.168.137.0/24`. Matching public TCP blocks retain all other ports; guard rules preserve the original public-network block on port 443 outside that exact address/subnet. Existing UDP rules and firewall profiles remain unchanged. Original block-rule identifiers are saved under ignored `firewall-state.json`. Disable removes test access first, restores the original blocks, then removes the guards. Independently changed rule fields cause a refusal rather than an overwrite.

PowerShell parsing and a live `-Action Enable -WhatIf` scope check passed; one matching public Python TCP block was found. **No firewall change has been applied.** This execution session has no Windows Administrator token. The user must run the prepared helper from **PowerShell as Administrator**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\Contexify\scripts\assistant-local-firewall.ps1" -Action Enable
```

Then retry registration/sign-in with fresh test credentials and reopen Assistant. To restore the firewall after testing, run the same command with `-Action Disable`. If phone access still times out, further hotspot routing/reachability diagnosis is needed; do not weaken TLS or switch the test APK to production. No new APK or cloud build was requested/submitted for this diagnosis.

The first administrator-run attempt rejected the guard's address-prefix list. Live inspection confirmed rollback: no `Contexify-Assistant-Local-HTTPS*` rules or saved firewall state remained, and the original public Python TCP/UDP blocks still covered `Any` port. The helper now uses nonzero IPv6 prefixes (`::/1`, `8000::/1`), usable IPv4 endpoint ranges and IPv4-only remote filters for the IPv4 hotspot. Syntax and boundary checks passed, as did a repeated live scope dry-run. Actual rule creation with the revised filters remains unverified until the user reruns it with their Administrator token; do not claim the timeout is resolved from these checks alone.

## Saved local setup

Tools are under ignored `backend/.pytest_cache/assistant-local-android`: Temurin JDK 21.0.13+9 and Gradle 9.4.1 (publisher SHA-256 verified), Google command-line tools (publisher checksum verified), platform 37.0, build tools 37.0.0, NDK 27.1.12297006 and CMake 3.22.1. Package versions follow the installed Expo/React Native toolchain. SDK installation completed; do not redownload these after a restart. No system-wide JDK/PATH configuration was changed.

The Gradle **user cache** now lives at shorter ignored `backend/.pytest_cache/g`; this avoids Ninja's Windows header-path limit and reuses the moved cache without another toolchain download. The Gradle distribution itself stays under the tool directory above.

Phase 4C adds a native-only check:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-assistant-local.ps1 -LanHost 192.168.137.1 -NativeTestsOnly
```

This compiles/tests the changed modules and returns before APK assembly/inspection/copy. It passed for the brightness implementation; see [Phase 4C](phase-4c-brightness.md). Existing APK artifacts and the running practice backend were not updated. The deferred phone-test request remains in force.

Expo prebuild generated ignored `mobile/android` from the installed template for the separate `ai.contexify.app.assistantvolumetest` identity. The package manifest was preserved. Generated test-only changes embed the JavaScript bundle and disable Metro developer support, so the APK can run without a debugging connection. `scripts/assistant_local_android.py` checks the identity before preparing these files.

`scripts/assistant_local_backend.py` reuses actual authentication, session and assistant handlers with a separate SQLite database/account/files. It exposes no AI, email or upload endpoints, clears inherited provider settings in its own process and blocks external outbound sockets. `CONTEXIFY_ENV_FILE` selects its explicit configuration without reading production dotenv. A missing/non-file selection fails instead of falling back; ordinary startup retains its existing dotenv defaults.

The selected hotspot endpoint is `https://192.168.137.1`, bound only to that interface on port 443. State is under ignored `backend/.pytest_cache/assistant-local-android/backend-192-168-137-1`. Synthetic credentials are in `test-account.json` there, not printed or embedded in the app. No user/production database or environment was changed.

The TLS leaf certificate includes the hotspot IP. Only the public development CA enters the generated **debug** Android resources, restricted to that hostname; no phone/PC CA installation or TLS verification bypass is used. Private keys stay in the ignored backend state. The CA signing key is not retained; the leaf lasts 14 days, so renewal requires regenerating/rebuilding the test trust. Normal/release TLS policy is unchanged. Firewall and phone-to-PC connectivity still need manual acceptance; no firewall rule was added automatically.

## Commands

Start the practice API from the repository root:

```powershell
.\backend\venv\Scripts\python.exe -B scripts/assistant_local_backend.py --lan-host 192.168.137.1
```

Compile the standalone test APK locally:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-assistant-local.ps1 -LanHost 192.168.137.1
```

The builder uses local tools/caches, runs both modules' debug native tests, assembles ARM64 and copies the APK to `backend/.pytest_cache/assistant-local-android/Contexify-Volume-Test-1.4.3.apk`. It restores process environment settings on exit and never calls ADB/EAS or installs an app. APK inspection is required before handoff.

## Crash recovery and evidence

The first local Gradle daemon crashed with a confirmed native-memory allocation error; the default 2 GiB heap plus other processes exceeded available memory on the 8 GiB PC. No APK/native passing result was produced. VS Code also crashed; the source, staged changes, SDK/JDK/Gradle downloads, generated project and separate TLS/test databases survived. Whether Gradle caused the IDE crash is not established. Saved diagnostics: ignored `local-build.log` and `mobile/android/hs_err_pid40200.log`.

The local builder now uses one worker, a 1 GiB Gradle heap, 512 MiB metaspace, two JVM processors, Kotlin compilation in-process, one CMake job and a 512 MiB Node heap. These are local build limits, not production behavior. The user confirmed closing unused applications; do not terminate unrelated user processes.

Passed before the crash: publisher checksums; real loopback HTTPS/certificate/password-login/session/scope/wrong-origin checks; hotspot HTTPS/certificate/password-login/scope checks from the PC; 12 settings tests including explicit dotenv isolation and missing-file failure. These do not establish phone connectivity or device effects.

Still pending: manual installation/connection, enrollment/confirmation, actual S25 media-volume readback and earlier device/privacy/recovery gates. Resume [the combined checklist](implementation-plan.md#next-checkpoint-working-android-action-and-unfinished-verification); do not replace these with more preview tests.

Recovery update: the smaller-memory attempt compiled both assistant Android modules. The actual Gradle JUnit XML reports show 7 speech-language and 4 volume-policy cases, zero failures/errors. At that point, app packaging remained in progress; the successful result is recorded above. The hotspot server was restarted after the crash and certificate-verified from the PC. User-reported unused apps were closed; the build used conservative limits and no concurrent heavy checks.

The next packaging attempt reached C++ compilation and failed in Windows Ninja while creating a long generated Safe Area Context object path (`local-build-recovery.log`). The generated test project's CMake configuration now sets `CMAKE_OBJECT_PATH_MAX=240`, so CMake hashes long object paths before the native tool's limit. An initial limit of 200 was too small for the fixed target directory and filename, producing warnings and leaving the long path intact. This changes only local generated build configuration and reuses the existing cache; it does not change dependency source or Windows system settings. See [CMake's object-path setting](https://cmake.org/cmake/help/latest/variable/CMAKE_OBJECT_PATH_MAX.html).

The compiler probe also stalled with no live compiler child in restricted execution. Only this build's verified Ninja/CMake/Gradle processes were stopped. A reviewed local build outside the process sandbox completed the same configuration step promptly; logs remain in `local-build-path-fix.log` and `local-build-native-recovery.log`. The exact cause of the earlier stall is not established. No cloud build or phone operation was involved.


## Authorized M4 test APK delivery - 2026-11-18

The inspected local M4 update is `backend/.pytest_cache/assistant-local-android/Contexify-Assistant-M4-Test-1.4.3-3.apk`, version 1.4.3-assistant-test3/code 3 (62,516,001 bytes). It matches the previous test signing identity and preserves the earlier APK. Install over Contexify Volume Test; no uninstall or production update is needed. The isolated HTTPS backend was restarted with protected M4 routes. No EAS build, phone access or live generation was used. Full digest/inspection evidence and pending physical checks are in [M4 delivery](m4-operation-recovery.md#authorized-m4-test-apk-delivery---2026-11-18).
