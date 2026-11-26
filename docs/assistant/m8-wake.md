# M8 Android foreground wake-to-command integration

Implemented after the user confirmed the isolated S25 trial and authorized integration on 2026-11-25. Sherpa feeds the existing assistant voice session; the planner, public-text processing scope and action-authorization boundaries are preserved.

## Behavior

- Wake requires a signed-in compatible test build, session microphone consent and an explicit **Listen for Hey Contexify** tap. Opening Assistant never starts capture. If Android microphone permission has never been granted, **Use microphone** obtains it first; wake shows fixed guidance rather than silently requesting permission or resuming after a permission dialog.
- Say **Hey Contexify**, pause, then speak when the command microphone is ready. Wake capture stops after 30 seconds independently in native code. A 45-second session deadline includes model loading. A command spoken simultaneously with the wake phrase is not buffered/replayed.
- Wake releases its microphone and inference resources before handing over to the existing on-device command recognizer. AI consent off gives an editable transcript. Existing AI consent on submits through the same public-command planner; enrollment, policy, free-tier limits and exact native confirmation are unchanged. Wake grants no authentication or action permit.
- One detection starts at most one command capture. No automatic rearming follows capture, timeout, confirmation, errors or returning to the app. Explicitly enable another wake window when wanted.
- Stop, Clear/cancel, consent removal, Close, sign-out/account change, navigation to other tools, Home/background, lock/activity destruction and unmount cancel wake. Competing PTT/TTS/typing/actions are blocked while wake capture runs. Request IDs isolate old reads/stops. Late detections cannot activate a closed or changed command session. Cleanup failure blocks handover; UI errors omit native bodies.
- Wake audio stays in memory. No recording file, wake transcript, user voice profile, cloud ASR, upload or runtime model download is introduced. App-private cached model files contain only public build assets.
- The compiled wake gate uses the existing separate test-variant and voice build options; no new environment variable is required. Production and offline verification builds keep wake disabled. The new Sherpa Apple dependency is excluded; existing iOS speech/Siri and web behavior remain. No background service or OS-assistant role is added.

## Dependency and model reproducibility

`@siteed/sherpa-onnx.rn` is pinned to **2.0.1**, matching the tested Expo **58.0.19** / React Native **0.88.0** setup. Existing dependency versions/integrity entries are unchanged. Installation used lifecycle scripts disabled and the published Android libraries. Use `npm ci --ignore-scripts` in `mobile` for this reviewed setup; optional binary download/rebuild scripts and Apple distribution need separate review. [Expo autolinking](https://docs.expo.dev/modules/autolinking/) links the Android library/local transport. The Gradle plugin matches the already-loaded host AGP instead of the wrapper's outdated fallback.

`assistant_wake_model.py` pins the standard English GigaSpeech KWS 3.3M 2024-01-01 archive, individual model/token/README hashes, selected regular members and bounded sizes. It verifies payloads before writing and replaces files atomically. The broken mobile encoder is excluded. The source keywords retain the three phone-tested full-name pronunciations and exclude `Hello world`. Score 1.5, threshold 0.25, four paths and two trailing blanks are unchanged. See the module's `NOTICE.md`, packaged upstream README and [comparison](wake-library-comparison.md) for attribution and licensing evidence; public-distribution approval is separate.

From the repository root, prepare assets using **one** source, then check:

```powershell
# Existing verified archive retained outside the disposable compatibility project:
backend\venv\Scripts\python.exe -B scripts\assistant_wake_model.py --archive backend/.pytest_cache/assistant-local-android/wake-model/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2
# Alternatively, explicitly download the fixed public archive (no API quota):
backend\venv\Scripts\python.exe -B scripts\assistant_wake_model.py --download
backend\venv\Scripts\python.exe -B scripts\assistant_wake_model.py --check
```

Generated `mobile/modules/assistant-wake/model` assets are git-ignored but covered by the native source fingerprint and APK inspection. Native builds need them; OTA cannot add the library. The local builder verifies model assets before assembly and the compiled wake gate/model contents afterward. The new test artifact uses code **8**, `1.4.3-assistant-test8`. No cloud build, live Gemini request, USB/ADB or production deployment is used for implementation checks.

For later PC restarts, reconnect the phone to Windows Mobile hotspot and run the existing isolated backend from the repository root, keeping its terminal open:

```powershell
backend\venv\Scripts\python.exe -B scripts\assistant_local_backend.py --lan-host 192.168.137.1 --live-planner --confirm-free-tier --flash-lite-evaluation --account-storage
```

This retains the previously approved free-only public-command configuration and existing test account/storage. It does not send a model request at startup. Keep API billing disabled; do not substitute a production origin, reset the test database or repeatedly retry a quota-limited command.

## Verification and changed-path phone tests

Automated checks cover one-time handover after release, duplicate starts, timeout/cancel/dispose, changed consent/account/lifecycle, non-brand rejection, cleanup failure, safe errors, platform/build restrictions and archive/model/keyword tampering. Real component handlers are exercised with the existing fixture. Existing voice/planning/build-isolation/release checks protect reused paths. Windows inference passed **37** local checks with the actual assistant keyword file, including non-triggering `Hello world`. This is retained synthetic/public-audio evidence, not an accuracy study. The disposable inference environment and fixtures were removed after acceptance; the real integration and regression tests remain.

The focused integration phone batch is complete at the scope recorded below. Do not repeat it unless a later change affects these paths; standalone results remain separate from main-screen observations.

**2026-11-26 phone checkpoint:** after the instructed code-8 wake → spoken public command → Android approval flow, the user reports media volume updated to halfway. Record the successful wake-to-volume path as **user-reported pass**; no independent audio/network trace or exact volume-step readback is claimed. Do not repeat this successful path.

**2026-11-26 main-screen cleanup:** the user started wake listening, closed Assistant without speaking and confirmed the green microphone indicator disappeared. Record this code-8 main-screen check as **user-reported pass**, separately from the earlier standalone trial. No independent microphone trace is claimed.

**2026-11-26 AI-consent-off check:** with microphone consent on and AI planning unchecked, the user confirmed wake detection handed over to command capture, the spoken command appeared in the text field, volume stayed unchanged and no Android confirmation appeared. An initial wake attempt had stayed in wake-listening status before a subsequent attempt detected the phrase; retain that observation for the separate wake-quality work. The user then explicitly tapped **Review command** and saw `Specify a supported app or an exact permitted percentage.` This is the existing limited local parser rejecting the free-form mute phrase; it was not an automatic speech error or a volume action. Record the consent-off phone behavior as **user-reported pass**. Source tests cover the no-planner-request boundary; the UI observation alone is not network-egress evidence.

The three focused code-8 phone checks are **user-reported passed**. Do not repeat this batch or rebuild solely for the expected local-review message. Long-duration false-trigger/miss and battery/memory measurements, Android OEM/OS matrices, Apple builds/devices and M8 gates A-F remain open. The user also reported the setup/interface is too complex; simplifying that experience remains separate from the verified functional path and must preserve microphone/planning consent and required action approval. No unchanged M5-M7 batch is requested.

## Built artifact - 2026-11-25

Local Android assembly succeeded in **30m 5s**, including the existing voice, security and platform unit-test tasks. Only the final inspected artifact below is delivered. No EAS build or live provider request was made.

- APK: `backend/.pytest_cache/assistant-local-android/Contexify-Assistant-M8-Wake-Test-1.4.3-8.apk`, **96,927,303 bytes**; separate `ai.contexify.app.assistantvolumetest` identity, version **1.4.3-assistant-test8 / code 8**, ARM64 only.
- SHA256: `8bbbec0752309e623c5f69e5c99ce16ef00e36aa0320875d44cd5cbf558a9b05`.
- Inspection passes for source fingerprint, current output/copy equality, signature matching the existing code-7 app, test TLS/backup/permission boundaries, compiled wake gate, exact model/keyword and license assets. The new wake button is present in the bundled main app and the native wake module is in DEX. There are **no additional Android permissions** compared with code 7.
- Evidence: ignored `backend/.pytest_cache/assistant-wake-integration/build.log`, `apk-inspection-code8.json`, `extra-inspection.json`, `command-regression.log`, `wake-ui.log` and `compatibility-evidence/main-wake-model-validation.json`. Source checks pass for mobile/web TypeScript, Python types/lint, wake session/adapter/UI tests, build isolation and offline artifact/model tests. These checks are separate from the user-reported phone observations above.
- The separate existing hotspot test backend was restarted with the previously approved free-only public-command/account-storage settings; test-CA-validated `/api/v1/health` returns HTTP 200. No test account/database reset, production access, phone debugging, staging or commit was performed. Keep the PC hotspot/backend available while testing.

The release-evidence artifact digest identifies code 8; A-F remain pending and the CLI correctly reports `hold` with no runtime authority. Its `wake.enabled: false` / pending decision refers to production rollout approval, not the enabled isolated test build or the completed library-selection trial. The PC hotspot and test backend must be available for sign-in or live planning.

## Compatibility cleanup - 2026-11-26

The disposable Wake Check project and its temporary environments, fixtures, duplicated packages and APKs were removed after verification. Small compatibility results and the pinned public model archive were preserved at the paths above. One-off build runners/canceled-build logs and superseded main-test APK copies were removed. Code 8 remains the current phone artifact; code 5 is retained only because the existing inspector uses it as a signing-continuity reference, not as an installation recommendation. Historical artifact names in older milestone documents are not current download instructions.

The working wake integration, notices, regression tests, shared build tools/cache, test backend/database/keys and the offline host for deferred verification remain. Runtime/source-build inputs and the staged index are unchanged by this cleanup; no new APK or live model call is needed.
