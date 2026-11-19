const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { fixture } = require("./helpers/device_control_fixture.cjs");
const { assistantUI } = require("./helpers/assistant_ui_fixture.cjs");
const core = createTypeScriptLoader()("packages/assistant-core/src/index.ts");
const id = "11111111-1111-4111-8111-111111111111";
const result = (outcome = "schedule_requested") =>
  JSON.stringify({
    protocol_version: 1,
    outcome,
    reminder_id: id,
    receipt_recorded: true,
    account_copy: "not_requested",
  });
const snapshot = () => ({
  protocol_version: 1,
  alarms_allowed: true,
  items: [
    {
      reminder_id: id,
      kind: "timer",
      title: "Synthetic timer",
      state: "scheduled",
      next_at: 1800000000000,
      remaining: 1,
    },
  ],
});
const draft = {
  title: "Synthetic reminder",
  date: "2026-11-20",
  time: "09:00",
  zone: "Asia/Kolkata",
  repeat: "none",
  until: null,
  overlap: "ask",
};
function ios(t, native = {}, extra = {}) {
  return fixture(t, {
    platform: "ios",
    native: {
      reminderSupport: () => true,
      appleAlarmSupport: () => true,
      appleTimerSupport: () => true,
      readReminders: async () => "",
      executeReminder: async () => result(),
      listSavedReminders: async () =>
        JSON.stringify({ items: [], next_after: null }),
      readAppleAlarms: async () => JSON.stringify(snapshot()),
      executeAppleAlarm: async () => result(),
      requestAppleAlarmPermission: async () => true,
      ...native,
    },
    ...extra,
  });
}

test("private Apple alarm contracts reject arbitrary commands, invalid duration and false verification", () => {
  assert.equal(
    core.appleAlarmDraft({
      kind: "timer",
      title: " Test ",
      duration_seconds: 60,
    }).title,
    "Test",
  );
  assert.equal(
    core.appleAlarmDraft({ kind: "alarm", schedule: draft }).schedule.zone,
    draft.zone,
  );
  for (const value of [0, 59, 86401, 1.5, true, "60", NaN, Infinity])
    assert.throws(() =>
      core.appleAlarmDraft({
        kind: "timer",
        title: "Test",
        duration_seconds: value,
      }),
    );
  assert.throws(() =>
    core.appleAlarmDraft({
      kind: "timer",
      title: "Test",
      duration_seconds: 60,
      url: "https://example.invalid",
    }),
  );
  const state = snapshot();
  state.items[0].state = "verified";
  assert.throws(() => core.appleAlarmSnapshot(JSON.stringify(state)));
  state.items[0].state = "scheduled";
  state.items.push(state.items[0]);
  assert.throws(() => core.appleAlarmSnapshot(JSON.stringify(state)));
});

test("iOS uses bound scheduling without enabling Android volume effects", async (t) => {
  const calls = [];
  const f = ios(t, {
    executeAppleAlarm: async (...args) => {
      calls.push(args);
      return result();
    },
  });
  assert.equal(f.api.appleAlarmSupported(), true);
  await f.api.enableVolume(f.binding.userId); // Shared enrollment only.
  const answer = await f.api.createAppleAlarm(f.binding.userId, {
    kind: "timer",
    title: "Synthetic timer",
    duration_seconds: 300,
  });
  assert.equal(answer.outcome, "schedule_requested");
  assert.deepEqual(calls[0].slice(0, 6), [
    f.binding.host,
    f.binding.userId,
    f.binding.installationId,
    "fixture-management",
    "create",
    "timer",
  ]);
  assert.deepEqual(JSON.parse(calls[0][6]), {
    title: "Synthetic timer",
    duration_seconds: 300,
  });
  await assert.rejects(f.api.changeVolume(f.binding.userId, 50));
  assert.equal(f.calls(), 0);
});

test("alarm drafts and owned cancellation preserve the exact native target", async (t) => {
  const calls = [];
  const f = ios(t, {
    executeAppleAlarm: async (...args) => {
      calls.push(args);
      return result(
        args[4] === "cancel" ? "reminder_cancelled" : "schedule_requested",
      );
    },
  });
  await f.api.createAppleAlarm(f.binding.userId, {
    kind: "alarm",
    schedule: draft,
  });
  await f.api.cancelAppleAlarm(f.binding.userId, id);
  assert.equal(calls[0][5], "alarm");
  assert.deepEqual(JSON.parse(calls[0][6]), draft);
  assert.deepEqual(JSON.parse(calls[1][6]), { reminder_id: id });
  await assert.rejects(
    f.api.cancelAppleAlarm(f.binding.userId, "foreign-target"),
  );
  assert.equal(calls.length, 2);
});

test("old binaries and disabled execution never acquire schedule authority", async (t) => {
  const f = ios(t, {
    appleAlarmSupport: undefined,
    appleTimerSupport: undefined,
  });
  assert.equal(f.api.appleAlarmSupported(), false);
  await assert.rejects(
    f.api.createAppleAlarm(f.binding.userId, {
      kind: "timer",
      title: "Test",
      duration_seconds: 60,
    }),
  );
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "false";
  assert.equal(f.api.reminderSupported(), false);
  await assert.rejects(f.api.createReminder(f.binding.userId, draft));
});

test("iOS cleanup runs before device-key removal and native results cannot invent permission", async (t) => {
  const calls = [];
  const f = ios(t, {
    clearReminders: async () => calls.push("clear"),
    deleteKey: async () => calls.push("delete"),
    requestAppleAlarmPermission: async () => "granted",
  });
  assert.equal(await f.api.requestAppleAlarmPermission(), false);
  await f.api.forget();
  assert.deepEqual(calls, ["clear", "delete"]);
});

test("late private schedule read is discarded after account credentials change", async (t) => {
  let complete,
    authorization = "Bearer original";
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const f = ios(
    t,
    { readAppleAlarms: () => pending },
    { authHeaders: async () => ({ Authorization: authorization }) },
  );
  const read = f.api.readAppleAlarms(f.binding.userId);
  await new Promise((resolve) => setImmediate(resolve));
  authorization = "Bearer other-account";
  complete(JSON.stringify(snapshot()));
  await assert.rejects(read, /session changed|Private details/);
});

test("the real iPhone form sends one typed timer and suppresses stale background results", async () => {
  const calls = [];
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const controls = {
    appleAlarmSupported: () => true,
    appleTimerSupported: () => true,
    cancel() {},
    createAppleAlarm: async (_user, request) => {
      calls.push(request);
      return pending;
    },
  };
  const ui = assistantUI(
    "ios",
    { theme: {}, userId: "fixture-user", controls, onClose() {} },
    "AppleAlarmManager",
  );
  ui.find("TouchableOpacity", "Timer").props.onPress();
  ui.render();
  ui.find("TextInput", "Private label").props.onChangeText("Synthetic timer");
  ui.render();
  ui.find("TouchableOpacity", "Review and schedule").props.onPress();
  ui.render();
  ui.find("TouchableOpacity", "Review and schedule").props.onPress();
  assert.equal(calls.length, 1, ui.text());
  assert.deepEqual(calls[0], {
    kind: "timer",
    title: "Synthetic timer",
    duration_seconds: 300,
  });
  ui.emit("change", "background");
  complete(JSON.parse(result()));
  await ui.flush();
  assert.doesNotMatch(ui.text(), /accepted the alert registration/);
  assert.equal(ui.find("TextInput", "Private label").props.value, "");
  ui.unmount();
});

function projectFixture() {
  const project = require("../mobile/node_modules/xcode").project(
    "fixture.pbxproj",
  );
  const id = (value) => value.toString(16).padStart(24, "0").toUpperCase();
  project.hash = {
    project: {
      archiveVersion: 1,
      classes: {},
      objectVersion: 56,
      rootObject: id(1),
      objects: {
        PBXProject: {
          [id(1)]: {
            isa: "PBXProject",
            mainGroup: id(2),
            productRefGroup: id(4),
            targets: [{ value: id(5), comment: "TestApp" }],
            attributes: {},
            buildConfigurationList: id(6),
          },
        },
        PBXGroup: {
          [id(2)]: {
            isa: "PBXGroup",
            children: [
              { value: id(3), comment: "TestApp" },
              { value: id(4), comment: "Products" },
            ],
            sourceTree: '"<group>"',
          },
          [id(3)]: {
            isa: "PBXGroup",
            name: "TestApp",
            path: "TestApp",
            children: [],
            sourceTree: '"<group>"',
          },
          [id(4)]: {
            isa: "PBXGroup",
            name: "Products",
            children: [{ value: id(10), comment: "TestApp.app" }],
            sourceTree: '"<group>"',
          },
        },
        PBXNativeTarget: {
          [id(5)]: {
            isa: "PBXNativeTarget",
            name: "TestApp",
            productName: "TestApp",
            productReference: id(10),
            productType: '"com.apple.product-type.application"',
            buildConfigurationList: id(6),
            buildPhases: [{ value: id(9), comment: "Sources" }],
            dependencies: [],
          },
        },
        XCConfigurationList: {
          [id(6)]: {
            isa: "XCConfigurationList",
            buildConfigurations: [
              { value: id(7), comment: "Debug" },
              { value: id(8), comment: "Release" },
            ],
            defaultConfigurationName: "Release",
          },
        },
        XCBuildConfiguration: {
          [id(7)]: {
            isa: "XCBuildConfiguration",
            name: "Debug",
            buildSettings: { DEVELOPMENT_TEAM: "FIXTURE" },
          },
          [id(8)]: {
            isa: "XCBuildConfiguration",
            name: "Release",
            buildSettings: { DEVELOPMENT_TEAM: "FIXTURE" },
          },
        },
        PBXSourcesBuildPhase: {
          [id(9)]: {
            isa: "PBXSourcesBuildPhase",
            files: [],
            buildActionMask: 2147483647,
          },
        },
        PBXFileReference: {
          [id(10)]: {
            isa: "PBXFileReference",
            path: "TestApp.app",
            explicitFileType: "wrapper.application",
            sourceTree: "BUILT_PRODUCTS_DIR",
          },
        },
        PBXBuildFile: {},
        PBXCopyFilesBuildPhase: {},
        PBXResourcesBuildPhase: {},
        PBXFrameworksBuildPhase: {},
        PBXContainerItemProxy: {},
        PBXTargetDependency: {},
      },
    },
  };
  return project;
}

test("the widget plugin creates a real app-extension target, embeds sources once and refuses production reuse", () => {
  const files = new Map(),
    project = projectFixture(),
    module = { exports: {} };
  const pluginPath = path.resolve(
    "mobile/plugins/with-assistant-alarm-widget.js",
  );
  vm.runInNewContext(fs.readFileSync(pluginPath, "utf8"), {
    module,
    __dirname: path.dirname(pluginPath),
    require(name) {
      if (name === "node:path") return path;
      if (name === "expo/config-plugins")
        return require("../mobile/node_modules/expo/config-plugins");
      assert.equal(name, "node:fs");
      return {
        existsSync: (file) => files.has(file),
        mkdirSync() {},
        writeFileSync: (file, text) => files.set(file, text),
        readFileSync: (file) =>
          files.has(file) ? files.get(file) : fs.readFileSync(file, "utf8"),
      };
    },
  });
  const mod = {
    ios: { bundleIdentifier: "ai.contexify.app.assistantvolumetest" },
    version: "1.4.3",
    modResults: project,
    modRequest: {
      projectName: "TestApp",
      platformProjectRoot: path.resolve("widget-fixture"),
    },
  };
  module.exports(mod, true);
  const first = project.writeSync();
  module.exports(mod, true);
  assert.equal(
    project.writeSync(),
    first,
    "Repeated prebuild must not duplicate targets or sources",
  );
  assert.match(first, /com.apple.product-type.app-extension/);
  assert.match(first, /ai.contexify.app.assistantvolumetest.schedules/);
  assert.match(first, /ContexifyScheduleWidget.swift/);
  assert.match(first, /AppleAlarmMetadata.swift/);
  assert.throws(
    () => module.exports(mod, false),
    /clean, separate iOS project/,
  );
  assert.ok(
    [...files.values()].some((text) => text.includes("ActivityConfiguration")),
  );
});
