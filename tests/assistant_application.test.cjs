const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { fixture } = require("./helpers/device_control_fixture.cjs");
const core = createTypeScriptLoader()("packages/assistant-core/src/index.ts");
const id = "11111111-1111-4111-8111-111111111111";
const app = { capability_id: "application.open", application_id: "spotify" };
const volume = { capability_id: "media_volume.set", percent: 40 };
const capabilities = [
  "media_volume.set",
  "brightness.set_app",
  "application.open",
];
const plan = (steps = [{ action: app }]) =>
  core.operationPlan(id, 1, Date.now() + 60000, steps);
function handoff(p) {
  return {
    protocol_version: 2,
    plan_id: p.plan_id,
    plan_revision: p.plan_revision,
    revision: 3,
    steps: [
      {
        step_id: 0,
        capability_id: "application.open",
        state: "handoff_requested",
        result: {
          outcome: "handoff_requested",
          application_id: "spotify",
          package_id: "com.spotify.music",
          receipt_recorded: true,
        },
      },
    ],
  };
}

test("only a final app handoff is supported; older binaries preview the whole plan", () => {
  const p = plan([{ action: volume }, { action: app, depends_on: [0] }]);
  assert.equal(core.supportedOperationPlan(p), false);
  assert.equal(core.supportedOperationPlan(p, capabilities), true);
  assert.equal(
    core.supportedOperationPlan(
      plan([{ action: app }, { action: volume, depends_on: [0] }]),
      capabilities,
    ),
    false,
  );
  assert.equal(
    core.supportedOperationPlan(
      plan([{ action: app }, { action: app }]),
      capabilities,
    ),
    false,
  );
});

test("handoff evidence never claims app visibility, playback or verified delivery", () => {
  const p = plan();
  const value = core.operationResult(handoff(p), p);
  assert.match(core.describeOperationResult(value), /handoff requested/);
  assert.match(core.describeOperationResult(value), /not verified/);
  for (const change of [
    (v) => {
      v.steps[0].state = v.steps[0].result.outcome = "verified";
    },
    (v) => {
      v.steps[0].result.package_id = "com.evil.app";
    },
    (v) => {
      v.steps[0].result.application_id = "clock";
    },
    (v) => {
      v.steps[0].result.intent = "android.intent.action.CALL";
    },
    (v) => {
      v.steps[0].result = null;
    },
    (v) => {
      v.steps[0].result.receipt_recorded = "true";
    },
  ]) {
    const result = handoff(p);
    change(result);
    assert.throws(() => core.operationResult(result, p));
  }
});

test("authenticated historical app evidence permits uncertainty without inventing success", () => {
  const p = plan(),
    value = handoff(p);
  value.steps[0].state = "outcome_unknown";
  value.steps[0].result = null;
  assert.match(
    core.describeOperationResult(core.operationResult(value)),
    /outcome unknown/,
  );
  const settings = {
    ...value,
    steps: [
      {
        ...value.steps[0],
        capability_id: "media_volume.set",
        state: "handoff_requested",
      },
    ],
  };
  assert.throws(() => core.operationResult(settings));
});

test("a compatible native binary receives one immutable app plan and no legacy effect", async (t) => {
  let calls = 0;
  const f = fixture(t, {
    native: {
      operationCapabilitiesV2: () => capabilities,
      executePlanV2: async (_origin, _user, _installation, _token, encoded) => {
        calls++;
        const received = JSON.parse(encoded);
        assert.deepEqual(received, planSnapshot);
        return handoff(received);
      },
      reconcilePlansV2: async () => [],
    },
  });
  const planSnapshot = plan();
  assert.equal(f.api.supportsPlan(planSnapshot), true);
  assert.equal(
    (await f.api.executePlan("fixture-user", planSnapshot)).steps[0].state,
    "handoff_requested",
  );
  assert.equal(calls, 1);
  assert.equal(f.calls(), 0);
  assert.equal(f.brightnessCalls(), 0);
});

test("missing or malformed native app support refuses the entire plan before authentication", async (t) => {
  for (const discovery of [
    undefined,
    () => ["application.open", "arbitrary.intent"],
    () => "application.open",
    () => [],
  ]) {
    const f = fixture(t, {
      native: {
        operationCapabilitiesV2: discovery,
        executePlanV2: async () =>
          assert.fail("Old or unsupported binary must not dispatch"),
        reconcilePlansV2: async () => [],
      },
    });
    let requests = 0;
    global.fetch = async () => {
      requests++;
      assert.fail("No authority request for unsupported whole plans");
    };
    const p = plan([{ action: volume }, { action: app, depends_on: [0] }]);
    assert.equal(f.api.supportsPlan(p), false);
    await assert.rejects(
      f.api.executePlan("fixture-user", p),
      /whole plan must be supported/,
    );
    assert.equal(requests, 0);
    assert.equal(f.calls(), 0);
  }
});
