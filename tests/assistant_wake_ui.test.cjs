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
