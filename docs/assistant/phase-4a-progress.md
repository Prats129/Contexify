# Phase 4A: Android control readiness

2026-11-13. The user's next-step instruction authorizes further local source development while retaining Phase 3 for a combined push. This first Phase 4 batch implements read-only capability prerequisites. It does not complete the Phase 4 Android MVP or enable real device actions. Deferred native-security/device tests remain open.

## Implemented boundary

- Signed-in Android users can choose **Check Android support** inside Assistant preview. The explanatory text says what is inspected and that the check cannot enable actions. Opening the preview alone does not inspect installed packages.
- The existing Android device-security module exposes only `deviceControlReadiness` for this batch. It reports a fixed versioned shape with `execution_enabled: false`; it does not create/sign keys, enroll a device, authorize a task, consume a permit or dispatch an OS action.
- Foreground/unlocked checks run before inspecting media-volume support or launch candidates. React Native modal windows are handled through the host activity's resumed lifecycle. Locked/background reports contain no package-support details. These lifecycle properties still require hardware verification.
- Media support checks the fixed-volume policy and a usable media-stream maximum. App brightness reports only whether an app window exists. Neither hint proves that an adjustment will succeed or changes the current setting.
- Launch checks use four fixed packages: Spotify, Google Clock, AOSP Clock and Samsung Clock. Only their launch intents are inspected. A different Clock app is reported as **no reviewed launcher found**, rather than incorrectly claiming there is no Clock installed. No arbitrary package, URL, intent extra or application enumeration is accepted.
- The TypeScript service rejects unknown/missing fields, accessors, unsupported versions/platforms, inconsistent locked reports and any report claiming execution is enabled. It returns a copy, bounds waiting to three seconds, removes listeners/timers and hides platform exception details. Abort on background, account change or unmount prevents stale display. Reports remain in modal memory, with no network/storage port.
- Older binaries without the method and non-Android clients retain text previews. Both preview UIs now say device control is unavailable on that surface instead of implying the mobile app already executes commands. No third-party dependency or backend/API/schema change is required.
- This source is part of the still-unbuilt **1.4.0** native batch. No second version bump is needed before that combined binary exists. Native changes require a compatible binary; an OTA cannot add this method or its manifest declarations.

Platform references: [fixed-volume policy](<https://developer.android.com/reference/android/media/AudioManager#isVolumeFixed()>), [window brightness scope](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#screenBrightness), [narrow package visibility](https://developer.android.com/training/package-visibility/declaring), [package launch lookup](<https://developer.android.com/reference/android/content/pm/PackageManager#getLaunchIntentForPackage(java.lang.String)>). A readiness hint is advisory and must be rechecked by any future executor.

## Verification

- `node tests/assistant_device_readiness.test.cjs`: 9 passing offline service/bridge cases, including malformed reports, no getters, fixed volume, unavailable catalog handlers, old/missing bridges, non-Android/pre-aborted lookup prevention, cancellation and timeout. Native ports are synthetic; this does not exercise Android APIs.
- Shared-core, voice and security-client regressions: 30 + 28 + 14 passing tests.
- Frontend and mobile TypeScript checks pass with no emit or incremental cache.
- Manifest XML parsing confirms exactly four package entries matching the native catalog, with no permission or application/service declarations added. Both staged and unstaged diffs pass whitespace checks.
- Native compilation and physical-device acceptance have not been performed. The shell has no available Java/Gradle/Kotlin/ADB toolchain. No build, install, push, configured backend, database, provider or environment change was performed.

Subsequent verification update: the user authorized an internal Android build. Native compilation and static APK inspection now pass; [the build artifact, S25 checklist and remaining device/security gates](android-native-verification.md) supersede the earlier no-build state above. Phone acceptance is still pending.

## Device acceptance and next implementation boundary

After building a compatible Android binary with synthetic accounts, open Assistant preview, choose **Check Android support**, and verify expected support/missing-handler messages. Check older-binary fallback, guest visibility, lock/background, close/reopen, account switching and a slow/erroring platform call. Confirm with settings and task switching that volume, brightness and foreground app never change. Inspect the merged manifest for only the four package queries and verify no report is persisted/uploaded. Autolinking metadata or mocked tests alone do not close these gates.

Next is the separately gated trusted execution path: exact native transaction confirmation, a real execution scope distinct from simulation, atomic one-use authorization, durable native replay protection, immutable argument binding and observed result states. Implement and validate the bounded media-volume capability first, then app-window brightness and reviewed app launch. A discovered launcher supports only a future handoff claim, not proof of successful opening. Reminders additionally need encrypted private metadata, owned-object lifecycle and scheduling/notification permission handling; they are not implemented by this batch. Physical/security gates must close before real controls are enabled. Web remains a restricted preview/settings surface.
