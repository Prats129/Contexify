const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("../frontend/node_modules/typescript");

const base = require("../mobile/app.json").expo;
const profiles = require("../mobile/eas.json").build;
function config(env = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("mobile/app.config.js", "utf8"), {
    module,
    process: { env },
    URL,
    require(name) {
      if (name === "./eas.json") return { build: profiles };
      assert.equal(name, "./app.json");
      return { expo: base };
    },
  });
  return JSON.parse(JSON.stringify(module.exports()));
}

test("normal app identity, backend profiles and plugins are preserved", () => {
  assert.deepEqual(config(), base);
  assert.deepEqual(
    config({
      APP_VARIANT: "production",
      EXPO_PUBLIC_ASSISTANT_NATIVE_TEST: "false",
    }),
    base,
  );
  assert.equal(profiles.preview.env.EXPO_PUBLIC_APP_ENV, "production");
  assert.equal(
    profiles.preview.env.EXPO_PUBLIC_API_URL,
    profiles.production.env.EXPO_PUBLIC_API_URL,
  );
});

test("verification config has its own identity, no OTA and no app network permission", () => {
  const profile = profiles["assistant-verification"];
  assert.equal(
    profile.extends,
    undefined,
    "Test builds must not inherit a production API target.",
  );
  assert.equal(
    new URL(profile.env.EXPO_PUBLIC_API_URL).hostname,
    "assistant-verification.invalid",
  );
  const isolated = config(profile.env);
  assert.equal(isolated.name, "Contexify Assistant Test");
  assert.equal(
    isolated.android.package,
    "ai.contexify.app.assistantverification",
  );
  assert.notEqual(isolated.android.package, base.android.package);
  assert.notEqual(isolated.ios.bundleIdentifier, base.ios.bundleIdentifier);
  assert.notEqual(isolated.scheme, base.scheme);
  assert.equal(isolated.updates.enabled, false);
  assert.ok(
    isolated.android.blockedPermissions.includes("android.permission.INTERNET"),
  );
  assert.ok(
    isolated.android.blockedPermissions.includes(
      "android.permission.MODIFY_AUDIO_SETTINGS",
    ),
  );
  assert.ok(
    isolated.android.blockedPermissions.includes(
      "com.android.alarm.permission.SET_ALARM",
    ),
  );
  assert.ok(
    isolated.android.blockedPermissions.includes(
      "android.permission.ACCESS_NETWORK_STATE",
    ),
  );
  assert.ok(
    !isolated.plugins.includes("@react-native-google-signin/google-signin"),
  );
  assert.deepEqual(
    config(),
    base,
    "Evaluating the test variant must not mutate normal app settings.",
  );
});

test("shared execution opt-in is a native config change and cannot enable the offline app", () => {
  const enabled = config({
    ...profiles["assistant-volume-verification"].env,
    ASSISTANT_VOLUME_TEST_API_ORIGIN: "https://volume.fixture.invalid",
    EXPO_PUBLIC_API_URL: "https://volume.fixture.invalid",
  });
  assert.ok(enabled.plugins.includes("./plugins/with-assistant-execution"));
  assert.equal(enabled.android.package, "ai.contexify.app.assistantvolumetest");
  assert.notEqual(enabled.android.package, base.android.package);
  assert.equal(enabled.updates.enabled, false);
  assert.throws(
    () => config({ EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED: "true" }),
    /restricted to the separate test variant/,
  );
  assert.throws(
    () =>
      config({
        ...profiles["assistant-verification"].env,
        EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED: "true",
      }),
    /cannot enable device actions/,
  );
});

test("online volume variant fails before a build if the test backend is missing or production", () => {
  const profile = profiles["assistant-volume-verification"];
  assert.equal(profile.extends, undefined);
  for (const origin of [
    undefined,
    "http://volume.fixture.invalid",
    "https://volume.fixture.invalid/path",
    profiles.production.env.EXPO_PUBLIC_API_URL,
  ]) {
    assert.throws(
      () =>
        config({
          ...profile.env,
          ASSISTANT_VOLUME_TEST_API_ORIGIN: origin,
          EXPO_PUBLIC_API_URL: origin,
        }),
      /separate HTTPS test API origin/,
    );
  }
  assert.throws(
    () =>
      config({
        ...profile.env,
        ASSISTANT_VOLUME_TEST_API_ORIGIN: "https://volume.fixture.invalid",
        EXPO_PUBLIC_API_URL: profiles.production.env.EXPO_PUBLIC_API_URL,
      }),
    /matching public API URL/,
  );
});

test("native manifest opt-in is explicit, preserves other metadata and is idempotent", () => {
  let transform;
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync("mobile/plugins/with-assistant-execution.js", "utf8"),
    {
      module,
      require(name) {
        assert.equal(name, "expo/config-plugins");
        return {
          withAndroidManifest(config, callback) {
            transform = callback;
            return config;
          },
        };
      },
    },
  );
  module.exports({});
  const manifest = {
    $: {},
    application: [
      {
        $: {},
        "meta-data": [
          {
            $: {
              "android:name": "other-metadata",
              "android:value": "preserved",
            },
          },
          {
            $: {
              "android:name": "ai.contexify.assistant.EXECUTION_ENABLED",
              "android:value": "false",
            },
          },
        ],
      },
    ],
  };
  const mod = { modResults: { manifest } };
  transform(mod);
  transform(mod);
  assert.equal(manifest.application[0]["meta-data"].length, 2);
  assert.equal(
    manifest.application[0]["meta-data"][0].$["android:value"],
    "preserved",
  );
  assert.equal(
    manifest.application[0]["meta-data"][1].$["android:value"],
    "true",
  );
  assert.equal(
    manifest.application[0]["meta-data"][1].$["tools:replace"],
    "android:value",
  );
  assert.equal(manifest.$["xmlns:tools"], "http://schemas.android.com/tools");
});

test("mismatched test-entry/native-identity flags fail the build configuration", () => {
  for (const env of [
    { APP_VARIANT: "assistant-verification" },
    { EXPO_PUBLIC_ASSISTANT_NATIVE_TEST: "true" },
    { APP_VARIANT: "production", EXPO_PUBLIC_ASSISTANT_NATIVE_TEST: "true" },
    {
      APP_VARIANT: "assistant-verification",
      EXPO_PUBLIC_ASSISTANT_NATIVE_TEST: "false",
    },
  ])
    assert.throws(
      () => config(env),
      /both the isolated native variant and test entry/,
    );
});

test("verification entry never imports the normal app, accounts or backend transport", () => {
  for (const testMode of [true, false]) {
    const imported = [];
    const registered = [];
    const sentinel = {};
    const code = ts.transpileModule(
      fs.readFileSync("mobile/index.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
        },
      },
    ).outputText;
    vm.runInNewContext(code, {
      exports: {},
      process: { env: { EXPO_PUBLIC_ASSISTANT_NATIVE_TEST: String(testMode) } },
      require(name) {
        imported.push(name);
        if (name === "expo")
          return {
            registerRootComponent: (component) => registered.push(component),
          };
        assert.equal(
          name,
          testMode ? "./src/testing/AssistantNativeVerificationApp" : "./App",
        );
        return { default: sentinel };
      },
    });
    assert.deepEqual(registered, [sentinel]);
    assert.equal(imported.length, 2);
  }
});

test("native-version and package versions match for the new binary", () => {
  assert.equal(base.version, "1.4.3");
  assert.equal(require("../mobile/package.json").version, base.version);
  const lock = require("../mobile/package-lock.json");
  assert.equal(lock.version, base.version);
  assert.equal(lock.packages[""].version, base.version);
});
