const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { fixture } = require("./helpers/device_control_fixture.cjs");
const { assistantUI } = require("./helpers/assistant_ui_fixture.cjs");
const core = createTypeScriptLoader()("packages/assistant-core/src/index.ts");
const id = "11111111-1111-4111-8111-111111111111";
const draft = {
  title: "Synthetic reminder",
  date: "2026-11-20",
  time: "09:00",
  zone: "Asia/Kolkata",
  repeat: "none",
  until: null,
  overlap: "ask",
};
const details = { ...draft, reminder_id: id, occurrences: [1800000000000] };
const snapshot = () => ({
  protocol_version: 1,
  storage: {
    mode: "device_only",
    revision: 0,
    account_storage_available: true,
    consent_policy_version: 1,
  },
  items: [],
  time_zone: "Asia/Kolkata",
  notifications_allowed: true,
});
const result = (outcome = "schedule_requested") => ({
  protocol_version: 1,
  outcome,
  reminder_id: id,
  receipt_recorded: true,
  account_copy: "not_requested",
});
const bridge = (extra = {}) => ({
  reminderSupport: () => true,
  readReminders: async () => JSON.stringify(snapshot()),
  executeReminder: async () => JSON.stringify(result()),
  listSavedReminders: async () =>
    JSON.stringify({ items: [], next_after: null }),
  ...extra,
});

test("private reminder contracts reject injected actions, changed identities and false delivery claims", () => {
  assert.equal(core.reminderDraft(draft).title, draft.title);
  assert.throws(() => core.reminderDraft({ ...draft, provider: "gemini" }));
  assert.throws(() =>
    core.reminderDraft({ ...draft, title: "Hidden\u202e text" }),
  );
  assert.throws(() =>
    core.reminderDetails({ ...details, occurrences: [2000, 1000] }),
  );
  assert.throws(() =>
    core.reminderResult(JSON.stringify(result("delivered")), "create"),
  );
  assert.throws(() =>
    core.reminderResult(
      JSON.stringify({
        ...result(),
        reminder_id: "22222222-2222-4222-8222-222222222222",
      }),
      "cancel",
      id,
    ),
  );
  assert.throws(() =>
    core.reminderResult(
      JSON.stringify({
        ...result("storage_updated"),
        reminder_id: null,
        receipt_recorded: false,
      }),
      "storage",
    ),
  );
  assert.match(
    core.describeReminderResult(result("outcome_unknown")),
    /will not retry/,
  );
  assert.throws(() =>
    core.reminderSnapshot(
      JSON.stringify({
        ...snapshot(),
        items: [
          {
            reminder_id: id,
            state: "scheduled",
            next_at: 1800000000000,
            remaining: 1,
            last_outcome: null,
            details: {
              ...details,
              reminder_id: "22222222-2222-4222-8222-222222222222",
            },
          },
        ],
      }),
    ),
  );
});

test("old APKs cannot silently fall back to an untrusted reminder executor", async (t) => {
  const f = fixture(t);
  assert.equal(f.api.reminderSupported(), false);
  await assert.rejects(
    f.api.createReminder(f.binding.userId, draft),
    /updated compatible Android build/,
  );
  assert.equal(f.calls(), 0);
});

test("reminder bridge binds the authenticated device and validates exact native results", async (t) => {
  let calls = 0;
  const f = fixture(t, {
    native: bridge({
      executeReminder: async (
        origin,
        user,
        installation,
        token,
        kind,
        payload,
      ) => {
        calls++;
        assert.equal(origin, f.binding.host);
        assert.equal(user, f.binding.userId);
        assert.equal(installation, f.binding.installationId);
        assert.equal(token, "fixture-management");
        assert.equal(kind, "create");
        assert.equal(JSON.parse(payload).title, draft.title);
        return JSON.stringify(result());
      },
    }),
  });
  assert.equal(
    (await f.api.createReminder(f.binding.userId, draft)).outcome,
    "schedule_requested",
  );
  assert.equal(calls, 1);
  f.native.executeReminder = async () =>
    JSON.stringify({ ...result(), outcome: "delivered" });
  await assert.rejects(
    f.api.createReminder(f.binding.userId, draft),
    /Invalid reminder result/,
  );
});

test("sign-out cancellation discards a late private response and stops local alerts", async (t) => {
  let release, started;
  const ready = new Promise((r) => (started = r));
  let cleared = 0;
  const f = fixture(t, {
    native: bridge({
      readReminders: async () => {
        started();
        return new Promise((r) => (release = r));
      },
      clearReminders: async () => cleared++,
    }),
  });
  const request = f.api.readReminders(f.binding.userId);
  await ready;
  await assert.rejects(
    f.api.createReminder(f.binding.userId, draft),
    /already in progress/,
  );
  await f.api.clearReminderData();
  release(JSON.stringify(snapshot()));
  await assert.rejects(request, /session changed|cancelled/);
  assert.equal(cleared, 1);
});

test("same-account login retains alerts while account changes clear them", async (t) => {
  let cleared = 0;
  const f = fixture(t, {
    native: bridge({ clearReminders: async () => cleared++ }),
  });
  await f.api.matchReminderAccount(f.binding.userId);
  assert.equal(cleared, 0);
  await f.api.matchReminderAccount("different-user");
  assert.equal(cleared, 1);
});

function ui(t, extra = {}) {
  const calls = [];
  const controls = {
    reminderSupported: () => true,
    readReminders: async () => snapshot(),
    cancel: () => calls.push("cancel-pending"),
    createReminder: async (user, value) => {
      calls.push({ create: value });
      return result();
    },
    savedReminders: async () => ({
      items: [{ details, source_device_id: id, created_at: 1 }],
      next_after: null,
    }),
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
    "ReminderManager",
  );
  t.after(() => view.unmount());
  return { view, calls, controls };
}

test("private reminder form explicitly creates, shows results and never invokes AI planning", async (t) => {
  const { view, calls } = ui(t);
  await view.flush();
  view.find("TextInput", "Reminder title").props.onChangeText(draft.title);
  view.render();
  const button = view.find("TouchableOpacity", "Review and create reminder");
  assert.equal(button.props.disabled, false);
  button.props.onPress();
  await view.flush();
  assert.equal(calls.filter((x) => x.create).length, 1);
  assert.match(view.text(), /Reminder scheduled on this phone/);
  assert.equal(view.find("TextInput", "Reminder title").props.value, "");
});

test("saved copies load as editable drafts with no automatic schedule", async (t) => {
  const { view, calls } = ui(t);
  await view.flush();
  view.find("TouchableOpacity", "Show saved account reminders").props.onPress();
  await view.flush();
  view.find("TouchableOpacity", "Use as new draft").props.onPress();
  view.render();
  assert.equal(
    view.find("TextInput", "Reminder title").props.value,
    draft.title,
  );
  assert.match(view.text(), /Nothing was scheduled/);
  assert.equal(calls.filter((x) => x.create).length, 0);
});

test("background clears reminder details and ignores late private reads", async (t) => {
  let release;
  const { view } = ui(t, {
    readReminders: async () => new Promise((r) => (release = r)),
  });
  view.emit("change", "background");
  release({
    ...snapshot(),
    items: [
      {
        reminder_id: id,
        state: "scheduled",
        next_at: 1800000000000,
        remaining: 1,
        last_outcome: null,
        details,
      },
    ],
  });
  await view.flush();
  view.emit("change", "active");
  assert.doesNotMatch(view.text(), /Synthetic reminder/);
  assert.match(view.text(), /Private reminder details cleared/);
  assert.equal(view.find("TextInput", "Reminder title").props.value, "");
});

test("unconfigured encryption keeps account storage off and notification denial blocks creation", async (t) => {
  const state = snapshot();
  state.storage.account_storage_available = false;
  state.notifications_allowed = false;
  const { view } = ui(t, { readReminders: async () => state });
  await view.flush();
  assert.equal(
    view.find("TouchableOpacity", "Encrypted account storage").props.disabled,
    true,
  );
  assert.equal(
    view.find("TouchableOpacity", "Review and create reminder").props.disabled,
    true,
  );
  assert.match(view.text(), /Device-only reminders remain available/);
});

test("reminder setup enrolls explicitly without changing device volume", async (t) => {
  let enrolled = false;
  const { view, calls } = ui(t, {
    readReminders: async () => {
      if (!enrolled) throw Error("Enable device controls first");
      return snapshot();
    },
    enableVolume: async () => {
      enrolled = true;
    },
  });
  await view.flush();
  view
    .find("TouchableOpacity", "Enable assistant on this device")
    .props.onPress();
  await view.flush();
  assert.equal(enrolled, true);
  assert.equal(calls.filter((value) => value.create).length, 0);
  assert.match(view.text(), /Device setup checked/);
});

test("turning account storage off uses its current consent revision and clears saved detail views", async (t) => {
  const state = snapshot();
  state.storage.mode = "account";
  state.storage.revision = 4;
  let changes = 0;
  const { view } = ui(t, {
    readReminders: async () => state,
    setReminderStorage: async (user, mode, revision) => {
      assert.equal(mode, "device_only");
      assert.equal(revision, 4);
      changes++;
      state.storage.mode = mode;
      state.storage.revision++;
      return { ...result("storage_updated"), reminder_id: null };
    },
  });
  await view.flush();
  view.find("TouchableOpacity", "Show saved account reminders").props.onPress();
  await view.flush();
  assert.match(view.text(), /Synthetic reminder/);
  view.find("TouchableOpacity", "Encrypted account storage").props.onPress();
  await view.flush();
  assert.equal(changes, 1);
  assert.doesNotMatch(view.text(), /Synthetic reminder/);
  assert.match(view.text(), /Off \(device only\)/);
});
