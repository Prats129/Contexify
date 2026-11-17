const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const {
  fixture: deviceFixture,
} = require("./helpers/device_control_fixture.cjs");
const load = createTypeScriptLoader();
const core = load("packages/assistant-core/src/index.ts");
const id = "11111111-1111-4111-8111-111111111111";
const contextId = "33333333-3333-4333-8333-333333333333";
const reading = (changes) => ({
  protocol_version: 1,
  capability_id: "media_volume.set",
  context_id: contextId,
  min_index: 0,
  max_index: 100,
  current_index: 50,
  expires_in_ms: 30000,
  ...changes,
});
const answer = (changes) => ({
  capability_id: "media_volume.set",
  operation: "decrease",
  amount: 10,
  unit: "percentage_points",
  ...changes,
});
const signal = () => new AbortController().signal;
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("clarification needs an explicit target, operation, decimal amount and units", () => {
  for (const value of [
    answer({ capability_id: "contacts" }),
    answer({ operation: "a little" }),
    answer({ unit: "guess" }),
    answer({ amount: -1 }),
    answer({ amount: 0 }),
    answer({ amount: 1.5 }),
    answer({ confirmed: true }),
    answer({ operation: "set", unit: "percentage_points" }),
  ])
    assert.throws(() => core.validateClarification(value));
  for (const value of ["", "1.5", "0x10", "1e2", "-1", "1000"])
    assert.throws(() =>
      core.clarificationFromFields("media_volume.set", "set", value, "percent"),
    );
  assert.equal(
    core.clarificationFromFields("media_volume.set", "set", "0", "percent")
      .amount,
    0,
  );
  assert.throws(
    () =>
      core.clarificationFromFields("media_volume.set", "set", "90", "percent"),
    /0%.*70%/,
  );
  let invoked = false;
  assert.throws(() =>
    core.validateClarification(
      answer({
        operation: {
          toString() {
            invoked = true;
            return "set";
          },
        },
      }),
    ),
  );
  assert.equal(invoked, false);
});

test("an exact clarified target requires no state read or provider call", async () => {
  const result = await core.resolveClarification(
    answer({ operation: "set", amount: 40, unit: "percent" }),
    () => assert.fail("No local read for an absolute value"),
    false,
    signal(),
  );
  assert.equal(result.review.actions[0].percent, 40);
  assert.equal(result.review.contextId, undefined);
  assert.equal(Object.isFrozen(result.review.actions[0]), true);
});

test("relative resolution requires separate local-read consent and compatible device support", async () => {
  let reads = 0;
  await assert.rejects(
    core.resolveClarification(
      answer(),
      async () => {
        reads++;
        return reading();
      },
      false,
      signal(),
    ),
    /Allow the one/,
  );
  await assert.rejects(
    core.resolveClarification(answer(), undefined, true, signal()),
    /compatible Android/,
  );
  await assert.rejects(
    core.resolveClarification(
      answer({ capability_id: "brightness.set_app" }),
      async () => {
        reads++;
      },
      true,
      signal(),
    ),
    /exact percentage/,
  );
  assert.equal(reads, 0);
});

test("percentage points and percent of current volume resolve differently without guessing", async () => {
  const points = await core.resolveClarification(
    answer(),
    async () => reading({ current_index: 40 }),
    true,
    signal(),
  );
  const percent = await core.resolveClarification(
    answer({ unit: "percent" }),
    async () => reading({ current_index: 40 }),
    true,
    signal(),
  );
  assert.equal(points.review.actions[0].percent, 30);
  assert.equal(percent.review.actions[0].percent, 36);
  assert.equal(points.review.contextId, contextId);
  assert.match(percent.summary, /% of the current/);
  assert.ok(points.review.expiresAt <= Date.now() + 30000);
});

test("rounding and Android quantization are disclosed, never silently clamped", async () => {
  const result = await core.resolveClarification(
    answer(),
    async () => reading({ current_index: 7, max_index: 15 }),
    true,
    signal(),
  );
  assert.equal(result.review.actions[0].percent, 37);
  assert.match(result.summary, /step 7 of 15.*46.67%.*37%.*rounded/s);
  await assert.rejects(
    core.resolveClarification(
      answer({ operation: "increase", amount: 21 }),
      async () => reading({ current_index: 4949, max_index: 10000 }),
      true,
      signal(),
    ),
    /0–70%/,
  );
  await assert.rejects(
    core.resolveClarification(
      answer({ amount: 100, unit: "percent" }),
      async () => reading({ current_index: 5, min_index: 1 }),
      true,
      signal(),
    ),
    /volume steps/,
  );
  await assert.rejects(
    core.resolveClarification(
      answer({ amount: 1, unit: "percent" }),
      async () => reading({ current_index: 0 }),
      true,
      signal(),
    ),
    /volume steps/,
  );
});

test("malformed, extra, wrong-capability or nonfinite context fields never become a review", () => {
  for (const change of [
    { context_id: "forged" },
    { protocol_version: 2 },
    { capability_id: "brightness.set_app" },
    { current_index: -1 },
    { current_index: 101 },
    { max_index: 0 },
    { min_index: 51 },
    { expires_in_ms: 30001 },
    { max_index: Infinity },
    { current_index: 1.5 },
    { private: "marker" },
  ])
    assert.throws(() => core.validateVolumeContext(reading(change)));
  let invoked = false;
  const value = reading();
  Object.defineProperty(value, "current_index", {
    get() {
      invoked = true;
      return 50;
    },
  });
  assert.throws(() => core.validateVolumeContext(value));
  assert.equal(invoked, false);
});

test("local read deadline and parent cancellation suppress an uncooperative late context", async (t) => {
  const original = global.setTimeout;
  t.after(() => {
    global.setTimeout = original;
  });
  global.setTimeout = (callback, milliseconds, ...args) =>
    original(callback, milliseconds === 3000 ? 5 : milliseconds, ...args);
  const late = deferred();
  let readSignal;
  await assert.rejects(
    core.resolveClarification(
      answer(),
      (value) => {
        readSignal = value;
        return late.promise;
      },
      true,
      signal(),
    ),
    /stopped/,
  );
  assert.equal(readSignal.aborted, true);
  late.resolve(reading());
  await flush();
  const parent = new AbortController();
  const next = deferred();
  const pending = core.resolveClarification(
    answer(),
    async () => next.promise,
    true,
    parent.signal,
  );
  parent.abort();
  await assert.rejects(pending, /stopped/);
  next.resolve(reading());
});

async function sessionFixture(read = async () => reading()) {
  const requests = [];
  let reply = {
    mode: "proposal",
    status: "needs_clarification",
    reason: "relative_value",
  };
  const planner = core.createCommandPlanner(async () => ({
    userId: "fixture-user",
    deviceId: id,
    async request(path, body) {
      requests.push({ path, body });
      if (path === "/grants")
        return {
          grant_id: id,
          scope: "assistant:plan",
          consent_policy_version: 1,
          data_scope: "synthetic_evaluation",
          expires_at: Date.now() / 1000 + 300,
        };
      if (path.endsWith("/revoke")) return {};
      return {
        plan_id: id,
        revision: 1,
        owner_user_id: "fixture-user",
        owner_device_id: id,
        expires_at: Date.now() / 1000 + 60,
        execution: "not_authorized",
        proposal: reply,
      };
    },
  }));
  const adapter = {
    availability: async () => ({
      recognition: false,
      synthesis: false,
      message: "off",
    }),
    stop() {},
    cancel() {},
    listen: async () => "",
    speak: async () => {},
    dispose() {},
  };
  const session = core.createCommandSession(adapter, "android", planner, read);
  session.setPlanningConsent(true);
  session.setTranscript("make it quieter");
  await session.review();
  return {
    session,
    requests,
    reply: (value) => {
      reply = value;
    },
  };
}

test("clarification is question-bound, local-only, and preserves the native precondition", async () => {
  const f = await sessionFixture();
  const pending = f.session.getSnapshot().clarification;
  assert.equal(f.session.getSnapshot().reviewed, null);
  await f.session.clarify(answer(), true, pending.id + 1);
  assert.equal(f.session.getSnapshot().reviewed, null);
  await f.session.clarify(answer(), true, pending.id);
  assert.equal(
    f.requests.filter((value) => value.path === "/proposals").length,
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(f.requests),
    /current_index|context_id|33333333/,
  );
  assert.equal(f.session.takeReviewedPercent("media_volume.set"), null);
  assert.deepEqual(f.session.takeReviewedControl("media_volume.set"), {
    percent: 40,
    contextId,
  });
  assert.equal(f.session.takeReviewedControl("media_volume.set"), null);
  f.session.dispose();
});

test("edit, close, consent withdrawal and background clear suppress pending context replies", async () => {
  for (const operation of ["edit", "clear", "dispose", "consent"]) {
    const late = deferred();
    const f = await sessionFixture(() => late.promise);
    const pending = f.session.clarify(
      answer(),
      true,
      f.session.getSnapshot().clarification.id,
    );
    if (operation === "edit") f.session.setTranscript("new draft");
    else if (operation === "consent") f.session.setPlanningConsent(false);
    else f.session[operation]();
    late.resolve(reading());
    await pending;
    assert.equal(f.session.getSnapshot().reviewed, null);
    assert.equal(f.session.getSnapshot().clarification, null);
    f.session.dispose();
  }
});

test("expired questions and previous target references cannot silently authorize a change", async (t) => {
  const f = await sessionFixture();
  const clock = Date.now;
  t.after(() => {
    Date.now = clock;
    f.session.dispose();
  });
  const pending = f.session.getSnapshot().clarification;
  Date.now = () => pending.expiresAt;
  await f.session.clarify(answer(), true, pending.id);
  assert.equal(f.session.getSnapshot().reviewed, null);
  assert.match(f.session.getSnapshot().message, /expired/);
  Date.now = clock;
  f.session.setTranscript("set volume to 50%");
  f.session.setPlanningConsent(false);
  await f.session.review();
  f.session.setPlanningConsent(true);
  f.session.setTranscript("that one");
  await f.session.review();
  assert.equal(
    f.session.getSnapshot().clarification.previousTarget,
    "media_volume.set",
  );
  assert.equal(f.session.getSnapshot().reviewed, null);
  f.session.clear();
  f.session.setPlanningConsent(true);
  f.session.setTranscript("that one");
  await f.session.review();
  assert.equal(f.session.getSnapshot().clarification.previousTarget, null);
});

test("refusal, unsupported requests and non-actions never open a clarification form", async () => {
  const f = await sessionFixture();
  for (const [status, reason] of [
    ["refused", "policy_limit"],
    ["unsupported", "unsupported_request"],
    ["non_action", "not_a_command"],
  ]) {
    f.reply({ mode: "proposal", status, reason });
    f.session.setTranscript("new request");
    await f.session.review();
    assert.equal(f.session.getSnapshot().clarification, null);
  }
  f.session.dispose();
});

test("native read requires the new bridge and stays local without a server request", async (t) => {
  const f = deviceFixture(t, {
    native: {
      readVolumeContext: async (origin, user, installation) => {
        assert.equal(origin, f.binding.host);
        assert.equal(user, f.binding.userId);
        assert.equal(installation, f.binding.installationId);
        return reading();
      },
      executeVolumeFromContext: async () =>
        assert.fail("Read must not execute"),
    },
  });
  global.fetch = () => assert.fail("Local reads must not contact the backend");
  assert.deepEqual(
    await f.api.readVolumeContext(f.binding.userId, signal()),
    reading(),
  );
  assert.equal(f.calls(), 0);
  await assert.rejects(
    f.api.readVolumeContext("other-user", signal()),
    /binding differs/,
  );
  f.native.executeVolumeFromContext = undefined;
  await assert.rejects(
    f.api.readVolumeContext(f.binding.userId, signal()),
    /compatible/,
  );
});

test("conditional volume uses only the new native method and never falls back to an absolute write", async (t) => {
  let calls = 0;
  const f = deviceFixture(t, {
    native: {
      executeVolumeFromContext: async (
        origin,
        user,
        install,
        token,
        percent,
        key,
      ) => {
        calls++;
        assert.equal(origin, f.binding.host);
        assert.equal(user, f.binding.userId);
        assert.equal(install, f.binding.installationId);
        assert.equal(token, "fixture-management");
        assert.equal(key, contextId);
        assert.equal(percent, 40);
        return {
          outcome: "verified",
          requested_percent: 40,
          observed_percent: 40,
          receipt_recorded: true,
        };
      },
    },
  });
  await f.api.changeVolumeFromContext(f.binding.userId, 40, contextId);
  assert.equal(calls, 1);
  assert.equal(f.calls(), 0);
  f.native.executeVolumeFromContext = undefined;
  await assert.rejects(
    f.api.changeVolumeFromContext(f.binding.userId, 40, contextId),
    /compatible/,
  );
  assert.equal(f.calls(), 0);
});

test("account cancellation while reading prevents returning a stale native context", async (t) => {
  const late = deferred();
  const f = deviceFixture(t, {
    native: {
      readVolumeContext: () => late.promise,
      executeVolumeFromContext: async () => {},
    },
  });
  const pending = f.api.readVolumeContext(f.binding.userId, signal());
  await flush();
  f.api.cancel();
  late.resolve(reading());
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.calls(), 0);
});
