// Offline tests of the actual web/native API facades; no server or device needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../frontend/node_modules/typescript");

function client(platform, handleRequest) {
  const storage = new Map();
  const requests = [];
  const uploads = [];
  class XHR {
    constructor() {
      this.headers = {};
      this.status = 200;
      this.responseText = "{}";
      uploads.push(this);
    }
    open(method, url) {
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send() {
      this.sent = true;
    }
    abort() {}
  }
  const exports = {};
  const context = {
    exports,
    Headers,
    URLSearchParams,
    AbortController,
    console,
    setTimeout,
    clearTimeout,
    process: { env: {} },
    XMLHttpRequest: XHR,
    FormData: class {
      append() {}
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    require: (name) => {
      if (name === "@react-native-async-storage/async-storage")
        return {
          default: {
            getItem: async (key) => storage.get(key) ?? null,
            setItem: async (key, value) => {
              storage.set(key, value);
            },
            removeItem: async (key) => {
              storage.delete(key);
            },
          },
        };
      if (name === "react-native")
        return { Platform: { select: () => "http://fixture.invalid" } };
      throw new Error(`Unexpected runtime import: ${name}`);
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      return handleRequest(url, options);
    },
  };
  const source = fs
    .readFileSync(
      path.join(__dirname, "..", platform, "src/services/api.ts"),
      "utf8",
    )
    .replaceAll("import.meta.env", "({})");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(code, context);
  return {
    api: exports.apiService,
    setApiBaseUrl: exports.setApiBaseUrl,
    storage,
    requests,
    uploads,
  };
}

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
const profile = {
  id: "u1",
  username: "fixture",
  email: "fixture@example.invalid",
  display_name: "Fixture",
};
const credentials = (token) => ({
  ...profile,
  access_token: token,
  token_type: "bearer",
  expires_at: Date.now() / 1000 + 3600,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (condition()) return;
    await tick();
  }
  throw new Error("Expected mocked operation did not start");
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: cached profile alone is not a credential`, async () => {
    const fixture = client(platform, (url) => {
      if (url.endsWith("/user/guest"))
        return response(credentials("guest-token"));
      return response({ items: [], total: 0 });
    });
    fixture.storage.set(
      platform === "mobile" ? "contexify_mobile_user" : "contexify_user",
      JSON.stringify(profile),
    );
    assert.equal(await fixture.api.hasUserSession(), false);
    await fixture.api.getAssets();
    assert.equal(
      new Headers(fixture.requests.at(-1).options.headers).get("Authorization"),
      "Bearer guest-token",
    );
  });

  test(`${platform}: login stores credentials separately and logout revokes them`, async () => {
    const fixture = client(platform, (url) =>
      response(
        url.endsWith("/user/login") ? credentials("signed-token") : profile,
      ),
    );
    const user = await fixture.api.login("fixture", "fixture-password");
    assert.equal(user.id, profile.id);
    assert.equal(user.access_token, undefined);
    assert.equal(await fixture.api.hasUserSession(), true);
    await fixture.api.getCurrentUser(user.id);
    assert.equal(
      new Headers(fixture.requests.at(-1).options.headers).get("Authorization"),
      "Bearer signed-token",
    );
    await fixture.api.logout();
    assert.equal(await fixture.api.hasUserSession(), false);
    assert.equal(fixture.requests.at(-1).url.endsWith("/user/logout"), true);
    assert.equal(
      new Headers(fixture.requests.at(-1).options.headers).get("Authorization"),
      "Bearer signed-token",
    );
  });

  test(`${platform}: pending guest bootstrap cannot overwrite signed-in credentials`, async () => {
    let release;
    const fixture = client(platform, (url) => {
      if (url.endsWith("/user/guest"))
        return new Promise((resolve) => {
          release = resolve;
        });
      if (url.endsWith("/user/login"))
        return response(credentials("signed-token"));
      return response({ items: [], total: 0 });
    });
    const pending = fixture.api.getAssets();
    await until(() => release);
    await fixture.api.login("fixture", "fixture-password");
    release(response(credentials("guest-token")));
    await pending;
    assert.equal(
      JSON.parse(fixture.storage.get("contexify_auth_session")).access_token,
      "signed-token",
    );
  });

  test(`${platform}: late 401 cannot clear a newer login`, async () => {
    let loginCount = 0;
    let release;
    const fixture = client(platform, (url) => {
      if (url.endsWith("/user/login"))
        return response(credentials(`signed-${++loginCount}`));
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    await fixture.api.login("fixture", "fixture-password");
    const pending = fixture.api.getAssets();
    await until(() => release);
    await fixture.api.login("fixture", "fixture-password");
    release(response({ detail: "Session expired" }, 401));
    await assert.rejects(pending);
    assert.equal(
      JSON.parse(fixture.storage.get("contexify_auth_session")).access_token,
      "signed-2",
    );
  });
}

test("mobile: a login response from the previous server cannot become credentials for the new server", async () => {
  let release;
  const fixture = client(
    "mobile",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = fixture.api.login("fixture", "fixture-password");
  await until(() => release);
  await fixture.setApiBaseUrl("http://other.invalid");
  release(response(credentials("previous-server-token")));
  await assert.rejects(pending, /server changed/);
  assert.equal(fixture.storage.has("contexify_auth_session"), false);
});

test("mobile: switching servers during guest bootstrap never sends a token to another server", async () => {
  let release;
  const fixture = client("mobile", (url) => {
    if (url.endsWith("/user/guest"))
      return new Promise((resolve) => {
        release = resolve;
      });
    return response({ items: [], total: 0 });
  });
  const previous = fixture.api.getAssets();
  await until(() => release);
  await fixture.setApiBaseUrl("http://other.invalid");
  const next = fixture.api.getAssets();
  // Attach the rejection handler before resolving the shared guest bootstrap.
  const rejected = assert.rejects(next, /server changed/);
  await tick();
  release(response(credentials("previous-server-token")));
  await previous;
  await rejected;
  assert.equal(
    fixture.requests.some((request) =>
      request.url.startsWith("http://other.invalid"),
    ),
    false,
  );
});

test("mobile: credentials are included in native uploads and SSE", async () => {
  const fixture = client("mobile", () => response(credentials("signed-token")));
  await fixture.api.login("fixture", "fixture-password");
  const upload = fixture.api.uploadAvatar(
    "u1",
    "file:///fixture.png",
    "fixture.png",
  );
  await until(() => fixture.uploads[0]?.sent);
  assert.equal(fixture.uploads[0].headers.Authorization, "Bearer signed-token");
  fixture.uploads[0].responseText = JSON.stringify(profile);
  fixture.uploads[0].onload();
  await upload;
  fixture.api.streamChat("fixture-session", "hello", "AUTO", {
    onToken() {},
    onCitations() {},
    onComplete() {},
    onError(message) {
      throw new Error(message);
    },
  });
  await until(() => fixture.uploads[1]?.sent);
  assert.equal(fixture.uploads[1].headers.Authorization, "Bearer signed-token");
  fixture.uploads[1].responseText =
    'data: {"event":"done","data":"[DONE]"}\n\n';
  fixture.uploads[1].onload();
});

// Execute the actual App callbacks with state/storage/provider effects isolated.
function appCallbacks(platform, apiService) {
  const filename = path.join(
    __dirname,
    "..",
    platform,
    platform === "frontend" ? "src/App.tsx" : "App.tsx",
  );
  const source = fs.readFileSync(filename, "utf8");
  const parsed = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names =
    platform === "frontend"
      ? [
          "resetConversationForAuthChange",
          "handleLogout",
          "handleLogin",
          "handleFileUpload",
        ]
      : [
          "cancelStreamForAuthChange",
          "handleNewChat",
          "handleLogout",
          "handleAuthSuccess",
          "handleAttachFile",
        ];
  const declarations = new Map();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      names.includes(node.name.getText(parsed))
    ) {
      declarations.set(
        node.name.getText(parsed),
        `const ${node.getText(parsed)};`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(declarations.size, names.length);
  const callbacks = names.map((name) => declarations.get(name)).join("\n");
  const state = {
    attachedMedia: [{ id: "previous-owner" }],
    documents: [{ document_id: "previous-owner" }],
    messages: ["private"],
    streamingMessage: "private",
  };
  let cancelled = 0;
  const context = {
    exports: {},
    console,
    apiService,
    currentUser: null,
    currentUserRef: { current: null },
    activeSessionId: "fixture-session",
    currentMode: "AUTO",
    authVersionRef: { current: 0 },
    abortControllerRef: {
      current: {
        abort() {
          cancelled++;
        },
      },
    },
    streamAbortRef: {
      current: () => {
        cancelled++;
      },
    },
    isSendingRef: { current: true },
    isAtBottomRef: { current: false },
    generateGuestSessionId: () => "guest-fixture",
    updateUrlForSession() {},
    loadSessions: async () => {},
    loadUserSessions: async () => {},
    localStorage: { removeItem() {}, setItem() {} },
    AsyncStorage: { removeItem: async () => {}, setItem: async () => {} },
    Haptics: {
      notificationAsync() {},
      NotificationFeedbackType: { Success: 1 },
    },
    Alert: {
      alert(message) {
        throw new Error(message);
      },
    },
    showAlert: async ({ message }) => {
      throw new Error(message);
    },
  };
  for (const setter of new Set(callbacks.match(/\bset[A-Z]\w+/g))) {
    const key = setter[3].toLowerCase() + setter.slice(4);
    context[setter] = (value) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    };
  }
  const code = ts.transpileModule(
    `${callbacks}\nexports.callbacks = { ${names.join(",")} };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  vm.runInNewContext(code, context);
  return {
    callbacks: context.exports.callbacks,
    state,
    cancelled: () => cancelled,
  };
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: a successful response from an earlier login is discarded`, async () => {
    let release;
    let loginCount = 0;
    const fixture = client(platform, (url) => {
      if (url.endsWith("/user/login"))
        return response(credentials(`signed-${++loginCount}`));
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    await fixture.api.login("fixture", "password");
    const pending = fixture.api.getAssets();
    await until(() => release);
    await fixture.api.login("fixture", "password");
    release(response({ items: [{ id: "previous-owner" }], total: 1 }));
    await assert.rejects(pending, /session changed/);
    assert.equal(
      JSON.parse(fixture.storage.get("contexify_auth_session")).access_token,
      "signed-2",
    );
  });

  test(`${platform}: account changes discard previous attachments and cancel streaming`, async () => {
    for (const action of ["logout", "login"]) {
      const fixture = appCallbacks(platform, {
        logout: async () => {},
        login: async () => profile,
      });
      if (action === "logout") await fixture.callbacks.handleLogout();
      else if (platform === "frontend")
        await fixture.callbacks.handleLogin("fixture", "password");
      else await fixture.callbacks.handleAuthSuccess(profile);
      assert.equal(fixture.cancelled(), 1);
      assert.equal(fixture.state.attachedMedia.length, 0);
      assert.equal(fixture.state.documents.length, 0);
      assert.equal(fixture.state.messages.length, 0);
      assert.equal(fixture.state.streamingMessage, null);
      assert.equal(fixture.state.isSending, false);
    }
  });

  for (const type of ["image", "document"]) {
    test(`${platform}: ${type} upload completing after logout cannot repopulate private state`, async () => {
      let release;
      const upload = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      const fixture = appCallbacks(platform, {
        logout: async () => {},
        uploadMedia: upload,
        uploadDocument: upload,
      });
      const file = {
        name: type === "image" ? "fixture.png" : "fixture.txt",
        type: type === "image" ? "image/png" : "text/plain",
        uri: "file:///fixture",
        mimeType: type === "image" ? "image/png" : "text/plain",
      };
      const pending =
        platform === "frontend"
          ? fixture.callbacks.handleFileUpload(file)
          : fixture.callbacks.handleAttachFile(file);
      await until(() => release);
      await fixture.callbacks.handleLogout();
      release(
        type === "image"
          ? { id: "previous-owner" }
          : platform === "frontend"
            ? { document: { document_id: "previous-owner" } }
            : { document_id: "previous-owner" },
      );
      await pending;
      assert.equal(fixture.state.attachedMedia.length, 0);
      assert.equal(fixture.state.documents.length, 0);
    });
  }
}
