const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { fixture } = require("./helpers/device_control_fixture.cjs");
const core = createTypeScriptLoader()("packages/assistant-core/src/index.ts");
const id = "11111111-1111-4111-8111-111111111111";
const action = { capability_id: "media_volume.set", percent: 50 };
const plan = (steps = [{ action }]) =>
  core.operationPlan(id, 1, Date.now() + 60000, steps);
const result = (p, states = p.steps.map(() => "verified")) => ({
  protocol_version: 2,
  plan_id: p.plan_id,
  plan_revision: p.plan_revision,
  revision: 1 + 2 * p.steps.length,
  steps: p.steps.map((step, i) => ({
    step_id: i,
    capability_id: step.action.capability_id,
    state: states[i],
    result:
      states[i] === "verified"
        ? {
            outcome: "verified",
            requested_percent: step.action.percent,
            observed_percent: step.action.percent,
            receipt_recorded: true,
          }
        : null,
  })),
});

test("a reviewed whole graph has stable immutable identity, ordered dependencies and no transcript", () => {
  const steps = [
    { action: { ...action } },
    { action: { ...action, percent: 40 }, depends_on: [0] },
  ];
  const p = plan(steps);
  steps[0].action.percent = 60;
  steps[1].depends_on.push(1);
  assert.equal(p.steps[0].action.percent, 50);
  assert.deepEqual(p.steps[1].depends_on, [0]);
  assert.deepEqual(
    p.steps.map((step) => step.step_id),
    [0, 1],
  );
  assert.equal(p.plan_id, id);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.steps[1].depends_on));
  assert.doesNotMatch(
    JSON.stringify(p),
    /text|transcript|token|permit|current_index/,
  );
});

test("malformed, cyclic, forward, duplicate dependencies and out-of-policy plans fail before dispatch", () => {
  for (const steps of [
    [],
    Array(6).fill({ action }),
    [{ action, depends_on: [0] }],
    [{ action }, { action, depends_on: [0, 0] }],
    [{ action: { ...action, percent: 90 } }],
  ]) {
    assert.throws(() => plan(steps));
  }
  assert.throws(() =>
    core.operationPlan(id, 0, Date.now() + 1000, [{ action }]),
  );
  assert.throws(() => core.operationPlan(id, 1, Date.now() - 1, [{ action }]));
  const unsupported = plan([
    { action },
    {
      action: { capability_id: "application.open", application_id: "clock" },
      depends_on: [0],
    },
  ]);
  assert.equal(core.supportedOperationPlan(unsupported), false);
});

test("a conditional plan retains one local context and rejects context on multi-step or brightness", () => {
  const p = core.operationPlan(id, 2, Date.now() + 1000, [{ action }], id);
  assert.equal(p.context_id, id);
  for (const steps of [
    [{ action }, { action }],
    [{ action: { capability_id: "brightness.set_app", percent: 40 } }],
  ])
    assert.throws(() =>
      core.operationPlan(id, 2, Date.now() + 1000, steps, id),
    );
});

test("native evidence cannot swap identity, target, step, state or inject extra success prose", () => {
  const p = plan();
  assert.equal(core.operationResult(result(p), p).steps[0].state, "verified");
  for (const change of [
    (value) => {
      value.plan_revision = 2;
    },
    (value) => {
      value.steps[0].step_id = 1;
    },
    (value) => {
      value.steps[0].result.requested_percent = 60;
    },
    (value) => {
      value.steps[0].result.outcome = "outcome_unknown";
    },
    (value) => {
      value.steps[0].result = null;
    },
    (value) => {
      value.message = "Model says success";
    },
  ]) {
    const value = result(p);
    change(value);
    assert.throws(() => core.operationResult(value, p));
  }
  assert.match(
    core.describeOperationResult(
      core.operationResult(result(p, ["outcome_unknown"]), p),
    ),
    /outcome unknown/,
  );
});

test("v2 execution sends one immutable plan and never substitutes a legacy volume call", async (t) => {
  const received = [];
  const f = fixture(t, {
    native: {
      executePlanV2: async (origin, user, installation, token, encoded) => {
        assert.equal(token, "fixture-management");
        received.push(JSON.parse(encoded));
        return result(received[0]);
      },
      reconcilePlansV2: async () => [],
    },
  });
  const p = plan();
  const value = await f.api.executePlan("fixture-user", p);
  assert.equal(value.plan_id, id);
  assert.deepEqual(received, [p]);
  assert.equal(f.calls(), 0);
});

test("an older APK refuses v2 plans before authority requests and never falls back", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.api.executePlan("fixture-user", plan()),
    /updated compatible Android build/,
  );
  assert.equal(f.calls(), 0);
});

test("reconciliation only calls the native read-only method; it cannot execute recovered work", async (t) => {
  let reads = 0,
    writes = 0;
  const p = plan();
  const f = fixture(t, {
    native: {
      executePlanV2: async () => {
        writes++;
        throw Error("Must not execute");
      },
      reconcilePlansV2: async () => {
        reads++;
        return [result(p, ["outcome_unknown"])];
      },
    },
  });
  const rows = await f.api.reconcilePlans("fixture-user");
  assert.equal(rows[0].steps[0].state, "outcome_unknown");
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.equal(f.calls(), 0);
});

test("concurrent dispatch and account cancellation cannot publish a stale result or automatically retry", async (t) => {
  let finish,
    calls = 0;
  const p = plan();
  const f = fixture(t, {
    native: {
      executePlanV2: async () => {
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      reconcilePlansV2: async () => [],
    },
  });
  const pending = f.api.executePlan("fixture-user", p);
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    f.api.executePlan("fixture-user", p),
    /already in progress/,
  );
  f.api.cancel();
  finish(result(p));
  await assert.rejects(pending, /session changed/);
  assert.equal(calls, 1);
});
