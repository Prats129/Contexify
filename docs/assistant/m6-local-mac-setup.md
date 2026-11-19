# M6: local Mac build and iPhone installation

Prepared 2026-11-19 for a future borrowed-Mac route. The user currently has no Mac and has deferred Apple build/signing and phone verification until a Mac and iPhone are available. No Apple build has run on the Windows PC. This guide prepares the first build; it does not establish that the Swift sources compile or that M6 acceptance has passed.

## What you need

- A Mac able to run Xcode with the iOS 26 SDK or newer, and an iPhone on iOS 26+ to test ringing alarms and countdown timers. Earlier supported iOS versions can test the other available features, but cannot close the full checklist.
- Xcode, its iOS platform components, compatible Node.js (22.13+ in the 22.x line is supported by this package), and CocoaPods. Open Xcode once and handle its setup and any Apple agreements yourself. Do not run commands that silently accept agreements or enroll in a paid program.
- Your own Apple signing account in Xcode. A Personal Team can support local device testing, but its provisioning restrictions and app/widget signing must be checked on the Mac. Stop at a signing/capability error rather than buying membership or changing production identifiers as a workaround.
- A data cable for the initial Mac/iPhone pairing if required by Xcode. You control pairing and installation; this gives no phone access to this assistant. Enable Developer Mode when Xcode requests it.
- The current M6 sources, including both `mobile/` and `packages/assistant-core/`. An older repository clone or the old Android APK does not contain this iPhone build. Do not copy Windows dependencies, backend state, credentials or actual `.env` files to the borrowed Mac.

The prepared `Contexify-M6-iOS-Source.zip` contains the current tracked mobile/shared source files as they exist in the working tree, these instructions and the M6 checklist. It excludes dependencies, generated native projects, backend state and real environment files. Extract it to a **new dedicated folder** on the Mac. It is source code, not an installable app. Keep `mobile/` next to `packages/`; the local core dependency uses that relative path. Changes made after the ZIP was prepared require a refreshed source transfer.

## 1. Prepare the separate test backend on Windows

Keep the Windows PC online, turn on Windows Mobile hotspot, and connect the iPhone to that hotspot. The existing test origin is `https://192.168.137.1`; confirm that address is active before starting. Do not switch to the production API to resolve a connection failure.

From `E:\Contexify`, use the existing isolated launcher when the test server needs to start. If that same test server is already running, use its known terminal to stop it before replacing it; do not terminate unrelated Python processes.

```powershell
backend\venv\Scripts\python.exe -B scripts/assistant_local_backend.py --lan-host 192.168.137.1 --account-storage
```

This uses the existing isolated practice database and separately prepared Windows-protected account-storage key. It omits live Gemini processing. If it reports missing storage-key preparation, stop and resolve that setup on Windows; do not copy production secrets or Windows-protected keys to the Mac. Retain the existing narrow hotspot firewall configuration; do not disable Windows Firewall.

The iPhone must trust the test server's TLS certificate. Android's test-CA configuration does not transfer to iOS. For this existing local origin, have the phone owner inspect and install **only the public test CA**:

```text
E:\Contexify\backend\.pytest_cache\assistant-local-android\backend-192-168-137-1\ca.pem
```

Use an owner-controlled transfer, such as AirDrop from the Mac. Never transfer `server.key.pem`, test-account files or storage keys. If a certificate format conversion is necessary, convert only this public PEM certificate to a DER `.cer`; never generate a replacement CA to get past a trust error. Check its certificate identity/fingerprint against the Windows original before trusting it. Installing a manually transferred certificate and enabling SSL trust are separate steps: Settings → General → VPN & Device Management, then Settings → General → About → Certificate Trust Settings. Full trust must be an informed choice by the borrowed phone's owner; remove this test certificate/trust after testing. Do not disable TLS checks or install unrelated profiles.

In iPhone Safari open `https://192.168.137.1/api/v1/health`. It must load without a certificate warning. This checks the test service only; do not share its diagnostic response or account credentials. Keep the PC/server/hotspot running during online app tests. The Mac needs internet to download build dependencies; it need not run the backend. If using another reviewed separate HTTPS test origin, use that same canonical origin throughout the following steps.

## 2. Prepare the build in Mac Terminal

Open a **new Terminal session** in the freshly extracted source root. Run each step in order and stop if one fails. The first two commands report the selected Xcode and available SDKs; they do not accept licenses.

```sh
xcodebuild -version
xcodebuild -showsdks
node --version
pod --version
swift test --package-path mobile/modules/assistant-device-security
cd mobile
npm ci
```

Run the five Swift policy tests before device acceptance. If the selected developer directory points at Command Line Tools rather than Xcode, choose the installed Xcode in its Settings → Locations → Command Line Tools, then retry. A Swift policy pass is separate from compiling the complete app and widget. `npm ci` uses the existing lockfile; do not update dependencies to work around a build error without reviewing the cause.

Set the following **nonsecret test-build values in that same Terminal**:

```sh
export EXPO_NO_DOTENV=1
export APP_VARIANT=assistant-volume-test
export EXPO_PUBLIC_ASSISTANT_NATIVE_TEST=false
export EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED=true
export EXPO_PUBLIC_ASSISTANT_VOICE_ENABLED=true
export EXPO_PUBLIC_APP_ENV=production
export ASSISTANT_VOLUME_TEST_API_ORIGIN=https://192.168.137.1
export EXPO_PUBLIC_API_URL="$ASSISTANT_VOLUME_TEST_API_ORIGIN"
```

`EXPO_PUBLIC_APP_ENV=production` selects the existing fixed HTTPS transport behavior; the explicit test origin and distinct bundle identifier still select the test system. It does not authorize production testing. No Gemini key, backend key, password or certificate private key belongs in these public build variables.

Confirm the evaluated identity, origin, native flags and disabled OTA before generation. This command outputs only the reviewed fields; it fails if the configuration does not match the isolated variant:

```sh
node -e 'const c=require("./app.config.js")(); if(c.ios.bundleIdentifier!=="ai.contexify.app.assistantvolumetest" || c.updates.enabled!==false || process.env.EXPO_PUBLIC_API_URL!==process.env.ASSISTANT_VOLUME_TEST_API_ORIGIN) throw Error("Test isolation check failed"); console.log({name:c.name,bundleIdentifier:c.ios.bundleIdentifier,apiOrigin:process.env.EXPO_PUBLIC_API_URL,updatesEnabled:c.updates.enabled,platform:c.plugins.find(p=>Array.isArray(p)&&p[0]==="./plugins/with-assistant-platform")});'
```

The platform options must show `enabled: true` and `voiceEnabled: true`. Generate a fresh iOS project, preserving package versions and avoiding deletion of an existing project:

```sh
node -e 'if(require("node:fs").existsSync("ios")) throw Error("Use a fresh extracted source folder; do not overwrite an existing iOS project");'
node node_modules/expo/bin/cli prebuild --platform ios --no-clean --no-install --skip-dependency-update react,react-native
cd ios
pod install
cd ..
open ios/*.xcworkspace
```

Use `--no-clean` explicitly: this installed Expo CLI otherwise defaults to recreating native folders. Do not copy a generated test native project back into the production project. The first pod resolution creates a `Podfile.lock`; retain it with the build evidence for reproducing that native build.

## 3. Sign and install from the Mac

In the opened Xcode **workspace**, sign into your Apple account if needed, pair your unlocked iPhone and select the app scheme and that physical device. Under Signing & Capabilities select your own team with automatic signing for **both** targets:

| Target | Required test bundle identifier |
| --- | --- |
| App (`Contexify Volume Test`, name may be sanitized by Expo) | `ai.contexify.app.assistantvolumetest` |
| `ContexifyScheduleWidget` | `ai.contexify.app.assistantvolumetest.schedules` |

Do not select `ai.contexify.app`. If Xcode cannot provision these identities for your team, stop and record the signing error for review; do not edit only one identifier or install over production. Confirm that the widget is embedded in the app and has the same signing team. No App Group, shared account store or background microphone capability is required by this implementation.

After setting signing, save the project. In the **same Mac Terminal with the exports above**, still in `mobile/`, build and install:

```sh
node node_modules/expo/bin/cli run:ios --device --configuration Release --no-bundler
```

Select the paired iPhone when prompted. This uses local Xcode compilation and device installation, not EAS. The Release configuration bundles JavaScript for standalone/offline-alert testing without Metro. There is no need to export an `.ipa` for this direct Xcode installation. `npm run build:ios` is an existing **EAS production-build command**; do not use it for this workflow.

If compilation, pod integration, App Intents extraction, widget embedding, device trust or signing fails, record the first relevant error and stop. Share the concise error with credentials, account identifiers and private paths removed. Do not substitute Expo Go, an old Android APK or an OTA update for the required native binary.

## 4. Start the consolidated phone checks

1. Open **Contexify Volume Test**, verify it is separate from the production app, and sign into the isolated test account while on the PC hotspot. Allow its local-network access when requested. A successful Safari check alone does not establish app sign-in.
2. Open Assistant. Use the iPhone feature controls/forms for Calendar, reminders, ringing alarms and timers. **Leave AI planning off**; these M6 paths do not need Gemini and private details must not be submitted to it.
3. Run the consolidated M6 checklist in [m6-platform-extensions.md](m6-platform-extensions.md), including build gates B1-B3. Record iPhone/iOS, Xcode/SDK, source snapshot, signing type, app/widget identifiers and each result. Keep earlier Android/deferred tests in their own documents.
4. After testing, cancel the test app's owned pending alerts, sign out, remove its test installation and remove the test CA/trust from the borrowed phone. Saved Calendar events are managed separately in Calendar. Remove your Apple account/signing credentials from a borrowed Mac when finished; do not delete another person's credentials.

M6 remains pending until the Apple build and applicable real-device/browser checks pass. This guide and source ZIP are preparation evidence only. No EAS build, paid enrollment, Apple agreement acceptance, production deployment or live Gemini request is performed by preparing them.

## Official setup references

- [Expo: local app compilation](https://docs.expo.dev/guides/local-app-development/) and [local builds from generated native projects](https://docs.expo.dev/build-reference/local-builds/).
- [Apple: run an app on a device](https://help.apple.com/xcode/mac/current/en.lproj/dev5a825a1ca.html), [developer account and Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account/), and [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
- [Apple: trust a manually installed certificate](https://support.apple.com/102390).
- [Apple: AlarmKit scheduling requirements](https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit).
