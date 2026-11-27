const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { assistantUI } = require("./helpers/assistant_ui_fixture.cjs");

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function appleFixture(os = "ios", missing = false) {
  const callbacks = new Map();
  const edit = deferred();
  const calls = {
    edits: 0,
    cancels: 0,
    consumes: 0,
    lookups: 0,
    editorIds: [],
    cancelIds: [],
  };
  let requested = false;
  const state = {
    currentState: "active",
    addEventListener(name, callback) {
      callbacks.set(name, callback);
      return { remove: () => callbacks.delete(name) };
    },
  };
  const native = {
    support: async () => ({ calendar_editor: true, shortcuts: true }),
    editCalendarEvent(id) {
      calls.edits++;
      calls.editorIds.push(id);
      return edit.promise;
    },
    async cancelCalendarEditor(id) {
      calls.cancels++;
      calls.cancelIds.push(id);
    },
    async consumeAssistantEntry() {
      calls.consumes++;
      const value = requested;
      requested = false;
      return value;
    },
    addListener(name, callback) {
      callbacks.set(name, callback);
      return { remove: () => callbacks.delete(name) };
    },
  };
  const load = createTypeScriptLoader({
    "react-native": { Platform: { OS: os }, AppState: state },
    "../../modules/assistant-platform": {
      assistantPlatform() {
        calls.lookups++;
        if (missing === "throw") throw Error("Native lookup failed");
        return missing ? null : native;
      },
    },
  });
  const api = load("mobile/src/services/assistant_platform.ts");
  return {
    api,
    calls,
    edit,
    native,
    state,
    callbacks,
    request() {
      requested = true;
      callbacks.get("onAssistantEntry")?.();
    },
    background() {
      state.currentState = "background";
      callbacks.get("change")?.("background");
    },
    foreground() {
      state.currentState = "active";
      callbacks.get("change")?.("active");
    },
  };
}

test("feature discovery distinguishes previews, eligibility and microphone permission", () => {
  const { companionFeatures } = createTypeScriptLoader()(
    "packages/assistant-core/src/index.ts",
  );
  const voice = {
    recognition: true,
    synthesis: false,
    message: "Local speech ready",
  };
  for (const platform of ["web", "ios"]) {
    const features = companionFeatures(platform, voice, true, true);
    assert.equal(
      features.find((f) => f.id === "speech").status,
      "permission_required",
    );
    assert.equal(features.find((f) => f.id === "controls").status, "preview");
    assert.equal(
      features.find((f) => f.id === "reminders").status,
      "unavailable",
    );
    assert.equal(
      features.find((f) => f.id === "calendar").status,
      platform === "ios" ? "available" : "unavailable",
    );
  }
});

test("the browser guide and typed preview never invoke a native or network executor", async () => {
  const ui = assistantUI("web", { onClose() {} });
  await ui.flush();
  assert.match(ui.text(), /What works in this browser/);
  assert.match(ui.text(), /closed browser tab cannot provide reliable alerts/);
  ui.find("textarea").props.onChange({
    target: { value: "set volume to 40%" },
  });
  ui.render();
  ui.find("button", "Review command").props.onClick();
  await ui.flush();
  assert.match(ui.text(), /preview only|Preview only/);
  ui.unmount();
});

test("iPhone support stays collapsed until requested and opening it clears the old command", async () => {
  const ui = assistantUI("ios", { theme: {}, onClose() {} });
  await ui.flush();
  assert.equal(ui.find("AppleAssistantTools"), undefined);
  ui.find("TextInput").props.onChangeText("set volume to 40%");
  ui.render();
  ui.find("TouchableOpacity", "Tools and support").props.onPress();
  ui.render();
  ui.find("TouchableOpacity", "iPhone tools and support").props.onPress();
  ui.render();
  assert.ok(ui.find("AppleAssistantTools"));
  assert.equal(ui.find("TextInput").props.value, "");
  ui.unmount();
});

test("Apple companion fails closed on Android, old binaries and failed lookups", async () => {
  for (const [os, missing] of [
    ["android", false],
    ["ios", true],
    ["ios", "throw"],
  ]) {
    const f = appleFixture(os, missing);
    const port = f.api.createAppleCompanion();
    assert.deepEqual(await port.support(), {
      calendar_editor: false,
      shortcuts: false,
    });
    assert.match(await port.editCalendarEvent(), /unavailable/);
    f.api.subscribeAssistantEntry(() => assert.fail("unexpected launch"))();
    assert.equal(f.calls.edits, 0);
    if (os === "android") assert.equal(f.calls.lookups, 0);
    port.dispose();
  }
});

test("Calendar stays user composed, opens once and reports Apple's Save without claiming delivery", async () => {
  const f = appleFixture();
  const port = f.api.createAppleCompanion();
  const pending = port.editCalendarEvent();
  assert.match(await port.editCalendarEvent(), /unavailable/);
  assert.equal(f.calls.edits, 1);
  f.edit.resolve("saved_in_editor");
  assert.match(await pending, /editor reported Save/);
  assert.equal(f.calls.edits, 1);
  port.dispose();
});

test("cancelled, unknown, rejected and hostile editor results never become verified success", async () => {
  for (const outcome of ["cancelled", "outcome_unknown", "verified", "throw"]) {
    const f = appleFixture();
    const port = f.api.createAppleCompanion();
    const pending = port.editCalendarEvent();
    if (outcome === "throw") f.edit.reject(Error("PRIVATE platform exception"));
    else f.edit.resolve(outcome);
    const result = await pending;
    assert.doesNotMatch(result, /PRIVATE|reported Save|verified/);
    assert.match(
      result,
      outcome === "cancelled" ? /cancelled/ : /Check Calendar/,
    );
    assert.equal(f.calls.edits, 1);
    port.dispose();
  }
});

test("Calendar lifecycle and disposal suppress late Save without retrying an effect", async () => {
  for (const action of ["cancel", "dispose"]) {
    const f = appleFixture();
    const port = f.api.createAppleCompanion();
    const pending = port.editCalendarEvent();
    port[action]();
    f.edit.resolve("saved_in_editor");
    assert.equal(await pending, "");
    assert.equal(f.calls.edits, 1);
    assert.equal(f.calls.cancels, 1);
    if (action === "cancel") port.dispose();
  }
});

test("cleanup is scoped to its editor request and cannot cancel a newer companion's editor", async () => {
  const f = appleFixture();
  const first = f.api.createAppleCompanion();
  const old = first.editCalendarEvent();
  first.cancel();
  const second = f.api.createAppleCompanion();
  const current = second.editCalendarEvent();
  first.dispose();
  assert.notEqual(f.calls.editorIds[0], f.calls.editorIds[1]);
  assert.deepEqual(f.calls.cancelIds, [f.calls.editorIds[0]]);
  f.edit.resolve("saved_in_editor");
  assert.equal(await old, "");
  assert.match(await current, /reported Save/);
  second.dispose();
  assert.equal(f.calls.cancels, 1);
});

test("Siri entry consumes one opening request, never opens in background and cleans up", async () => {
  const f = appleFixture();
  let opens = 0;
  f.request(); // Cold-launch request predates the JS subscriber.
  const stop = f.api.subscribeAssistantEntry(() => opens++);
  await flush();
  assert.equal(opens, 1);
  f.callbacks.get("onAssistantEntry")();
  await flush();
  assert.equal(opens, 1);
  f.background();
  f.request();
  await flush();
  assert.equal(opens, 1);
  f.foreground();
  await flush();
  assert.equal(opens, 2);
  stop();
  assert.equal(f.callbacks.size, 0);
});

test("a late Siri response after unmount cannot open an Assistant screen", async () => {
  const f = appleFixture();
  const response = deferred();
  f.native.consumeAssistantEntry = () => response.promise;
  const stop = f.api.subscribeAssistantEntry(() => assert.fail("late opening"));
  stop();
  response.resolve(true);
  await flush();
});

test("iPhone tools clear command capture before opening the native editor and clear late UI", async () => {
  const result = deferred();
  const calls = [];
  const port = {
    support: async () => ({ calendar_editor: true, shortcuts: true }),
    editCalendarEvent() {
      calls.push("editor");
      return result.promise;
    },
    cancel() {
      calls.push("cancel");
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const ui = assistantUI(
    "ios",
    {
      theme: {},
      signedIn: true,
      voice: { recognition: false, synthesis: false, message: "Type instead" },
      beforeOpen() {
        calls.push("clear");
      },
    },
    "AppleAssistantTools",
    { apple: { createAppleCompanion: () => port } },
  );
  await ui.flush();
  ui.find("TouchableOpacity", "Create event").props.onPress();
  ui.render();
  assert.deepEqual(calls, ["clear", "editor"]);
  assert.equal(ui.find("TouchableOpacity").props.disabled, true);
  ui.emit("change", "background");
  result.resolve("SENSITIVE OLD RESULT");
  await ui.flush();
  assert.doesNotMatch(ui.text(), /SENSITIVE/);
  ui.unmount();
  assert.equal(calls.at(-1), "dispose");
});

function pluginFixture(options) {
  const files = new Map();
  const hooks = {};
  const links = [];
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync("mobile/plugins/with-assistant-platform.js", "utf8"),
    {
      module,
      require(name) {
        if (name === "./with-assistant-alarm-widget") return () => {};
        if (name === "node:path") return path;
        if (name === "node:fs")
          return {
            existsSync: (name) => files.has(name),
            readFileSync: (name) => files.get(name),
            mkdirSync() {},
            writeFileSync: (name, body) => files.set(name, body),
          };
        assert.equal(name, "expo/config-plugins");
        return {
          withInfoPlist(config, fn) {
            hooks.info = fn;
            return config;
          },
          withXcodeProject(config, fn) {
            hooks.project = fn;
            return config;
          },
          IOSConfig: {
            XcodeUtils: {
              addBuildSourceFileToGroup: (link) => links.push(link),
            },
          },
        };
      },
    },
  );
  module.exports({}, options);
  const request = {
    projectName: "ContexifyTest",
    platformProjectRoot: path.resolve("ios-fixture"),
  };
  const runProject = () =>
    hooks.project({ modRequest: request, modResults: {} });
  return { files, hooks, links, runProject, request };
}

test("iOS plugin preserves app settings and adds only explicitly enabled voice disclosures", () => {
  for (const enabled of [false, true]) {
    const f = pluginFixture({ enabled, voiceEnabled: enabled });
    const info = { ExistingKey: "keep" };
    f.hooks.info({ modResults: info });
    assert.equal(info.ExistingKey, "keep");
    assert.equal(info.ContexifyAssistantExtensionsEnabled, enabled);
    assert.equal(Boolean(info.NSSpeechRecognitionUsageDescription), enabled);
    assert.equal(Boolean(info.NSMicrophoneUsageDescription), enabled);
    assert.ok(
      !Object.keys(info).some((key) => /Reminders|Calendars/.test(key)),
    );
    assert.equal(Boolean(info.NSAlarmKitUsageDescription), enabled);
    assert.equal(info.ContexifyAssistantCountdownWidget, enabled);
    f.runProject();
    assert.equal(f.files.size, enabled ? 1 : 0);
  }
});

test("shortcut build wiring targets the app, is repeatable and refuses to overwrite user Swift", () => {
  const f = pluginFixture({ enabled: true });
  f.runProject();
  const [filename, source] = [...f.files][0];
  assert.match(source, /AppShortcutsProvider/);
  assert.ok(source.includes("\\(.applicationName)"));
  assert.match(source, /AssistantPlatformIntentsPackage/);
  assert.equal(f.links[0].groupName, "ContexifyTest");
  f.runProject();
  assert.equal(f.files.get(filename), source);
  const disabled = pluginFixture({ enabled: false, voiceEnabled: false });
  disabled.files.set(filename, source);
  disabled.runProject();
  assert.doesNotMatch(
    disabled.files.get(filename),
    /AppShortcutsProvider|AppIntent/,
  );
  f.files.set(filename, "// User code");
  assert.throws(() => f.runProject(), /manually maintained/);
});

test("phone availability query preserves existing schemes and removes only the plugin's own query when disabled", () => {
  const enabled = pluginFixture({ enabled: true });
  const disabled = pluginFixture({ enabled: false });
  const info = { LSApplicationQueriesSchemes: ["existing-app"] };
  enabled.hooks.info({ modResults: info });
  enabled.hooks.info({ modResults: info });
  assert.deepEqual(Array.from(info.LSApplicationQueriesSchemes), [
    "existing-app",
    "tel",
  ]);
  disabled.hooks.info({ modResults: info });
  assert.deepEqual(Array.from(info.LSApplicationQueriesSchemes), [
    "existing-app",
  ]);
  assert.equal(info.ContexifyAssistantOwnsPhoneQuery, undefined);
  const existing = { LSApplicationQueriesSchemes: ["tel"] };
  enabled.hooks.info({ modResults: existing });
  disabled.hooks.info({ modResults: existing });
  assert.deepEqual(existing.LSApplicationQueriesSchemes, ["tel"]);
});
