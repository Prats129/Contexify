const {
  withAndroidManifest,
  withProjectBuildGradle,
} = require("expo/config-plugins");

module.exports = function withAssistantWake(config, { enabled = false } = {}) {
  if (typeof enabled !== "boolean") throw new Error("Wake build option must be boolean.");
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application[0];
    const name = "ai.contexify.assistant.WAKE_ENABLED";
    application["meta-data"] = [
      ...(application["meta-data"] ?? []).filter((item) => item.$["android:name"] !== name),
      { $: { "android:name": name, "android:value": String(enabled) } },
    ];
    return mod;
  });
  return withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") throw new Error("Unsupported Android Gradle language.");
    const line = "ext.agpVersion = com.android.Version.ANDROID_GRADLE_PLUGIN_VERSION";
    // The pinned wrapper otherwise falls back to AGP 7.2.1. Match the host
    // plugin already loaded by Expo; never downgrade the app toolchain.
    if (!mod.modResults.contents.includes(line)) mod.modResults.contents += `\n${line}\n`;
    return mod;
  });
};
