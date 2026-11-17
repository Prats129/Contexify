// Offline tests of the real security/storage modules, with no OS or network access.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("../frontend/node_modules/typescript");
const { webcrypto } = require("node:crypto");
const { createTypeScriptLoader } = require("./helpers/typescript_modules.cjs");
const volumeSupport = createTypeScriptLoader()(
  "mobile/src/services/assistant_volume.ts",
);
const brightnessSupport = createTypeScriptLoader()(
  "mobile/src/services/assistant_brightness.ts",
);

function load(filename, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    URL,
    Date,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    TextEncoder,
    crypto: webcrypto,
    require: (name) => {
      if (name === "./assistant_volume") return volumeSupport;
      if (name === "./assistant_brightness") return brightnessSupport;
      if (name === "@contexify/assistant-core")
        return createTypeScriptLoader()("packages/assistant-core/src/index.ts");
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return exports;
}

function storageFixture() {
  const legacy = new Map(),
    encrypted = new Map();
  const asyncStorage = {
    getItem: async (key) => legacy.get(key) ?? null,
    removeItem: async (key) => {
      legacy.delete(key);
    },
  };
  const secure = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    isAvailableAsync: async () => true,
    getItemAsync: async (key) => encrypted.get(key) ?? null,
    setItemAsync: async (key, value, options) => {
      assert.equal(options.keychainAccessible, 6);
      encrypted.set(key, value);
    },
    deleteItemAsync: async (key) => {
      encrypted.delete(key);
    },
  };
  const platform = { OS: "android" };
  const storage = load("mobile/src/services/credential_storage.ts", {
    "@react-native-async-storage/async-storage": {
      __esModule: true,
      default: asyncStorage,
    },
    "expo-secure-store": secure,
    "react-native": { Platform: platform },
  }).credentialStorage;
  return { legacy, encrypted, secure, platform, storage };
}

const authKey = "contexify_auth_session";
const session = () =>
  JSON.stringify({
    access_token: "fixture-credential-32-characters-long",
    host: "https://api.fixture.invalid",
    expires_at: Date.now() / 1000 + 600,
    is_guest: false,
  });

test("native credentials migrate once and leave no plaintext copy", async () => {
  const fixture = storageFixture();
  const value = session();
  fixture.legacy.set(authKey, value);
  assert.equal(await fixture.storage.get(), value);
  assert.equal(fixture.encrypted.get(authKey), value);
  assert.equal(fixture.legacy.has(authKey), false);
  fixture.legacy.set(authKey, "stale backup credential");
  assert.equal(await fixture.storage.get(), value);
  assert.equal(fixture.legacy.has(authKey), false);
  await fixture.storage.clear();
  assert.equal(fixture.encrypted.has(authKey), false);
});

test("malformed expired or untrusted legacy sessions cannot migrate", async () => {
  for (const value of [
    "bad json",
    "{}",
    JSON.stringify({ ...JSON.parse(session()), expires_at: 1 }),
    JSON.stringify({
      ...JSON.parse(session()),
      host: "https://secret@evil.invalid",
    }),
  ]) {
    const fixture = storageFixture();
    fixture.legacy.set(authKey, value);
    assert.equal(await fixture.storage.get(), null);
    assert.equal(fixture.legacy.has(authKey), false);
    assert.equal(fixture.encrypted.size, 0);
  }
});

test("missing keychain and write failures never fall back to plaintext", async () => {
  const fixture = storageFixture();
  fixture.legacy.set(authKey, session());
  fixture.secure.isAvailableAsync = async () => false;
  await assert.rejects(
    fixture.storage.get(),
    /Secure credential storage is unavailable/,
  );
  assert.equal(fixture.legacy.size, 0);
  fixture.secure.isAvailableAsync = async () => true;
  fixture.secure.setItemAsync = async () => {
    throw new Error("keychain locked");
  };
  await assert.rejects(fixture.storage.set(session()), /keychain locked/);
  assert.equal(fixture.legacy.size, 0);
});

test("logout waits for migration and removes both copies", async () => {
  const fixture = storageFixture();
  fixture.legacy.set(authKey, session());
  const reading = fixture.storage.get();
  const clearing = fixture.storage.clear();
  await Promise.all([reading, clearing]);
  assert.equal(await fixture.storage.get(), null);
  assert.equal(fixture.encrypted.size, 0);
  assert.equal(fixture.legacy.size, 0);
});

test("failed or incomplete credential migration removes plaintext and requires sign-in", async () => {
  for (const incomplete of [false, true]) {
    const fixture = storageFixture();
    fixture.legacy.set(authKey, session());
    fixture.secure.setItemAsync = async () => {
      if (!incomplete) throw new Error("write failed");
      // Simulate an acknowledged write whose keychain readback is absent.
    };
    await assert.rejects(fixture.storage.get(), /Credential migration failed/);
    assert.equal(fixture.legacy.size, 0);
    assert.equal(fixture.encrypted.size, 0);
  }
});

test("mobile web credentials stay in memory and erase restored plaintext", async () => {
  const fixture = storageFixture();
  fixture.platform.OS = "web";
  fixture.legacy.set(authKey, session());
  assert.equal(await fixture.storage.get(), null);
  await fixture.storage.set(session());
  assert.equal(fixture.legacy.size, 0);
  assert.equal(fixture.encrypted.size, 0);
  assert.ok(await fixture.storage.get());
});

function webFixture() {
  const calls = [];
  let account = "fresh-login";
  let respond = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      csrf_token: "csrf-not-a-credential",
      expires_at: Date.now() / 1000 + 900,
    }),
  });
  const security = load(
    "frontend/src/services/assistant_security.ts",
    {},
    {
      window: { location: { origin: "https://web.fixture.invalid" } },
      fetch: async (url, options) => {
        calls.push({ url, options });
        return respond(url, options);
      },
    },
  ).createAssistantWebSecurity(
    async () => "https://api.fixture.invalid",
    async () => ({ Authorization: `Bearer ${account}` }),
  );
  return {
    calls,
    security,
    respond: (next) => {
      respond = next;
    },
    switchAccount: () => {
      account = "another-login";
    },
  };
}

test("web assistant uses cookie plus CSRF and only bootstraps with account bearer", async () => {
  const fixture = webFixture();
  await fixture.security.enable();
  await fixture.security.status();
  assert.equal(
    fixture.calls[0].options.headers.Authorization,
    "Bearer fresh-login",
  );
  const check = fixture.calls[1];
  assert.equal(check.options.credentials, "include");
  assert.equal(check.options.redirect, "error");
  assert.equal(check.options.headers["X-CSRF-Token"], "csrf-not-a-credential");
  assert.equal(check.options.headers.Authorization, undefined);
  await fixture.security.disable();
  await assert.rejects(fixture.security.status(), /Enable assistant security/);
});

test("web rejects an API origin without HTTPS before fetching", async () => {
  const security = load(
    "frontend/src/services/assistant_security.ts",
    {},
    {
      fetch: () => assert.fail("No insecure request"),
    },
  ).createAssistantWebSecurity(
    async () => "http://api.fixture.invalid",
    async () => ({}),
  );
  await assert.rejects(security.enable(), /HTTPS/);
});

test("late browser bootstrap after disable cannot restore local authority", async () => {
  const fixture = webFixture();
  let finish;
  fixture.respond(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const enabling = fixture.security.enable();
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await fixture.security.disable();
  finish({
    ok: true,
    json: async () => ({
      csrf_token: "stale",
      expires_at: Date.now() / 1000 + 900,
    }),
  });
  await assert.rejects(enabling, /session changed/);
  await assert.rejects(fixture.security.status(), /Enable assistant security/);
});

test("native security rejects a cross-host restored binding before device signing", async () => {
  const security = load(
    "mobile/src/services/assistant_security.ts",
    {
      "expo-secure-store": {
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
        getItemAsync: async () =>
          JSON.stringify({
            userId: "u1",
            host: "https://old.fixture.invalid",
            installationId: "old",
            deviceId: "old",
          }),
      },
      "react-native": { Platform: { OS: "android" } },
      "../../modules/assistant-device-security": {
        deviceSecurity: () => assert.fail("Must not use a restored key"),
      },
    },
    { fetch: () => assert.fail("Must not send restored authority") },
  ).createAssistantDeviceSecurity(
    async () => "https://new.fixture.invalid",
    async () => ({}),
  );
  await assert.rejects(
    security.openSession("u1"),
    /Enroll this account and device/,
  );
});

test("web rejects a late bootstrap after the signed-in account changes", async () => {
  const fixture = webFixture();
  fixture.respond(async () => {
    fixture.switchAccount();
    return {
      ok: true,
      json: async () => ({
        csrf_token: "old-account",
        expires_at: Date.now() / 1000 + 900,
      }),
    };
  });
  await assert.rejects(fixture.security.enable(), /session changed/);
  await assert.rejects(fixture.security.status(), /Enable assistant security/);
});

test("web never reads an old account's device list after switching login", async () => {
  const fixture = webFixture();
  await fixture.security.enable();
  fixture.switchAccount();
  await assert.rejects(fixture.security.devices(), /sign-in changed/);
  assert.equal(fixture.calls.length, 1);
});

test("web discards a private response if the account changes while its body arrives", async () => {
  const fixture = webFixture();
  await fixture.security.enable();
  fixture.respond(async () => ({
    ok: true,
    status: 200,
    json: async () => {
      fixture.switchAccount();
      return [{ device_id: "private-old-account" }];
    },
  }));
  await assert.rejects(fixture.security.devices(), /sign-in changed/);
});

test("native discards a late response after the parent login changes", async () => {
  let account = "first-login";
  const security = load(
    "mobile/src/services/assistant_security.ts",
    {
      "expo-secure-store": {
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
        getItemAsync: async () =>
          JSON.stringify({
            userId: "u1",
            host: "https://api.fixture.invalid",
            installationId: "fixture",
            deviceId: "fixture",
          }),
      },
      "react-native": { Platform: { OS: "android" } },
      "../../modules/assistant-device-security": {
        deviceSecurity: () =>
          assert.fail("Do not sign after an account change"),
      },
    },
    {
      fetch: async () => ({
        ok: true,
        json: async () => {
          account = "another-login";
          return { challenge_id: "old-account", payload: "old-account" };
        },
      }),
    },
  ).createAssistantDeviceSecurity(
    async () => "https://api.fixture.invalid",
    async () => ({ Authorization: `Bearer ${account}` }),
  );
  await assert.rejects(security.openSession("u1"), /sign-in changed/);
});
