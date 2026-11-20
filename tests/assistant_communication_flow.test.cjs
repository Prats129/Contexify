const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { assistantUI } = require("./helpers/assistant_ui_fixture.cjs");
const {
  fixture: deviceFixture,
} = require("./helpers/device_control_fixture.cjs");
const load = createTypeScriptLoader();
const core = load("packages/assistant-core/src/index.ts");
const uuid = "12345678-1234-4123-8123-123456789abc";
const sample = core.PUBLIC_COMMUNICATION_CASES;
// Deliberately different from the core's validation-only placeholder recipient.
const number = "+12025550124";
const message = "This is a Contexify test.";
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function proposal(overrides = {}) {
  return {
    protocol_version: 1,
    mode: "proposal",
    status: "communication_proposed",
    capability_id: "communication.compose",
    request_kind: "sms",
    recipient: "local_picker",
    message,
    ...overrides,
  };
}
function envelope(value = proposal(), overrides = {}) {
  return {
    plan_id: uuid,
    revision: 1,
    owner_user_id: "test-user",
    owner_device_id: uuid,
    expires_at: Date.now() / 1000 + 120,
    execution: "not_authorized",
    proposal: value,
    ...overrides,
  };
}
function planning(value = envelope()) {
  const calls = [];
  let connections = 0;
  const context = {
    userId: "test-user",
    deviceId: uuid,
    async request(path, body, signal) {
      calls.push({ path, body, signal });
      if (path === "/grants")
        return {
          grant_id: uuid,
          scope: "assistant:plan",
          consent_policy_version: 1,
          data_scope: "synthetic_evaluation",
          expires_at: Date.now() / 1000 + 300,
        };
      if (path.endsWith("/revoke")) return {};
      return typeof value === "function" ? value() : value;
    },
  };
  return {
    calls,
    context,
    connect: async () => {
      connections++;
      return context;
    },
    connections: () => connections,
  };
}
test("approved corpora preserve the existing settings scope and exact quoted message bytes", () => {
  const old = JSON.parse(
    fs.readFileSync("tests/fixtures/assistant-planner-evaluation.json", "utf8"),
  )
    .cases.filter((item) => item.source === "user")
    .map((item) => item.text);
  assert.deepEqual([...core.PUBLIC_SETTINGS_COMMANDS], old);
  for (const [id, text] of Object.entries(sample))
    assert.deepEqual(core.publicCommunicationInput(text), {
      text,
      synthetic_case_id: id,
    });
  assert.throws(
    () => core.publicCommunicationInput(sample["M7-03"].toLowerCase()),
    /not sent/,
  );
  assert.deepEqual(
    core.publicCommunicationInput(
      ' DRAFT  a text saying "This is a Contexify test." for a contact I choose. ',
    ),
    { text: sample["M7-03"], synthetic_case_id: "M7-03" },
  );
});
test("real/private command text is rejected before connection, grants or model traffic", async () => {
  const f = planning();
  const planner = core.createCommunicationPlanner(f.connect);
  for (const text of [
    "text my real friend a private message",
    sample["M7-03"] + " secret",
    "call +12025550123",
  ])
    await assert.rejects(
      planner.plan(text, new AbortController().signal),
      /not sent/,
    );
  assert.equal(f.connections(), 0);
  assert.equal(f.calls.length, 0);
});
test("communication plans reuse consent, owner binding, route whitelist and revocation", async () => {
  const f = planning();
  const planner = core.createCommunicationPlanner(f.connect);
  const result = await planner.plan(
    sample["M7-03"],
    new AbortController().signal,
  );
  await planner.plan(sample["M7-03"], new AbortController().signal);
  assert.equal(f.connections(), 1);
  assert.deepEqual(
    f.calls.map((item) => item.path),
    ["/grants", "/communication-proposals", "/communication-proposals"],
  );
  assert.deepEqual(f.calls[1].body, {
    grant_id: uuid,
    text: sample["M7-03"],
    synthetic_case_id: "M7-03",
    source: "user",
  });
  assert.equal(core.reviewedCommunication(result).kind, "sms");
  assert.equal(
    core.planningPath("/communication-proposals"),
    "/api/v1/assistant/planning/communication-proposals",
  );
  assert.throws(() => core.planningPath("/send-message"));
  planner.close();
  assert.match(f.calls.at(-1).path, /revoke$/);
});
test("untrusted proposal fields, wrong ownership, expired authority and invented message are rejected", async () => {
  const context = planning().context;
  for (const value of [
    envelope(proposal({ number })),
    envelope(proposal({ recipient: number })),
    envelope(proposal({ confirmed: true })),
    envelope(proposal({ request_kind: "send_sms" })),
    envelope(proposal({ request_kind: ["sms"], message: null })),
    envelope({
      protocol_version: 1,
      mode: "proposal",
      status: ["non_action"],
      reason: "not_a_command",
    }),
    envelope(proposal({ message: "\u202eevil" })),
    envelope(proposal({ message: "" })),
    envelope(proposal({ request_kind: "dial", message: null })),
    envelope(proposal(), { owner_user_id: "other" }),
    envelope(proposal(), { owner_device_id: null }),
    envelope(proposal(), { expires_at: Date.now() / 1000 - 1 }),
    envelope(proposal(), { execution: "authorized" }),
  ])
    assert.throws(() =>
      core.validateCommunicationPlanningResponse(value, context),
    );
  const f = planning(envelope(proposal({ message: "invented body" })));
  const planner = core.createCommunicationPlanner(f.connect);
  await assert.rejects(
    planner.plan(sample["M7-03"], new AbortController().signal),
    /changed the requested message/,
  );
  planner.close();
});
test("close discards late model replies and a duplicate request never sends twice", async () => {
  const reply = deferred();
  const f = planning(() => reply.promise);
  const planner = core.createCommunicationPlanner(f.connect);
  const first = planner.plan(sample["M7-03"], new AbortController().signal);
  await assert.rejects(
    planner.plan(sample["M7-03"], new AbortController().signal),
    /already in progress/,
  );
  await new Promise((r) => setImmediate(r));
  planner.close();
  await assert.rejects(first, /cancelled/);
  reply.resolve(envelope());
  assert.equal(
    f.calls.filter((item) => item.path === "/communication-proposals").length,
    1,
  );
});
test("main public router blocks private egress and routes communication without inventing actions", async () => {
  const f = planning();
  const opened = [];
  const router = core.createPublicAssistantPlanner(f.connect, (text) =>
    opened.push(text),
  );
  await assert.rejects(
    router.plan(
      "text a real person my private words",
      new AbortController().signal,
    ),
    /not sent/,
  );
  await assert.rejects(
    router.plan(sample["M7-01"], new AbortController().signal),
    /Continue/,
  );
  assert.deepEqual(opened, [sample["M7-01"]]);
  assert.equal(f.connections(), 0);
  router.close();
});
test("browser AI input preserves local privacy and reports native-only communications without a request", async () => {
  const f = planning();
  const ui = assistantUI("web", {
    onClose() {},
    planningAccess: { planningContext: f.connect },
    planningUserId: "test-user",
  });
  await ui.flush();
  ui.find("input").props.onChange({ target: { checked: true } });
  ui.render();
  for (const [text, expected] of [
    ["text PrivatePerson my private words", /not sent/],
    [sample["M7-01"], /supported native app/],
  ]) {
    ui.find("textarea").props.onChange({ target: { value: text } });
    ui.render();
    ui.find("button", "Send command").props.onClick();
    await ui.flush();
    assert.match(ui.text(), expected);
    assert.equal(f.connections(), 0);
  }
  ui.unmount();
});
test("the real enrolled-device transport admits the new route with management auth and no effect signer", async (t) => {
  const f = deviceFixture(t),
    previous = global.fetch,
    calls = [];
  global.fetch = async (url, options) => {
    if (!url.includes("/planning/")) return previous(url, options);
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({ proposal: "synthetic transport fixture" }),
    };
  };
  t.after(() => {
    global.fetch = previous;
  });
  const context = await f.api.planningContext(
    f.binding.userId,
    new AbortController().signal,
  );
  const body = {
    grant_id: uuid,
    ...core.publicCommunicationInput(sample["M7-03"]),
    source: "user",
  };
  await context.request(
    "/communication-proposals",
    body,
    new AbortController().signal,
  );
  assert.match(calls[0].url, /\/planning\/communication-proposals$/);
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer fixture-management",
  );
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
  assert.equal(f.calls(), 0);
  f.api.cancel();
  await assert.rejects(
    context.request(
      "/communication-proposals",
      body,
      new AbortController().signal,
    ),
    /sign-in changed/,
  );
});

const theme = {
  textMain: "black",
  textMuted: "gray",
  borderSubtle: "gray",
  bgCard: "white",
};
function manager({
  output = envelope(),
  updated = true,
  os = "android",
  initialRequest,
} = {}) {
  const f = planning(output);
  const pick = deferred(),
    open = deferred();
  let picking = false;
  const calls = { pick: 0, open: [], cancel: 0 };
  const companion = {
    planningSupported: () => updated,
    support: async () => ({ picker: true, dial: true, sms: true }),
    pickNumber() {
      calls.pick++;
      picking = true;
      return pick.promise.finally(() => {
        picking = false;
      });
    },
    open(draft, expiry) {
      calls.open.push({ draft, expiry });
      return open.promise;
    },
    isPicking: () => picking,
    background() {},
    cancel() {
      calls.cancel++;
    },
    dispose() {
      calls.cancel++;
    },
  };
  const ui = assistantUI(
    os,
    {
      userId: "test-user",
      theme,
      onClose() {},
      planningConnect: f.connect,
      initialRequest,
    },
    "CommunicationManager",
    { communications: { createCommunicationCompanion: () => companion } },
  );
  function press(label) {
    const node = ui.find("TouchableOpacity", label);
    assert.ok(node, label);
    node.props.onPress();
    ui.render();
  }
  async function send(text = sample["M7-03"]) {
    await ui.flush();
    press("Allow AI processing");
    ui.find("TextInput", "Public communication command").props.onChangeText(
      text,
    );
    ui.render();
    press("Send public command");
    await ui.flush();
  }
  return { ...f, ui, pick, open, calls, requests: f.calls, press, send };
}
test("AI-to-picker-to-native flow keeps selected private number outside every backend payload", async () => {
  const f = manager();
  await f.send();
  assert.equal(f.calls.pick, 1);
  assert.equal(f.calls.open.length, 0);
  f.ui.emit("change", "background");
  f.ui.emit("change", "active");
  f.pick.resolve(number);
  await f.ui.flush();
  assert.deepEqual(f.calls.open[0].draft, {
    kind: "sms",
    number,
    body: message,
  });
  assert.ok(f.calls.open[0].expiry > Date.now());
  assert.equal(
    JSON.stringify(f.requests.map((item) => item.body)).includes(number),
    false,
  );
  f.open.resolve("Phone app opened. Delivery is not verified.");
  await f.ui.flush();
  assert.match(f.ui.text(), /Delivery is not verified/);
  assert.equal(
    f.ui.find("TextInput", "International phone number").props.value,
    "",
  );
  f.ui.unmount();
});
test("missing message is completed privately with no second AI request", async () => {
  const f = manager({ output: envelope(proposal({ message: null })) });
  await f.send(sample["M7-10"]);
  assert.match(f.ui.text(), /missing message privately/);
  assert.equal(f.calls.pick, 0);
  f.ui
    .find("TextInput", "Message to review")
    .props.onChangeText("locally completed private words");
  f.ui.render();
  f.press("Review message request");
  f.pick.resolve(number);
  await f.ui.flush();
  assert.equal(f.calls.open[0].draft.body, "locally completed private words");
  assert.equal(
    f.requests.filter((item) => item.path === "/communication-proposals")
      .length,
    1,
  );
  assert.doesNotMatch(JSON.stringify(f.requests), /locally completed/);
  f.open.resolve("cancelled");
  await f.ui.flush();
  f.ui.unmount();
});
test("cancelled picker, unsupported feedback and missing native method produce no handoff", async () => {
  const cancel = manager();
  await cancel.send();
  cancel.pick.resolve(null);
  await cancel.ui.flush();
  assert.match(cancel.ui.text(), /selection cancelled/);
  assert.equal(cancel.calls.open.length, 0);
  cancel.ui.unmount();
  const unsupported = manager({
    output: envelope({
      protocol_version: 1,
      mode: "proposal",
      status: "unsupported",
      reason: "unsupported_request",
    }),
  });
  await unsupported.send(sample["M7-06"]);
  assert.equal(unsupported.calls.pick, 0);
  assert.match(unsupported.ui.text(), /Nothing was opened/);
  unsupported.ui.unmount();
  const old = manager({ updated: false });
  await old.send();
  assert.equal(old.requests.length, 0);
  assert.equal(old.calls.pick, 0);
  old.ui.unmount();
});
test("private text typed in AI field never connects and private manual fallback still works", async () => {
  const f = manager();
  await f.send("text my real contact a private message");
  assert.equal(f.connections(), 0);
  assert.equal(f.calls.pick, 0);
  assert.match(f.ui.text(), /not sent/);
  f.ui
    .find("TextInput", "International phone number")
    .props.onChangeText(number);
  f.ui.render();
  f.press("Review phone request");
  assert.deepEqual(f.calls.open[0], {
    draft: { kind: "dial", number, body: "" },
    expiry: undefined,
  });
  f.open.resolve("cancelled");
  await f.ui.flush();
  f.ui.unmount();
});
test("Close, account change, consent removal and unexpected background invalidate late picker data", async () => {
  for (const mode of ["close", "account", "consent", "background"]) {
    const f = manager({ os: "ios" });
    await f.send();
    if (mode === "close") f.press("Back");
    if (mode === "consent") f.press("Allow AI processing");
    if (mode === "account") f.ui.render({ userId: "different-user" });
    if (mode === "background") {
      f.ui.emit("change", "background");
      f.ui.emit("change", "active");
    }
    f.pick.resolve(number);
    await f.ui.flush();
    assert.equal(f.calls.open.length, 0, mode);
    assert.equal(
      f.ui.find("TextInput", "International phone number").props.value,
      "",
    );
    f.ui.unmount();
  }
});
test("national-only selected number needs local correction; no inferred country or extra model call", async () => {
  const f = manager();
  await f.send();
  f.pick.resolve("2025550124");
  await f.ui.flush();
  assert.equal(f.calls.open.length, 0);
  assert.match(f.ui.text(), /No country code was guessed/);
  f.ui
    .find("TextInput", "International phone number")
    .props.onChangeText(number);
  f.ui.render();
  f.press("Review message request");
  await f.ui.flush();
  assert.equal(f.calls.open[0].draft.number, number);
  f.open.resolve("cancelled");
  await f.ui.flush();
  assert.equal(
    f.requests.filter((item) => item.path === "/communication-proposals")
      .length,
    1,
  );
  f.ui.unmount();
});
test("expired proposal cannot continue after local selection", async () => {
  const f = manager({
    output: envelope(proposal(), { expires_at: Date.now() / 1000 + 1 }),
  });
  await f.send();
  const original = Date.now;
  Date.now = () => original() + 5000;
  try {
    f.pick.resolve(number);
    await f.ui.flush();
    assert.equal(f.calls.open.length, 0);
    assert.match(f.ui.text(), /expired/);
  } finally {
    Date.now = original;
    f.ui.unmount();
  }
});
test("main assistant routes only after explicit consent and Send on Android and iOS", async (t) => {
  const old = process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
  process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = "true";
  t.after(() => {
    if (old === undefined)
      delete process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED;
    else process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED = old;
  });
  for (const os of ["android", "ios"]) {
    const f = planning();
    const ui = assistantUI(os, {
      theme,
      volumeUserId: "test-user",
      volumeControls: { planningContext: f.connect, cancel() {} },
      onClose() {},
    });
    await ui.flush();
    ui.find("TextInput").props.onChangeText(sample["M7-01"]);
    ui.render();
    assert.equal(ui.find("CommunicationManager"), undefined);
    ui.find("TouchableOpacity", "Allow AI planning").props.onPress();
    ui.render();
    ui.find("TouchableOpacity", "Send command").props.onPress();
    await ui.flush();
    const child = ui.find("CommunicationManager");
    assert.ok(child, os);
    assert.deepEqual(child.props.initialRequest, {
      text: sample["M7-01"],
      consent: true,
      createdAt: child.props.initialRequest.createdAt,
      ownerUserId: "test-user",
    });
    assert.equal(f.connections(), 0);
    ui.unmount();
  }
});
test("initial consent transfer is one-shot, fresh and bound to the signed-in account", async () => {
  const fresh = {
    text: sample["M7-01"],
    consent: true,
    createdAt: Date.now(),
    ownerUserId: "test-user",
  };
  const accepted = manager({
    output: envelope(proposal({ request_kind: "dial", message: "" })),
    initialRequest: fresh,
  });
  await accepted.ui.flush();
  accepted.ui.render();
  await accepted.ui.flush();
  assert.equal(accepted.calls.pick, 1);
  accepted.pick.resolve(null);
  await accepted.ui.flush();
  accepted.ui.unmount();
  for (const initialRequest of [
    { ...fresh, ownerUserId: "previous-user" },
    { ...fresh, createdAt: Date.now() - 6000 },
  ]) {
    const f = manager({ initialRequest });
    await f.ui.flush();
    assert.equal(f.connections(), 0);
    assert.equal(f.calls.pick, 0);
    f.ui.unmount();
  }
});
test("a final local voice transcript enters M7 only with both microphone and AI consent", async () => {
  const f = planning(),
    opened = [];
  const voice = {
    availability: async () => ({
      recognition: true,
      synthesis: false,
      message: "Local",
    }),
    listen: async () => sample["M7-01"],
    stop() {},
    cancel() {},
    speak: async () => {},
    dispose() {},
  };
  let session;
  const router = core.createPublicAssistantPlanner(f.connect, (text) => {
    opened.push(text);
    session.clear();
  });
  session = core.createCommandSession(voice, "android", router);
  await session.refreshAvailability();
  session.setConsent(true);
  await session.listen();
  assert.equal(opened.length, 0);
  assert.equal(f.connections(), 0);
  session.setPlanningConsent(true);
  await session.listen();
  assert.deepEqual(opened, [sample["M7-01"]]);
  assert.equal(f.connections(), 0);
  assert.equal(session.getSnapshot().consent, false);
  session.dispose();
});
test("planned bridge requires a live proposal deadline and the new native method", async () => {
  const calls = [];
  const state = { currentState: "active" };
  const native = {
    communicationSupport: async () => ({ picker: true, dial: true, sms: true }),
    pickPhoneNumber() {},
    openCommunication() {},
    cancelCommunicationRequest: async () => {},
    openPlannedCommunication: async (...args) => {
      calls.push(args);
      return "handoff_requested";
    },
  };
  const serviceLoad = createTypeScriptLoader({
    "react-native": { Platform: { OS: "android" }, AppState: state },
    "../../modules/assistant-platform": { assistantPlatform: () => native },
    "@contexify/assistant-core": core,
  });
  const port = serviceLoad(
    "mobile/src/services/assistant_communications.ts",
  ).createCommunicationCompanion();
  const draft = { kind: "sms", number, body: message };
  for (const expiry of [NaN, Infinity, Date.now() - 1, Date.now() + 186000])
    await assert.rejects(port.open(draft, expiry), /expired/);
  assert.equal(calls.length, 0);
  const expiry = Date.now() + 120000;
  assert.match(
    await port.open(draft, expiry),
    /No call or message delivery has been verified/,
  );
  assert.equal(calls[0][2], expiry);
  assert.deepEqual(JSON.parse(calls[0][1]), draft);
  delete native.openPlannedCommunication;
  assert.equal(port.planningSupported(), false);
  await assert.rejects(port.open(draft, expiry));
  port.dispose();
});
