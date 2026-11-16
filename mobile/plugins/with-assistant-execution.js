const { withAndroidManifest } = require("expo/config-plugins");

/** A binary must explicitly opt in; an OTA/public JS flag cannot enable native execution. */
module.exports = function withAssistantExecution(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) throw new Error("Android application manifest is missing.");
    const metadata = (application["meta-data"] ??= []);
    const name = "ai.contexify.assistant.EXECUTION_ENABLED";
    const existing = metadata.find((item) => item.$?.["android:name"] === name);
    const attributes = {
      "android:name": name,
      "android:value": "true",
      "tools:replace": "android:value",
    };
    mod.modResults.manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    if (existing) existing.$ = attributes;
    else metadata.push({ $: attributes });
    return mod;
  });
};
