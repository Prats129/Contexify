const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const { createWakeSession } = createTypeScriptLoader()("packages/assistant-core/src/wake.ts");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture() {
  const released = deferred();
  let allowed = true, listens = 0, commands = 0, signal;
  const wake = createWakeSession({
    async listen(current, ready) {
      listens++; signal = current; ready();
      return released.promise; // Represents capture AND native cleanup completion.
    },
  }, () => allowed, async () => { commands++; });
  return { wake, released, deny() { allowed = false; },
    get listens() { return listens; }, get commands() { return commands; }, get signal() { return signal; } };
}

test("wake hands off exactly once after capture releases and never auto-rearms", async () => {
  const f = fixture();
  const running = f.wake.start();
  assert.equal(f.wake.getSnapshot().phase, "listening");
  await f.wake.start();
  assert.equal(f.listens, 1);
  assert.equal(f.commands, 0);
  f.released.resolve(true);
  await running;
  assert.equal(f.commands, 1);
  assert.equal(f.listens, 1);
  assert.equal(f.wake.getSnapshot().phase, "idle");
  assert.equal(f.wake.getSnapshot().message, "");
});

test("revoked consent, cancellation, disposal and timeout cannot activate command capture", async () => {
  for (const reason of ["consent", "cancel", "dispose", "no_detection"]) {
    const f = fixture();
    const running = f.wake.start();
    if (reason === "consent") f.deny();
    if (reason === "cancel") { f.wake.cancel(); assert.equal(f.signal.aborted, true); }
    if (reason === "dispose") f.wake.dispose();
    f.released.resolve(reason !== "no_detection");
    await running;
    assert.equal(f.commands, 0, reason);
  }
  const f = fixture(); f.deny(); await f.wake.start(); assert.equal(f.listens, 0);
});

test("a bounded session aborts its adapter without rearming or leaking provider details", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const running = f.wake.start();
  t.mock.timers.tick(45000);
  assert.equal(f.signal.aborted, true);
  f.released.resolve(true); await running;
  assert.equal(f.commands, 0);
  assert.match(f.wake.getSnapshot().message, /timed out/);
  const failed = createWakeSession({ listen: async () => { throw Error("PRIVATE NATIVE DETAIL"); } }, () => true, async () => assert.fail());
  await failed.start();
  assert.doesNotMatch(failed.getSnapshot().message, /PRIVATE/);
});

test("actual command session keeps AI consent independent after wake activation", async () => {
  const { createCommandSession } = createTypeScriptLoader()("packages/assistant-core/src/voice.ts");
  let plans = 0;
  const command = createCommandSession({
    availability: async () => ({ recognition: true, synthesis: false, message: "ready" }),
    listen: async () => "set volume to 50%", cancel() {}, stop() {}, dispose() {}, speak: async () => {},
  }, "android", { plan: async () => { plans++; throw Error("not authorized"); }, close() {} });
  await command.refreshAvailability();
  command.setConsent(true);
  const wake = createWakeSession({ listen: async () => true }, () => command.getSnapshot().consent, () => command.listen());
  await wake.start();
  assert.equal(command.getSnapshot().transcript, "set volume to 50%");
  assert.equal(command.getSnapshot().planningConsent, false);
  assert.equal(plans, 0);
  command.setPlanningConsent(true);
  await wake.start();
  assert.equal(plans, 1);
  command.dispose(); wake.dispose();
});
