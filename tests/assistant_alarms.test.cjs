const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { fixture } = require("./helpers/device_control_fixture.cjs");
const { assistantUI } = require("./helpers/assistant_ui_fixture.cjs");
const core = createTypeScriptLoader()("packages/assistant-core/src/index.ts");
const draft = {
  kind: "set_alarm",
  time: "07:30",
  label: "Synthetic private label",
  days: [],
  clock: "samsung",
};
const result = (extra = {}) => ({
  protocol_version: 1,
  outcome: "handoff_requested",
  request_kind: "set_alarm",
  package_id: "com.sec.android.app.clockpackage",
  receipt_recorded: true,
  ...extra,
});

test("alarm drafts reject unknown commands, private upload fields, invalid time and repeats", () => {
  assert.deepEqual(core.alarmDraft(draft), draft);
  for (const change of [
    { kind: "dismiss_alarm" },
    { time: "24:00" },
    { time: "7am" },
    { days: [2, 2] },
    { days: [0] },
    { days: [true] },
    { clock: "unreviewed.package" },
    { label: "hidden\u202e" },
    { provider: "gemini" },
    { kind: "show_alarms" },
    { label: "x".repeat(121) },
  ])
    assert.throws(() => core.alarmDraft({ ...draft, ...change }));
  assert.equal(core.alarmDraft({ ...draft, label: "  Test  " }).label, "Test");
});
test("viewing alarms accepts no hidden creation parameters", () => {
  const show = { ...draft, kind: "show_alarms", time: "", label: "", days: [] };
  assert.equal(core.alarmDraft(show).kind, "show_alarms");
  assert.throws(() => core.alarmDraft({ ...show, time: "07:30" }));
  assert.throws(() => core.alarmDraft({ ...show, days: [2] }));
});
test("alarm evidence never reports verified creation or accepts another kind or handler", () => {
  assert.throws(() => core.alarmHandoffResult(result(), "set_alarm", "google"));
  for (const change of [
    { outcome: "verified" },
    { request_kind: "show_alarms" },
    { package_id: "com.evil.app" },
    { receipt_recorded: 1 },
    { outcome: "cancelled", receipt_recorded: true },
    { protocol_version: 2 },
    { label: "private" },
  ])
    assert.throws(() => core.alarmHandoffResult(result(change), "set_alarm"));
  assert.match(
    core.describeAlarmHandoff(core.alarmHandoffResult(result(), "set_alarm")),
    /cannot verify/,
  );
  assert.match(
    core.describeAlarmHandoff(result({ outcome: "outcome_unknown" })),
    /Check Clock/,
  );
});
test("older binaries fail visibly before native handoff", async (t) => {
  const { api } = fixture(t);
  assert.equal(api.alarmHandoffSupported(), false);
  await assert.rejects(
    api.requestAlarmHandoff("fixture-user", draft),
    /updated compatible Android/,
  );
});
test("private parameters go only to the bound native bridge, never the HTTP management body", async (t) => {
  let calls = 0;
  const f = fixture(t, {
    native: {
      alarmHandoffSupport: () => true,
      executeAlarmHandoff: async (host, user, install, token, payload) => {
        calls++;
        assert.equal(host, f.binding.host);
        assert.equal(user, f.binding.userId);
        assert.equal(install, f.binding.installationId);
        assert.equal(token, "fixture-management");
        assert.deepEqual(JSON.parse(payload), draft);
        return result();
      },
    },
  });
  const old = global.fetch,
    bodies = [];
  global.fetch = async (url, options) => {
    bodies.push(options?.body || "");
    return old(url, options);
  };
  assert.equal(
    (await f.api.requestAlarmHandoff(f.binding.userId, draft)).outcome,
    "handoff_requested",
  );
  assert.equal(calls, 1);
  assert.doesNotMatch(bodies.join(""), /Synthetic private label|07:30/);
});
test("duplicate presses are blocked and cancellation discards a late response", async (t) => {
  let release,
    calls = 0,
    cancelled = 0;
  const f = fixture(t, {
    native: {
      alarmHandoffSupport: () => true,
      executeAlarmHandoff: async () => {
        calls++;
        return new Promise((resolve) => (release = resolve));
      },
      cancelAlarmHandoffs: async () => {
        cancelled++;
      },
    },
  });
  const pending = f.api.requestAlarmHandoff(f.binding.userId, draft);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    f.api.requestAlarmHandoff(f.binding.userId, draft),
    /already in progress/,
  );
  f.api.cancel();
  release(result());
  await assert.rejects(pending, /session changed/);
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
});
test("changed authentication cannot expose a late handoff result", async (t) => {
  let authorization = "Bearer fixture-parent";
  const f = fixture(t, {
    authHeaders: async () => ({ Authorization: authorization }),
    native: {
      alarmHandoffSupport: () => true,
      executeAlarmHandoff: async () => {
        authorization = "Bearer changed-parent";
        return result();
      },
    },
  });
  await assert.rejects(
    f.api.requestAlarmHandoff(f.binding.userId, draft),
    /session changed/,
  );
});
function ui(t, extra = {}) {
  const calls = [];
  const controls = {
    alarmHandoffSupported: () => true,
    enableVolume: async () => calls.push("enroll"),
    cancel: () => calls.push("cancel"),
    requestAlarmHandoff: async (user, value) => {
      calls.push(value);
      return result({ request_kind: value.kind });
    },
    ...extra,
  };
  const view = assistantUI(
    "android",
    {
      userId: "fixture-user",
      controls,
      theme: {},
      onClose: () => calls.push("close"),
    },
    "AlarmManager",
  );
  t.after(() => view.unmount());
  return { view, calls };
}
test("alarm screen sends a private reviewed request and displays honest handoff evidence", async (t) => {
  const { view, calls } = ui(t);
  view
    .find("TextInput", "Alarm time (HH:mm, 24-hour)")
    .props.onChangeText(draft.time);
  view.render();
  view
    .find("TextInput", "Optional alarm label")
    .props.onChangeText(draft.label);
  view.render();
  view.find("TouchableOpacity", "Samsung Clock").props.onPress();
  view.render();
  view.find("TouchableOpacity", "Review alarm request").props.onPress();
  await view.flush();
  assert.equal(calls.filter((value) => value?.kind === "set_alarm").length, 1);
  assert.match(view.text(), /cannot verify that an alarm was created/);
});
test("manage-alarm handoff never contains form fields or a dismissal command", async (t) => {
  const { view, calls } = ui(t);
  view
    .find("TextInput", "Optional alarm label")
    .props.onChangeText(draft.label);
  view.render();
  view
    .find("TouchableOpacity", "Open Clock to view or cancel alarms")
    .props.onPress();
  await view.flush();
  const sent = calls.find((value) => value?.kind === "show_alarms");
  assert.equal(sent.label, "");
  assert.equal(sent.time, "");
  assert.equal(sent.days.length, 0);
});
test("background clears private fields, cancels pending approval and ignores late output", async (t) => {
  let release;
  const { view, calls } = ui(t, {
    requestAlarmHandoff: async () =>
      new Promise((resolve) => (release = resolve)),
  });
  view
    .find("TextInput", "Optional alarm label")
    .props.onChangeText(draft.label);
  view.render();
  view.find("TouchableOpacity", "Review alarm request").props.onPress();
  view.emit("change", "background");
  release(result());
  await view.flush();
  view.emit("change", "active");
  assert.equal(view.find("TextInput", "Optional alarm label").props.value, "");
  assert.match(view.text(), /Private fields cleared/);
  assert.ok(calls.includes("cancel"));
  assert.doesNotMatch(view.text(), /Clock handoff requested/);
});
test("unsupported binary and busy state prevent double UI dispatch", async (t) => {
  const old = ui(t, { alarmHandoffSupported: () => false });
  assert.equal(
    old.view.find("TouchableOpacity", "Review alarm request").props.disabled,
    true,
  );
  let release,
    count = 0;
  const { view } = ui(t, {
    requestAlarmHandoff: async () => {
      count++;
      return new Promise((resolve) => (release = resolve));
    },
  });
  const button = view.find("TouchableOpacity", "Review alarm request");
  button.props.onPress();
  button.props.onPress();
  assert.equal(count, 1);
  release(result());
  await view.flush();
});
