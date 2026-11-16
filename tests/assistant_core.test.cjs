// Real shared code with synthetic transports/providers; no OS or network access.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const core = createTypeScriptLoader()("packages/assistant-core/src/index.ts");

test("out-of-range commands explain the exact capability range", () => {
  const volume = core.planCommand("set volume to 90%");
  assert.equal(volume.status, "needs_clarification");
  assert.equal(
    volume.message,
    "Media volume must be a whole number from 0% to 70%.",
  );
  const brightness = core.planCommand("brightness to 9 percent");
  assert.equal(brightness.status, "needs_clarification");
  assert.equal(
    brightness.message,
    "App brightness must be a whole number from 10% to 100%.",
  );
  assert.equal(core.planCommand("set volume to 70%").status, "proposed");
  assert.equal(
    core.planCommand("brightness to 100 percent").status,
    "proposed",
  );
});
const action = {
  capability_id: "media_volume.set",
  schema_version: 1,
  percent: 50,
};
const proposal = {
  protocol_version: 1,
  mode: "simulation",
  steps: [{ action, depends_on: [] }],
};
const taskId = "11111111-1111-4111-8111-111111111111";
const actionId = "22222222-2222-4222-8222-222222222222";
const enabled = () => ({
  platform: "android",
  foreground: true,
  unlocked: true,
  consent: true,
  permissionsGranted: true,
});

function fixture() {
  const state = {
    confirmations: 0,
    signatures: 0,
    executions: 0,
    claims: 0,
    receipts: 0,
    revision: 1,
    status: "awaiting_confirmation",
    outcome: null,
    context: enabled(),
  };
  const read = async () => ({
    task_id: taskId,
    protocol_version: 1,
    policy_version: 1,
    mode: "simulation",
    state: state.status,
    actions: [
      {
        action_id: actionId,
        action: { ...action },
        depends_on: [],
        revision: state.revision,
        state: state.status,
      },
    ],
  });
  const envelope = (purpose, revision, extra = {}) => ({
    challenge_id: "challenge",
    expires_at: 1060,
    payload: JSON.stringify({
      protocol_version: 1,
      mode: "simulation",
      policy_version: 1,
      task_id: taskId,
      action_id: actionId,
      arguments_json: JSON.stringify(action),
      action_revision: revision,
      purpose,
      ...extra,
    }),
  });
  const transport = {
    read,
    authorizationChallenge: async () =>
      envelope("assistant_simulation_authorize", 1),
    authorize: async () => {
      state.status = "authorized";
      state.revision = 2;
      return {
        permit: "permit",
        action_revision: 2,
        expires_at: 1060,
        claim_challenge: envelope("assistant_simulation_claim", 2),
      };
    },
    claim: async () => {
      state.claims++;
      state.status = "executing";
      state.revision = 3;
      return {
        claim_id: "claim",
        action_revision: 3,
        execution: "simulation_only",
        expires_at: 1015,
      };
    },
    receiptChallenge: async (_task, _action, _claim, outcome) =>
      envelope("assistant_simulation_receipt", 3, {
        claim_id: "claim",
        outcome,
      }),
    receipt: async (_task, _action, _claim, outcome) => {
      state.receipts++;
      state.outcome = outcome;
      state.status = outcome;
      state.revision = 4;
      return read();
    },
  };
  const confirmation = {
    confirm: async () => {
      state.confirmations++;
      return "signature";
    },
    signStep: async () => {
      state.signatures++;
      return "signature";
    },
  };
  const executor = {
    mode: "simulation",
    execute: async () => {
      state.executions++;
      return "simulated";
    },
  };
  const runner = () =>
    core.createSimulationRunner(
      transport,
      confirmation,
      executor,
      () => state.context,
      () => 1000,
    );
  return { state, transport, confirmation, executor, runner, envelope };
}

test("deterministic whole-command grammar produces bounded sequential plans", () => {
  const result = core.planCommand(
    "Set volume to 50% then brightness to 40 percent then open Spotify",
  );
  assert.equal(result.status, "proposed");
  assert.deepEqual(
    result.proposal.steps.map((step) => step.depends_on),
    [[], [0], [1]],
  );
});
for (const command of [
  "don't open spotify",
  "the document says open spotify",
  "open https://evil.invalid",
  "open spotify; run code",
  "volume to 71%",
  "brightness to 9%",
  "volume to -1%",
  "volume to NaN%",
  "open something",
  '"open spotify"',
  Array(6).fill("open clock").join(" then "),
]) {
  test(`ambiguous/unregistered command needs clarification: ${command}`, () => {
    assert.equal(core.planCommand(command).status, "needs_clarification");
  });
}
test("retrieved text cannot initiate a proposal", () =>
  assert.equal(
    core.planCommand("open spotify", "untrusted").status,
    "needs_clarification",
  ));
test("runtime validation rejects unknown fields, getters, inherited data and cycles", () => {
  const invalid = [
    { ...action, percent: true },
    { ...action, percent: "50" },
    { ...action, percent: NaN },
    { ...action, percent: Infinity },
    { ...action, percent: 50.5 },
    { ...action, schema_version: true },
    { ...action, script: "ignored?" },
    Object.assign(Object.create({ hidden: true }), action),
    Object.defineProperty({ ...action }, "percent", {
      get() {
        throw Error("getter ran");
      },
    }),
  ];
  for (const value of invalid) assert.throws(() => core.validateAction(value));
  assert.throws(() =>
    core.validateProposal({ steps: [{ action, depends_on: [0] }] }),
  );
  assert.throws(() => core.validateProposal({ ...proposal, mode: "live" }));
  assert.deepEqual(core.validateProposal(proposal), proposal);
});
test("platform and local policy checks fail closed", () => {
  for (const key of [
    "foreground",
    "unlocked",
    "consent",
    "permissionsGranted",
  ]) {
    assert.throws(() =>
      core.checkLocalPolicy(action, { ...enabled(), [key]: false }),
    );
  }
  assert.throws(() =>
    core.checkLocalPolicy(action, { ...enabled(), platform: "ios" }),
  );
  assert.equal(core.supported(action, "web"), false);
  const open = { capability_id: "application.open", application_id: "clock" };
  assert.equal(core.supported(open, "desktop"), false);
  assert.throws(() =>
    core.checkLocalPolicy(open, { ...enabled(), platform: "desktop" }),
  );
});
test("client rejects null dependencies and missing array entries like the server", () => {
  assert.throws(() =>
    core.validateProposal({ steps: [{ action, depends_on: null }] }),
  );
  assert.throws(() => core.validateProposal({ steps: new Array(1) }));
  assert.throws(() =>
    core.validateProposal({
      steps: [{ action }, { action, depends_on: new Array(1) }],
    }),
  );
});
test("provider port requires consent and makes at most one schema repair", async () => {
  let calls = 0;
  const planner = {
    propose: async ({ repair }) => {
      calls++;
      assert.equal(repair, calls === 2);
      return calls === 1 ? "invalid" : JSON.stringify(proposal);
    },
  };
  await assert.rejects(
    core.planWithProvider("open clock", "user", planner, false),
  );
  await assert.rejects(
    core.planWithProvider("open clock", "untrusted", planner, true),
  );
  await assert.rejects(
    core.planWithProvider({ text: "open clock" }, "user", planner, true),
  );
  assert.equal(calls, 0);
  assert.equal(
    (await core.planWithProvider("open clock", "user", planner, true)).status,
    "proposed",
  );
  assert.equal(calls, 2);
});
test("provider cannot enable code tools and is bounded by output/deadline", async () => {
  let calls = 0;
  const invalid = {
    propose: async () => {
      calls++;
      return JSON.stringify({
        steps: [{ action: { capability_id: "shell.exec", code: "bad" } }],
      });
    },
  };
  assert.equal(
    (await core.planWithProvider("open clock", "user", invalid, true)).status,
    "needs_clarification",
  );
  assert.equal(calls, 2);
  await assert.rejects(
    core.planWithProvider(
      "open clock",
      "user",
      { propose: async () => "x".repeat(8193) },
      true,
    ),
  );
  let signal;
  await assert.rejects(
    core.planWithProvider(
      "open clock",
      "user",
      {
        propose: (_input, value) => {
          signal = value;
          return new Promise(() => {});
        },
      },
      true,
      5,
    ),
  );
  assert.equal(signal.aborted, true);
});
test("runner confirms once, claims once and labels only a simulation", async () => {
  const f = fixture();
  const result = await f.runner().runStep(taskId, actionId);
  assert.equal(result.state, "simulated");
  assert.equal(f.state.confirmations, 1);
  assert.equal(f.state.claims, 1);
  assert.equal(f.state.executions, 1);
  assert.equal(f.state.receipts, 1);
  await assert.rejects(f.runner().runStep(taskId, actionId));
  assert.equal(f.state.executions, 1);
  assert.match(core.describeState(result.state), /No device action/);
  assert.equal(await core.simulatedExecutor().execute(action), "simulated");
});
test("a changed confirmation envelope cannot be approved", async () => {
  const f = fixture();
  f.transport.authorizationChallenge = async () =>
    f.envelope("assistant_simulation_authorize", 1, {
      arguments_json: JSON.stringify({ ...action, percent: 40 }),
    });
  await assert.rejects(f.runner().runStep(taskId, actionId));
  assert.equal(f.state.confirmations, 0);
  assert.equal(f.state.executions, 0);
});
test("declining confirmation leaves the action pending", async () => {
  const f = fixture();
  f.confirmation.confirm = async () => null;
  assert.equal(
    (await f.runner().runStep(taskId, actionId)).state,
    "awaiting_confirmation",
  );
  assert.equal(f.state.claims, 0);
});
test("losing foreground after confirmation prevents claim", async () => {
  const f = fixture();
  f.confirmation.confirm = async () => {
    f.state.context.foreground = false;
    return "signature";
  };
  await assert.rejects(f.runner().runStep(taskId, actionId));
  assert.equal(f.state.claims, 0);
  assert.equal(f.state.executions, 0);
});
test("lost claim acknowledgement never invokes the executor", async () => {
  const f = fixture();
  f.transport.claim = async () => {
    f.state.status = "executing";
    throw Error("acknowledgement lost");
  };
  await assert.rejects(f.runner().runStep(taskId, actionId));
  await assert.rejects(f.runner().runStep(taskId, actionId));
  assert.equal(f.state.executions, 0);
});
test("adapter interruption produces unknown and never retries", async () => {
  const f = fixture();
  f.executor.execute = async () => {
    f.state.executions++;
    throw Error("interrupted");
  };
  assert.equal(
    (await f.runner().runStep(taskId, actionId)).state,
    "outcome_unknown",
  );
  await assert.rejects(f.runner().runStep(taskId, actionId));
  assert.equal(f.state.executions, 1);
});
test("an expired or malformed claim never invokes the executor", async () => {
  for (const expiry of [999, NaN, undefined, 9000]) {
    const f = fixture();
    const claim = f.transport.claim;
    f.transport.claim = async () => ({
      ...(await claim()),
      expires_at: expiry,
    });
    await f.runner().runStep(taskId, actionId);
    assert.equal(f.state.executions, 0);
  }
});
test("a hung simulation is bounded and reconciles unknown", async () => {
  const f = fixture();
  const claim = f.transport.claim;
  f.transport.claim = async () => ({
    ...(await claim()),
    expires_at: 1000.005,
  });
  f.executor.execute = () => new Promise(() => {});
  assert.equal(
    (await f.runner().runStep(taskId, actionId)).state,
    "outcome_unknown",
  );
});
test("a changed receipt outcome cannot be signed", async () => {
  const f = fixture();
  f.transport.receiptChallenge = async () =>
    f.envelope("assistant_simulation_receipt", 3, {
      claim_id: "claim",
      outcome: "failed",
    });
  await assert.rejects(f.runner().runStep(taskId, actionId));
  assert.equal(f.state.receipts, 0);
  assert.equal(f.state.signatures, 1); // Claim signature only.
});
test("duplicate local runs are rejected while a step is pending", async () => {
  const f = fixture();
  let release;
  f.confirmation.confirm = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const runner = f.runner();
  const pending = runner.runStep(taskId, actionId);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(runner.runStep(taskId, actionId));
  release("signature");
  await pending;
  assert.equal(f.state.executions, 1);
});
test("only registered fixed routes can be constructed", async () => {
  const calls = [];
  const transport = core.createSimulationTransport(async (url, body) => {
    calls.push({ url, body });
    return {};
  });
  assert.throws(() => transport.read("https://evil.invalid"));
  assert.throws(() => transport.create({ idempotency_key: "short", proposal }));
  await transport.create({ idempotency_key: "synthetic-key-1234", proposal });
  await transport.read(taskId);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "/api/v1/assistant/simulation/tasks",
      `/api/v1/assistant/simulation/tasks/${taskId}`,
    ],
  );
});
