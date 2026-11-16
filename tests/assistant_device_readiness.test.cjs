// Offline checks of the real service/bridge with synthetic native reports; no device or network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");

function report(patch = {}) {
  return {
    protocol_version: 1,
    platform: "android",
    execution_enabled: false,
    context: "foreground_unlocked",
    media_volume: "available",
    app_brightness: "available",
    applications: { spotify: "available", clock: "no_reviewed_handler" },
    ...patch,
  };
}

function fixture(platform = "android", method = async () => report()) {
  let lookups = 0;
  const native = {
    deviceControlReadiness: method,
    createKey() {
      assert.fail("Readiness must not create a key.");
    },
    signChallenge() {
      assert.fail("Readiness must not sign anything.");
    },
    confirmSimulation() {
      assert.fail("Readiness must not authorize simulation.");
    },
  };
  const load = createTypeScriptLoader({
    "react-native": { Platform: { OS: platform } },
    expo: {
      requireOptionalNativeModule(name) {
        lookups++;
        assert.equal(name, "AssistantDeviceSecurity");
        return native;
      },
    },
  });
  return {
    ...load("mobile/src/services/assistant_device_readiness.ts"),
    native,
    lookups: () => lookups,
  };
}

test("read-only report is copied and describes support without claiming execution", async () => {
  const source = report();
  const f = fixture("android", async () => source);
  const result = await f.readDeviceControlReadiness(
    new AbortController().signal,
  );
  assert.deepEqual(result, source);
  source.applications.spotify = "unavailable";
  assert.equal(result.applications.spotify, "available");
  const message = f.describeDeviceControlReadiness(result);
  assert.match(message, /adjustable stream found/);
  assert.match(message, /Clock: no reviewed launcher found/);
  assert.match(message, /Device actions remain disabled/);
  assert.match(f.describeDeviceControlReadiness(result, true), /Volume changes require separate confirmation/);
  assert.equal(f.lookups(), 1);
});

test("non-Android and pre-aborted requests never touch the native bridge", async () => {
  for (const platform of ["ios", "web", "windows", "unknown"]) {
    const f = fixture(platform);
    await assert.rejects(
      f.readDeviceControlReadiness(new AbortController().signal),
      /unavailable/,
    );
    assert.equal(f.lookups(), 0);
  }
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.readDeviceControlReadiness(controller.signal),
    /unavailable/,
  );
  assert.equal(f.lookups(), 0);
});

test("older builds preserve text preview and do not expose native exception details", async () => {
  const f = fixture();
  delete f.native.deviceControlReadiness;
  await assert.rejects(
    f.readDeviceControlReadiness(new AbortController().signal),
    /compatible native build/,
  );
  f.native.deviceControlReadiness = async () => {
    throw Error("private OS detail");
  };
  await assert.rejects(
    f.readDeviceControlReadiness(new AbortController().signal),
    (error) => {
      assert.doesNotMatch(error.message, /private OS detail/);
      return true;
    },
  );
  const load = createTypeScriptLoader({
    "react-native": { Platform: { OS: "android" } },
    expo: { requireOptionalNativeModule: () => null },
  });
  await assert.rejects(
    load(
      "mobile/src/services/assistant_device_readiness.ts",
    ).readDeviceControlReadiness(new AbortController().signal),
    /compatible native build/,
  );
});

test("version, scope, fields, booleans and unrecognized states fail closed", async () => {
  const malformed = [
    null,
    [],
    "ready",
    report({ protocol_version: "1" }),
    report({ protocol_version: 2 }),
    report({ platform: "ios" }),
    report({ execution_enabled: true }),
    report({ execution_enabled: "false" }),
    report({ context: "trusted" }),
    report({ media_volume: true }),
    report({ app_brightness: "ready" }),
    report({
      applications: {
        spotify: "available",
        clock: "available",
        arbitrary: "available",
      },
    }),
    report({ applications: { spotify: "available" } }),
    report({ applications: { spotify: "installed", clock: "available" } }),
    report({ token: "unexpected" }),
    Object.create(report()),
  ];
  const missing = report();
  delete missing.execution_enabled;
  malformed.push(missing);
  for (const value of malformed) {
    const f = fixture("android", async () => value);
    await assert.rejects(
      f.readDeviceControlReadiness(new AbortController().signal),
      /unavailable/,
    );
  }
});

test("accessors and symbol fields are rejected without evaluating getters", async () => {
  let getters = 0;
  const accessor = report();
  Object.defineProperty(accessor, "context", {
    enumerable: true,
    get() {
      getters++;
      return "foreground_unlocked";
    },
  });
  const nestedAccessor = report();
  Object.defineProperty(nestedAccessor.applications, "spotify", {
    enumerable: true,
    get() {
      getters++;
      return "available";
    },
  });
  const symbol = report();
  symbol[Symbol("extra")] = true;
  for (const value of [accessor, nestedAccessor, symbol]) {
    const f = fixture("android", async () => value);
    await assert.rejects(
      f.readDeviceControlReadiness(new AbortController().signal),
      /unavailable/,
    );
  }
  assert.equal(getters, 0);
});

test("locked/background reports cannot advertise available device or package details", async () => {
  for (const context of [
    "device_locked",
    "foreground_required",
    "unavailable",
  ]) {
    const f = fixture("android", async () => report({ context }));
    await assert.rejects(
      f.readDeviceControlReadiness(new AbortController().signal),
      /unavailable/,
    );
    f.native.deviceControlReadiness = async () =>
      report({
        context,
        media_volume: "unavailable",
        app_brightness: "unavailable",
        applications: { spotify: "unavailable", clock: "unavailable" },
      });
    const result = await f.readDeviceControlReadiness(
      new AbortController().signal,
    );
    assert.match(
      f.describeDeviceControlReadiness(result),
      /Device actions remain disabled/,
    );
    assert.doesNotMatch(
      f.describeDeviceControlReadiness(result),
      /Spotify|Clock/,
    );
  }
});

test("fixed-volume devices and catalog misses remain distinct from query errors", async () => {
  const f = fixture("android", async () =>
    report({
      media_volume: "fixed_volume",
      app_brightness: "unavailable",
      applications: { spotify: "no_reviewed_handler", clock: "unavailable" },
    }),
  );
  const result = await f.readDeviceControlReadiness(
    new AbortController().signal,
  );
  const message = f.describeDeviceControlReadiness(result);
  assert.match(message, /fixed by this device/);
  assert.match(message, /Spotify: no reviewed launcher found/);
  assert.match(message, /Clock: could not be checked/);
});

test("cancelling a screen rejects a pending check and ignores its late result", async () => {
  let finish;
  const f = fixture(
    "android",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const check = f.readDeviceControlReadiness(controller.signal);
  const rejection = assert.rejects(check, /unavailable/);
  controller.abort();
  await rejection;
  finish(report());
  await new Promise((resolve) => setImmediate(resolve));
});

test("native stalls stop after three seconds and settle once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish;
  const f = fixture(
    "android",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.readDeviceControlReadiness(new AbortController().signal);
  const rejected = assert.rejects(pending, /unavailable/);
  t.mock.timers.tick(3000);
  await rejected;
  finish(report());
  await Promise.resolve();
});
