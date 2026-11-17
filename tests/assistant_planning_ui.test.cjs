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
function setup(t, platform = "android", reply = async () => draft()) {
  const old = process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "true";
  t.after(() => {
    if (old === undefined)
      delete process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
    else process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = old;
  });
  const calls = [],
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
  return { ui, send, calls, requests };
}

test("Android Send command requests the exact native volume confirmation without a second JS button", async (t) => {
  const f = setup(t);
  f.send();
  await f.ui.flush();
  assert.deepEqual(f.calls, [{ user: userId, percent: 50 }]);
  assert.equal(
    f.ui.find("TouchableOpacity", "Confirm volume change"),
    undefined,
  );
  assert.match(f.ui.text(), /Media volume verified at 46%/);
  await f.ui.flush();
  assert.equal(f.calls.length, 1);
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
  assert.match(f.ui.text(), /No part of this plan/);
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
