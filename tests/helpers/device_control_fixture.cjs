const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./typescript_modules.cjs");
function fixture(t, overrides = {}) {
  const previous = {
    nativeTest: process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST,
    flag: process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED,
    fetch: global.fetch,
  };
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "true";
  process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST = "false";
  t.after(() => {
    if (previous.flag === undefined)
      delete process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
    else process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = previous.flag;
    global.fetch = previous.fetch;
    if (previous.nativeTest === undefined)
      delete process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST;
    else process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST = previous.nativeTest;
  });
  const binding = {
    userId: "fixture-user",
    host: "https://api.fixture.invalid",
    installationId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
  };
  let calls = 0,
    cancellations = 0,
    brightnessCalls = 0;
  let savedBinding = JSON.stringify(binding);
  const native = {
    signChallenge: async () => "fixture-signature",
    executeVolume: async (origin, user, installation, token, percent) => {
      calls++;
      assert.equal(origin, binding.host);
      assert.equal(user, binding.userId);
      assert.equal(installation, binding.installationId);
      assert.equal(token, "fixture-management");
      return {
        outcome: "verified",
        requested_percent: percent,
        observed_percent: 46,
        receipt_recorded: true,
      };
    },
    executeBrightness: async (origin, user, installation, token, percent) => {
      brightnessCalls++;
      assert.equal(origin, binding.host);
      assert.equal(user, binding.userId);
      assert.equal(installation, binding.installationId);
      assert.equal(token, "fixture-management");
      return {
        outcome: "verified",
        requested_percent: percent,
        observed_percent: percent,
        receipt_recorded: true,
      };
    },
    cancelVolume: async () => {
      cancellations++;
    },
    ...overrides.native,
  };
  const loader = createTypeScriptLoader({
    "expo-secure-store": {
      getItemAsync: async () => savedBinding,
      deleteItemAsync: async () => {
        savedBinding = null;
      },
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    },
    "react-native": { Platform: { OS: "android" } },
    "../../modules/assistant-device-security": { deviceSecurity: () => native },
  });
  global.fetch = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith("/challenge")
        ? { challenge_id: "fixture-challenge", payload: "fixture-payload" }
        : {
            access_token: "fixture-management",
            expires_at: Date.now() / 1000 + 60,
            scope: "security:manage",
          },
  });
  const api = loader(
    "mobile/src/services/assistant_security.ts",
  ).createAssistantDeviceSecurity(
    overrides.getHost || (async () => binding.host),
    overrides.authHeaders ||
      (async () => ({ Authorization: "Bearer fixture-parent" })),
  );
  return {
    api,
    native,
    binding,
    calls: () => calls,
    brightnessCalls: () => brightnessCalls,
    cancellations: () => cancellations,
  };
}

module.exports = { fixture };
