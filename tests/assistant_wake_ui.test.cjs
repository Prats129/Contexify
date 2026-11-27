const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assistantUI } = require("./helpers/assistant_ui_fixture.cjs");

function fixture(t, controls) {
  let resolve, captures = 0, starts = 0, signal;
  const detection = new Promise((done) => { resolve = done; });
  const ui = assistantUI("android", { theme: {}, voiceAllowed: true, volumeUserId: "test-owner", volumeControls: controls, onClose() {} }, "AssistantPreview", {
    wake: {
      mobileWakeAvailable: () => true,
      createMobileWakeAdapter: () => ({ listen: async (current, ready) => {
        starts++; signal = current; ready(); return detection;
      } }),
    },
    voice: {
      availability: async () => ({ recognition: true, synthesis: true, message: "ready" }),
      listen: async (_, ready) => { captures++; ready(); return "set volume to 50%"; },
      stop() {}, cancel() {}, dispose() {}, speak: async () => {},
    },
  });
  t.after(() => ui.unmount());
  return { ui, resolve, get captures() { return captures; }, get starts() { return starts; }, get signal() { return signal; } };
}

function permissionFixture(t, options = {}) {
  let granted = false, requests = 0, captures = 0, wakes = 0;
  const ui = assistantUI(options.platform ?? "android", {
    theme: {}, voiceAllowed: true, volumeUserId: "test-owner", onClose() {},
    volumeControls: { cancel() {}, async planningContext() { assert.fail("Unexpected AI request"); } },
  }, "AssistantPreview", {
    permissions: {
      PERMISSIONS: { RECORD_AUDIO: "record_audio" },
      RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
      check: async () => granted,
      request: async () => {
        requests++;
        const result = await (options.request?.() ?? "granted");
        granted = result === "granted";
        return result;
      },
    },
    wake: { mobileWakeAvailable: () => true, createMobileWakeAdapter: () => ({ listen: async () => { wakes++; return false; } }) },
    voice: {
      availability: async () => ({ recognition: true, synthesis: false, message: "ready" }),
      listen: async () => { captures++; return "set volume to 50%"; },
      stop() {}, cancel() {}, dispose() {}, speak: async () => {},
    },
  });
  t.after(() => ui.unmount());
  return { ui, get requests() { return requests; }, get captures() { return captures; }, get wakes() { return wakes; } };
}

test("Android permission setup grants no session consent and never starts wake, speech or AI", async (t) => {
  const previous = process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
    else process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = previous;
  });
  const f = permissionFixture(t);
  await f.ui.flush();
  assert.equal(f.requests, 0);
  assert.equal(f.ui.find("TouchableOpacity", "Allow the microphone").props.disabled, true);
  f.ui.find("TouchableOpacity", "Grant microphone access").props.onPress();
  await f.ui.flush();
  assert.equal(f.requests, 1);
  assert.equal(f.captures, 0);
  assert.equal(f.wakes, 0);
  assert.equal(f.ui.find("TouchableOpacity", "Allow the microphone").props.accessibilityState.checked, false);
  assert.equal(f.ui.find("TouchableOpacity", "Allow AI planning").props.accessibilityState.checked, false);
  assert.equal(f.ui.find("TouchableOpacity", "Use microphone").props.disabled, true);
  f.ui.find("TouchableOpacity", "Allow the microphone").props.onPress();
  f.ui.render();
  assert.equal(f.ui.find("TouchableOpacity", "Use microphone").props.disabled, false);
  assert.ok(f.ui.find("TouchableOpacity", "Review command"));
});

test("denied or blocked Android permission keeps speech disabled and typed commands available", async (t) => {
  for (const result of ["denied", "never_ask_again"]) {
    const f = permissionFixture(t, { request: async () => result });
    await f.ui.flush();
    f.ui.find("TouchableOpacity", "Grant microphone access").props.onPress();
    await f.ui.flush();
    assert.equal(f.ui.find("TouchableOpacity", "Use microphone").props.disabled, true);
    assert.equal(f.captures, 0);
    assert.equal(f.wakes, 0);
    if (result === "never_ask_again") assert.match(f.ui.text(), /Android Settings/);
    f.ui.find("TextInput").props.onChangeText("set volume to 50%");
    f.ui.render();
    assert.equal(f.ui.find("TouchableOpacity", "Review command").props.disabled, false);
  }
});

test("a permission dialog returning from background cannot restore session consent or start capture", async (t) => {
  let finish;
  const f = permissionFixture(t, { request: () => new Promise((resolve) => { finish = resolve; }) });
  await f.ui.flush();
  f.ui.find("TouchableOpacity", "Grant microphone access").props.onPress();
  f.ui.find("TouchableOpacity", "Grant microphone access").props.onPress();
  assert.equal(f.requests, 1);
  f.ui.emit("change", "background");
  f.ui.emit("change", "active");
  await f.ui.flush(); // The foreground permission check may precede the dialog result.
  finish("granted");
  await f.ui.flush();
  assert.equal(f.ui.find("TouchableOpacity", "Allow the microphone").props.disabled, false);
  assert.equal(f.ui.find("TouchableOpacity", "Allow the microphone").props.accessibilityState.checked, false);
  assert.equal(f.captures, 0);
  assert.equal(f.wakes, 0);
});

test("late permission results are discarded after Close, sign-out or unmount", async (t) => {
  for (const change of ["close", "signout", "unmount"]) {
    let finish;
    const f = permissionFixture(t, { request: () => new Promise((resolve) => { finish = resolve; }) });
    await f.ui.flush();
    f.ui.find("TouchableOpacity", "Grant microphone access").props.onPress();
    if (change === "close") f.ui.find("TouchableOpacity", "Close").props.onPress();
    if (change === "signout") f.ui.render({ voiceAllowed: false, volumeUserId: undefined });
    if (change === "unmount") f.ui.unmount();
    finish("granted");
    if (change !== "unmount") {
      await f.ui.flush();
      assert.doesNotMatch(f.ui.text(), /Microphone access granted/);
      assert.equal(f.ui.find("TouchableOpacity", "Use microphone").props.disabled, true);
    }
    assert.equal(f.captures, 0);
    assert.equal(f.wakes, 0);
  }
});

test("Android permission setup is not exposed on iOS", async (t) => {
  const f = permissionFixture(t, { platform: "ios" });
  await f.ui.flush();
  assert.equal(f.ui.find("TouchableOpacity", "Grant microphone access"), undefined);
  assert.equal(f.ui.find("TouchableOpacity", "Allow the microphone").props.disabled, false);
  assert.equal(f.requests, 0);
});

test("wake readiness and command readiness are distinct until the recognizer reports ready", async (t) => {
  let detect, ready, finish;
  const ui = assistantUI("android", { theme: {}, voiceAllowed: true, onClose() {} }, "AssistantPreview", {
    wake: { mobileWakeAvailable: () => true, createMobileWakeAdapter: () => ({
      listen: async (_, listening) => { listening(); return new Promise((resolve) => { detect = resolve; }); },
    }) },
    voice: {
      availability: async () => ({ recognition: true, synthesis: false, message: "ready" }),
      listen: async (_, listening) => { ready = listening; return new Promise((resolve) => { finish = resolve; }); },
      stop() {}, cancel() {}, dispose() {}, speak: async () => {},
    },
  });
  t.after(() => ui.unmount());
  await ui.flush();
  ui.find("TouchableOpacity", "Allow the microphone").props.onPress(); ui.render();
  ui.find("TouchableOpacity", "Listen for Hey Contexify").props.onPress(); await ui.flush();
  assert.match(ui.text(), /Waiting for the wake phrase/);
  detect(true); await ui.flush();
  assert.match(ui.text(), /Starting command microphone/);
  // Static instructions quote the cue; inspect the actual live heading instead.
  assert.equal(ui.find("Text", "Assistant listening status").props.children, "Starting command microphone…");
  ready(); ui.render();
  assert.equal(ui.find("Text", "Assistant listening status").props.children, "Speak your command now");
  finish("set volume to 50%"); await ui.flush();
  assert.ok(ui.find("TouchableOpacity", "Review command"));
});

test("assistant wake is opt-in and hands off to editable voice without granting AI consent", async (t) => {
  const f = fixture(t); await f.ui.flush();
  assert.equal(f.starts, 0);
  assert.equal(f.ui.find("TouchableOpacity", "Listen for Hey Contexify").props.disabled, true);
  f.ui.find("TouchableOpacity", "Allow the microphone").props.onPress(); f.ui.render();
  f.ui.find("TouchableOpacity", "Listen for Hey Contexify").props.onPress(); await f.ui.flush();
  assert.equal(f.ui.find("TextInput").props.editable, false);
  assert.equal(f.ui.find("TouchableOpacity", "Use microphone").props.disabled, true);
  f.resolve(true); await f.ui.flush();
  assert.equal(f.captures, 1);
  assert.equal(f.ui.find("TextInput").props.value, "set volume to 50%");
  assert.ok(f.ui.find("TouchableOpacity", "Review command"));
  assert.equal(f.starts, 1);
});

test("AI consent can still be revoked during wake listening without authorizing a provider request", async (t) => {
  const before = process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "true";
  t.after(() => {
    if (before === undefined) delete process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
    else process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = before;
  });
  let requests = 0;
  const f = fixture(t, { cancel() {}, async planningContext() { requests++; throw Error("unexpected request"); } });
  await f.ui.flush();
  f.ui.find("TouchableOpacity", "Allow AI planning").props.onPress(); f.ui.render();
  f.ui.find("TouchableOpacity", "Allow the microphone").props.onPress(); f.ui.render();
  f.ui.find("TouchableOpacity", "Listen for Hey Contexify").props.onPress(); await f.ui.flush();
  const consent = f.ui.find("TouchableOpacity", "Allow AI planning");
  assert.equal(consent.props.disabled, false);
  consent.props.onPress(); f.ui.render();
  f.resolve(true); await f.ui.flush();
  assert.equal(f.captures, 1);
  assert.equal(requests, 0);
});

test("Close, Home, sign-out and microphone-consent revocation discard late wake detections", async (t) => {
  for (const change of ["close", "background", "signout", "consent"]) {
    const f = fixture(t); await f.ui.flush();
    f.ui.find("TouchableOpacity", "Allow the microphone").props.onPress(); f.ui.render();
    f.ui.find("TouchableOpacity", "Listen for Hey Contexify").props.onPress(); await f.ui.flush();
    if (change === "close") f.ui.find("TouchableOpacity", "Close").props.onPress();
    if (change === "background") f.ui.emit("change", "background");
    if (change === "signout") f.ui.render({ voiceAllowed: false, volumeUserId: undefined });
    if (change === "consent") f.ui.find("TouchableOpacity", "Allow the microphone").props.onPress();
    assert.equal(f.signal.aborted, true, change);
    f.resolve(true); await f.ui.flush();
    assert.equal(f.captures, 0, change);
    assert.equal(f.ui.find("TextInput").props.value, "", change);
  }
});
