param(
    [Parameter(Mandatory=$true)][string]$LanHost,
    [switch]$PrepareOnly,
    [switch]$NativeTestsOnly,
    [switch]$CheckLiveKey
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mobileRoot = Join-Path $projectRoot 'mobile'
$toolRoot = Join-Path $projectRoot 'backend\.pytest_cache\assistant-local-android'
$python = Join-Path $projectRoot 'backend\venv\Scripts\python.exe'
$sdk = Join-Path $toolRoot 'sdk'
$jdk = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
if (!$jdk -or !(Test-Path -LiteralPath (Join-Path $sdk 'build-tools\37.0.0\aapt2.exe'))) {
    throw 'The project-local JDK/Android SDK setup is incomplete.'
}
$environmentNames = @('JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','ANDROID_USER_HOME','GRADLE_USER_HOME',
    'EXPO_NO_DOTENV','EXPO_NO_TELEMETRY','EXPO_OFFLINE','CI','APP_VARIANT',
    'EXPO_PUBLIC_ASSISTANT_NATIVE_TEST','EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED',
    'EXPO_PUBLIC_ASSISTANT_VOICE_ENABLED','EXPO_PUBLIC_APP_ENV','ASSISTANT_VOLUME_TEST_API_ORIGIN',
    'EXPO_PUBLIC_API_URL','NODE_OPTIONS','CMAKE_BUILD_PARALLEL_LEVEL','PATH')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
# Process-only environment. No user/system PATH, production dotenv or cloud profile is changed.
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_USER_HOME = Join-Path $toolRoot 'android-user'
# Leave room for React Native's long generated header paths on Windows Ninja.
$env:GRADLE_USER_HOME = Join-Path $projectRoot 'backend\.pytest_cache\g'
$env:EXPO_NO_DOTENV = '1'
$env:EXPO_NO_TELEMETRY = '1'
$env:EXPO_OFFLINE = '1'
$env:CI = '1'
$env:APP_VARIANT = 'assistant-volume-test'
$env:EXPO_PUBLIC_ASSISTANT_NATIVE_TEST = 'false'
$env:EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = 'true'
$env:EXPO_PUBLIC_ASSISTANT_VOICE_ENABLED = 'true'
$env:EXPO_PUBLIC_APP_ENV = 'production'
$env:ASSISTANT_VOLUME_TEST_API_ORIGIN = "https://$LanHost"
$env:EXPO_PUBLIC_API_URL = "https://$LanHost"
$env:NODE_OPTIONS = '--max-old-space-size=512'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '1'
$env:PATH = (Join-Path $jdk.FullName 'bin') + ';' + $env:PATH

Push-Location $projectRoot
try {
    & $python -B scripts/assistant_local_backend.py --prepare-only --lan-host $LanHost
    if ($LASTEXITCODE -ne 0) { throw 'Test TLS/config preparation failed.' }
    $applicationGradle = Join-Path $mobileRoot 'android\app\build.gradle'
    if (!(Test-Path -LiteralPath $applicationGradle)) {
        throw 'Generate the isolated Android project with Expo prebuild before running this script.'
    }
    & $python -B scripts/assistant_local_android.py --lan-host $LanHost
    if ($LASTEXITCODE -ne 0) { throw 'Standalone Android test preparation failed.' }
    $sdkProperty = 'sdk.dir=' + $sdk.Replace('\', '/')
    [IO.File]::WriteAllText((Join-Path $mobileRoot 'android\local.properties'), $sdkProperty + "`n")
    if ($PrepareOnly) { return }
    Push-Location (Join-Path $mobileRoot 'android')
    try {
        # Local compilation only. Single phone architecture, bounded worker count, no install/ADB command.
        $gradle = Join-Path $toolRoot 'gradle-distribution\gradle-9.4.1\bin\gradle.bat'
        if (!(Test-Path -LiteralPath $gradle)) { $gradle = '.\gradlew.bat' }
        $nativeTasks = @(':assistant-voice:testDebugUnitTest', ':assistant-device-security:testDebugUnitTest')
        if (!$NativeTestsOnly) { $nativeTasks += ':app:assembleDebug' }
        & $gradle @nativeTasks `
            '-PreactNativeArchitectures=arm64-v8a' '--offline' '--max-workers=1' '--console=plain' '--no-daemon' `
            '-Dorg.gradle.jvmargs=-Xmx768m -XX:MaxMetaspaceSize=384m -XX:ReservedCodeCacheSize=96m -XX:ActiveProcessorCount=1' `
            '-Dorg.gradle.parallel=false' '-Pkotlin.compiler.execution.strategy=in-process' '-Pkotlin.incremental=false' '--stacktrace'
        if ($LASTEXITCODE -ne 0) { throw 'The local native build failed; inspect its compiler output before retrying.' }
    } finally { Pop-Location }
    if ($NativeTestsOnly) { Write-Output 'Native modules compiled and unit-test tasks passed. No APK assembled or phone accessed.'; return }
    $apk = Join-Path $mobileRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
    if (!(Test-Path -LiteralPath $apk)) { throw 'The expected test APK was not generated.' }
    $destination = Join-Path $toolRoot 'Contexify-Assistant-M5-Reminders-Test-1.4.3-5.apk'
    Copy-Item -LiteralPath $apk -Destination $destination
    $inspectionArguments = @('--lan-host', $LanHost)
    if ($CheckLiveKey) { $inspectionArguments += '--check-live-key' }
    & $python -B scripts/inspect_assistant_local_apk.py @inspectionArguments
    if ($LASTEXITCODE -ne 0) { throw 'Test APK inspection failed; do not install it.' }
    Write-Output ('Test APK ready for inspection and manual installation: ' + $destination)
    Write-Output 'No phone connection, installation, cloud build or production deployment was performed.'
} finally {
    Pop-Location
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
}
