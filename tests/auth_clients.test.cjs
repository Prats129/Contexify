// Offline tests of the actual web/native API facades; no server or device needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../frontend/node_modules/typescript");

test("frontend: reply clicks use the message ID rather than the DOM element ID", () => {
  const filename = path.join(
    __dirname,
    "../frontend/src/components/Chat/MessageList.tsx",
  );
  const source = fs.readFileSync(filename, "utf8");
  const parsed = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "onReply") {
      expression = node.initializer.expression.getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression);
  const message = {
    id: "11111111-1111-4111-8111-111111111111",
    role: "assistant",
    content: "Saved answer",
  };
  let reference;
  const reply = vm.runInNewContext(`(${expression})`, {
    msg: message,
    onReply: (value) => {
      reference = value;
    },
  });
  reply({ ...message, id: `msg-${message.id}` });
  assert.equal(reference.id, message.id);
  assert.equal(reference.content, message.content);
});

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: acknowledgements reconcile user, assistant and draft reply IDs without duplicating messages`, async () => {
    const requests = [];
    const fixture = appCallbacks(platform, {
      streamChat(...args) {
        requests.push(args);
        return () => {};
      },
    });
    Object.assign(fixture.state, {
      messages: [],
      documents: [],
      attachedMedia: [],
      pendingDocumentIds: [],
    });
    fixture.context.isSendingRef.current = false;
    await fixture.callbacks.handleSendMessage();
    const handlers = requests[0][3];
    const optimistic = fixture.state.messages[0];
    fixture.callbacks.handleReplyMessage(optimistic);
    const userAck = {
      id: "11111111-1111-4111-8111-111111111111",
      session_id: "fixture-session",
      role: "user",
      created_at: "2026-10-20T12:00:00",
    };
    handlers.onMessage(userAck);
    const userRevision = fixture.workspace.getSnapshot();
    handlers.onMessage(userAck);
    assert.equal(fixture.workspace.getSnapshot(), userRevision);
    assert.equal(fixture.state.messages.length, 1);
    assert.equal(fixture.state.messages[0].id, userAck.id);
    assert.equal(fixture.state.messages[0].created_at, userAck.created_at);
    assert.equal(fixture.state.replyingTo.id, userAck.id);
    handlers.onMessage({ ...userAck, id: "wrong", session_id: "another-chat" });
    assert.equal(fixture.state.messages[0].id, userAck.id);

    const assistantAck = {
      ...userAck,
      id: "22222222-2222-4222-8222-222222222222",
      role: "assistant",
    };
    // Simple responses acknowledge before their first token.
    handlers.onMessage(assistantAck);
    const assistantRevision = fixture.workspace.getSnapshot();
    handlers.onMessage(assistantAck);
    assert.equal(fixture.workspace.getSnapshot(), assistantRevision);
    handlers.onToken("Saved answer");
    assert.equal(fixture.state.streamingMessage.id, assistantAck.id);
    await (handlers.onDone || handlers.onComplete)();
    assert.equal(fixture.state.messages.length, 2);
    assert.equal(fixture.state.messages[1].id, assistantAck.id);
    assert.equal(fixture.state.messages[1].created_at, assistantAck.created_at);
    assert.equal(fixture.state.messages[1].content, "Saved answer");
    fixture.callbacks.handleReplyMessage(fixture.state.messages[1]);
    // Exercise a round trip through the same JSON shape used by history reload.
    fixture.state.messages = JSON.parse(JSON.stringify(fixture.state.messages));
    fixture.state.query = fixture.state.inputQuery = "Follow up";
    await fixture.callbacks.handleSendMessage();
    const reference = requests[1][platform === "frontend" ? 7 : 6];
    assert.equal(reference.id, fixture.state.messages[1].id);
    assert.equal(reference.content, "Saved answer");
  });

  test(`${platform}: saved error responses and stopped acknowledged messages keep permanent IDs`, async () => {
    for (const terminal of ["error", "stop"]) {
      let handlers;
      const fixture = appCallbacks(platform, {
        streamChat(...args) {
          handlers = args[3];
          return () => {};
        },
      });
      Object.assign(fixture.state, {
        messages: [],
        documents: [],
        attachedMedia: [],
        pendingDocumentIds: [],
      });
      fixture.context.isSendingRef.current = false;
      await fixture.callbacks.handleSendMessage();
      handlers.onToken("Partial answer");
      const saved = {
        id: "33333333-3333-4333-8333-333333333333",
        session_id: "fixture-session",
        role: "assistant",
        created_at: "2026-10-20T12:00:00",
      };
      handlers.onMessage(saved);
      if (terminal === "error") handlers.onError("Fixture provider failed");
      else fixture.callbacks.handleStopGeneration();
      const stopped = fixture.state.messages.at(-1);
      assert.equal(stopped.id, saved.id);
      assert.equal(stopped.created_at, saved.created_at);
      assert.ok(stopped.content.includes("Partial answer"));
      handlers.onMessage({ ...saved, id: "late" });
      handlers.onToken(" late output");
      assert.equal(fixture.state.messages.length, 2);
      assert.equal(fixture.state.messages.at(-1).id, saved.id);
    }
  });

  test(`${platform}: background acknowledgements stay with their conversation and disappear after logout`, async () => {
    let handlers;
    const fixture = appCallbacks(platform, {
      streamChat(...args) {
        handlers = args[3];
        return () => {};
      },
      logout: async () => {},
    });
    Object.assign(fixture.state, {
      messages: [],
      documents: [],
      attachedMedia: [],
      pendingDocumentIds: [],
    });
    fixture.context.isSendingRef.current = false;
    await fixture.callbacks.handleSendMessage();
    const original = fixture.workspace.active;
    fixture.callbacks.handleReplyMessage(original.state.messages[0]);
    fixture.context.setActiveSessionId("another-chat");
    const saved = {
      id: "44444444-4444-4444-8444-444444444444",
      session_id: "fixture-session",
      role: "user",
      created_at: "2026-10-20T12:00:00",
    };
    handlers.onMessage(saved);
    assert.equal(original.state.messages[0].id, saved.id);
    assert.equal(original.state.replyingTo.id, saved.id);
    assert.equal(fixture.state.messages.length, 0);
    assert.equal(fixture.state.replyingTo, null);
    await fixture.callbacks.handleLogout();
    handlers.onMessage({ ...saved, id: "after-logout" });
    assert.equal(fixture.state.messages.length, 0);
  });

  test(`${platform}: streaming message acknowledgements survive every frame split and reject unrelated metadata`, async () => {
    let chunks = [];
    const fixture = client(platform, (url) => {
      if (!url.endsWith("/chat/stream"))
        return response(credentials("ack-token"));
      let index = 0;
      return {
        ...response({}),
        body: {
          getReader: () => ({
            read: async () =>
              index < chunks.length
                ? { value: chunks[index++], done: false }
                : { done: true },
            cancel: async () => {},
          }),
        },
      };
    });
    await fixture.api.login("fixture", "password");
    const saved = {
      id: "55555555-5555-4555-8555-555555555555",
      session_id: "fixture-session",
      role: "user",
      created_at: "2026-10-20T12:00:00",
    };
    const wire = [
      {
        event: "message",
        data: "",
        message: { ...saved, session_id: "wrong" },
      },
      { event: "message", data: "", message: { ...saved, role: "system" } },
      { event: "message", data: "", message: saved },
      { event: "token", data: "Answer 🌍" },
      {
        event: "message",
        data: "",
        message: { ...saved, role: "assistant", id: "assistant-id" },
      },
      { event: "done", data: "[DONE]" },
    ]
      .map((event) => "data: " + JSON.stringify(event) + "\n\n")
      .join("");
    const wireBytes = new TextEncoder().encode(wire);
    const length = platform === "frontend" ? wireBytes.length : wire.length;
    for (let split = 0; split <= length; split++) {
      const events = [];
      const handlers = {
        onMessage: (message) =>
          events.push(["message", message.role, message.id]),
        onToken: (token) => events.push(["token", token]),
        onCitations() {},
        onDone: () => events.push(["done"]),
        onComplete: () => events.push(["done"]),
        onError: (error) => {
          throw new Error(error);
        },
      };
      if (platform === "frontend") {
        chunks = [wireBytes.slice(0, split), wireBytes.slice(split)];
        await fixture.api.streamChat(
          "fixture-session",
          "hello",
          "AUTO",
          handlers,
        );
      } else {
        fixture.api.streamChat("fixture-session", "hello", "AUTO", handlers);
        const xhr = fixture.uploads.at(-1);
        await until(() => xhr.sent);
        xhr.responseText = wire.slice(0, split);
        xhr.onprogress();
        xhr.responseText = wire;
        xhr.onprogress();
        xhr.onload();
      }
      assert.deepEqual(events, [
        ["message", "user", saved.id],
        ["token", "Answer 🌍"],
        ["message", "assistant", "assistant-id"],
        ["done"],
      ]);
    }
  });
}

async function mobileStreamFixture() {
  const fixture = client("mobile", () => response(credentials("stream-token")));
  await fixture.api.login("fixture", "password");
  return async () => {
    const events = [];
    const cancel = fixture.api.streamChat("fixture-session", "hello", "AUTO", {
      onToken: (value) => events.push(["token", value]),
      onCitations: (value) => events.push(["citations", value]),
      onMedia: (value) => events.push(["media", value]),
      onComplete: () => events.push(["complete"]),
      onError: (value) => events.push(["error", value]),
    });
    const xhr = fixture.uploads.at(-1);
    await until(() => xhr.sent);
    xhr.responseText = "";
    return { xhr, events, cancel };
  };
}

test("mobile: SSE survives every split without delaying complete events", async () => {
  const stream = await mobileStreamFixture();
  const first = 'data: {"event":"token","data":"Hello 🌍 नमस्ते"}\n\n';
  const second = 'data: {"event":"token","data":" next"}\n\n';
  for (let split = 0; split <= second.length; split++) {
    const { xhr, events } = await stream();
    xhr.responseText = first + second.slice(0, split);
    xhr.onprogress();
    assert.equal(events[0]?.[1], "Hello 🌍 नमस्ते");
    assert.equal(events.length, split === second.length ? 2 : 1);
    xhr.responseText = first + second;
    xhr.onprogress();
    xhr.onprogress();
    xhr.onload();
    assert.deepEqual(events, [
      ["token", "Hello 🌍 नमस्ते"],
      ["token", " next"],
      ["complete"],
    ]);
  }
});

test("mobile: SSE preserves Unicode and event ordering across every split and line ending", async () => {
  const stream = await mobileStreamFixture();
  for (const newline of ["\n", "\r\n", "\r"]) {
    const wire = [
      ": keepalive",
      "id: ignored",
      'data:{"event":"token",',
      'data:"data":"🌍 नमस्ते"}',
      "",
      'data: {"event":"citations","citations":[{"title":"Fixture"}]}',
      "",
      'data: {"event":"media","media":{"id":"fixture","url":"/image.png"}}',
      "",
      "data: [DONE]",
      "",
      'data: {"token":"must not appear"}',
      "",
      "",
    ].join(newline);
    for (let split = 0; split <= wire.length; split++) {
      const { xhr, events } = await stream();
      xhr.responseText = wire.slice(0, split);
      xhr.onprogress();
      xhr.responseText = wire;
      xhr.onprogress();
      xhr.onload();
      assert.deepEqual(
        events.map((event) => event[0]),
        ["token", "citations", "media", "complete"],
      );
      assert.equal(events[0][1], "🌍 नमस्ते");
      assert.equal(events[1][1][0].title, "Fixture");
      assert.equal(events[2][1].url, "http://fixture.invalid/image.png");
    }
    const { xhr, events } = await stream();
    for (let length = 1; length <= wire.length; length++) {
      xhr.responseText = wire.slice(0, length);
      xhr.onprogress();
    }
    xhr.onload();
    assert.equal(events.length, 4);
  }
});

test("mobile: SSE flushes final bytes at EOF and rejects malformed or truncated events", async () => {
  const stream = await mobileStreamFixture();
  for (const suffix of ["", "\n", "\n\n", "\r\n\r\n"]) {
    const { xhr, events } = await stream();
    xhr.responseText = 'data: {"token":"final"}' + suffix;
    xhr.onload();
    xhr.onload();
    assert.deepEqual(events, [["token", "final"], ["complete"]]);
  }
  for (const wire of [
    'data: {"event":"token","data":"cut',
    "data: broken\n\n",
  ]) {
    const { xhr, events } = await stream();
    xhr.responseText = wire;
    xhr.onprogress();
    xhr.onload();
    assert.equal(events.length, 1);
    assert.equal(events[0][0], "error");
    assert.match(events[0][1], /invalid streaming response/i);
  }
  const { xhr, events } = await stream();
  xhr.responseText = 'data: {"event":"done"}\n\ndata: {"token":"ignored"}\n\n';
  xhr.onprogress();
  xhr.onload();
  assert.deepEqual(events, [["complete"]]);
});

test("mobile: split SSE errors terminate once and HTTP failures are not treated as tokens", async () => {
  const stream = await mobileStreamFixture();
  const wire =
    'data: {"event":"error","data":"Provider fixture unavailable"}\n\ndata: {"token":"ignored"}\n\n';
  for (let split = 0; split <= wire.length; split++) {
    const { xhr, events } = await stream();
    xhr.responseText = wire.slice(0, split);
    xhr.onprogress();
    xhr.responseText = wire;
    xhr.onprogress();
    xhr.onload();
    xhr.onerror();
    assert.deepEqual(events, [["error", "Provider fixture unavailable"]]);
  }
  const { xhr, events } = await stream();
  xhr.status = 503;
  xhr.responseText = JSON.stringify({ detail: "Server fixture unavailable" });
  xhr.onprogress();
  assert.equal(events.length, 0);
  xhr.onload();
  assert.deepEqual(events, [["error", "Server fixture unavailable"]]);
});

test("mobile: stopping a partial SSE event suppresses all late callbacks", async () => {
  const stream = await mobileStreamFixture();
  const wire = 'data: {"token":"late"}\n\n';
  for (let split = 0; split < wire.length; split++) {
    const { xhr, events, cancel } = await stream();
    let aborts = 0;
    xhr.abort = () => {
      aborts++;
      xhr.onabort();
    };
    xhr.responseText = wire.slice(0, split);
    xhr.onprogress();
    cancel();
    xhr.responseText = wire;
    xhr.onprogress();
    xhr.onload();
    xhr.onerror();
    assert.equal(aborts, 1);
    assert.deepEqual(events, []);
  }
});

test("mobile: stream setup failures report an error and immediate cancellation stays silent", async () => {
  const fixture = client("mobile", () => {
    throw new Error("fixture offline");
  });
  const events = [];
  const handlers = {
    onToken: () => events.push("token"),
    onCitations: () => events.push("citations"),
    onComplete: () => events.push("complete"),
    onError: () => events.push("error"),
  };
  fixture.api.streamChat("fixture", "hello", "AUTO", handlers);
  await until(() => events.length > 0);
  assert.deepEqual(events, ["error"]);
  const cancel = fixture.api.streamChat("fixture", "hello", "AUTO", handlers);
  cancel();
  await tick();
  assert.deepEqual(events, ["error"]);
});

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
    if (outcome === "switched") {
      fixture.context.setActiveSessionId("other-chat");
      fixture.state.messages = ["other chat"];
      fixture.state.documents = [{ document_id: "other-document" }];
      fixture.state.attachedMedia = [{ id: "other-image" }];
    }
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

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: out-of-order A → B → A history cannot overwrite the latest view`, async () => {
    const requests = [];
    const fixture = appCallbacks(platform, {
      getSessionHistory: (id) =>
        new Promise((resolve, reject) =>
          requests.push({ id, resolve, reject }),
        ),
    });
    fixture.context.currentUser = profile;
    const a1 = fixture.callbacks.selectSession("fixture-session");
    const b = fixture.callbacks.selectSession("chat-b");
    const a2 = fixture.callbacks.selectSession("fixture-session");
    requests[2].resolve({
      session: { mode: "AUTO" },
      messages: [{ id: "fresh-a" }],
      documents: [],
    });
    await a2;
    requests[1].resolve({
      session: { mode: "AUTO" },
      messages: [{ id: "b" }],
      documents: [],
    });
    await b;
    requests[0].resolve({
      session: { mode: "AUTO", is_temporary: true },
      messages: [{ id: "stale-a" }],
      documents: [],
    });
    await a1;
    assert.equal(fixture.state.messages[0].id, "fresh-a");
    assert.equal(fixture.state.isTemporaryChat, false);
    assert.equal(fixture.context.activeSessionId, "fixture-session");
  });

  test(`${platform}: navigation preserves simultaneous streams and Stop targets only the visible chat`, async () => {
    const streams = new Map();
    const stopped = [];
    const fixture = appCallbacks(platform, {
      getSessionHistory: async () => ({
        session: { mode: "AUTO" },
        messages: [],
        documents: [],
      }),
      streamChat: (id, query, mode, handlers, signal) => {
        streams.set(id, handlers);
        if (platform === "frontend")
          signal.addEventListener("abort", () => stopped.push(id));
        return platform === "mobile"
          ? () => stopped.push(id)
          : Promise.resolve();
      },
    });
    fixture.context.currentUser = profile;
    fixture.context.currentUserRef.current = profile;
    fixture.context.isSendingRef.current = false;
    fixture.state.messages = [];
    await fixture.callbacks.handleSendMessage();
    streams.get("fixture-session").onToken("A begins");
    await fixture.callbacks.selectSession("chat-b");
    assert.equal(fixture.state.messages.length, 0);
    assert.equal(fixture.state.isSending, false);
    fixture.context.query = "B prompt";
    fixture.context.inputQuery = "B prompt";
    await fixture.callbacks.handleSendMessage();
    streams.get("chat-b").onToken("B partial");
    streams.get("fixture-session").onToken(" and finishes");
    assert.equal(fixture.state.streamingMessage.content, "B partial");
    assert.deepEqual(stopped, []);
    fixture.callbacks.handleStopGeneration();
    assert.deepEqual(stopped, ["chat-b"]);
    assert.equal(fixture.state.messages.at(-1).content, "B partial");
    await fixture.callbacks.selectSession("fixture-session");
    assert.equal(
      fixture.state.streamingMessage.content,
      "A begins and finishes",
    );
    assert.equal(fixture.state.isSending, true);
    const a = streams.get("fixture-session");
    await (platform === "frontend" ? a.onDone() : a.onComplete());
    assert.equal(
      fixture.state.messages.at(-1).content,
      "A begins and finishes",
    );
    assert.equal(fixture.state.isSending, false);
    await fixture.callbacks.selectSession("chat-b");
    assert.equal(fixture.state.messages.at(-1).content, "B partial");
  });

  test(`${platform}: late image and document uploads stay in their original conversation`, async () => {
    for (const image of [true, false]) {
      let release;
      const fixture = appCallbacks(platform, {
        getSessionHistory: async () => ({
          session: { mode: "AUTO" },
          messages: [],
          documents: [],
        }),
        uploadMedia: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
        uploadDocument: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      });
      fixture.context.currentUser = profile;
      const pending =
        platform === "frontend"
          ? fixture.callbacks.handleFileUpload({
              name: image ? "fixture.png" : "fixture.txt",
              type: image ? "image/png" : "text/plain",
            })
          : fixture.callbacks.handleAttachFile({
              name: image ? "fixture.png" : "fixture.txt",
              mimeType: image ? "image/png" : "text/plain",
              uri: "file:///fixture",
            });
      await until(() => release);
      const original = fixture.workspace.active;
      await fixture.callbacks.selectSession("chat-b");
      fixture.context.query = "B draft";
      fixture.context.inputQuery = "B draft";
      release(
        image
          ? { id: "late-image" }
          : platform === "frontend"
            ? { document: { document_id: "late-doc" } }
            : { document_id: "late-doc" },
      );
      await pending;
      assert.equal(fixture.state.attachedMedia.length, 0);
      assert.equal(fixture.state.pendingDocumentIds.length, 0);
      assert.equal(fixture.state.isUploading, false);
      assert.equal(fixture.state.query, "B draft");
      assert.equal(original.state.isUploading, false);
      assert.ok(
        image
          ? original.state.attachedMedia.some(
              (item) => item.id === "late-image",
            )
          : original.state.pendingDocumentIds.includes("late-doc"),
      );
      fixture.context.setActiveSessionId("fixture-session");
      assert.ok(
        image
          ? fixture.state.attachedMedia.some((item) => item.id === "late-image")
          : fixture.state.documents.some(
              (item) => item.document_id === "late-doc",
            ),
      );
    }
  });

  test(`${platform}: delayed creation cannot redirect navigation or discard a submitted prompt`, async () => {
    let finish;
    let sent;
    const fixture = appCallbacks(platform, {
      createSession: (...args) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ id: args[4], title: "Created", mode: "AUTO" });
        }),
      getSessionHistory: async () => ({
        session: { mode: "AUTO" },
        messages: [],
        documents: [],
      }),
      streamChat: (...args) => {
        sent = args;
        return platform === "mobile" ? () => {} : Promise.resolve();
      },
    });
    fixture.context.currentUser = profile;
    fixture.context.currentUserRef.current = profile;
    fixture.context.isSendingRef.current = false;
    fixture.context.setActiveSessionId(null);
    fixture.context.query = "Original prompt";
    fixture.context.inputQuery = "Original prompt";
    const pending = fixture.callbacks.handleSendMessage();
    await until(() => finish);
    const original = fixture.workspace.active;
    await fixture.callbacks.selectSession("chat-b");
    finish();
    await pending;
    assert.equal(fixture.context.activeSessionId, "chat-b");
    assert.equal(fixture.state.messages.length, 0);
    assert.equal(sent[0], original.sessionId);
    assert.equal(sent[1], "Original prompt");
    assert.equal(original.state.messages.at(-1).content, "Original prompt");
  });

  test(`${platform}: background errors retain partial text, citations and media without touching another chat`, async () => {
    let handlers;
    const fixture = appCallbacks(platform, {
      getSessionHistory: async () => ({
        session: { mode: "AUTO" },
        messages: [],
        documents: [],
      }),
      streamChat: (id, query, mode, callbacks) => {
        handlers = callbacks;
        return platform === "mobile" ? () => {} : Promise.resolve();
      },
    });
    fixture.context.currentUser = profile;
    fixture.context.isSendingRef.current = false;
    await fixture.callbacks.handleSendMessage();
    const original = fixture.workspace.active;
    handlers.onToken("Partial answer");
    handlers.onCitations([{ title: "Fixture" }]);
    handlers.onMedia({ id: "generated-fixture" });
    await fixture.callbacks.selectSession("chat-b");
    handlers.onError("Fixture network failure");
    assert.equal(fixture.state.messages.length, 0);
    assert.match(
      original.state.messages.at(-1).content,
      /Partial answer.*\n\nResponse interrupted/s,
    );
    assert.equal(original.state.messages.at(-1).citations[0].title, "Fixture");
    assert.equal(
      original.state.messages.at(-1).attachments[0].id,
      "generated-fixture",
    );
    await fixture.callbacks.selectSession("fixture-session");
    assert.match(fixture.state.messages.at(-1).content, /Partial answer/);
  });
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: drafts and pending library documents survive navigation and a fresh chat`, async () => {
    const fixture = appCallbacks(platform, {
      getSessionHistory: async () => ({
        session: { mode: "AUTO" },
        messages: [],
        documents: [],
      }),
    });
    fixture.context.currentUser = profile;
    fixture.context.currentUserRef.current = profile;
    fixture.context.query = "A draft";
    fixture.context.inputQuery = "A draft";
    fixture.state.documents = [{ document_id: "library-document" }];
    fixture.state.pendingDocumentIds = ["library-document"];
    fixture.state.replyingTo = { id: "reply-a" };
    await fixture.callbacks.selectSession("chat-b");
    assert.equal(fixture.state.attachedMedia.length, 0);
    fixture.context.query = "B draft";
    fixture.context.inputQuery = "B draft";
    if (platform === "frontend") fixture.callbacks.handleNewSession();
    else fixture.callbacks.handleNewChat();
    assert.equal(fixture.state.query, "");
    await fixture.callbacks.selectSession("fixture-session");
    assert.equal(fixture.state.inputQuery, "A draft");
    assert.equal(fixture.state.replyingTo.id, "reply-a");
    assert.equal(fixture.state.documents[0].document_id, "library-document");
    assert.equal(fixture.state.attachedMedia[0].id, "previous-owner");
    await fixture.callbacks.selectSession("chat-b");
    assert.equal(fixture.state.query, "B draft");
  });

  test(`${platform}: failed background uploads remain visible in their original chat`, async () => {
    let fail;
    const fixture = appCallbacks(platform, {
      getSessionHistory: async () => ({
        session: { mode: "AUTO" },
        messages: [],
        documents: [],
      }),
      uploadMedia: () =>
        new Promise((resolve, reject) => {
          fail = reject;
        }),
    });
    fixture.context.currentUser = profile;
    const pending =
      platform === "frontend"
        ? fixture.callbacks.handleFileUpload({
            name: "fixture.png",
            type: "image/png",
          })
        : fixture.callbacks.handleAttachFile({
            name: "fixture.png",
            mimeType: "image/png",
            uri: "file:///fixture",
          });
    await until(() => fail);
    await fixture.callbacks.selectSession("chat-b");
    fail(new Error("fixture upload failure"));
    await pending;
    assert.equal(fixture.state.operationError, null);
    await fixture.callbacks.selectSession("fixture-session");
    assert.match(fixture.state.operationError, /fixture upload failure/);
  });

  test(`${platform}: logout cancels every conversation and rejects all late callbacks`, async () => {
    const streams = new Map();
    const stopped = [];
    const fixture = appCallbacks(platform, {
      getSessionHistory: async () => ({
        session: { mode: "AUTO" },
        messages: [],
        documents: [],
      }),
      streamChat: (id, query, mode, handlers, signal) => {
        streams.set(id, handlers);
        if (platform === "frontend")
          signal.addEventListener("abort", () => stopped.push(id));
        return platform === "mobile"
          ? () => stopped.push(id)
          : Promise.resolve();
      },
      logout: async () => {},
    });
    fixture.context.currentUser = profile;
    fixture.context.currentUserRef.current = profile;
    fixture.context.isSendingRef.current = false;
    await fixture.callbacks.handleSendMessage();
    await fixture.callbacks.selectSession("chat-b");
    fixture.context.query = "B";
    fixture.context.inputQuery = "B";
    await fixture.callbacks.handleSendMessage();
    await fixture.callbacks.handleLogout();
    assert.deepEqual(stopped.sort(), ["chat-b", "fixture-session"]);
    for (const handlers of streams.values()) {
      handlers.onToken("private late token");
      handlers.onMedia({ id: "private-image" });
      if (platform === "frontend") await handlers.onDone();
      else handlers.onComplete();
      handlers.onError("private error");
    }
    assert.equal(fixture.state.messages.length, 0);
    assert.equal(fixture.state.streamingMessage, null);
    assert.equal(fixture.state.attachedMedia.length, 0);
  });

  test(`${platform}: deleting an inactive conversation leaves the active stream intact`, async () => {
    const streams = new Map();
    const stopped = [];
    const fixture = appCallbacks(platform, {
      deleteSession: async () => {},
      getSessionHistory: async () => ({
        session: { mode: "AUTO" },
        messages: [],
        documents: [],
      }),
      streamChat: (id, query, mode, handlers, signal) => {
        streams.set(id, handlers);
        if (platform === "frontend")
          signal.addEventListener("abort", () => stopped.push(id));
        return platform === "mobile"
          ? () => stopped.push(id)
          : Promise.resolve();
      },
    });
    Object.assign(fixture.context, {
      currentUser: profile,
      currentUserRef: { current: profile },
      confirm: async () => true,
      removeSession() {},
      sessions: [{ id: "fixture-session" }, { id: "chat-b" }],
    });
    fixture.context.isSendingRef.current = false;
    await fixture.callbacks.handleSendMessage();
    await fixture.callbacks.selectSession("chat-b");
    fixture.context.query = "B";
    fixture.context.inputQuery = "B";
    await fixture.callbacks.handleSendMessage();
    await fixture.callbacks.handleDeleteSession("fixture-session");
    assert.deepEqual(stopped, ["fixture-session"]);
    streams.get("fixture-session").onToken("must not resurrect");
    streams.get("chat-b").onToken("B continues");
    assert.equal(fixture.context.activeSessionId, "chat-b");
    assert.equal(fixture.state.streamingMessage.content, "B continues");
    assert.equal(fixture.context.authVersionRef.current, 0);
  });

  test(`${platform}: history loading blocks sending without discarding the typed draft`, async () => {
    let release;
    const fixture = appCallbacks(platform, {
      getSessionHistory: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      streamChat: () => assert.fail("Must not send before history loads"),
    });
    fixture.context.currentUser = profile;
    fixture.context.isSendingRef.current = false;
    const pending = fixture.callbacks.selectSession("chat-b");
    fixture.context.query = "Keep draft";
    fixture.context.inputQuery = "Keep draft";
    await fixture.callbacks.handleSendMessage();
    assert.equal(fixture.state.messages.length, 0);
    release({
      session: { mode: "AUTO" },
      messages: [{ id: "saved" }],
      documents: [],
    });
    await pending;
    assert.equal(fixture.state.inputQuery, "Keep draft");
    assert.equal(fixture.state.messages[0].id, "saved");
  });
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: Stop during session creation restores the draft and prevents a delayed send`, async () => {
    let finish;
    let creations = 0;
    const fixture = appCallbacks(platform, {
      createSession: (...args) => {
        creations++;
        return new Promise((resolve) => {
          finish = () => resolve({ id: args[4], title: "Fixture" });
        });
      },
      streamChat: () =>
        assert.fail("A stopped creation must not start streaming"),
    });
    fixture.context.currentUser = profile;
    fixture.context.currentUserRef.current = profile;
    fixture.context.isSendingRef.current = false;
    fixture.context.setActiveSessionId(null);
    fixture.context.query = "Recover this prompt";
    fixture.context.inputQuery = "Recover this prompt";
    fixture.state.attachedMedia = [{ id: "image-a", file_type: "image" }];
    fixture.state.documents = [
      { document_id: "doc-a", filename: "fixture.txt" },
    ];
    fixture.state.pendingDocumentIds = ["doc-a"];
    const pending = fixture.callbacks.handleSendMessage();
    await until(() => finish);
    await fixture.callbacks.handleSendMessage();
    assert.equal(creations, 1);
    fixture.callbacks.handleStopGeneration();
    finish();
    await pending;
    assert.equal(fixture.state.messages.length, 0);
    assert.equal(fixture.state.isSending, false);
    assert.equal(fixture.state.streamingMessage, null);
    assert.equal(
      platform === "frontend" ? fixture.state.inputQuery : fixture.state.query,
      "Recover this prompt",
    );
    assert.equal(fixture.state.attachedMedia[0].id, "image-a");
    assert.equal(fixture.state.pendingDocumentIds[0], "doc-a");
  });

  test(`${platform}: an obsolete failed history request cannot show an error over a newer success`, async () => {
    const requests = [];
    const fixture = appCallbacks(platform, {
      getSessionHistory: () =>
        new Promise((resolve, reject) => requests.push({ resolve, reject })),
    });
    fixture.context.currentUser = profile;
    const first = fixture.callbacks.selectSession("fixture-session");
    const latest = fixture.callbacks.selectSession("fixture-session");
    requests[1].resolve({
      session: { mode: "AUTO" },
      messages: [{ id: "latest" }],
      documents: [],
    });
    await latest;
    requests[0].reject(new Error("obsolete fixture failure"));
    await first;
    assert.equal(fixture.state.messages[0].id, "latest");
    assert.equal(fixture.state.historyError, null);
    assert.equal(fixture.state.isLoadingHistory, false);
  });
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: React subscriptions follow the active chat and session assignment preserves input identity`, () => {
    const fixture = appCallbacks(platform, {});
    const store = fixture.workspace;
    const a = store.active;
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);
    store.select("chat-b");
    const before = store.getSnapshot();
    store.patch(a, { inputQuery: "Retained in background" });
    assert.equal(store.getSnapshot(), before);
    assert.equal(notifications, 1);
    store.select(a.sessionId);
    assert.equal(store.active.state.inputQuery, "Retained in background");
    const draft = store.select(null);
    const viewId = draft.viewId;
    const revision = store.getSnapshot();
    store.adopt(draft, "assigned-session");
    assert.equal(store.active.viewId, viewId);
    assert.ok(store.getSnapshot() > revision);
    unsubscribe();
  });

  test(`${platform}: concurrent uploads are all retained and busy state lasts until every upload finishes`, async () => {
    const uploads = [];
    const fixture = appCallbacks(platform, {
      uploadMedia: () => new Promise((resolve) => uploads.push(resolve)),
    });
    const upload = (name) =>
      platform === "frontend"
        ? fixture.callbacks.handleFileUpload({ name, type: "image/png" })
        : fixture.callbacks.handleAttachFile({
            name,
            mimeType: "image/png",
            uri: "file:///fixture",
          });
    const first = upload("one.png");
    const second = upload("two.png");
    assert.equal(uploads.length, 2);
    uploads[1]({ id: "two" });
    await second;
    assert.equal(fixture.state.isUploading, true);
    uploads[0]({ id: "one" });
    await first;
    assert.equal(fixture.state.isUploading, false);
    assert.ok(fixture.state.attachedMedia.some((item) => item.id === "one"));
    assert.ok(fixture.state.attachedMedia.some((item) => item.id === "two"));
  });
}

for (const platform of ["frontend", "mobile"]) {
  test(`${platform}: clearing one chat neither blocks sending nor clears messages in another chat`, async () => {
    let finishClear;
    const fixture = appCallbacks(platform, {
      clearSessionMessages: () =>
        new Promise((resolve) => {
          finishClear = resolve;
        }),
      getSessionHistory: async () => ({
        session: { mode: "AUTO" },
        messages: [],
        documents: [],
      }),
      streamChat: () => (platform === "mobile" ? () => {} : Promise.resolve()),
    });
    fixture.context.currentUser = profile;
    fixture.context.currentUserRef.current = profile;
    fixture.context.isSendingRef.current = false;
    fixture.context.confirm = async () => true;
    let pending;
    if (platform === "frontend")
      pending = fixture.callbacks.handleClearMessages();
    else {
      let buttons;
      fixture.context.Alert.alert = (title, message, actions) => {
        buttons = actions;
      };
      fixture.callbacks.handleClearMessages();
      pending = buttons.find((action) => action.text === "Clear").onPress();
    }
    await until(() => finishClear);
    const original = fixture.workspace.active;
    assert.equal(original.state.isClearingHistory, true);
    await fixture.callbacks.selectSession("chat-b");
    fixture.context.query = "B prompt";
    fixture.context.inputQuery = "B prompt";
    await fixture.callbacks.handleSendMessage();
    assert.equal(fixture.state.isSending, true);
    finishClear();
    await pending;
    assert.equal(fixture.state.messages.at(-1).content, "B prompt");
    assert.equal(fixture.state.isSending, true);
    assert.equal(original.state.messages.length, 0);
    assert.equal(original.state.isClearingHistory, false);
  });
}

function client(platform, handleRequest, environment = {}) {
  const storage = new Map();
  const requests = [];
  const uploads = [];
  const asyncStorage = {
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => {
      storage.set(key, value);
    },
    removeItem: async (key) => {
      storage.delete(key);
    },
  };
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
    URL,
    AbortController,
    DOMException,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    process: { env: environment },
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
          default: asyncStorage,
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
    getApiBaseUrl: exports.getApiBaseUrl,
    resetApiBaseUrl: exports.resetApiBaseUrl,
    asyncStorage,
    context,
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

test("mobile: stalled login times out even if native fetch ignores abort, without accepting a late login", async () => {
  let release;
  let timeout;
  let signal;
  let retry = false;
  const fixture = client("mobile", (_, options) => {
    signal = options.signal;
    if (retry) return response(credentials("retry-token"));
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  fixture.context.setTimeout = (callback, delay) => {
    assert.equal(delay, 30000);
    timeout = callback;
    return 1;
  };
  fixture.context.clearTimeout = () => {};
  const pending = fixture.api.login("fixture", "password");
  const rejected = assert.rejects(
    pending,
    /server did not respond within 30 seconds/,
  );
  await until(() => release);
  timeout();
  await rejected;
  assert.equal(signal.aborted, true);
  release(response(credentials("late-token")));
  await tick();
  assert.equal(fixture.storage.has("contexify_auth_session"), false);
  assert.equal(fixture.requests.length, 1);
  retry = true;
  await fixture.api.login("fixture", "password");
  assert.equal(
    JSON.parse(fixture.storage.get("contexify_auth_session")).access_token,
    "retry-token",
  );
});

test("mobile: authentication failures settle and clean up the request deadline", async () => {
  const failure = new TypeError("Network request failed");
  let cleared = 0;
  const fixture = client("mobile", () => {
    throw failure;
  });
  fixture.context.setTimeout = () => 1;
  fixture.context.clearTimeout = () => {
    cleared++;
  };
  await assert.rejects(
    fixture.api.login("fixture", "password"),
    /Network request failed/,
  );
  assert.equal(cleared, 1);
  assert.equal(fixture.requests.length, 1);
});

test("mobile: history failures reject while genuine empty history succeeds", async () => {
  for (const result of [
    response({}, 503),
    response({}, 404),
    response({}),
    new Error("offline"),
  ]) {
    const fixture = client("mobile", (url) => {
      if (url.endsWith("/user/login")) return response(credentials("signed"));
      if (result instanceof Error) throw result;
      return result;
    });
    await fixture.api.login("fixture", "password");
    await assert.rejects(fixture.api.getUserSessions("u1"));
    await assert.rejects(fixture.api.getSessionHistory("chat-a"));
  }
  const fixture = client("mobile", (url) => {
    if (url.endsWith("/user/login")) return response(credentials("signed"));
    if (url.includes("/session/list"))
      return response({ sessions: [], total: 0, has_more: false });
    return response({ session: { id: "chat-a" }, messages: [], documents: [] });
  });
  await fixture.api.login("fixture", "password");
  assert.equal((await fixture.api.getUserSessions("u1")).sessions.length, 0);
  assert.equal(
    (await fixture.api.getSessionHistory("chat-a")).messages.length,
    0,
  );
});

test("mobile: search, pagination and cancellation reach the backend", async () => {
  const fixture = client("mobile", (url, options) => {
    if (url.endsWith("/user/login")) return response(credentials("signed"));
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    return response({ sessions: [], total: 0, has_more: false });
  });
  await fixture.api.login("fixture", "password");
  const controller = new AbortController();
  await fixture.api.getUserSessions("u1", {
    search: " older & rare ",
    limit: 15,
    offset: 30,
    sort_by: "first_created",
    signal: controller.signal,
  });
  const request = fixture.requests.at(-1);
  const query = new URL(request.url).searchParams;
  assert.equal(query.get("search"), "older & rare");
  assert.equal(query.get("offset"), "30");
  assert.equal(query.get("sort_by"), "first_created");
  assert.equal(request.options.signal, controller.signal);
  controller.abort();
  await assert.rejects(
    fixture.api.getUserSessions("u1", { signal: controller.signal }),
    { name: "AbortError" },
  );
});

test("mobile: reset restores the environment URL and failed saves keep the active server", async () => {
  const fixture = client(
    "mobile",
    () => {
      throw new Error("Unexpected network request");
    },
    {
      EXPO_PUBLIC_API_URL: "https://environment.invalid/api/v1/",
    },
  );
  assert.equal(await fixture.getApiBaseUrl(), "https://environment.invalid");
  await fixture.setApiBaseUrl(" 'http://local.invalid:8001/api/v1/' ");
  assert.equal(await fixture.getApiBaseUrl(), "http://local.invalid:8001");
  await fixture.resetApiBaseUrl();
  assert.equal(await fixture.getApiBaseUrl(), "https://environment.invalid");
  assert.equal(fixture.storage.has("contexify_server_url"), false);
  fixture.asyncStorage.setItem = async () => {
    throw new Error("Storage unavailable");
  };
  await assert.rejects(
    fixture.setApiBaseUrl("http://other.invalid"),
    /Storage unavailable/,
  );
  assert.equal(await fixture.getApiBaseUrl(), "https://environment.invalid");
  fixture.asyncStorage.removeItem = async () => {
    throw new Error("Storage unavailable");
  };
  await assert.rejects(fixture.resetApiBaseUrl(), /Storage unavailable/);
  assert.equal(await fixture.getApiBaseUrl(), "https://environment.invalid");
  const fallback = client("mobile", () => {});
  await fallback.setApiBaseUrl("http://override.invalid");
  await fallback.resetApiBaseUrl();
  assert.equal(await fallback.getApiBaseUrl(), "http://fixture.invalid");
});

test("mobile: a stale preference read cannot undo a newly saved URL", async () => {
  const fixture = client("mobile", () => {});
  let release;
  fixture.asyncStorage.getItem = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = fixture.getApiBaseUrl();
  await fixture.setApiBaseUrl("http://new.invalid");
  release("http://old.invalid");
  assert.equal(await pending, "http://new.invalid");
});

test("mobile: health tests use the entered URL without credentials or changing saved settings", async () => {
  const fixture = client("mobile", (url) =>
    response(
      url.endsWith("/user/login")
        ? credentials("signed")
        : { status: "online" },
    ),
  );
  await fixture.api.login("fixture", "password");
  const credentialsBefore = fixture.storage.get("contexify_auth_session");
  assert.equal(
    await fixture.api.pingHealth("https://typed.invalid/api/v1/"),
    true,
  );
  assert.equal(
    fixture.requests.at(-1).url,
    "https://typed.invalid/api/v1/health",
  );
  assert.equal(
    new Headers(fixture.requests.at(-1).options.headers).has("Authorization"),
    false,
  );
  assert.equal(await fixture.getApiBaseUrl(), "http://fixture.invalid");
  assert.equal(
    fixture.storage.get("contexify_auth_session"),
    credentialsBefore,
  );
  for (const invalid of [
    "",
    "localhost:8001",
    "ftp://host.invalid",
    "https://user:secret@host.invalid",
    "https://host.invalid?token=secret",
    "https://host.invalid/#fragment",
  ]) {
    await assert.rejects(fixture.setApiBaseUrl(invalid), /valid http/);
    await assert.rejects(fixture.api.pingHealth(invalid), /valid http/);
  }
  assert.equal(fixture.requests.length, 2);
});

test("mobile: health checks reject unhealthy responses and time out or cancel", async () => {
  for (const result of [
    response({ status: "online" }, 503),
    response({}),
    new Error("Offline"),
  ]) {
    const fixture = client("mobile", () => {
      if (result instanceof Error) throw result;
      return result;
    });
    assert.equal(await fixture.api.pingHealth("http://typed.invalid"), false);
  }
  for (const cancelled of [false, true]) {
    const fixture = client(
      "mobile",
      (_, { signal }) =>
        new Promise((resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort);
        }),
    );
    let timeout;
    fixture.context.setTimeout = (callback, delay) => {
      assert.equal(delay, 8000);
      timeout = callback;
      return 1;
    };
    fixture.context.clearTimeout = () => {};
    const controller = new AbortController();
    const pending = fixture.api.pingHealth(
      "http://typed.invalid",
      controller.signal,
    );
    if (cancelled) controller.abort();
    else timeout();
    assert.equal(await pending, false);
  }
});
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
  const previousRejected = assert.rejects(previous, /server changed/);
  await tick();
  release(response(credentials("previous-server-token")));
  await previousRejected;
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
          "handleAttachDocumentFromModal",
          "handleSendMessage",
          "handleReplyMessage",
          "handleStopGeneration",
          "handleNewSession",
          "handleClearMessages",
          "handleDeleteSession",
          "selectSession",
        ]
      : [
          "sortMobileSessions",
          "loadUserSessions",
          "handleLoadMoreSessions",
          "handleRefreshSessions",
          "handleSearchSessions",
          "handleToggleSortOrder",
          "cancelStreamForAuthChange",
          "handleClearMessages",
          "handleNewChat",
          "handleLogout",
          "handleAuthSuccess",
          "handleAttachFile",
          "handleDetachDocument",
          "handleAttachDocumentFromModal",
          "handleSendMessage",
          "handleReplyMessage",
          "handleStopGeneration",
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
    sessions: [],
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
    SESSIONS_PAGE_SIZE: 15,
    sessionSortRef: { current: "last_created" },
    sessionSearchRef: { current: "" },
    sessionsRequestRef: { current: 0 },
    sessionsAbortRef: { current: null },
    sessionsSearchTimerRef: { current: null },
    sessionsPageRef: { current: { offset: 0, hasMore: false, ready: false } },
    sessionsError: null,
    clearTimeout,
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
    prependSession() {},
    updateSessionTitle() {},
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
  const storeExports = {};
  const storeCode = ts.transpileModule(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        platform,
        "src/services/conversation_store.ts",
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  vm.runInNewContext(storeCode, { exports: storeExports });
  const initial = () => ({
    messages: [],
    documents: [],
    pendingDocumentIds: [],
    attachedMedia: [],
    replyingTo: null,
    streamingMessage: null,
    isSending: false,
    isUploading: false,
    isTemporaryChat: false,
    currentMode: "AUTO",
    inputQuery: "",
    query: "",
    uploadStatusText: "",
    operationError: null,
    historyError: null,
    isLoadingHistory: false,
    isClearingHistory: false,
  });
  const workspace = new storeExports.ConversationStore(initial);
  workspace.select("fixture-session");
  workspace.patch(workspace.active, {
    ...state,
    inputQuery: "review",
    query: "review",
  });
  workspace.active.cancel = () => {
    cancelled++;
  };
  context.conversationStore = workspace;
  context.setTimeout = (callback) => callback();
  context.setActiveSessionId = (sessionId) => {
    workspace.select(sessionId);
    context.activeSessionIdRef.current = sessionId;
    context.isSendingRef.current = workspace.active.state.isSending;
  };
  for (const field of Object.keys(initial())) {
    Object.defineProperty(context, field, {
      configurable: true,
      get: () => workspace.active.state[field],
      set: (value) => workspace.patch(workspace.active, { [field]: value }),
    });
  }
  Object.defineProperty(context, "activeSessionId", {
    get: () => workspace.active.sessionId,
  });
  const setters = Object.keys(initial())
    .map(
      (field) =>
        `const set${field[0].toUpperCase() + field.slice(1)} = conversationStore.setter(conversation, "${field}");`,
    )
    .join("\n");
  const values = Object.keys(initial()).join(",");
  const code = ts.transpileModule(
    `exports.createCallbacks = () => {
      const conversation = conversationStore.active;
      const { ${values} } = conversation.state;
      ${setters}
      ${callbacks}
      return { ${names.join(",")} };
    };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  vm.runInNewContext(code, context);
  const stateProxy = new Proxy(state, {
    get: (target, field) =>
      field in initial() ? workspace.active.state[field] : target[field],
    set: (target, field, value) => {
      if (field in initial())
        workspace.patch(workspace.active, { [field]: value });
      else target[field] = value;
      return true;
    },
  });
  return {
    callbacks: new Proxy(
      {},
      {
        get:
          (_, name) =>
          (...args) =>
            context.exports.createCallbacks()[name](...args),
      },
    ),
    state: stateProxy,
    workspace,
    context,
    cancelled: () => cancelled,
  };
}

test("mobile: list failures preserve cached chats and retry replaces them with confirmed results", async () => {
  let fail = true;
  const fixture = appCallbacks("mobile", {
    getUserSessions: async () => {
      if (fail) throw new Error("offline");
      return { sessions: [], total: 0, has_more: false };
    },
  });
  fixture.state.sessions = [{ id: "cached" }];
  await fixture.callbacks.loadUserSessions("u1");
  assert.equal(fixture.state.sessions[0].id, "cached");
  assert.match(fixture.state.sessionsError, /retry/);
  assert.equal(fixture.state.isRefreshingSessions, false);
  fail = false;
  await fixture.callbacks.loadUserSessions("u1");
  assert.equal(fixture.state.sessions.length, 0);
  assert.equal(fixture.state.sessionsError, null);
});

test("mobile: rapid searches debounce, cancel old requests and discard stale responses", async () => {
  const pending = [];
  const fixture = appCallbacks("mobile", {
    getUserSessions: (_, params) =>
      new Promise((resolve) => pending.push({ params, resolve })),
  });
  fixture.context.currentUserRef.current = profile;
  let nextTimer = 0;
  const timers = new Map();
  fixture.context.setTimeout = (callback, delay) => {
    assert.equal(delay, 300);
    timers.set(++nextTimer, callback);
    return nextTimer;
  };
  fixture.context.clearTimeout = (timer) => timers.delete(timer);
  const initial = fixture.callbacks.loadUserSessions("u1");
  fixture.callbacks.handleSearchSessions("older");
  fixture.callbacks.handleSearchSessions("rare");
  assert.equal(timers.size, 1);
  assert.equal(pending[0].params.signal.aborted, true);
  Array.from(timers.values())[0]();
  assert.equal(pending[1].params.search, "rare");
  assert.equal(pending[1].params.offset, 0);
  pending[1].resolve({
    sessions: [{ id: "match", created_at: "2026-01-01" }],
    total: 1,
    has_more: false,
  });
  await until(() => fixture.state.sessions?.[0]?.id === "match");
  pending[0].resolve({
    sessions: [{ id: "stale" }],
    total: 99,
    has_more: true,
  });
  await initial;
  assert.equal(fixture.state.sessions[0].id, "match");
  assert.equal(fixture.state.totalSessions, 1);
  assert.equal(fixture.state.isRefreshingSessions, false);
});

test("mobile: search pagination uses server offsets and ignores duplicate load-more requests", async () => {
  const requests = [];
  let release;
  const fixture = appCallbacks("mobile", {
    getUserSessions: async (_, params) => {
      requests.push(params);
      if (requests.length === 1)
        return { sessions: [{ id: "match-a" }], total: 2, has_more: true };
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  fixture.context.currentUser = profile;
  fixture.context.sessionSearchRef.current = "older";
  await fixture.callbacks.loadUserSessions("u1", "first_created");
  fixture.state.sessions.push({ id: "local-draft" });
  const pending = fixture.callbacks.handleLoadMoreSessions();
  await fixture.callbacks.handleLoadMoreSessions();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].offset, 1);
  assert.equal(requests[1].search, "older");
  assert.equal(requests[1].sort_by, "first_created");
  release({
    sessions: [{ id: "match-a" }, { id: "match-b" }],
    total: 2,
    has_more: false,
  });
  await pending;
  assert.equal(fixture.state.sessions.length, 3);
  assert.equal(
    new Set(fixture.state.sessions.map((session) => session.id)).size,
    3,
  );
  assert.equal(fixture.state.isLoadingMoreSessions, false);
});

test("mobile: logout cancels pending list requests and prevents private history from reappearing", async () => {
  let release;
  let signal;
  const fixture = appCallbacks("mobile", {
    getUserSessions: (_, params) => {
      signal = params.signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    logout: async () => {},
  });
  const pending = fixture.callbacks.loadUserSessions("u1");
  await fixture.callbacks.handleLogout();
  assert.equal(signal.aborted, true);
  release({ sessions: [{ id: "previous-owner" }], total: 1, has_more: false });
  await pending;
  assert.equal(fixture.state.sessions.length, 0);
  assert.equal(fixture.state.sessionsError, null);
  assert.equal(fixture.state.isRefreshingSessions, false);
});

test("mobile: sorting failures retain loaded chats and an older request cannot overwrite the new sort", async () => {
  let release;
  let fail = false;
  const fixture = appCallbacks("mobile", {
    getUserSessions: (_, params) => {
      if (fail) throw new Error("offline");
      if (params.sort_by === "last_created")
        return new Promise((resolve) => {
          release = resolve;
        });
      return {
        sessions: [{ id: "sorted", created_at: "2026-01-01" }],
        total: 1,
        has_more: false,
      };
    },
  });
  fixture.context.currentUser = profile;
  fixture.context.AsyncStorage.setItem = async () => {
    throw new Error("Storage unavailable");
  };
  const initial = fixture.callbacks.loadUserSessions("u1");
  await fixture.callbacks.handleToggleSortOrder();
  assert.equal(fixture.context.sessionSortRef.current, "first_created");
  release({ sessions: [{ id: "stale" }], total: 1, has_more: false });
  await initial;
  assert.equal(fixture.state.sessions[0].id, "sorted");
  fail = true;
  await fixture.callbacks.handleToggleSortOrder();
  assert.match(fixture.state.sessionsError, /retry/);
  assert.equal(fixture.state.sessions[0].id, "sorted");
  assert.equal(fixture.state.isRefreshingSessions, false);
});

test("mobile: pagination failures retain every loaded chat and allow a fresh retry", async () => {
  let fail = false;
  const fixture = appCallbacks("mobile", {
    getUserSessions: async () => {
      if (fail) throw new Error("offline");
      return { sessions: [{ id: "saved" }], total: 20, has_more: true };
    },
  });
  fixture.context.currentUser = profile;
  await fixture.callbacks.loadUserSessions("u1");
  fail = true;
  await fixture.callbacks.handleLoadMoreSessions();
  assert.equal(fixture.state.sessions[0].id, "saved");
  assert.match(fixture.state.sessionsError, /retry/);
  assert.equal(fixture.state.isLoadingMoreSessions, false);
  fail = false;
  await fixture.callbacks.handleRefreshSessions();
  assert.equal(fixture.state.sessionsError, null);
  assert.equal(fixture.state.sessions[0].id, "saved");
});

test("mobile: a failed history request preserves messages and a successful retry clears the error", async () => {
  let fail = true;
  const fixture = appCallbacks("mobile", {
    getSessionHistory: async () => {
      if (fail) throw new Error("offline");
      return {
        session: { id: "fixture-session" },
        messages: [{ id: "saved" }],
        documents: [],
      };
    },
  });
  fixture.context.Alert.alert = () => {};
  await fixture.callbacks.selectSession("fixture-session");
  assert.equal(fixture.state.messages[0], "private");
  assert.match(fixture.state.historyError, /kept/);
  fail = false;
  await fixture.callbacks.selectSession("fixture-session");
  assert.equal(fixture.state.historyError, null);
  assert.equal(fixture.state.messages[0].id, "saved");
});

function serverConfigCallbacks(apiService) {
  const source = fs.readFileSync(
    path.join(__dirname, "../mobile/src/components/ServerConfigModal.tsx"),
    "utf8",
  );
  const parsed = ts.createSourceFile(
    "ServerConfigModal.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = [
    "invalidatePing",
    "changeInput",
    "handleTestPing",
    "handleSave",
    "handleReset",
  ];
  const declarations = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      names.includes(node.name.getText(parsed))
    )
      declarations.push(`const ${node.getText(parsed)};`);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(declarations.length, names.length);
  const state = {};
  const context = {
    exports: {},
    apiService,
    Error,
    inputUrl: "http://typed.invalid",
    onClose: () => {
      state.closed = true;
    },
    pingRequestRef: { current: 0 },
    pingAbortRef: { current: null },
    savingRef: { current: false },
    AbortController,
    Haptics: {
      impactAsync() {},
      notificationAsync() {},
      ImpactFeedbackStyle: { Light: 1 },
      NotificationFeedbackType: { Success: 1, Error: 2 },
    },
  };
  for (const key of ["inputUrl", "pingStatus", "error", "isSaving"])
    context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      context[key] = state[key] = value;
    };
  vm.runInNewContext(
    ts.transpileModule(
      `${declarations.join("\n")}\nexports.callbacks = {${names.join(",")}};`,
      { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
    ).outputText,
    context,
  );
  return { callbacks: context.exports.callbacks, context, state };
}

test("mobile: connection modal tests the input and ignores results after editing or closing", async () => {
  let release;
  let signal;
  const fixture = serverConfigCallbacks({
    pingHealth: (url, requestSignal) => {
      assert.equal(url, "http://typed.invalid");
      signal = requestSignal;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const pending = fixture.callbacks.handleTestPing();
  fixture.callbacks.changeInput("http://new.invalid");
  assert.equal(signal.aborted, true);
  release(true);
  await pending;
  assert.equal(fixture.state.pingStatus, "idle");
  assert.equal(fixture.state.inputUrl, "http://new.invalid");
  fixture.context.inputUrl = "http://typed.invalid";
  const next = fixture.callbacks.handleTestPing();
  fixture.callbacks.invalidatePing();
  release(true);
  await next;
  assert.equal(fixture.state.pingStatus, "testing");
});

test("mobile: connection modal shows save/reset failures and blocks duplicate saves", async () => {
  const fixture = serverConfigCallbacks({});
  let saves = 0;
  let release;
  fixture.context.setApiBaseUrl = () => {
    saves++;
    return new Promise((_, reject) => {
      release = reject;
    });
  };
  const pending = fixture.callbacks.handleSave();
  await fixture.callbacks.handleSave();
  assert.equal(saves, 1);
  release(new Error("Storage unavailable"));
  await pending;
  assert.equal(fixture.state.error, "Storage unavailable");
  assert.equal(fixture.state.closed, undefined);
  assert.equal(fixture.state.isSaving, false);
  fixture.context.resetApiBaseUrl = async () => {
    throw new Error("Storage unavailable");
  };
  await fixture.callbacks.handleReset();
  assert.match(fixture.state.error, /restore the default/);
  assert.equal(fixture.state.isSaving, false);
});

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
  test(`${platform}: library selection sends an existing document in the target chat`, async () => {
    let sent;
    const fixture = appCallbacks(platform, {
      streamChat(...args) {
        sent = args;
        return () => {};
      },
    });
    fixture.context.setActiveSessionId("target-chat");
    fixture.workspace.patch(fixture.workspace.active, {
      currentMode: "WEB_SEARCH",
      attachedMedia: [],
      documents: [],
      pendingDocumentIds: [],
    });
    const callbacks = fixture.callbacks;
    const document = { document_id: "source-document", filename: "source.txt" };
    callbacks.handleAttachDocumentFromModal(document);
    callbacks.handleAttachDocumentFromModal(document);
    assert.equal(fixture.state.currentMode, "DOCUMENT_RAG");
    assert.equal(fixture.state.pendingDocumentIds.length, 1);
    assert.equal(fixture.state.documents.length, 1);
    await fixture.callbacks.handleSendMessage();
    assert.equal(sent[0], "target-chat");
    const attachments = platform === "frontend" ? sent[5] : sent[4];
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].id, "source-document");
    assert.equal(attachments[0].file_type, "document");
  });

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
    assert.equal(fixture.state.inputQuery, "review");
    assert.equal(fixture.state.query, "review");
    assert.equal(fixture.state.isSending, false);
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
    assert.equal(fixture.context.authVersionRef.current, 0);
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
