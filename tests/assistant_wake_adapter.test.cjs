const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");

function fixture({ platform = "android", keyword = "HEY_CONTEXIFY", permission = true, failRelease = false } = {}) {
  const calls = [], state = { currentState: "active" };
  let recording = false, frames = 0;
  const native = {
    available: () => true,
    prepareModel: async () => "/private/bundled/model",
    start: async () => { recording = true; calls.push("start"); },
    isRecording: () => recording && frames === 0,
    readSamples: async () => { frames++; return [.5]; },
    stop: async () => { recording = false; calls.push("stop"); },
  };
  const engine = { KWS: {
    init: async () => ({ success: true }),
    resetStream: async () => ({ success: true }),
    acceptWaveform: async (_, samples) => ({ success: true, detected: samples[0] === .5, keyword }),
    release: async () => { calls.push("release"); return { released: !failRelease }; },
  } };
  const load = createTypeScriptLoader({
    "react-native": { Platform: { OS: platform }, AppState: state,
      PermissionsAndroid: { PERMISSIONS: { RECORD_AUDIO: "record_audio" }, check: async () => permission } },
    "../../modules/assistant-wake": { assistantWake: () => native },
    "@siteed/sherpa-onnx.rn": { __esModule: true, default: engine },
  });
  const module = load("mobile/src/services/assistant_wake.ts");
  return { ...module, native, calls, state };
}

test("real mobile adapter releases capture and engine before reporting only the approved keyword", async () => {
  for (const keyword of ["HEY_CONTEXIFY", "HELLO_WORLD"]) {
    const f = fixture({ keyword });
    const detected = await f.createMobileWakeAdapter().listen(new AbortController().signal, () => f.calls.push("ready"));
    assert.equal(detected, keyword === "HEY_CONTEXIFY");
    assert.deepEqual(f.calls, ["start", "ready", "stop", "release"]);
  }
});

test("cleanup failure and missing microphone permission fail closed", async () => {
  for (const options of [{ failRelease: true }, { permission: false }]) {
    const f = fixture(options);
    await assert.rejects(f.createMobileWakeAdapter().listen(new AbortController().signal, () => {}));
    assert.ok(f.calls.includes("stop"));
    if (options.permission === false) assert.ok(!f.calls.includes("start"));
  }
});

test("canceled model loading cannot open a microphone, and unsupported platforms do not enable wake", async () => {
  const f = fixture();
  let finish;
  f.native.prepareModel = () => new Promise((done) => { finish = done; });
  const controller = new AbortController();
  const running = f.createMobileWakeAdapter().listen(controller.signal, () => assert.fail());
  while (!finish) await new Promise((done) => setImmediate(done));
  controller.abort(); finish("/private/bundled/model");
  assert.equal(await running, false);
  assert.ok(!f.calls.includes("start"));
  for (const platform of ["ios", "web"]) assert.equal(fixture({ platform }).mobileWakeAvailable(true), false);
});
