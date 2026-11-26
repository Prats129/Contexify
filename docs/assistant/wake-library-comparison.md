# Wake-library decision and compatibility results

Updated 2026-11-26 after the user selected Sherpa, completed the focused Android checks and requested removal of the disposable compatibility setup. The working integration is documented in [M8 foreground wake](m8-wake.md).

## Selected integration

| Component | Verified selection |
| --- | --- |
| Library / native engine | `@siteed/sherpa-onnx.rn` **2.0.1** / sherpa-onnx **2.0.1** |
| App baseline | Expo **58.0.19**, React Native **0.88.0**, React **19.3.0**, New Architecture and Hermes |
| Android toolchain | Existing AGP **9.2.1**, Gradle **9.4.1**, Kotlin plugin **2.2.10**, JDK **21**; no framework downgrade |
| Model | Standard English GigaSpeech KWS **3.3M, 2024-01-01** archive; int8 encoder/joiner, fp32 decoder |
| Integrity / attribution | Archive and component hashes pinned by `scripts/assistant_wake_model.py`; keywords, licenses and model contents checked by the APK inspector |
| Scope | Explicit, bounded, foreground Android listening; local audio; existing speech/planning/confirmation flow |

The app plugin exposes its already-loaded AGP version through `rootProject.ext.agpVersion`; otherwise this wrapper falls back to AGP 7.2.1. No library patch or framework downgrade is used. Existing dependency versions/integrity entries were preserved, lifecycle scripts were disabled, and the published package supplies Android native libraries. Apple linking is excluded pending its own verification.

The selection review on 2026-11-20 favored Sherpa's local custom-keyword path for the INR 0 budget. Porcupine required an account/AccessKey and separate commercial terms; openWakeWord required more mobile integration and its bundled-model licensing did not fit the proposed commercial path. These are historical selection findings, not renewed vendor-term verification or approval of other models. D13's general command/connector-library decision remains separate.

## Completed compatibility evidence

| Focused check | Result and limits |
| --- | --- |
| Android integration | TypeScript, configuration, code generation, Kotlin, Metro/Hermes, ARM64 linking and signed APK assembly passed on the app's exact versions. Apple/web runtime compatibility is not established. |
| Model inference | Real Windows CPU component inference and keyword decoding passed. Bundled ARM64 ONNX/JNI load segments support 16 KB alignment. Host inference is separate from phone evidence. |
| Standalone S25 trial, 2026-11-25 | User confirmed control-phrase detection, subsequent existing speech capture, stopping microphone capture on Home and final `Hey Contexify` detection across the recorded trial builds. This was not an accuracy study. |
| Integrated code-8 S25 checks, 2026-11-26 | User reported wake-to-command volume control, microphone cleanup on Close and AI-consent-off transcription without an action. Details and the current APK identity/hash are in [M8 wake](m8-wake.md). Do not repeat this completed smoke batch. |

The first trial's mobile encoder had a reproducible host ONNX reshape failure, and the user reported an Android crash. That binary was withdrawn. The standard model archive resolves the reproduced inference fault and is the pinned model used by the real integration. The original phone stack trace was not collected.

Three full brand tokenizations, generated with the model's BPE vocabulary, address the locally reproduced pronunciation gap and return the same `HEY_CONTEXIFY` keyword. Score **1.5**, threshold **0.25**, four paths and two trailing blanks are unchanged. The compatibility-only `Hello world` control is excluded from the real assistant. The selected assistant configuration passed **37** local synthetic/public-audio checks; these do not establish long-duration accuracy, battery or latency figures. An initial wake miss during integrated testing remains part of the open quality work.

## Disposable-trial cleanup

The separate **Contexify Wake Check** project, temporary PCM probe, duplicated app/core/dependency trees, host inference/tokenizer environments, generated speech fixtures, trial models/installers/scripts and trial APKs were removed after acceptance. Obsolete main-test APK copies and one-off build runners were also removed.

Small public verification records remain in the ignored `backend/.pytest_cache/assistant-wake-integration/compatibility-evidence/` directory. The verified standard model archive remains under `backend/.pytest_cache/assistant-local-android/wake-model/` for offline preparation. Current build/inspection records and the code-8 APK are retained. Code 5 is retained solely as the existing inspector's signing-continuity reference, not as an installation recommendation.

The working wake module, model preparation/integrity checks, notices, regression tests, shared SDK/build cache and isolated backend/account/key state remain. The offline verification host supports deferred platform checks. Cleanup does not change runtime/build source inputs or require another APK.

## Remaining boundaries

Wake recognition grants no identity, private-data processing consent or action authority. Wake releases its microphone before command transcription; AI processing and actions keep their separate consent/policy checks. Production and offline-verification wake stay disabled. No background service, OS-assistant role, always-on wake or adaptive correction memory is implemented here.

Wake-quality/resource measurements, Android OEM/OS matrices, deferred Mac/iPhone checks, web/deployed-topology acceptance and M8 gates A-F/public distribution remain open. The user also requested a simpler interface. The focused Android results do not close these requirements.

## Sources retained from the selection review

[Sherpa KWS design](https://k2-fsa.github.io/sherpa/onnx/kws/index.html), [engine license](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE), [model-license clarification](https://github.com/k2-fsa/sherpa-onnx/issues/3802), [wrapper documentation](https://github.com/deeeed/audiolab/blob/main/packages/sherpa-onnx.rn/README.md), [Porcupine setup](https://picovoice.ai/docs/quick-start/porcupine-react-native/), [Picovoice terms/FAQ](https://picovoice.ai/docs/faq/general/), [openWakeWord implementation/licenses](https://github.com/dscripka/openWakeWord), [Android microphone-service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#microphone), [Android background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/).
