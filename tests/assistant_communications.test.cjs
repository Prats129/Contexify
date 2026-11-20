const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { assistantUI } = require("./helpers/assistant_ui_fixture.cjs");

const core = createTypeScriptLoader()("packages/assistant-core/src/index.ts");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const valid = { kind: "sms", number: "+12025550123", body: "Test only" };

test("communication policy freezes one explicit international target without inventing a country", () => {
  const input = { ...valid, number: "+1 (202) 555-0123" };
  const result = core.communicationDraft(input);
  input.number = "+442079460123";
  assert.deepEqual(result, valid);
  for (const number of [
    "2025550123",
    "+0123456789",
    "+1,2025550123",
    "+12025550123;123",
    "tel:+12025550123",
    "+12025550123#",
    "+١٢٠٢٥٥٥٠١٢٣",
    "+1\n2025550123",
    "+123",
    "+1234567890123456",
  ])
    assert.throws(() => core.communicationDraft({ ...valid, number }));
});
test("private drafts reject hidden controls, overlong or ill-formed text and extra authority fields", () => {
  for (const body of [
    "",
    " ",
    "a\0b",
    "a\tb",
    "x\u202ey",
    "x\u2066y",
    "\ud800",
    "\udc00",
    "a".repeat(1001),
  ])
    assert.throws(() => core.communicationDraft({ ...valid, body }));
  for (const changes of [
    { kind: "send" },
    { url: "https://bad.invalid" },
    { package: "evil" },
    { approved: true },
    { recipients: [valid.number] },
  ])
    assert.throws(() => core.communicationDraft({ ...valid, ...changes }));
  assert.throws(() => core.communicationDraft({ ...valid, kind: "dial" }));
  assert.equal(
    core.communicationDraft({ ...valid, body: "Hello\n🙂" }).body,
    "Hello\n🙂",
  );
  assert.equal(
    core.communicationDraft({ ...valid, body: "a".repeat(1000) }).body.length,
    1000,
  );
  assert.equal(
    core.communicationDraft({ ...valid, kind: "dial", body: "" }).kind,
    "dial",
  );
});
test("result wording never treats an OS handoff or composer Send as delivery", () => {
  assert.match(
    core.communicationResult("handoff_requested"),
    /No call or message delivery has been verified/,
  );
  assert.match(
    core.communicationResult("sent_in_composer"),
    /Delivery and receipt are not verified/,
  );
  assert.match(core.communicationResult("unexpected"), /unknown/);
  assert.match(
    core.communicationResult("cancelled_in_composer"),
    /may retain a draft/,
  );
});

test("private input rejects prototypes and accessor properties without evaluating getters", () => {
  assert.throws(() =>
    core.communicationDraft(
      Object.assign(Object.create({ injected: true }), valid),
    ),
  );
  const input = { ...valid };
  let reads = 0;
  Object.defineProperty(input, "number", {
    enumerable: true,
    get() {
      reads++;
      return valid.number;
    },
  });
  assert.throws(() => core.communicationDraft(input));
  assert.equal(reads, 0);
});

function fixture(os = "android", missing = false) {
  const pick = deferred(),
    open = deferred();
  const calls = { picks: [], opens: [], cancels: [] };
  const state = { currentState: "active" };
  const native = {
    communicationSupport: async () => ({ picker: true, dial: true, sms: true }),
    pickPhoneNumber(id) {
      calls.picks.push(id);
      return pick.promise;
    },
    openCommunication(id, body) {
      calls.opens.push({ id, body });
      return open.promise;
    },
    async cancelCommunicationRequest(id) {
      calls.cancels.push(id);
    },
  };
  const load = createTypeScriptLoader({
    "react-native": { Platform: { OS: os }, AppState: state },
    "../../modules/assistant-platform": {
      assistantPlatform: () => (missing ? null : native),
    },
    "@contexify/assistant-core": core,
  });
  return {
    port: load(
      "mobile/src/services/assistant_communications.ts",
    ).createCommunicationCompanion(),
    native,
    calls,
    pick,
    open,
    state,
  };
}
test("missing/old bridges and web provide a manual alternative without a native request", async () => {
  for (const f of [
    fixture("web"),
    fixture("android", true),
    fixture("ios", true),
  ]) {
    assert.deepEqual(await f.port.support(), {
      picker: false,
      dial: false,
      sms: false,
    });
    await assert.rejects(f.port.open(valid), /unavailable/);
    assert.equal(f.calls.opens.length, 0);
  }
  const f = fixture();
  delete f.native.openCommunication;
  // A new service instance must detect an older, incomplete interface.
  const load = createTypeScriptLoader({
    "react-native": { Platform: { OS: "ios" }, AppState: f.state },
    "../../modules/assistant-platform": { assistantPlatform: () => f.native },
    "@contexify/assistant-core": core,
  });
  assert.equal(
    (
      await load("mobile/src/services/assistant_communications.ts")
        .createCommunicationCompanion()
        .support()
    ).sms,
    false,
  );
});
test("composer validation precedes native access, blocks duplicate requests and freezes the payload", async () => {
  const f = fixture();
  await assert.rejects(f.port.open({ ...valid, number: "123" }));
  assert.equal(f.calls.opens.length, 0);
  const draft = { ...valid };
  const operation = f.port.open(draft);
  draft.body = "changed after review";
  await assert.rejects(f.port.open(valid), /already open/);
  assert.deepEqual(JSON.parse(f.calls.opens[0].body), valid);
  f.open.resolve("handoff_requested");
  assert.match(
    await operation,
    /No call or message delivery has been verified/,
  );
});
test("close/background invalidates composer results and cancels only its own request", async () => {
  const f = fixture("ios");
  const operation = f.port.open(valid);
  f.state.currentState = "background";
  f.port.background();
  assert.deepEqual(f.calls.cancels, [f.calls.opens[0].id]);
  f.state.currentState = "active";
  f.open.resolve("sent_in_composer");
  assert.equal(await operation, "");
  f.port.dispose();
  await assert.rejects(f.port.open(valid));
});
test("Android's explicitly opened contact picker may return only its selected number after the OS activity", async () => {
  const f = fixture();
  const operation = f.port.pickNumber();
  f.state.currentState = "background";
  f.port.background();
  assert.equal(f.port.isPicking(), true);
  assert.equal(f.calls.cancels.length, 0);
  f.state.currentState = "active";
  f.pick.resolve({ outcome: "selected", number: "+1 (202) 555-0123" });
  assert.equal(await operation, "+1 (202) 555-0123");
  assert.equal(f.calls.opens.length, 0);
});
test("cancelled/late picker results cannot restore private data or approve an action", async () => {
  const f = fixture();
  const operation = f.port.pickNumber();
  f.port.cancel();
  f.pick.resolve({ outcome: "selected", number: valid.number });
  assert.equal(await operation, null);
  assert.equal(f.calls.opens.length, 0);
  const ios = fixture("ios");
  const pending = ios.port.pickNumber();
  ios.state.currentState = "background";
  ios.port.background();
  ios.state.currentState = "active";
  ios.pick.resolve({ outcome: "selected", number: valid.number });
  assert.equal(await pending, null);
  assert.equal(ios.calls.cancels.length, 1);
});
test("picker rejects unexpected content and never returns it to the UI", async () => {
  for (const value of [
    { outcome: "selected", number: "x" },
    { outcome: "selected", number: "1".repeat(65) },
    { outcome: "outcome_unknown", number: valid.number },
  ]) {
    const f = fixture();
    const pending = f.port.pickNumber();
    f.pick.resolve(value);
    await assert.rejects(pending, /selected number/);
  }
});
test("stale support responses are boolean-normalized; unsupported ports do not request permissions", async () => {
  const f = fixture();
  f.native.communicationSupport = async () => ({
    picker: "true",
    dial: 1,
    sms: true,
  });
  assert.deepEqual(await f.port.support(), {
    picker: false,
    dial: false,
    sms: true,
  });
  assert.equal(f.calls.picks.length + f.calls.opens.length, 0);
  f.state.currentState = "background";
  await assert.rejects(f.port.pickNumber());
});

function uiFixture(os = "android") {
  const pick = deferred(),
    open = deferred();
  let picking = false;
  const calls = { opens: [], cancel: 0, dispose: 0, background: 0 };
  const companion = {
    support: async () => ({ picker: true, dial: true, sms: true }),
    pickNumber() {
      picking = true;
      return pick.promise.finally(() => {
        picking = false;
      });
    },
    open(value) {
      calls.opens.push(value);
      return open.promise;
    },
    isPicking: () => picking,
    background() {
      calls.background++;
    },
    cancel() {
      calls.cancel++;
    },
    dispose() {
      calls.dispose++;
    },
  };
  const theme = {
    textMain: "black",
    textMuted: "gray",
    borderSubtle: "gray",
    bgCard: "white",
  };
  const ui = assistantUI(
    os,
    { userId: "test-user", theme, onClose() {} },
    "CommunicationManager",
    {
      communications: { createCommunicationCompanion: () => companion },
    },
  );
  return { ui, pick, open, calls };
}
test("private UI validates input and opens only an explicitly reviewed draft", async () => {
  const f = uiFixture();
  await f.ui.flush();
  f.ui.find("TouchableOpacity", "Review phone request").props.onPress();
  await f.ui.flush();
  assert.match(f.ui.text(), /Enter one international number/);
  assert.equal(f.calls.opens.length, 0);
  f.ui
    .find("TextInput", "International phone number")
    .props.onChangeText(valid.number);
  f.ui.render();
  f.ui.find("TouchableOpacity", "Text message").props.onPress();
  f.ui.render();
  f.ui.find("TextInput", "Message to review").props.onChangeText(valid.body);
  f.ui.render();
  f.ui.find("TouchableOpacity", "Review message request").props.onPress();
  f.ui.find("TouchableOpacity", "Review message request").props.onPress();
  assert.deepEqual(f.calls.opens, [valid]);
  f.open.resolve("Composer opened. Not delivered.");
  await f.ui.flush();
  assert.equal(
    f.ui.find("TextInput", "International phone number").props.value,
    "",
  );
  assert.equal(f.ui.find("TextInput", "Message to review").props.value, "");
  assert.match(f.ui.text(), /Not delivered/);
  f.ui.unmount();
});
test("UI clears private fields on background and ignores a late composer success", async () => {
  const f = uiFixture("ios");
  await f.ui.flush();
  f.ui
    .find("TextInput", "International phone number")
    .props.onChangeText(valid.number);
  f.ui.render();
  f.ui.find("TouchableOpacity", "Review phone request").props.onPress();
  f.ui.emit("change", "background");
  assert.equal(
    f.ui.find("TextInput", "International phone number").props.value,
    "",
  );
  f.ui.emit("change", "active");
  f.open.resolve("late private success");
  await f.ui.flush();
  assert.doesNotMatch(f.ui.text(), /late private success/);
  f.ui.unmount();
  assert.equal(f.calls.dispose, 1);
});
test("contact selection fills a field but never starts communication automatically", async () => {
  const f = uiFixture();
  await f.ui.flush();
  f.ui.find("TouchableOpacity", "Choose one contact number").props.onPress();
  f.ui.emit("change", "background");
  f.ui.emit("change", "active");
  f.pick.resolve(valid.number);
  await f.ui.flush();
  assert.equal(
    f.ui.find("TextInput", "International phone number").props.value,
    valid.number,
  );
  assert.equal(f.calls.opens.length, 0);
  f.ui.unmount();
});
test("the added Android manifest requests no contact, call, SMS or package-enumeration permission", () => {
  const manifest = fs.readFileSync(
    "mobile/modules/assistant-platform/android/src/main/AndroidManifest.xml",
    "utf8",
  );
  assert.doesNotMatch(
    manifest,
    /uses-permission|QUERY_ALL_PACKAGES|android:exported="true"/,
  );
  assert.match(manifest, /android.intent.action.DIAL/);
  assert.match(manifest, /android.intent.action.SENDTO/);
});
