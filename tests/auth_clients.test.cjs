// Offline tests of the actual web/native API facades; no server or device needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../frontend/node_modules/typescript");

test("mobile: clearing history authenticates, encodes IDs and reports API failures", async () => {
  for (const status of [200, 403, 503]) {
    const fixture = client("mobile", (url) =>
      url.endsWith("/messages")
        ? response({ detail: "Clear fixture failed" }, status)
        : response(credentials("signed-token")),
    );
    await fixture.api.login("fixture", "password");
    const pending = fixture.api.clearSessionMessages("chat/fixture");
    if (status === 200) await pending;
    else await assert.rejects(pending, /Clear fixture failed/);
    const request = fixture.requests.find((item) =>
      item.url.endsWith("/messages"),
    );
    assert.ok(request.url.endsWith("/session/chat%2Ffixture/messages"));
    assert.equal(request.options.method, "DELETE");
    assert.equal(
      new Headers(request.options.headers).get("Authorization"),
      "Bearer signed-token",
    );
    await assert.rejects(
      fixture.api.clearSessionMessages("  "),
      /Session ID is required/,
    );
  }
});

test("mobile: clear confirmation updates only the cleared chat and preserves files", async () => {
  for (const outcome of ["success", "failure", "switched"]) {
    let finish;
    let calls = 0;
    const fixture = appCallbacks("mobile", {
      clearSessionMessages: () => {
        calls++;
        return new Promise((resolve, reject) => {
          finish = () =>
            outcome === "failure"
              ? reject(new Error("Clear fixture failed"))
              : resolve();
        });
      },
    });
    fixture.context.currentUser = profile;
    fixture.context.isSendingRef.current = false;
    const alerts = [];
    fixture.context.Alert.alert = (...args) => alerts.push(args);
    fixture.callbacks.handleClearMessages();
    assert.equal(calls, 0);
    const pending = alerts[0][2]
      .find((button) => button.text === "Clear")
      .onPress();
    assert.equal(calls, 1);
    if (outcome === "switched")
      fixture.context.activeSessionIdRef.current = "other-chat";
    finish();
    await pending;
    assert.equal(fixture.state.documents.length, 1);
    assert.equal(fixture.state.attachedMedia.length, 1);
    if (outcome === "success") {
      assert.equal(fixture.state.messages.length, 0);
      assert.ok(fixture.state.clearedChats["fixture-session"]);
    } else {
      assert.equal(fixture.state.messages.length, 1);
      if (outcome === "failure") {
        assert.equal(alerts[1][0], "Clear Failed");
        assert.deepEqual(fixture.state.clearedChats, {});
      } else assert.ok(fixture.state.clearedChats["fixture-session"]);
    }
    assert.equal(fixture.context.clearingChatRef.current, false);
  }
});

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: image upload errors preserve readable server messages`, async () => {
    for (const [status, message] of [
      [400, "Invalid or corrupted image file. Upload a valid raster image."],
      [413, "Image dimensions exceed the allowed pixel limit."],
      [503, "Image processing is busy. Please retry shortly."],
    ]) {
      const fixture = client(platform, (url) =>
        url.endsWith("/media/upload")
          ? response({ detail: message }, status)
          : response(credentials("signed-token")),
      );
      await fixture.api.login("fixture", "password");
      if (platform === "frontend") {
        await assert.rejects(
          fixture.api.uploadMedia({}, "fixture-session"),
          (error) => error.message === message,
        );
      } else {
        const pending = fixture.api.uploadMedia(
          "fixture-session",
          "file:///fixture.png",
          "fixture.png",
          "image/png",
        );
        const rejected = assert.rejects(
          pending,
          (error) => error.message === message,
        );
        await until(() => fixture.uploads[0]?.sent);
        fixture.uploads[0].status = status;
        fixture.uploads[0].responseText = JSON.stringify({ detail: message });
        fixture.uploads[0].onload();
        await rejected;
      }
    }
  });
}

function client(platform, handleRequest, environment = {}) {
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
    send(body) {
      this.body = body;
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
    DOMException,
    console,
    setTimeout,
    clearTimeout,
    process: { env: {} },
    XMLHttpRequest: XHR,
    FormData: class {
      values = new Map();
      append(key, value) {
        this.values.set(key, value);
      }
      get(key) {
        return this.values.get(key);
      }
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
    .replaceAll("import.meta.env", `(${JSON.stringify(environment)})`);
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
          "handleDetachDocument",
          "handleSendMessage",
          "handleDeleteSession",
          "selectSession",
        ]
      : [
          "cancelStreamForAuthChange",
          "handleClearMessages",
          "handleNewChat",
          "handleLogout",
          "handleAuthSuccess",
          "handleAttachFile",
          "handleDetachDocument",
          "handleSendMessage",
          "handleDeleteSession",
          "selectSession",
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
    pendingDocumentIds: ["previous-owner"],
    attachedMedia: [{ id: "previous-owner" }],
    documents: [{ document_id: "previous-owner" }],
    messages: ["private"],
    streamingMessage: "private",
    clearedChats: {},
  };
  let cancelled = 0;
  const context = {
    exports: {},
    console,
    useCallback: (callback) => callback,
    apiService,
    isAuthReady: true,
    isSending: false,
    isUploading: false,
    isTemporaryChat: false,
    isTempActive: false,
    inputQuery: "review",
    query: "review",
    replyingTo: null,
    Date,
    AbortController,
    currentUser: null,
    currentUserRef: { current: null },
    activeSessionId: "fixture-session",
    activeSessionIdRef: { current: "fixture-session" },
    messages: state.messages,
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
    clearingChatRef: { current: false },
    isAtBottomRef: { current: false },
    flatListRef: { current: null },
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
    context,
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
      assert.equal(fixture.state.pendingDocumentIds.length, 0);
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
      assert.equal(fixture.state.pendingDocumentIds.length, 0);
    });
  }
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: sending waits for uploads without clearing the draft`, async () => {
    const fixture = appCallbacks(platform, {
      streamChat() {
        throw new Error("Must wait for the upload");
      },
    });
    Object.assign(fixture.context, {
      isUploading: true,
      attachedMedia: [],
      pendingDocumentIds: [],
    });
    fixture.context.isSendingRef.current = false;
    const messagesBefore = fixture.state.messages;
    await fixture.callbacks.handleSendMessage();
    assert.equal(fixture.state.messages, messagesBefore);
    assert.equal(fixture.state.inputQuery, undefined);
    assert.equal(fixture.state.query, undefined);
    assert.equal(fixture.state.isSending, undefined);
  });

  test(`${platform}: document chips detach without deleting session knowledge`, () => {
    const api = {
      deleteDocument() {
        throw new Error("Draft removal must not delete documents");
      },
    };
    const fixture = appCallbacks(platform, api);
    fixture.state.pendingDocumentIds = ["document-fixture"];
    fixture.state.documents = [
      { document_id: "document-fixture", filename: "fixture.txt" },
    ];
    fixture.callbacks.handleDetachDocument("document-fixture");
    assert.equal(fixture.state.pendingDocumentIds.length, 0);
    assert.equal(fixture.state.documents.length, 1);
  });

  test(`${platform}: sending includes pending documents and clears only the draft`, async () => {
    let sent;
    const api = {
      streamChat(...args) {
        sent = args;
        return () => {};
      },
    };
    const fixture = appCallbacks(platform, api);
    fixture.context.isSendingRef.current = false;
    fixture.context.abortControllerRef.current = null;
    fixture.context.attachedMedia = [];
    fixture.context.documents = [
      {
        document_id: "document-fixture",
        filename: "fixture.txt",
        storage_url: "http://fixture.invalid/download",
        file_size_bytes: 7,
      },
    ];
    fixture.context.pendingDocumentIds = ["document-fixture"];
    fixture.state.pendingDocumentIds = ["document-fixture"];
    fixture.state.documents = fixture.context.documents;
    await fixture.callbacks.handleSendMessage();
    const attachments = platform === "frontend" ? sent[5] : sent[4];
    assert.equal(attachments[0].file_type, "document");
    assert.equal(attachments[0].id, "document-fixture");
    assert.equal(
      fixture.state.messages.at(-1).attachments[0].file_name,
      "fixture.txt",
    );
    assert.equal(fixture.state.pendingDocumentIds.length, 0);
    assert.equal(fixture.state.documents.length, 1);
  });
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: document-only sends use a review prompt`, async () => {
    let sent;
    const fixture = appCallbacks(platform, {
      streamChat(...args) {
        sent = args;
        return () => {};
      },
    });
    Object.assign(fixture.context, {
      query: "",
      inputQuery: "",
      attachedMedia: [],
      pendingDocumentIds: ["document-fixture"],
      documents: [
        {
          document_id: "document-fixture",
          filename: "fixture.txt",
          storage_url: "http://fixture.invalid/download",
        },
      ],
    });
    fixture.context.isSendingRef.current = false;
    fixture.context.abortControllerRef.current = null;
    await fixture.callbacks.handleSendMessage();
    assert.equal(sent[1], "Review the attached documents.");
    assert.equal(
      fixture.state.messages.at(-1).content,
      "Review the attached documents.",
    );
  });

  test(`${platform}: uploaded document links target the backend host`, async () => {
    const document = {
      document_id: "document-fixture",
      filename: "fixture.txt",
      storage_url:
        "/api/v1/media/content/document/document-fixture?ticket=fixture",
    };
    const fixture = client(
      platform,
      (url) =>
        url.endsWith("/document/upload")
          ? response({ document })
          : response(credentials("signed-token")),
      { VITE_API_BASE_URL: "http://fixture.invalid" },
    );
    await fixture.api.login("fixture", "password");
    let uploaded;
    if (platform === "frontend") {
      uploaded = (await fixture.api.uploadDocument({}, "fixture-session"))
        .document;
    } else {
      const pending = fixture.api.uploadDocument(
        "fixture-session",
        "file:///fixture.txt",
        "fixture.txt",
        "text/plain",
      );
      await until(() => fixture.uploads[0]?.sent);
      fixture.uploads[0].responseText = JSON.stringify({ document });
      fixture.uploads[0].onload();
      uploaded = await pending;
    }
    assert.equal(
      uploaded.storage_url,
      `http://fixture.invalid${document.storage_url}`,
    );
  });
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: temporary flag reaches upload and chat fallback requests`, async () => {
    const fixture = client(platform, (url) => {
      if (url.endsWith("/user/login"))
        return response(credentials("signed-token"));
      if (url.endsWith("/chat/stream"))
        return response({ detail: "fixture" }, 400);
      return response({
        id: "asset",
        url: "/fixture.png",
        document: { document_id: "doc", filename: "fixture.txt" },
      });
    });
    await fixture.api.login("fixture", "password");
    for (const temporary of [true, false]) {
      for (const kind of ["uploadMedia", "uploadDocument"]) {
        if (platform === "frontend") {
          await fixture.api[kind]({}, "fixture-session", undefined, temporary);
          assert.equal(
            fixture.requests.at(-1).options.body.get("is_temporary"),
            String(temporary),
          );
        } else {
          const count = fixture.uploads.length;
          const pending = fixture.api[kind](
            "fixture-session",
            "file:///fixture",
            "fixture",
            "text/plain",
            undefined,
            temporary,
          );
          await until(
            () =>
              fixture.uploads.length > count && fixture.uploads.at(-1)?.sent,
          );
          const upload = fixture.uploads.at(-1);
          assert.equal(upload.body.get("is_temporary"), String(temporary));
          upload.responseText = JSON.stringify({
            id: "asset",
            url: "/fixture.png",
            document: { document_id: "doc" },
          });
          upload.onload();
          await pending;
        }
      }
      const handlers = {
        onError() {},
        onComplete() {},
        onDone() {},
        onToken() {},
        onCitations() {},
      };
      if (platform === "frontend") {
        await fixture.api.streamChat(
          "fixture-session",
          "fixture",
          "AUTO",
          handlers,
          undefined,
          [],
          undefined,
          null,
          temporary,
        );
        assert.equal(
          JSON.parse(fixture.requests.at(-1).options.body).is_temporary,
          temporary,
        );
      } else {
        const count = fixture.uploads.length;
        fixture.api.streamChat(
          "fixture-session",
          "fixture",
          "AUTO",
          handlers,
          [],
          undefined,
          null,
          temporary,
        );
        await until(
          () => fixture.uploads.length > count && fixture.uploads.at(-1)?.sent,
        );
        const stream = fixture.uploads.at(-1);
        assert.equal(JSON.parse(stream.body).is_temporary, temporary);
        stream.responseText = 'data: {"event":"done","data":"[DONE]"}\n\n';
        stream.onload();
      }
    }
  });
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: deleting the active chat cancels late uploads and streams`, async () => {
    const fixture = appCallbacks(platform, { deleteSession: async () => {} });
    Object.assign(fixture.context, {
      currentUser: profile,
      currentUserRef: { current: profile },
      sessions: [{ id: "fixture-session", title: "Fixture", mode: "AUTO" }],
      confirm: async () => true,
      removeSession() {},
    });
    await fixture.callbacks.handleDeleteSession("fixture-session");
    assert.equal(fixture.cancelled(), 1);
    assert.equal(fixture.context.authVersionRef.current, 1);
    assert.equal(fixture.state.isSending, false);
    assert.equal(fixture.state.isUploading, false);
    assert.equal(fixture.state.messages.length, 0);
    assert.equal(fixture.state.attachedMedia.length, 0);
  });
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: reopening a chat restores the server retention status`, async () => {
    for (const temporary of [true, false, undefined]) {
      const fixture = appCallbacks(platform, {
        getSessionHistory: async () => ({
          session: { mode: "AUTO", is_temporary: temporary },
          messages: [],
          documents: [],
        }),
      });
      fixture.context.currentUser = profile;
      await fixture.callbacks.selectSession("fixture-session");
      assert.equal(fixture.state.isTemporaryChat, Boolean(temporary));
    }
  });

  test(`${platform}: a late history response cannot change the new identity's retention status`, async () => {
    let release;
    const fixture = appCallbacks(platform, {
      getSessionHistory: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    fixture.context.currentUser = profile;
    const pending = fixture.callbacks.selectSession("fixture-session");
    await until(() => release);
    fixture.context.authVersionRef.current++;
    release({
      session: { mode: "AUTO", is_temporary: true },
      messages: [],
      documents: [],
    });
    await pending;
    assert.equal(fixture.state.isTemporaryChat, false);
  });
}
