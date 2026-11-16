const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { fixture } = require("./helpers/device_control_fixture.cjs");
const { reviewedBrightnessPercent, brightnessResult, describeBrightnessResult } =
  createTypeScriptLoader()("mobile/src/services/assistant_brightness.ts");

test("only one complete bounded app-brightness command is executable", () => {
  for (const percent of [10, 40, 100]) assert.equal(reviewedBrightnessPercent(`brightness to ${percent}%`), percent);
  for (const input of ["brightness to 9%", "brightness to 101%", "set volume to 40%", "brightness to 40% then open clock", "don't set brightness to 40%"])
    assert.equal(reviewedBrightnessPercent(input), null, input);
});

test("window readback requires an exact percentage and never claims system luminance", () => {
  const result = { outcome: "verified", requested_percent: 40, observed_percent: 40, receipt_recorded: true };
  assert.equal(brightnessResult(result, 40).observed_percent, 40);
  for (const observed_percent of [null, 39, 41, NaN]) assert.throws(() => brightnessResult({ ...result, observed_percent }, 40));
  assert.match(describeBrightnessResult(result), /window setting, not measured display luminance/);
  assert.match(describeBrightnessResult({ ...result, outcome: "outcome_unknown" }), /uncertain/);
});

test("brightness reuses enrolled identity but calls only its compiled native method", async (t) => {
  const f = fixture(t);
  await f.api.enableBrightness(f.binding.userId);
  assert.equal((await f.api.changeBrightness(f.binding.userId, 40)).outcome, "verified");
  assert.equal(f.brightnessCalls(), 1);
  assert.equal(f.calls(), 0);
});

test("invalid percentages, old binaries and other accounts never reach brightness execution", async (t) => {
  const f = fixture(t);
  for (const percent of [0, 9, 101, true, 40.5]) await assert.rejects(f.api.changeBrightness(f.binding.userId, percent));
  await assert.rejects(f.api.changeBrightness("other-user", 40), /binding differs/);
  f.native.executeBrightness = undefined;
  await assert.rejects(f.api.changeBrightness(f.binding.userId, 40), /enabled Android build/);
  assert.equal(f.brightnessCalls(), 0);
  assert.equal(f.calls(), 0);
});

test("volume and brightness cannot overlap and late brightness results cannot survive cancellation", async (t) => {
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  const f = fixture(t, { native: { executeBrightness: () => { entered(); return pending; } } });
  const execution = f.api.changeBrightness(f.binding.userId, 40);
  const rejected = assert.rejects(execution, /session changed/);
  await started;
  await assert.rejects(f.api.changeVolume(f.binding.userId, 50), /already in progress/);
  f.api.cancel();
  release({ outcome: "verified", requested_percent: 40, observed_percent: 40, receipt_recorded: true });
  await rejected;
  assert.equal(f.calls(), 0);
});
