// Real command-session/planning/security modules, injected HTTP and native ports only.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const {
  fixture: deviceFixture,
} = require("./helpers/device_control_fixture.cjs");
const load = createTypeScriptLoader();
const core = load("packages/assistant-core/src/index.ts");
const id = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const context = { userId: "fixture-user", deviceId };
const action = {
  capability_id: "media_volume.set",
  schema_version: 1,
  percent: 50,
};
const proposal = (steps) => ({
  protocol_version: 1,
  mode: "proposal",
  status: "proposed",
  steps,
});
const response = (changes = {}) => ({
  plan_id: id,
  revision: 1,
  owner_user_id: context.userId,
  owner_device_id: deviceId,
  expires_at: Date.now() / 1000 + 60,
  execution: "not_authorized",
  proposal: proposal([{ action }]),
  ...changes,
});
const grant = () => ({
  grant_id: id,
  scope: "assistant:plan",
  consent_policy_version: 1,
  data_scope: "synthetic_evaluation",
  expires_at: Date.now() / 1000 + 120,
});
const jsonResponse = (value, status = 200) => ({
  ok: status === 200,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(value),
});
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const adapter = () => ({
  availability: async () => ({
    recognition: true,
    synthesis: false,
    message: "Local",
  }),
  listen: async () => "put my media sound halfway",
  stop() {},
  cancel() {},
  speak: async () => {},
  dispose() {},
});
function fixture(reply = async () => response(), platform = "android") {
  const calls = [];
  const planner = core.createCommandPlanner(async () => ({
    ...context,
    async request(path, body, signal) {
      calls.push({ path, body, signal });
      if (path === "/grants") return grant();
      if (path.endsWith("/revoke")) return {};
      return reply(body, signal);
    },
  }));
  const session = core.createCommandSession(adapter(), platform, planner);
  return { session, planner, calls };
}

test("strict wire validation rejects wrong owners, expired plans and injected authority", () => {
  for (const patch of [
    { owner_user_id: "another-user" },
    { owner_device_id: null },
    { revision: 2 },
    { expires_at: 0 },
    { expires_at: Infinity },
    { expires_at: Date.now() / 1000 + 500 },
    { execution: "verified" },
    { confirmed: true },
    { plan_id: "arbitrary" },
    { proposal: { ...proposal([{ action }]), permit: "untrusted" } },
    { proposal: { ...proposal([{ action }]), mode: "simulation" } },
    { proposal: proposal([{ action: { ...action, percent: 90 } }]) },
    { proposal: proposal([{ action, depends_on: [0] }]) },
  ])
    assert.throws(() =>
      core.validatePlanningResponse(response(patch), context),
    );
  assert.throws(() =>
    core.validatePlanningResponse(response(), {
      ...context,
      deviceId: "other-device",
    }),
  );
  assert.equal(
    core.validatePlanningResponse(response(), context).proposal.steps[0].action
      .percent,
    50,
  );
});

test("feedback uses fixed text and cannot render model prose or invented reason codes", () => {
  const feedback = {
    mode: "proposal",
    status: "refused",
    reason: "model_refusal",
  };
  assert.match(
    core.planningFeedback(
      core.validatePlanningResponse(response({ proposal: feedback }), context)
        .proposal,
    ),
    /declined/,
  );
  for (const item of [
    { ...feedback, reason: "__proto__" },
    { ...feedback, message: "synthetic-private-marker" },
  ])
    assert.throws(() =>
      core.validatePlanningResponse(response({ proposal: item }), context),
    );
});

test("planning requires separate explicit consent and never falls back after a cloud failure", async () => {
  const f = fixture(async () => {
    throw Error("synthetic-private-marker");
  });
  f.session.setTranscript("put my media sound halfway");
  await f.session.review();
  assert.equal(f.calls.length, 0);
  assert.equal(f.session.getSnapshot().reviewed, null);
  f.session.setPlanningConsent(true);
  f.session.setTranscript("set volume to 50%");
  await f.session.review();
  assert.equal(f.session.getSnapshot().reviewed, null); // No grammar fallback.
  assert.doesNotMatch(
    f.session.getSnapshot().message,
    /synthetic-private-marker/,
  );
  f.session.dispose();
});

test("a paraphrase exposes its stable reviewed plan once without reparsing or a legacy downgrade", async () => {
  const f = fixture();
  f.session.setPlanningConsent(true);
  f.session.setTranscript("put my media sound halfway");
  await f.session.review();
  const review = f.session.getSnapshot().reviewed;
  assert.equal(Object.isFrozen(review), true);
  assert.equal(Object.isFrozen(review.actions[0]), true);
  assert.equal(
    f.session.getSnapshot().preview[0].description,
    "Set media volume to 50%.",
  );
  assert.equal(f.session.takeReviewedPercent("media_volume.set"), null);
  const plan = f.session.takeReviewedPlan();
  assert.equal(plan.plan_id, id);
  assert.equal(plan.steps[0].action.percent, 50);
  assert.equal(f.session.takeReviewedPlan(), null);
  assert.equal(f.calls[1].body.text, "put my media sound halfway");
  assert.equal(Object.hasOwn(f.calls[1].body, "synthetic_case_id"), false);
  f.session.dispose();
});

test("a multi-step plan never executes just its first supported action", async () => {
  const f = fixture(async () =>
    response({
      proposal: proposal([
        { action },
        {
          action: {
            capability_id: "application.open",
            application_id: "spotify",
          },
          depends_on: [0],
        },
      ]),
    }),
  );
  f.session.setPlanningConsent(true);
  f.session.setTranscript("set volume halfway and open Spotify");
  await f.session.review();
  assert.equal(f.session.getSnapshot().preview.length, 2);
  assert.equal(f.session.takeReviewedPercent("media_volume.set"), null);
  assert.match(f.session.getSnapshot().message, /No part/);
  f.session.dispose();
});

test("dynamic brightness requires the v2 plan while the existing local brightness path is preserved", async () => {
  const f = fixture(async () =>
    response({
      proposal: proposal([
        { action: { capability_id: "brightness.set_app", percent: 40 } },
      ]),
    }),
  );
  f.session.setPlanningConsent(true);
  f.session.setTranscript("make this window a little dimmer");
  await f.session.review();
  assert.equal(f.session.takeReviewedPercent("brightness.set_app"), null);
  assert.equal(
    f.session.takeReviewedPlan().steps[0].action.capability_id,
    "brightness.set_app",
  );
  f.session.setPlanningConsent(false);
  f.session.setTranscript("brightness to 40%");
  await f.session.review();
  assert.equal(f.session.takeReviewedPercent("brightness.set_app"), 40);
  f.session.dispose();
});

test("browser plans cannot be presented as available phone actions", async () => {
  const f = fixture(undefined, "web");
  f.session.setPlanningConsent(true);
  f.session.setTranscript("put my media sound halfway");
  await f.session.review();
  assert.equal(f.session.getSnapshot().preview[0].availableOnPlatform, false);
  assert.equal(f.session.takeReviewedPercent("media_volume.set"), null);
  f.session.dispose();
});

test("expired review and manual edits invalidate action selection", async () => {
  const f = fixture();
  f.session.setPlanningConsent(true);
  f.session.setTranscript("put my media sound halfway");
  await f.session.review();
  const review = f.session.getSnapshot().reviewed;
  assert.equal(
    core.reviewedPercent({ ...review, expiresAt: 0 }, "media_volume.set"),
    null,
  );
  f.session.setTranscript("another command");
  assert.equal(f.session.takeReviewedPercent("media_volume.set"), null);
  assert.equal(f.session.getSnapshot().preview, null);
  f.session.dispose();
});

test("edit, clear, close and consent withdrawal reject late replies and abort HTTP work", async () => {
  for (const operation of ["edit", "clear", "dispose", "consent"]) {
    const late = deferred();
    const f = fixture(() => late.promise);
    f.session.setPlanningConsent(true);
    f.session.setTranscript("put my media sound halfway");
    const pending = f.session.review();
    await flush();
    const signal = f.calls.find((call) => call.path === "/proposals").signal;
    if (operation === "edit") f.session.setTranscript("new draft");
    else if (operation === "consent") f.session.setPlanningConsent(false);
    else f.session[operation]();
    assert.equal(signal.aborted, true);
    late.resolve(response());
    await pending;
    assert.equal(f.session.getSnapshot().reviewed, null);
    assert.equal(f.session.getSnapshot().preview, null);
    f.session.dispose();
  }
});

test("duplicate reviews make one proposal request and grants are reused until consent ends", async () => {
  const late = deferred();
  let reply = () => late.promise;
  const f = fixture((...args) => reply(...args));
  f.session.setPlanningConsent(true);
  f.session.setTranscript("put my media sound halfway");
  const first = f.session.review();
  await flush();
  await f.session.review();
  assert.equal(f.calls.filter((call) => call.path === "/proposals").length, 1);
  late.resolve(response());
  await first;
  reply = async () => response();
  f.session.setTranscript("put my media sound halfway again");
  await f.session.review();
  assert.equal(f.calls.filter((call) => call.path === "/grants").length, 1);
  f.session.setPlanningConsent(false);
  await flush();
  assert.equal(
    f.calls.filter((call) => call.path.endsWith("/revoke")).length,
    1,
  );
  f.session.dispose();
});

test("approved microphone consent alone does not send transcripts; planning opt-in does", async () => {
  const f = fixture();
  await f.session.refreshAvailability();
  f.session.setConsent(true);
  await f.session.listen();
  assert.equal(f.calls.length, 0);
  f.session.setPlanningConsent(true);
  await f.session.listen();
  assert.equal(f.calls.filter((call) => call.path === "/proposals").length, 1);
  assert.equal(f.session.takeReviewedPlan().steps[0].action.percent, 50);
  f.session.clear();
  assert.equal(f.session.getSnapshot().planningConsent, false);
  assert.equal(f.session.getSnapshot().consent, false);
  f.session.dispose();
});

test("an edited request reuses consent and a late old response cannot replace the newer review", async () => {
  const late = deferred();
  let request = 0;
  const f = fixture(async () => (++request === 1 ? late.promise : response()));
  f.session.setPlanningConsent(true);
  f.session.setTranscript("old draft");
  const first = f.session.review();
  await flush();
  f.session.setTranscript("new draft");
  await first;
  await f.session.review();
  const current = f.session.getSnapshot().reviewed;
  late.resolve(
    response({ proposal: proposal([{ action: { ...action, percent: 40 } }]) }),
  );
  await flush();
  assert.equal(f.session.getSnapshot().reviewed, current);
  assert.equal(f.session.takeReviewedPlan().steps[0].action.percent, 50);
  assert.equal(f.calls.filter((call) => call.path === "/grants").length, 1);
  f.session.dispose();
});

test("the client deadline also covers a stalled proposal body and closes its signal", async (t) => {
  const original = global.setTimeout;
  t.after(() => {
    global.setTimeout = original;
  });
  global.setTimeout = (callback, milliseconds, ...args) =>
    original(callback, milliseconds === 35000 ? 5 : milliseconds, ...args);
  const late = deferred();
  const f = fixture(() => late.promise);
  f.session.setPlanningConsent(true);
  f.session.setTranscript("put my media sound halfway");
  await f.session.review();
  assert.match(f.session.getSnapshot().message, /timed out/);
  assert.equal(
    f.calls.find((call) => call.path === "/proposals").signal.aborted,
    true,
  );
  late.resolve(response());
  await flush();
  assert.equal(f.session.getSnapshot().reviewed, null);
  f.session.dispose();
});

test("the 35-second client deadline covers stalled connection and cannot publish late state", async (t) => {
  const original = global.setTimeout;
  t.after(() => {
    global.setTimeout = original;
  });
  const late = deferred();
  global.setTimeout = (callback, milliseconds, ...args) => {
    assert.equal(milliseconds, 35000);
    return original(callback, 5, ...args);
  };
  let signal;
  const planner = core.createCommandPlanner((value) => {
    signal = value;
    return late.promise;
  });
  await assert.rejects(
    planner.plan("put my media sound halfway", new AbortController().signal),
    /timed out/,
  );
  assert.equal(signal.aborted, true);
  late.resolve({
    ...context,
    request: () => assert.fail("Late connection must not create a grant"),
  });
  await flush();
  planner.close();
});

test("planning HTTP maps errors without reading private error bodies or retrying", async (t) => {
  const previous = global.fetch;
  t.after(() => {
    global.fetch = previous;
  });
  for (const status of [401, 403, 404, 429, 502, 503, 504]) {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return {
        status,
        ok: false,
        text: () => assert.fail("Do not read private error bodies"),
      };
    };
    await assert.rejects(
      core.planningJson(
        "https://api.fixture.invalid",
        {},
        new AbortController().signal,
      ),
      (error) => !error.message.includes("synthetic-private-marker"),
    );
    assert.equal(calls, 1);
  }
  global.fetch = async () => jsonResponse({ oversized: "x".repeat(16384) });
  await assert.rejects(
    core.planningJson(
      "https://api.fixture.invalid",
      {},
      new AbortController().signal,
    ),
    /exceeded/,
  );
  assert.throws(() => core.planningPath("https://evil.fixture.invalid"));
});

test("native planning sends only management authority and never calls an executor", async (t) => {
  const f = deviceFixture(t);
  const oldFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    if (url.includes("/planning/")) {
      calls.push({ url, options });
      return jsonResponse(grant());
    }
    return oldFetch(url, options);
  };
  const connection = await f.api.planningContext(
    f.binding.userId,
    new AbortController().signal,
  );
  assert.equal(connection.deviceId, f.binding.deviceId);
  await connection.request(
    "/grants",
    { consent: true },
    new AbortController().signal,
  );
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer fixture-management",
  );
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(f.calls(), 0);
  f.api.cancel();
  await assert.rejects(
    connection.request("/proposals", {}, new AbortController().signal),
    /sign-in changed/,
  );
  assert.equal(calls.length, 1);
  await connection.request(
    `/grants/${id}/revoke`,
    {},
    new AbortController().signal,
  );
  assert.equal(calls.length, 2); // Cancellation permits withdrawal, never new planning.
});

test("native cancels planning when the account/host context changes or the HTTP body is late", async (t) => {
  let host = "https://api.fixture.invalid";
  let account = "fixture-parent";
  const f = deviceFixture(t, {
    getHost: async () => host,
    authHeaders: async () => ({ Authorization: "Bearer " + account }),
  });
  const connection = await f.api.planningContext(
    f.binding.userId,
    new AbortController().signal,
  );
  host = "https://other.fixture.invalid";
  await assert.rejects(
    connection.request("/grants", {}, new AbortController().signal),
    /sign-in changed/,
  );
  host = f.binding.host;
  account = "another-parent";
  await assert.rejects(
    connection.request("/grants", {}, new AbortController().signal),
    /sign-in changed/,
  );
  account = "fixture-parent";
  const body = deferred();
  global.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    text: () => body.promise,
  });
  const pending = connection.request(
    "/grants",
    {},
    new AbortController().signal,
  );
  await flush();
  f.api.cancel();
  body.resolve(JSON.stringify(grant()));
  await assert.rejects(pending, /cancelled|changed/);
  assert.equal(f.calls(), 0);
});

test("web planning keeps cookie/CSRF authority separate from bootstrap bearer and rejects account changes", async (t) => {
  const previous = {
    fetch: global.fetch,
    window: global.window,
    crypto: global.crypto,
  };
  t.after(() => {
    global.fetch = previous.fetch;
    global.window = previous.window;
    Object.defineProperty(global, "crypto", {
      value: previous.crypto,
      configurable: true,
    });
  });
  global.window = { location: { origin: "https://web.fixture.invalid" } };
  Object.defineProperty(global, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  let account = "fixture-parent";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(
      url.endsWith("/web-session")
        ? { csrf_token: "fixture-csrf", expires_at: Date.now() / 1000 + 120 }
        : grant(),
    );
  };
  const security = load(
    "frontend/src/services/assistant_security.ts",
  ).createAssistantWebSecurity(
    async () => "",
    async () => ({ Authorization: "Bearer " + account }),
  );
  const connection = await security.planningContext(
    "fixture-user",
    new AbortController().signal,
  );
  await connection.request("/grants", {}, new AbortController().signal);
  assert.equal(calls[0].options.headers.Authorization, "Bearer fixture-parent");
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers["X-CSRF-Token"], "fixture-csrf");
  assert.equal(calls[1].options.credentials, "include");
  assert.equal(connection.deviceId, null);
  account = "another-parent";
  await assert.rejects(
    connection.request("/proposals", {}, new AbortController().signal),
    /sign-in changed/,
  );
  assert.equal(calls.length, 2);
});
