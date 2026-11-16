const base = require("./app.json").expo;

module.exports = () => {
  const verification = process.env.APP_VARIANT === "assistant-verification";
  const testEntry = process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST === "true";
  const execution =
    process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED === "true";
  const volumeTest = process.env.APP_VARIANT === "assistant-volume-test";
  if (verification !== testEntry) {
    throw new Error(
      "Assistant verification requires both the isolated native variant and test entry point.",
    );
  }
  if (volumeTest) {
    const origin = process.env.ASSISTANT_VOLUME_TEST_API_ORIGIN;
    const url = origin ? new URL(origin) : null;
    const productionApi =
      require("./eas.json").build.production.env.EXPO_PUBLIC_API_URL;
    if (
      !execution ||
      !url ||
      url.protocol !== "https:" ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      origin !== process.env.EXPO_PUBLIC_API_URL ||
      origin === new URL(productionApi).origin
    ) {
      throw new Error(
        "Volume testing requires an explicit, separate HTTPS test API origin and matching public API URL.",
      );
    }
    return {
      ...base,
      name: "Contexify Volume Test",
      scheme: "contexify-volume-test",
      updates: { enabled: false },
      android: {
        ...base.android,
        package: "ai.contexify.app.assistantvolumetest",
      },
      ios: {
        ...base.ios,
        bundleIdentifier: "ai.contexify.app.assistantvolumetest",
      },
      plugins: [
        ...base.plugins.filter(
          (plugin) =>
            (Array.isArray(plugin) ? plugin[0] : plugin) !==
            "@react-native-google-signin/google-signin",
        ),
        "./plugins/with-assistant-execution",
      ],
    };
  }
  if (!verification) {
    if (execution)
      throw new Error(
        "Assistant execution is restricted to the separate test variant pending device acceptance.",
      );
    return base;
  }
  if (execution)
    throw new Error(
      "Offline assistant verification cannot enable device actions.",
    );
  return {
    ...base,
    name: "Contexify Assistant Test",
    scheme: "contexify-assistant-test",
    updates: { enabled: false },
    android: {
      ...base.android,
      package: "ai.contexify.app.assistantverification",
      // This test app has no backend, auth flow, file picker or overlay feature.
      blockedPermissions: [
        "android.permission.INTERNET",
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.MODIFY_AUDIO_SETTINGS",
      ],
    },
    ios: {
      ...base.ios,
      bundleIdentifier: "ai.contexify.app.assistantverification",
    },
    plugins: base.plugins.filter(
      (plugin) =>
        (Array.isArray(plugin) ? plugin[0] : plugin) !==
        "@react-native-google-signin/google-signin",
    ),
  };
};
