const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const load = createTypeScriptLoader();
const { reviewedVolumePercent, volumeResult, describeVolumeResult } = load("mobile/src/services/assistant_volume.ts");

test("only a complete, single reviewed volume action is eligible", () => {
  assert.equal(reviewedVolumePercent("set volume to 50%"), 50);
  assert.equal(reviewedVolumePercent("volume to 0 percent"), 0);
  for (const input of ["set volume to 71%", "set volume to 50% then open Spotify", "don't set volume to 50%", "open clock", "brightness to 40%", "set volume to fifty"]) {
    assert.equal(reviewedVolumePercent(input), null, input);
  }
});

test("honest result messages preserve quantization and missing receipts", () => {
  const result = volumeResult({ outcome: "verified", requested_percent: 50, observed_percent: 46, receipt_recorded: false }, 50);
  assert.match(describeVolumeResult(result), /46%.*50%.*steps/);
  assert.match(describeVolumeResult(result), /Server receipt unavailable/);
  assert.match(describeVolumeResult({ ...result, outcome: "outcome_unknown" }), /uncertain/);
});

test("bridge rejects fabricated success, unknown fields and accessors without invoking them", () => {
  const base = { outcome: "verified", requested_percent: 50, observed_percent: 46, receipt_recorded: true };
  for (const value of [null, [], { ...base, observed_percent: null }, { ...base, observed_percent: 51 },
    { ...base, requested_percent: 60 }, { ...base, outcome: "simulated" }, { ...base, private: "raw" },
    { ...base, observed_percent: NaN }, { ...base, receipt_recorded: "yes" }]) assert.throws(() => volumeResult(value, 50));
  let invoked = false;
  const object = { ...base };
  Object.defineProperty(object, "outcome", { get() { invoked = true; throw Error("secret"); } });
  assert.throws(() => volumeResult(object, 50));
  assert.equal(invoked, false);
});

test("bridge rejects symbol fields and custom prototypes while accepting copied plain data", () => {
  const base = { outcome: "verified", requested_percent: 50, observed_percent: 46, receipt_recorded: true };
  assert.throws(() => volumeResult({ ...base, [Symbol("unexpected")]: true }, 50));
  assert.throws(() => volumeResult(Object.assign(Object.create({ inherited: true }), base), 50));
  const copy = volumeResult(Object.assign(Object.create(null), base), 50);
  assert.deepEqual(copy, base);
  base.observed_percent = 0;
  assert.equal(copy.observed_percent, 46);
});

const { fixture } = require("./helpers/device_control_fixture.cjs");

test("native owns authority and execution; JS supplies only the enrolled context and bounded percentage", async (t) => {
  const f = fixture(t);
  await f.api.enableVolume(f.binding.userId);
  const result = await f.api.changeVolume(f.binding.userId, 50);
  assert.equal(result.outcome, "verified");
  assert.equal(f.calls(), 1);
});

test("disabled/old builds, invalid ranges and wrong accounts never reach the native executor", async (t) => {
  const f = fixture(t);
  for (const percent of [71, -1, true, 50.5]) await assert.rejects(f.api.changeVolume(f.binding.userId, percent));
  await assert.rejects(f.api.changeVolume("other-user", 50), /binding differs/);
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "false";
  await assert.rejects(f.api.changeVolume(f.binding.userId, 50), /enabled Android build/);
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "true";
  f.native.executeVolume = undefined;
  await assert.rejects(f.api.changeVolume(f.binding.userId, 50), /enabled Android build/);
  assert.equal(f.calls(), 0);
});

test("account cancellation during a management response prevents execution", async (t) => {
  const f = fixture(t);
  const fetch = global.fetch;
  global.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (!url.endsWith("/challenge")) f.api.cancel();
    return response;
  };
  await assert.rejects(f.api.changeVolume(f.binding.userId, 50), /cancelled/);
  assert.equal(f.calls(), 0);
  assert.equal(f.cancellations(), 1);
});

test("double taps and ambiguous native failures never automatically repeat execution", async (t) => {
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let calls = 0;
  const f = fixture(t, { native: { executeVolume: () => { calls++; entered(); return pending; } } });
  const first = f.api.changeVolume(f.binding.userId, 50);
  await started;
  await assert.rejects(f.api.changeVolume(f.binding.userId, 50), /already in progress/);
  reject(Error("fixture-ambiguous-native-call"));
  await assert.rejects(first);
  assert.equal(calls, 1);
});

test("cancellation settles a stalled security body and discards its late response", async (t) => {
  const f = fixture(t);
  let release, entered, signal;
  const started = new Promise((resolve) => { entered = resolve; });
  const body = new Promise((resolve) => { release = resolve; });
  global.fetch = async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: () => { entered(); return body; } };
  };
  const pending = f.api.changeVolume(f.binding.userId, 50);
  await started;
  f.api.cancel();
  await assert.rejects(pending, /cancelled/);
  assert.equal(signal.aborted, true);
  release({ challenge_id: "late-challenge", payload: "late-payload" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls(), 0);
  assert.equal(f.cancellations(), 1);
});

test("security deadline includes the response body even when fetch ignores abort", async (t) => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release, entered, signal;
  const started = new Promise((resolve) => { entered = resolve; });
  const body = new Promise((resolve) => { release = resolve; });
  global.fetch = async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: () => { entered(); return body; } };
  };
  const pending = f.api.changeVolume(f.binding.userId, 50);
  const rejected = assert.rejects(pending, /timed out/);
  await started;
  t.mock.timers.tick(15000);
  await rejected;
  assert.equal(signal.aborted, true);
  release({ challenge_id: "late-challenge", payload: "late-payload" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls(), 0);
});

test("an origin change while the security body arrives prevents native execution", async (t) => {
  let selected = "https://api.fixture.invalid";
  const f = fixture(t, { getHost: async () => selected });
  global.fetch = async () => ({ ok: true, json: async () => {
    selected = "https://other.fixture.invalid";
    return { challenge_id: "late-challenge", payload: "late-payload" };
  } });
  await assert.rejects(f.api.changeVolume(f.binding.userId, 50), /server changed/);
  assert.equal(f.calls(), 0);
});

test("forgetting the device aborts setup, deletes its key and prevents later volume execution", async (t) => {
  let deleted, release, entered;
  const f = fixture(t, { native: { deleteKey: async (installation) => { deleted = installation; } } });
  const started = new Promise((resolve) => { entered = resolve; });
  const body = new Promise((resolve) => { release = resolve; });
  global.fetch = async () => ({ ok: true, json: () => { entered(); return body; } });
  const pending = f.api.changeVolume(f.binding.userId, 50);
  const rejected = assert.rejects(pending, /cancelled/);
  await started;
  await f.api.forget();
  await rejected;
  assert.equal(deleted, f.binding.installationId);
  release({ challenge_id: "late-challenge", payload: "late-payload" });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(f.api.changeVolume(f.binding.userId, 50), /Enable volume control/);
  assert.equal(f.calls(), 0);
});
