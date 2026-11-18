const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assistantUI } = require("./helpers/assistant_ui_fixture.cjs");
const userId = "fixture-user",
  deviceId = "22222222-2222-4222-8222-222222222222";
const grantId = "11111111-1111-4111-8111-111111111111";
const draft = (
  device = deviceId,
  steps = [{ action: { capability_id: "media_volume.set", percent: 50 } }],
) => ({
  plan_id: grantId,
  revision: 1,
  owner_user_id: userId,
  owner_device_id: device,
  expires_at: Date.now() / 1000 + 60,
  execution: "not_authorized",
  proposal: {
    protocol_version: 1,
    mode: "proposal",
    status: "proposed",
    steps,
  },
});
function setup(
  t,
  platform = "android",
  reply = async () => draft(),
  overrides = {},
) {
  const old = process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "true";
  t.after(() => {
    if (old === undefined)
      delete process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
    else process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = old;
  });
  const calls = [],
    plans = [],
    requests = [];
  const controls = {
    async planningContext() {
      return {
        userId,
        deviceId: platform === "android" ? deviceId : null,
        async request(path, body, signal) {
          requests.push({ path, body, signal });
          if (path === "/grants")
            return {
              grant_id: grantId,
              scope: "assistant:plan",
              consent_policy_version: 1,
              data_scope: "synthetic_evaluation",
              expires_at: Date.now() / 1000 + 120,
            };
          if (path.endsWith("/revoke")) return {};
          return reply();
        },
      };
    },
    enableVolume: async () => {},
    async executePlan(user, plan) {
      plans.push({ user, plan });
      return {
        protocol_version: 2,
        plan_id: plan.plan_id,
        plan_revision: plan.plan_revision,
        revision: 1 + 2 * plan.steps.length,
        steps: plan.steps.map((step) => ({
          step_id: step.step_id,
          capability_id: step.action.capability_id,
          state: "verified",
          result: {
            outcome: "verified",
            requested_percent: step.action.percent,
            observed_percent:
              step.action.capability_id === "media_volume.set"
                ? Math.max(0, step.action.percent - 4)
                : step.action.percent,
            receipt_recorded: true,
          },
        })),
      };
    },
    reconcilePlans: async () => [],
    async changeVolume(user, percent) {
      calls.push({ user, percent });
      return {
        outcome: "verified",
        requested_percent: percent,
        observed_percent: 46,
        receipt_recorded: true,
      };
    },
    cancel() {},
  };
  Object.assign(controls, overrides);
  const ui = assistantUI(platform, {
    onClose() {},
    voiceAllowed: true,
    theme: {},
    volumeUserId: userId,
    volumeControls: controls,
    planningUserId: userId,
    planningAccess: controls,
  });
  t.after(() => ui.unmount());
  function send() {
    if (platform === "android") {
      ui.find("TouchableOpacity", "Allow AI planning").props.onPress();
      ui.render();
      ui.find("TextInput").props.onChangeText("put my media sound halfway");
      ui.render();
      ui.find("TouchableOpacity", "Send command").props.onPress();
    } else {
      ui.find("input").props.onChange({ target: { checked: true } });
      ui.render();
      ui.find("textarea").props.onChange({
        target: { value: "put my media sound halfway" },
      });
      ui.render();
      ui.find("button", "Send command").props.onClick();
    }
  }
  return { ui, send, calls, plans, requests };
}

test("Android Send command requests the exact native volume confirmation without a second JS button", async (t) => {
  const f = setup(t);
  f.send();
  await f.ui.flush();
  assert.equal(f.plans.length, 1);
  assert.equal(f.plans[0].user, userId);
  assert.equal(f.plans[0].plan.plan_id, grantId);
  assert.equal(f.plans[0].plan.steps[0].action.percent, 50);
  assert.equal(f.calls.length, 0); // No legacy dispatch.
  assert.equal(
    f.ui.find("TouchableOpacity", "Confirm volume change"),
    undefined,
  );
  assert.match(f.ui.text(), /Step 1: media volume verified at 46%/);
  await f.ui.flush();
  assert.equal(f.plans.length, 1);
});

test("a compound Android plan stays a preview and does not reach native confirmation", async (t) => {
  const f = setup(t, "android", async () =>
    draft(deviceId, [
      { action: { capability_id: "media_volume.set", percent: 50 } },
      {
        action: {
          capability_id: "application.open",
          application_id: "spotify",
        },
        depends_on: [0],
      },
    ]),
  );
  f.send();
  await f.ui.flush();
  assert.equal(f.calls.length, 0);
  assert.equal(f.plans.length, 0);
  assert.match(f.ui.text(), /No part of this plan/);
});

test("a fully supported settings graph reaches the v2 coordinator once with dependencies intact", async (t) => {
  const f = setup(t, "android", async () =>
    draft(deviceId, [
      { action: { capability_id: "media_volume.set", percent: 50 } },
      {
        action: { capability_id: "brightness.set_app", percent: 40 },
        depends_on: [0],
      },
    ]),
  );
  f.send();
  await f.ui.flush();
  assert.equal(f.plans.length, 1);
  assert.deepEqual(f.plans[0].plan.steps[1].depends_on, [0]);
  assert.equal(f.calls.length, 0);
  assert.match(f.ui.text(), /Step 2: Contexify brightness verified at 40%/);
  await f.ui.flush();
  assert.equal(f.plans.length, 1);
});

test("missing v2 support gives visible build guidance without falling back to legacy execution", async (t) => {
  const f = setup(t, "android", undefined, { executePlan: undefined });
  f.send();
  await f.ui.flush();
  assert.equal(f.plans.length, 0);
  assert.equal(f.calls.length, 0);
  assert.match(f.ui.text(), /compatible Android build/);
});

test("previous-action checks show historical uncertainty and do not dispatch effects", async (t) => {
  let reads = 0;
  const f = setup(t, "android", undefined, {
    reconcilePlans: async () => {
      reads++;
      return [
        {
          protocol_version: 2,
          plan_id: grantId,
          plan_revision: 1,
          revision: 2,
          steps: [
            {
              step_id: 0,
              capability_id: "media_volume.set",
              state: "outcome_unknown",
              result: null,
            },
          ],
        },
      ];
    },
  });
  f.ui.find("TouchableOpacity", "Check previous actions").props.onPress();
  await f.ui.flush();
  assert.match(f.ui.text(), /Recorded results, not current device readings/);
  assert.match(f.ui.text(), /outcome unknown/);
  assert.equal(reads, 1);
  assert.equal(f.plans.length, 0);
  assert.equal(f.calls.length, 0);
});

test("background cancels a v2 result and returning does not replay the plan", async (t) => {
  let finish;
  const f = setup(t, "android", undefined, {
    executePlan: async (_user, plan) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            protocol_version: 2,
            plan_id: plan.plan_id,
            plan_revision: 1,
            revision: 2,
            steps: [
              {
                step_id: 0,
                capability_id: "media_volume.set",
                state: "outcome_unknown",
                result: null,
              },
            ],
          });
      }),
  });
  f.send();
  await f.ui.flush();
  f.ui.emit("change", "background");
  finish();
  await f.ui.flush();
  f.ui.emit("change", "active");
  await f.ui.flush();
  assert.doesNotMatch(f.ui.text(), /Step 1: media volume outcome unknown/);
  assert.equal(f.calls.length, 0);
});

test("90% returned by a faulty planner produces visible error feedback with no control call", async (t) => {
  const f = setup(t, "android", async () =>
    draft(deviceId, [
      { action: { capability_id: "media_volume.set", percent: 90 } },
    ]),
  );
  f.send();
  await f.ui.flush();
  assert.equal(f.calls.length, 0);
  assert.match(f.ui.text(), /unavailable/);
});

test("policy-limit feedback explains the permitted range without reaching native execution", async (t) => {
  const f = setup(t, "android", async () => ({
    ...draft(),
    proposal: { mode: "proposal", status: "refused", reason: "policy_limit" },
  }));
  f.send();
  await f.ui.flush();
  assert.equal(f.calls.length, 0);
  assert.match(f.ui.text(), /Media volume allows 0–70%/);
});

test("guest mode exposes only local review and cannot create cloud consent", async (t) => {
  const f = setup(t);
  f.ui.render({ volumeUserId: undefined });
  assert.equal(f.ui.find("TouchableOpacity", "Allow AI planning"), undefined);
  assert.equal(f.ui.find("TouchableOpacity", "Send command"), undefined);
  assert.equal(f.requests.length, 0);
});

test("backgrounding clears AI consent and cancels a late Android plan without replay on resume", async (t) => {
  let resolve;
  const f = setup(
    t,
    "android",
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  f.send();
  await f.ui.flush();
  f.ui.emit("change", "background");
  assert.equal(
    f.requests.find((item) => item.path === "/proposals").signal.aborted,
    true,
  );
  resolve(draft());
  await f.ui.flush();
  f.ui.emit("change", "active");
  assert.equal(f.calls.length, 0);
  assert.equal(f.ui.find("TextInput").props.value, "");
  assert.equal(
    f.ui.find("TouchableOpacity", "Allow AI planning").props.accessibilityState
      .checked,
    false,
  );
});

test("closing the Android screen rejects a response that ignores cancellation", async (t) => {
  let resolve;
  const f = setup(
    t,
    "android",
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  f.send();
  await f.ui.flush();
  f.ui.find("TouchableOpacity", "Close").props.onPress();
  resolve(draft());
  await new Promise((yes) => setImmediate(yes));
  assert.equal(f.calls.length, 0);
  assert.equal(
    f.requests.find((item) => item.path === "/proposals").signal.aborted,
    true,
  );
});

test("editing during planning aborts the old request and preserves the new draft", async (t) => {
  let resolve;
  const f = setup(
    t,
    "android",
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  f.send();
  await f.ui.flush();
  assert.equal(f.ui.find("TextInput").props.editable, true);
  f.ui.find("TextInput").props.onChangeText("new draft");
  f.ui.render();
  assert.equal(
    f.requests.find((item) => item.path === "/proposals").signal.aborted,
    true,
  );
  resolve(draft());
  await f.ui.flush();
  assert.equal(f.calls.length, 0);
  assert.equal(f.ui.find("TextInput").props.value, "new draft");
});

test("browser shows the dynamic plan without a device effect and clears it on blur", async (t) => {
  const f = setup(t, "web", async () => draft(null));
  f.send();
  await f.ui.flush();
  assert.match(f.ui.text(), /Set media volume to 50%/);
  assert.match(f.ui.text(), /Device control is unavailable in this browser/);
  assert.equal(f.calls.length, 0);
  f.ui.emit("blur");
  assert.equal(f.ui.find("textarea").props.value, "");
  assert.equal(f.ui.find("input").props.checked, false);
});

const localContextId = "33333333-3333-4333-8333-333333333333";
const localReading = () => ({
  protocol_version: 1,
  capability_id: "media_volume.set",
  context_id: localContextId,
  min_index: 0,
  max_index: 100,
  current_index: 50,
  expires_in_ms: 30000,
});
const clarificationReply = (device) => ({
  ...draft(device),
  proposal: {
    mode: "proposal",
    status: "needs_clarification",
    reason: "relative_value",
  },
});
function chooseRelative(f, amount = "10") {
  f.ui.find("TouchableOpacity", "Media volume").props.onPress();
  f.ui.render();
  f.ui.find("TouchableOpacity", "Decrease by").props.onPress();
  f.ui.render();
  f.ui.find("TextInput", "Clarification amount").props.onChangeText(amount);
  f.ui.render();
  f.ui.find("TouchableOpacity", "Percentage points").props.onPress();
  f.ui.render();
}

test("clarification asks for explicit fields and local-read consent before a conditional native change", async (t) => {
  const conditional = [];
  let reads = 0;
  const f = setup(t, "android", async () => clarificationReply(deviceId), {
    readVolumeContext: async () => {
      reads++;
      return localReading();
    },
    executePlan: async (user, plan) => {
      const percent = plan.steps[0].action.percent;
      conditional.push({ user, percent, context: plan.context_id });
      return {
        protocol_version: 2,
        plan_id: plan.plan_id,
        plan_revision: 2,
        revision: 3,
        steps: [
          {
            step_id: 0,
            capability_id: "media_volume.set",
            state: "verified",
            result: {
              outcome: "verified",
              requested_percent: percent,
              observed_percent: percent,
              receipt_recorded: true,
            },
          },
        ],
      };
    },
  });
  f.send();
  await f.ui.flush();
  assert.match(f.ui.text(), /Clarify your command/);
  f.ui.find("TouchableOpacity", "Review clarified command").props.onPress();
  f.ui.render();
  assert.match(f.ui.text(), /whole-number/);
  assert.equal(reads, 0);
  chooseRelative(f);
  f.ui.find("TouchableOpacity", "Review clarified command").props.onPress();
  await f.ui.flush();
  assert.match(f.ui.text(), /Allow the one local/);
  assert.equal(reads, 0);
  f.ui.find("TouchableOpacity", "Allow one local").props.onPress();
  f.ui.render();
  f.ui.find("TouchableOpacity", "Review clarified command").props.onPress();
  await f.ui.flush();
  assert.equal(reads, 1);
  assert.deepEqual(conditional, [
    { user: userId, percent: 40, context: localContextId },
  ]);
  assert.equal(f.calls.length, 0); // The legacy absolute bridge is not substituted.
  assert.match(f.ui.text(), /Current media volume: step 50 of 100/);
  assert.equal(
    f.requests.filter((value) => value.path === "/proposals").length,
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(f.requests.map((value) => value.body)),
    /current_index|context_id/,
  );
});

test("out-of-range clarification is visible and neither clamped nor executed", async (t) => {
  let reads = 0;
  const f = setup(t, "android", async () => clarificationReply(deviceId), {
    readVolumeContext: async () => {
      reads++;
      return localReading();
    },
    changeVolumeFromContext: async () => assert.fail("No effect"),
  });
  f.send();
  await f.ui.flush();
  chooseRelative(f, "60");
  f.ui.find("TouchableOpacity", "Allow one local").props.onPress();
  f.ui.render();
  f.ui.find("TouchableOpacity", "Review clarified command").props.onPress();
  await f.ui.flush();
  assert.match(f.ui.text(), /0–70% media-volume limit/);
  assert.equal(f.calls.length, 0);
  assert.equal(reads, 1);
  assert.equal(
    f.ui.find("TouchableOpacity", "Allow one local").props.accessibilityState
      .checked,
    false,
  );
});

test("cancelled clarification discards a late local reading before native execution", async (t) => {
  let resolve;
  const f = setup(t, "android", async () => clarificationReply(deviceId), {
    readVolumeContext: () =>
      new Promise((yes) => {
        resolve = yes;
      }),
    changeVolumeFromContext: async () => assert.fail("No effect"),
  });
  f.send();
  await f.ui.flush();
  chooseRelative(f);
  f.ui.find("TouchableOpacity", "Allow one local").props.onPress();
  f.ui.render();
  f.ui.find("TouchableOpacity", "Review clarified command").props.onPress();
  await f.ui.flush();
  f.ui.find("TouchableOpacity", "Clear / cancel").props.onPress();
  f.ui.render();
  resolve(localReading());
  await f.ui.flush();
  assert.equal(f.calls.length, 0);
  assert.equal(f.ui.find("TextInput").props.value, "");
  assert.doesNotMatch(f.ui.text(), /Current media volume:/);
});

test("old context builds never fall back to an absolute effect after relative clarification", async (t) => {
  const f = setup(t, "android", async () => clarificationReply(deviceId));
  f.send();
  await f.ui.flush();
  chooseRelative(f);
  f.ui.find("TouchableOpacity", "Allow one local").props.onPress();
  f.ui.render();
  f.ui.find("TouchableOpacity", "Review clarified command").props.onPress();
  await f.ui.flush();
  assert.match(f.ui.text(), /compatible Android/);
  assert.equal(f.calls.length, 0);
});

test("browser clarification can choose an exact preview but cannot invent a phone reading", async (t) => {
  const f = setup(t, "web", async () => clarificationReply(null));
  f.send();
  await f.ui.flush();
  f.ui
    .find("select", "Clarification target")
    .props.onChange({ target: { value: "media_volume.set" } });
  f.ui.render();
  f.ui
    .find("select", "Clarification operation")
    .props.onChange({ target: { value: "set" } });
  f.ui.render();
  f.ui
    .find("input", "Clarification amount")
    .props.onChange({ target: { value: "40" } });
  f.ui.render();
  f.ui.find("button", "Review clarified command").props.onClick();
  await f.ui.flush();
  assert.match(f.ui.text(), /Set media volume to 40%/);
  assert.equal(f.calls.length, 0);
  assert.equal(
    f.requests.filter((value) => value.path === "/proposals").length,
    1,
  );
});

test("compatible Android app plans dispatch once and report only a launcher handoff", async (t) => {
  let dispatches = 0;
  const f = setup(
    t,
    "android",
    async () =>
      draft(deviceId, [
        {
          action: {
            capability_id: "application.open",
            application_id: "spotify",
          },
        },
      ]),
    {
      supportsPlan: (plan) =>
        plan.steps.every(
          (step, i) =>
            step.action.capability_id !== "application.open" ||
            i === plan.steps.length - 1,
        ),
      executePlan: async (_user, plan) => {
        dispatches++;
        return {
          protocol_version: 2,
          plan_id: plan.plan_id,
          plan_revision: plan.plan_revision,
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
      },
    },
  );
  f.send();
  await f.ui.flush();
  assert.equal(dispatches, 1);
  assert.match(f.ui.text(), /handoff requested/);
  assert.match(f.ui.text(), /not verified/);
  f.ui.emit("change", "background");
  await f.ui.flush();
  f.ui.emit("change", "active");
  await f.ui.flush();
  assert.equal(dispatches, 1);
});

test("missing reviewed app produces visible preflight guidance without a legacy effect", async (t) => {
  const f = setup(
    t,
    "android",
    async () =>
      draft(deviceId, [
        {
          action: {
            capability_id: "application.open",
            application_id: "clock",
          },
        },
      ]),
    {
      supportsPlan: () => true,
      executePlan: async () => {
        throw { code: "ERR_APP_UNAVAILABLE" };
      },
    },
  );
  f.send();
  await f.ui.flush();
  assert.match(f.ui.text(), /no single reviewed launcher/);
  assert.match(f.ui.text(), /No part of this plan was started/);
  assert.equal(f.calls.length, 0);
});
