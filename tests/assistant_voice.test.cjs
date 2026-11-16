const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const load = createTypeScriptLoader();
const { createCommandSession, describeAction } = load(
  "packages/assistant-core/src/voice.ts",
);
const { planCommand } = load("packages/assistant-core/src/planner.ts");
const { VoiceInputError } = load("packages/assistant-core/src/voice-errors.ts");
const { createBrowserVoiceAdapter } = load(
  "frontend/src/services/assistant_voice.ts",
);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("synthetic English transcripts preserve explicit commands and reject ambiguous/injected text", () => {
  const corpus = require("./fixtures/assistant-english-commands.json");
  for (const entry of corpus) {
    const result = planCommand(entry.text, entry.source ?? "user");
    if (entry.descriptions === null)
      assert.equal(result.status, "needs_clarification", entry.text);
    else {
      assert.equal(result.status, "proposed", entry.text);
      assert.deepEqual(
        result.proposal.steps.map((step) => describeAction(step.action)),
        entry.descriptions,
        entry.text,
      );
    }
  }
});

function voiceFixture(platform = "android") {
  const listening = deferred(),
    speaking = deferred();
  const calls = {
    listens: 0,
    cancels: 0,
    stops: 0,
    spoken: [],
    partial: null,
    ready: null,
  };
  const adapter = {
    availability: async () => ({
      recognition: true,
      synthesis: true,
      message: "Local speech ready.",
    }),
    listen: (partial, ready) => {
      calls.listens++;
      calls.partial = partial;
      calls.ready = ready;
      return listening.promise;
    },
    stop: () => {
      calls.stops++;
    },
    cancel: () => {
      calls.cancels++;
    },
    speak: (text) => {
      calls.spoken.push(text);
      return speaking.promise;
    },
    dispose: () => {},
  };
  const session = createCommandSession(adapter, platform);
  return { session, adapter, calls, listening, speaking };
}

test("typing works independently of voice, chat, storage and device authority", () => {
  const f = voiceFixture("web");
  f.session.setTranscript("set volume to 50% then open spotify");
  f.session.review();
  assert.deepEqual(f.session.getSnapshot().preview, [
    { description: "Set media volume to 50%.", availableOnPlatform: false },
    { description: "Open Spotify.", availableOnPlatform: true },
  ]);
  assert.equal(f.calls.listens, 0);
  assert.match(f.session.getSnapshot().message, /No device action/);
  f.session.setTranscript("open clock");
  assert.equal(f.session.getSnapshot().preview, null);
  f.session.dispose();
});
test("the reported 90% command explains the limit and a corrected draft stays preview-only", () => {
  const f = voiceFixture("web");
  f.session.setTranscript("set volume to 90%");
  f.session.review();
  assert.equal(f.session.getSnapshot().preview, null);
  assert.equal(
    f.session.getSnapshot().message,
    "Media volume must be a whole number from 0% to 70%.",
  );
  f.session.setTranscript("set volume to 50%");
  f.session.review();
  assert.equal(
    f.session.getSnapshot().preview[0].description,
    "Set media volume to 50%.",
  );
  assert.match(
    f.session.getSnapshot().message,
    /No device action has been performed/,
  );
  assert.equal(f.calls.listens, 0);
  f.session.dispose();
});

test("microphone always requires explicit session consent", async () => {
  const f = voiceFixture();
  await f.session.refreshAvailability();
  await f.session.listen();
  assert.equal(f.calls.listens, 0);
  assert.match(
    f.session.getSnapshot().message,
    /Select "Allow the microphone" first/,
  );
  f.session.setConsent(true);
  const pending = f.session.listen();
  f.calls.ready();
  f.calls.partial("open spot");
  assert.equal(f.session.getSnapshot().phase, "listening");
  assert.equal(f.session.getSnapshot().transcript, "");
  assert.equal(f.session.getSnapshot().preview, null);
  f.listening.resolve("open spotify");
  await pending;
  assert.equal(f.session.getSnapshot().transcript, "open spotify");
  assert.equal(f.session.getSnapshot().preview, null); // A transcript never authorizes or automatically plans.
  f.calls.partial("late private words");
  assert.equal(f.session.getSnapshot().partial, "");
  f.session.dispose();
});
test("background/close/consent revocation clears private state and rejects late results", async () => {
  for (const cancel of ["clear", "dispose", "consent"]) {
    const f = voiceFixture();
    await f.session.refreshAvailability();
    f.session.setConsent(true);
    const pending = f.session.listen();
    f.calls.partial("private draft");
    if (cancel === "consent") f.session.setConsent(false);
    else f.session[cancel]();
    f.listening.resolve("open spotify");
    await pending;
    const state = f.session.getSnapshot();
    assert.equal(state.transcript, "");
    assert.equal(state.partial, "");
    assert.equal(state.consent, false);
    assert.equal(state.preview, null);
    assert.equal(state.phase, "idle");
    f.session.dispose();
  }
});
test("manual editing cannot be overwritten by an old microphone result", async () => {
  const f = voiceFixture();
  await f.session.refreshAvailability();
  f.session.setConsent(true);
  const pending = f.session.listen();
  f.session.setTranscript("open clock");
  f.listening.resolve("open spotify");
  await pending;
  assert.equal(f.session.getSnapshot().transcript, "open clock");
  f.session.dispose();
});
test("one microphone operation runs at a time and Stop waits for an editable final", async () => {
  const f = voiceFixture();
  await f.session.refreshAvailability();
  f.session.setConsent(true);
  const pending = f.session.listen();
  await f.session.listen();
  assert.equal(f.calls.listens, 1);
  f.calls.ready();
  f.session.stop();
  assert.equal(f.calls.stops, 1);
  assert.equal(f.session.getSnapshot().phase, "processing");
  f.listening.resolve("brightness to 40 percent");
  await pending;
  assert.equal(f.session.getSnapshot().phase, "idle");
  assert.equal(f.session.getSnapshot().preview, null);
  f.session.dispose();
});
test("capture is bounded even when an adapter never settles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = voiceFixture();
  await f.session.refreshAvailability();
  f.session.setConsent(true);
  const pending = f.session.listen();
  t.mock.timers.tick(30001);
  await pending;
  assert.equal(f.session.getSnapshot().phase, "idle");
  assert.match(f.session.getSnapshot().message, /did not finish in time/);
  assert.ok(f.calls.cancels > 0);
  f.session.dispose();
});
test("Stop has a short deadline and does not accept a late final", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = voiceFixture();
  await f.session.refreshAvailability();
  f.session.setConsent(true);
  const pending = f.session.listen();
  f.session.stop();
  t.mock.timers.tick(5001);
  await pending;
  f.listening.resolve("open spotify");
  await Promise.resolve();
  assert.equal(f.session.getSnapshot().transcript, "");
  f.session.dispose();
});
test("invalid or oversized transcripts never get truncated into commands", async () => {
  for (const transcript of ["", " ", "x".repeat(1025), null]) {
    const f = voiceFixture();
    await f.session.refreshAvailability();
    f.session.setConsent(true);
    const pending = f.session.listen();
    f.listening.resolve(transcript);
    await pending;
    assert.equal(f.session.getSnapshot().transcript, "");
    assert.equal(f.session.getSnapshot().preview, null);
    f.session.dispose();
  }
});
test("only reviewed public action labels are spoken and editing cancels playback", async () => {
  const f = voiceFixture();
  await f.session.refreshAvailability();
  f.session.setTranscript("open clock");
  await f.session.readPreview();
  assert.equal(f.calls.spoken.length, 0);
  f.session.review();
  const speaking = f.session.readPreview();
  assert.equal(
    f.calls.spoken[0],
    "Preview only. Open Clock. No device action will be performed.",
  );
  assert.equal(f.session.getSnapshot().phase, "speaking");
  await f.session.listen();
  assert.equal(f.calls.listens, 0);
  f.session.setTranscript("open spotify");
  f.speaking.resolve();
  await speaking;
  assert.equal(f.session.getSnapshot().preview, null);
  assert.equal(f.session.getSnapshot().transcript, "open spotify");
  f.session.dispose();
});
test("late availability checks do not disable voice while someone types", async () => {
  const f = voiceFixture();
  const ready = deferred();
  f.adapter.availability = () => ready.promise;
  const refresh = f.session.refreshAvailability();
  f.session.setTranscript("open clock");
  ready.resolve({ recognition: true, synthesis: false, message: "Ready" });
  await refresh;
  assert.equal(f.session.getSnapshot().availability.recognition, true);
  f.session.dispose();
});
test("unresponsive availability checks fall back to text within a deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = voiceFixture();
  f.adapter.availability = () => new Promise(() => {});
  const ready = f.session.refreshAvailability();
  t.mock.timers.tick(3001);
  await ready;
  assert.equal(f.session.getSnapshot().availability.recognition, false);
  f.session.setTranscript("open clock");
  f.session.review();
  assert.equal(f.session.getSnapshot().preview[0].description, "Open Clock.");
  f.session.dispose();
});

function browserFixture(status = "available") {
  const calls = {
    starts: 0,
    checks: 0,
    installs: 0,
    spoken: [],
    cancels: 0,
    active: true,
    instances: [],
  };
  class Recognition {
    processLocally = false;
    constructor() {
      calls.instances.push(this);
    }
    static async available(options) {
      calls.checks++;
      assert.equal(options.processLocally, true);
      assert.deepEqual(options.langs, ["en-US"]);
      return status;
    }
    static install() {
      calls.installs++;
      throw Error("Must not install language packs");
    }
    start() {
      assert.equal(this.processLocally, true);
      calls.starts++;
      this.onstart?.();
    }
    stop() {}
    abort() {
      this.onend?.();
    }
    result(text, final = true) {
      this.onresult?.({
        results: [{ isFinal: final, 0: { transcript: text } }],
      });
    }
  }
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const local = { localService: true, lang: "en-US" },
    remote = { localService: false, lang: "en-US" };
  const host = {
    secure: true,
    active: () => calls.active,
    Recognition,
    Utterance,
    synthesis: {
      getVoices: () => [remote, local],
      speak: (utterance) => {
        calls.spoken.push(utterance);
      },
      cancel: () => {
        calls.cancels++;
      },
    },
  };
  return {
    calls,
    host,
    Recognition,
    local,
    remote,
    adapter: createBrowserVoiceAdapter(true, host),
  };
}
test("browser voice is off by default and performs no engine probes", async () => {
  const f = browserFixture();
  const adapter = createBrowserVoiceAdapter(false, f.host);
  assert.equal((await adapter.availability()).recognition, false);
  assert.equal(f.calls.checks, 0);
  assert.equal(f.calls.instances.length, 0);
  adapter.dispose();
});
for (const status of ["unavailable", "downloadable", "downloading"]) {
  test(`browser ${status} speech uses text without cloud or model installation`, async () => {
    const f = browserFixture(status);
    assert.equal((await f.adapter.availability()).recognition, false);
    await assert.rejects(
      f.adapter.listen(
        () => {},
        () => {},
      ),
    );
    assert.equal(f.calls.starts, 0);
    assert.equal(f.calls.installs, 0);
    f.adapter.dispose();
  });
}
test("a browser with only legacy recognition cannot use the microphone", async () => {
  const f = browserFixture();
  f.host.Recognition = class {
    start() {
      assert.fail("Legacy recognition must not start");
    }
  };
  const adapter = createBrowserVoiceAdapter(true, f.host);
  assert.equal((await adapter.availability()).recognition, false);
  await assert.rejects(
    adapter.listen(
      () => {},
      () => {},
    ),
  );
  adapter.dispose();
});
test("local browser recognition produces an editable final and cleans up events", async () => {
  const f = browserFixture();
  const partials = [];
  let ready = false;
  const pending = f.adapter.listen(
    (value) => partials.push(value),
    () => {
      ready = true;
    },
  );
  await flush();
  const recognition = f.calls.instances.at(-1);
  assert.equal(ready, true);
  recognition.result("open spot", false);
  assert.deepEqual(partials, ["open spot"]);
  recognition.result("open spotify");
  assert.equal(await pending, "open spotify");
  assert.equal(recognition.onresult, null);
  assert.equal(recognition.onend, null);
  f.adapter.dispose();
});
test("a mixed final/interim browser result cannot truncate a longer command", async () => {
  const f = browserFixture();
  const partials = [];
  const pending = f.adapter.listen(
    (text) => partials.push(text),
    () => {},
  );
  await flush();
  const recognition = f.calls.instances.at(-1);
  recognition.onresult({
    results: [
      { isFinal: true, 0: { transcript: "open clock " } },
      { isFinal: false, 0: { transcript: "then open spotify" } },
    ],
  });
  assert.deepEqual(partials, ["open clock then open spotify"]);
  assert.notEqual(recognition.onresult, null);
  recognition.result("open clock then open spotify");
  assert.equal(await pending, "open clock then open spotify");
  f.adapter.dispose();
});

test("closing during browser readiness cannot later activate a microphone", async () => {
  const f = browserFixture();
  const ready = deferred();
  f.Recognition.available = () => ready.promise;
  const pending = f.adapter.listen(
    () => assert.fail("late partial"),
    () => assert.fail("late capture"),
  );
  f.adapter.cancel();
  ready.resolve("available");
  await assert.rejects(pending);
  assert.equal(f.calls.starts, 0);
  f.adapter.dispose();
});
test("hidden/insecure browser contexts fail closed", async () => {
  for (const field of ["active", "secure"]) {
    const f = browserFixture();
    if (field === "active") f.calls.active = false;
    else f.host.secure = false;
    const adapter = createBrowserVoiceAdapter(true, f.host);
    await assert.rejects(
      adapter.listen(
        () => {},
        () => {},
      ),
    );
    assert.equal(f.calls.starts, 0);
    adapter.dispose();
  }
});
test("browser playback uses an explicitly local voice and cancel releases it", async () => {
  const f = browserFixture();
  const pending = f.adapter.speak("Preview only. Open Clock.");
  assert.equal(f.calls.spoken[0].voice, f.local);
  f.adapter.cancel();
  await assert.rejects(pending);
  assert.ok(f.calls.cancels > 0);
  f.host.synthesis.getVoices = () => [f.remote];
  assert.equal((await f.adapter.availability()).synthesis, false);
  await assert.rejects(f.adapter.speak("Must not use a remote voice"));
  f.adapter.dispose();
});

function mobileFixture(os = "android", enabled = true, missing = false) {
  const native = {
    callbacks: new Map(),
    listening: deferred(),
    stopped: deferred(),
    spoken: deferred(),
    cancels: [],
    id: null,
    availability: async () => ({
      recognition: true,
      synthesis: true,
      message: "Local",
    }),
    addListener(name, callback) {
      this.callbacks.set(name, callback);
      return { remove: () => this.callbacks.delete(name) };
    },
    listen(id, consent) {
      assert.equal(consent, true);
      this.id = id;
      return this.listening.promise;
    },
    stop() {
      return this.stopped.promise;
    },
    cancel(id) {
      this.cancels.push(id);
      return Promise.resolve();
    },
    speak(id) {
      this.id = id;
      return this.spoken.promise;
    },
  };
  let lookups = 0;
  const mobileLoad = createTypeScriptLoader({
    "react-native": { Platform: { OS: os } },
    "../../modules/assistant-voice": {
      assistantVoice: () => {
        lookups++;
        if (missing === "throw") throw Error("Native bridge unavailable");
        return missing ? null : native;
      },
    },
  });
  const { createMobileVoiceAdapter } = mobileLoad(
    "mobile/src/services/assistant_voice.ts",
  );
  return {
    native,
    adapter: createMobileVoiceAdapter(enabled),
    createCommandSession: mobileLoad("packages/assistant-core/src/voice.ts")
      .createCommandSession,
    get lookups() {
      return lookups;
    },
  };
}
test("disabled, iOS and old native builds retain text input", async () => {
  for (const [os, enabled, missing] of [
    ["android", false, false],
    ["ios", true, false],
    ["android", true, true],
  ]) {
    const f = mobileFixture(os, enabled, missing);
    assert.equal((await f.adapter.availability()).recognition, false);
    await assert.rejects(
      f.adapter.listen(
        () => {},
        () => {},
      ),
    );
    if (!enabled || os === "ios") assert.equal(f.lookups, 0);
    f.adapter.dispose();
  }
});

test("typed speech errors preserve fixed guidance and a bounded Android code", async () => {
  const f = voiceFixture();
  await f.session.refreshAvailability();
  f.session.setConsent(true);
  const pending = f.session.listen();
  const error = new VoiceInputError("language_unavailable", 13);
  error.message = "PRIVATE NATIVE EXCEPTION";
  f.listening.reject(error);
  await pending;
  assert.match(
    f.session.getSnapshot().message,
    /offline English recognizer is not ready/,
  );
  assert.match(f.session.getSnapshot().message, /Android speech error 13/);
  assert.doesNotMatch(f.session.getSnapshot().message, /PRIVATE/);
  assert.equal(f.session.getSnapshot().phase, "idle");
  f.session.dispose();
});

test("unknown platform errors never display raw exception messages", async () => {
  const f = voiceFixture();
  await f.session.refreshAvailability();
  f.session.setConsent(true);
  const pending = f.session.listen();
  f.listening.reject(Error("PRIVATE TRANSCRIPT OR PLATFORM DETAIL"));
  await pending;
  assert.equal(
    f.session.getSnapshot().message,
    "Voice stopped or unavailable. Type or try again.",
  );
  f.session.dispose();
});

test("an immediate native failure returns idle with a persistent error and remains retryable", async () => {
  const f = mobileFixture();
  f.native.listen = function (id) {
    this.id = id;
    return Promise.reject(Object.assign(Error("private engine detail"), { code: "ERR_SPEECH_13" }));
  };
  const session = f.createCommandSession(f.adapter, "android");
  await session.refreshAvailability();
  session.setConsent(true);
  const phases = [];
  const unsubscribe = session.subscribe(() => phases.push(session.getSnapshot().phase));
  for (let attempt = 0; attempt < 2; attempt++) {
    await session.listen();
    assert.equal(session.getSnapshot().phase, "idle");
    assert.equal(session.getSnapshot().consent, true);
    assert.match(session.getSnapshot().message, /Android speech error 13/);
    assert.doesNotMatch(session.getSnapshot().message, /private engine detail/);
    assert.equal(f.native.callbacks.size, 0);
  }
  assert.deepEqual(phases, ["starting", "idle", "starting", "idle"]);
  assert.equal(f.native.cancels.length, 2);
  unsubscribe();
  session.dispose();
});

test("Android speech and local interruption errors reach the real session as safe guidance", async () => {
  const cases = [
    ["ERR_SPEECH_1", /connection error/],
    ["ERR_SPEECH_2", /connection error/],
    ["ERR_SPEECH_3", /capture audio/],
    ["ERR_SPEECH_4", /service stopped/],
    ["ERR_SPEECH_5", /service stopped/],
    ["ERR_SPEECH_6", /No speech/],
    ["ERR_SPEECH_7", /could not understand/],
    ["ERR_SPEECH_8", /busy/],
    ["ERR_SPEECH_9", /permission was denied/],
    ["ERR_SPEECH_10", /busy/],
    ["ERR_SPEECH_11", /service stopped/],
    ["ERR_SPEECH_12", /cannot use the selected English/],
    ["ERR_SPEECH_13", /offline English recognizer is not ready/],
    ["ERR_VOICE_FOCUS", /audio focus/],
    ["ERR_VOICE_FOREGROUND", /interrupted/],
    ["ERR_VOICE_PERMISSION", /permission was denied/],
    ["ERR_VOICE_TIMEOUT", /did not finish in time/],
    ["ERR_VOICE_CANCELLED", /cancelled/],
    ["ERR_LOCAL_VOICE", /stopped or unavailable/],
    ["private arbitrary code", /stopped or unavailable/],
  ];
  for (const [code, expected] of cases) {
    const f = mobileFixture();
    const session = f.createCommandSession(f.adapter, "android");
    await session.refreshAvailability();
    session.setConsent(true);
    const pending = session.listen();
    f.native.listening.reject(
      Object.assign(Error("PRIVATE NATIVE DETAIL"), { code }),
    );
    await pending;
    assert.match(session.getSnapshot().message, expected, code);
    assert.doesNotMatch(session.getSnapshot().message, /PRIVATE NATIVE DETAIL/);
    assert.ok(f.native.cancels.includes(f.native.id), code);
    assert.equal(f.native.callbacks.size, 0);
    session.dispose();
  }
});

test("native error accessors are not evaluated and unsafe diagnostic codes are ignored", async () => {
  const f = mobileFixture();
  let reads = 0;
  const error = Object.defineProperty({}, "code", {
    get() {
      reads++;
      return "ERR_SPEECH_13";
    },
  });
  const pending = f.adapter.listen(
    () => {},
    () => {},
  );
  const rejected = assert.rejects(pending, /stopped or unavailable/);
  f.native.listening.reject(error);
  await rejected;
  assert.equal(reads, 0);
  for (const code of [NaN, -1, 14, Infinity, "13", {}])
    assert.doesNotMatch(
      new VoiceInputError("unavailable", code).message,
      /Android speech error/,
    );
  f.adapter.dispose();
});
test("native events are scoped to the current request and disposed subscriptions are removed", async () => {
  const f = mobileFixture();
  const partials = [];
  let ready = false;
  const pending = f.adapter.listen(
    (text) => partials.push(text),
    () => {
      ready = true;
    },
  );
  f.native.callbacks.get("onPartial")({ request_id: "old", text: "wrong" });
  f.native.callbacks.get("onPartial")({
    request_id: f.native.id,
    text: "open clock",
  });
  f.native.callbacks.get("onListening")({ request_id: f.native.id });
  assert.deepEqual(partials, ["open clock"]);
  assert.equal(ready, true);
  const oldId = f.native.id;
  f.adapter.cancel();
  f.native.listening.resolve("late private words");
  await assert.rejects(pending);
  assert.deepEqual(f.native.cancels, [oldId]);
  assert.equal(f.native.callbacks.size, 0);
  f.adapter.dispose();
});
test("a native bridge lookup error keeps text available", async () => {
  const f = mobileFixture("android", true, "throw");
  assert.equal((await f.adapter.availability()).recognition, false);
  await assert.rejects(
    f.adapter.listen(
      () => {},
      () => {},
    ),
  );
  f.adapter.dispose();
});
test("a partial native listener registration failure releases installed listeners", async () => {
  const f = mobileFixture();
  const add = f.native.addListener.bind(f.native);
  f.native.addListener = (name, callback) => {
    if (name === "onPartial") throw Error("Listener unavailable");
    return add(name, callback);
  };
  await assert.rejects(
    f.adapter.listen(
      () => {},
      () => {},
    ),
  );
  assert.equal(f.native.callbacks.size, 0);
  assert.equal(f.native.id, null);
  f.adapter.dispose();
});
test("a late native Stop failure cannot cancel a newer microphone request", async () => {
  const f = mobileFixture();
  const first = f.adapter.listen(
    () => {},
    () => {},
  );
  f.adapter.stop();
  f.adapter.cancel();
  f.native.listening.resolve("old");
  await assert.rejects(first);
  f.native.listening = deferred();
  const second = f.adapter.listen(
    () => {},
    () => {},
  );
  const newId = f.native.id;
  f.native.stopped.reject(Error("old Stop failure"));
  await flush();
  assert.ok(!f.native.cancels.includes(newId));
  f.native.listening.resolve("open clock");
  assert.equal(await second, "open clock");
  f.adapter.dispose();
});
