// Run the real message-list hooks with deterministic DOM geometry; no network/device.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("../frontend/node_modules/typescript");

function messages(start, end) {
  return Array.from({ length: end - start }, (_, i) => ({
    id: `saved-${start + i}`,
    role: (start + i) % 2 ? "assistant" : "user",
    content: `Message ${start + i}`,
  }));
}
function messageList(initial) {
  const slots = [];
  let index = 0,
    dirty = false,
    layout = [],
    effects = [],
    nodes = new Map();
  const props = {
    messages: [],
    streamingMessage: null,
    onSelectPrompt() {},
    ...initial,
  };
  const container = {
    scrollTop: 0,
    clientHeight: 400,
    get scrollHeight() {
      return props.messages.length * 100;
    },
    getBoundingClientRect: () => ({ top: 0 }),
    contains: (node) => [...nodes.values()].includes(node),
    querySelectorAll: () => [...nodes.values()],
  };
  let bottomCalls = 0,
    resize;
  const end = {
    scrollIntoView() {
      bottomCalls++;
      container.scrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
    },
  };
  const content = {};
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  function effect(queue, run, deps) {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) {
      const previous = slots[i];
      slots[i] = { deps };
      queue.push(() => {
        previous?.cleanup?.();
        slots[i].cleanup = run();
      });
    }
  }
  const react = {
    createElement(type, attributes, ...children) {
      if (type === "div" && attributes?.ref) {
        attributes.ref.current = attributes.onScroll
          ? container
          : attributes.className
            ? content
            : end;
        if (attributes.onScroll) container.handlers = attributes;
      }
      return { type, props: attributes || {}, children };
    },
    useRef(value) {
      const i = index++;
      return (slots[i] ||= { current: value });
    },
    useState(value) {
      const i = index++;
      slots[i] ||= { value };
      return [
        slots[i].value,
        (next) => {
          const value =
            typeof next === "function" ? next(slots[i].value) : next;
          if (!Object.is(value, slots[i].value)) {
            slots[i].value = value;
            dirty = true;
          }
        },
      ];
    },
    useMemo(run, deps) {
      const i = index++;
      if (!slots[i] || !same(slots[i].deps, deps))
        slots[i] = { deps, value: run() };
      return slots[i].value;
    },
    useCallback(run, deps) {
      return react.useMemo(() => run, deps);
    },
    useLayoutEffect(run, deps) {
      effect(layout, run, deps);
    },
    useEffect(run, deps) {
      effect(effects, run, deps);
    },
  };
  const exports = {};
  const filename = path.join(
    __dirname,
    "../frontend/src/components/Chat/MessageList.tsx",
  );
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    setTimeout,
    clearTimeout,
    document: { getElementById: (id) => nodes.get(id) },
    ResizeObserver: class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
    require(name) {
      if (name === "react")
        return { __esModule: true, default: react, ...react };
      return new Proxy({}, { get: () => () => null });
    },
  });
  let tree;
  function render() {
    for (let attempt = 0; attempt < 10; attempt++) {
      index = 0;
      dirty = false;
      layout = [];
      effects = [];
      nodes = new Map(
        props.messages.map((message, i) => [
          `msg-${message.id}`,
          {
            id: `msg-${message.id}`,
            getBoundingClientRect: () => ({
              top: i * 100 - container.scrollTop,
              bottom: (i + 1) * 100 - container.scrollTop,
            }),
          },
        ]),
      );
      tree = exports.MessageList(props);
      layout.forEach((run) => run());
      effects.forEach((run) => run());
      if (!dirty) return;
    }
    throw new Error("Unexpected repeated rendering");
  }
  const harness = {
    props,
    container,
    render,
    get tree() {
      return tree;
    },
    get bottomCalls() {
      return bottomCalls;
    },
    resize: () => resize?.(),
  };
  render();
  return harness;
}
function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (predicate(tree)) return tree;
  for (const child of (tree.children || []).flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test("web: initial async history opens at the newest message without fetching the entire chat", () => {
  let calls = 0;
  const view = messageList({
    hasOlderHistory: true,
    onHistoryPage: async () => {
      calls++;
      return true;
    },
  });
  view.props.messages = messages(2, 52);
  view.render();
  assert.equal(view.container.scrollTop, 4600);
  view.container.handlers.onScroll();
  assert.equal(calls, 0);
  assert.equal(view.props.messages.length, 50);
});

test("web: the 52-message conversation prepends its first two messages without snapping to either end", async () => {
  let release,
    calls = 0;
  const view = messageList({
    messages: messages(2, 52),
    hasOlderHistory: true,
    onHistoryPage: async (direction) => {
      calls++;
      assert.equal(direction, "older");
      await new Promise((resolve) => (release = resolve));
      view.props.messages = messages(0, 52);
      view.props.hasOlderHistory = false;
      view.render();
      return true;
    },
  });
  view.container.scrollTop = 80;
  const bottomBefore = view.bottomCalls;
  view.container.handlers.onWheel();
  assert.equal(calls, 1);
  view.container.handlers.onScroll();
  assert.equal(calls, 1);
  assert.equal(view.props.messages.length, 50);
  release();
  await settle();
  view.render();
  assert.equal(view.props.messages.length, 52);
  assert.equal(view.container.scrollTop, 280);
  assert.equal(view.bottomCalls, bottomBefore);
  view.container.handlers.onScroll();
  assert.equal(calls, 1);
});

test("web: scrolling during a fetch preserves the final reading position", async () => {
  let release;
  const view = messageList({
    messages: messages(50, 100),
    hasOlderHistory: true,
    onHistoryPage: async () => {
      await new Promise((resolve) => (release = resolve));
      view.props.messages = messages(0, 100);
      view.render();
      return true;
    },
  });
  view.container.scrollTop = 100;
  view.container.handlers.onWheel();
  view.container.scrollTop = 20;
  view.container.handlers.onScroll();
  release();
  await settle();
  view.render();
  assert.equal(view.container.scrollTop, 5020);
});

test("web: failed history loads leave visible messages in place and a later gesture retries", async () => {
  let calls = 0;
  const view = messageList({
    messages: messages(50, 100),
    hasOlderHistory: true,
    onHistoryPage: async () => {
      calls++;
      return false;
    },
  });
  view.container.scrollTop = 50;
  view.container.handlers.onWheel();
  await settle();
  view.render();
  assert.equal(view.container.scrollTop, 50);
  assert.equal(view.props.messages.length, 50);
  view.container.handlers.onWheel();
  await settle();
  assert.equal(calls, 2);
});

test("web: layout changes stay at the newest message only while the reader follows the bottom", () => {
  const view = messageList({ messages: messages(0, 50) });
  const before = view.bottomCalls;
  view.resize();
  assert.equal(view.bottomCalls, before + 1);
  view.container.scrollTop = 500;
  view.container.handlers.onWheel();
  view.resize();
  assert.equal(view.bottomCalls, before + 1);
  view.props.streamingMessage = { content: "More text" };
  view.render();
  assert.equal(view.container.scrollTop, 500);
});

test("web: the existing down arrow restores latest messages after jumping into old history", async () => {
  const view = messageList({
    messages: messages(0, 50),
    hasNewerHistory: true,
    onHistoryPage: async (direction) => {
      assert.equal(direction, "latest");
      view.props.messages = messages(150, 200);
      view.props.hasNewerHistory = false;
      view.render();
      return true;
    },
  });
  view.container.scrollTop = 100;
  view.container.handlers.onWheel();
  view.render();
  const button = find(
    view.tree,
    (node) =>
      node.type === "button" &&
      node.props["aria-label"] === "Scroll to latest message",
  );
  assert.ok(button);
  await button.props.onClick();
  view.render();
  assert.equal(view.props.messages[0].id, "saved-150");
  assert.equal(view.container.scrollTop, 4600);
});

function mobileHistory() {
  const source = fs.readFileSync(
    path.join(__dirname, "../mobile/App.tsx"),
    "utf8",
  );
  const parsed = ts.createSourceFile(
    "App.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = [
    "handleScroll",
    "handleHistoryScroll",
    "scrollToPendingMessage",
    "handleJumpToMessage",
  ];
  const declarations = [];
  const attributes = {};
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      names.includes(node.name.getText(parsed))
    )
      declarations.push(`const ${node.getText(parsed)};`);
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(parsed) === "FlatList"
    ) {
      for (const attribute of node.attributes.properties)
        if (
          ts.isJsxAttribute(attribute) &&
          [
            "onContentSizeChange",
            "onScrollBeginDrag",
            "onScrollToIndexFailed",
            "maintainVisibleContentPosition",
          ].includes(attribute.name.getText(parsed))
        )
          attributes[attribute.name.getText(parsed)] =
            attribute.initializer.expression.getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  const calls = [],
    timers = [];
  const conversation = {
    viewId: 1,
    state: {
      messages: messages(150, 200),
      hasOlderHistory: true,
      hasNewerHistory: false,
      isLoadingHistory: false,
    },
  };
  const context = {
    exports: {},
    messages: conversation.state.messages,
    conversation,
    conversationStore: { active: conversation },
    historyGestureRef: {
      current: { viewId: -1, interacted: false, positioned: false },
    },
    historyEdgeLoadingRef: { current: null },
    isAtBottomRef: { current: true },
    showScrollToBottomRef: { current: false },
    pendingJumpRef: { current: null },
    jumpRetryTimerRef: { current: null },
    highlightTimerRef: { current: null },
    flatListRef: {
      current: {
        scrollToEnd: (options) => calls.push(["end", options]),
        scrollToIndex: (options) => calls.push(["index", options]),
        scrollToOffset: (options) => calls.push(["offset", options]),
      },
    },
    setOperationError: (message) => calls.push(["error", message]),
    setShowScrollToBottom() {},
    setHighlightedMessageId: (id) => calls.push(["highlight", id]),
    useCallback: (run) => run,
    Haptics: { impactAsync() {}, ImpactFeedbackStyle: { Light: "light" } },
    setTimeout(callback, delay) {
      if (delay === 50) callback();
      else timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  };
  const code = ts.transpileModule(
    `${declarations.join("\n")}\nexports.callbacks={${names.join(",")},${Object.entries(
      attributes,
    )
      .map(([name, value]) => `${name}:(${value})`)
      .join(",")}};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  vm.runInNewContext(code, context);
  return { context, calls, timers, callbacks: context.exports.callbacks };
}
const mobileEvent = (y = 0) => ({
  nativeEvent: {
    contentOffset: { y },
    contentSize: { height: 5000 },
    layoutMeasurement: { height: 400 },
  },
});

test("mobile: initial history follows the bottom and prepending does not trigger another scroll to end", async () => {
  const fixture = mobileHistory();
  let finish,
    loads = 0;
  fixture.context.loadHistoryPage = async (direction) => {
    loads++;
    assert.equal(direction, "older");
    await new Promise((resolve) => (finish = resolve));
    return true;
  };
  fixture.callbacks.onContentSizeChange();
  assert.equal(fixture.calls[0][0], "end");
  assert.equal(fixture.calls[0][1].animated, false);
  fixture.callbacks.handleHistoryScroll(mobileEvent());
  assert.equal(loads, 0);
  fixture.callbacks.onScrollBeginDrag(mobileEvent(80));
  assert.equal(loads, 1);
  fixture.callbacks.handleHistoryScroll(mobileEvent(20));
  assert.equal(loads, 1);
  finish();
  await settle();
  fixture.context.conversation.state.messages = messages(148, 200);
  fixture.callbacks.onContentSizeChange();
  assert.equal(fixture.calls.filter((call) => call[0] === "end").length, 1);
  // The installed native list maintains its visible keyed item while data is prepended.
  assert.equal(
    fixture.callbacks.maintainVisibleContentPosition.minIndexForVisible,
    0,
  );
});

test("mobile: an old reply fetches its own history window and scrolls to the canonical target", async () => {
  const fixture = mobileHistory();
  fixture.context.loadHistoryPage = async (direction, id) => {
    assert.equal(direction, "target");
    assert.equal(id, "saved-10");
    fixture.context.conversation.state.messages = messages(5, 16);
    return true;
  };
  await fixture.callbacks.handleJumpToMessage("saved-10");
  const scroll = fixture.calls.find((call) => call[0] === "index");
  assert.equal(scroll[1].index, 5);
  assert.equal(scroll[1].viewPosition, 0.5);
  assert.equal(
    fixture.calls.find((call) => call[0] === "highlight")[1],
    "saved-10",
  );
});

for (const target of [150, 199]) {
  test(`mobile: loaded edge target ${target} fetches missing neighboring context`, async () => {
    const fixture = mobileHistory();
    fixture.context.conversation.state.hasNewerHistory = true;
    let loads = 0;
    fixture.context.loadHistoryPage = async (direction, id) => {
      loads++;
      assert.equal(direction, "target");
      assert.equal(id, `saved-${target}`);
      fixture.context.conversation.state.messages = messages(
        target - 5,
        target + 6,
      );
      return true;
    };
    await fixture.callbacks.handleJumpToMessage(`saved-${target}`);
    assert.equal(loads, 1);
    assert.equal(fixture.calls.find((call) => call[0] === "index")[1].index, 5);
  });
}

test("mobile: interior targets and true chat boundaries reuse loaded messages", async () => {
  const fixture = mobileHistory();
  fixture.context.loadHistoryPage = async () =>
    assert.fail("Unexpected history request");
  await fixture.callbacks.handleJumpToMessage("saved-175");
  fixture.context.conversation.state.hasOlderHistory = false;
  await fixture.callbacks.handleJumpToMessage("saved-150");
  await fixture.callbacks.handleJumpToMessage("saved-199");
  assert.deepEqual(
    fixture.calls
      .filter((call) => call[0] === "index")
      .map((call) => call[1].index),
    [25, 0, 49],
  );
});

function webReply(initial) {
  const source = fs.readFileSync(
    path.join(__dirname, "../frontend/src/components/Chat/ChatWorkspace.tsx"),
    "utf8",
  );
  const parsed = ts.createSourceFile(
    "ChatWorkspace.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let declaration;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(parsed) === "handleJumpToMessage"
    )
      declaration = `const ${node.getText(parsed)};`;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(declaration);
  const calls = [];
  let visible = initial.visible !== false;
  const element = {
    scrollIntoView: (options) => calls.push(["scroll", options]),
  };
  const context = {
    exports: {},
    messages: messages(150, 200),
    hasOlderHistory: true,
    hasNewerHistory: true,
    useCallback: (run) => run,
    document: { getElementById: () => (visible ? element : null) },
    requestAnimationFrame: (run) => run(),
    setHighlightedMessageId: (id) => calls.push(["highlight", id]),
    highlightTimerRef: { current: null },
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
    onHistoryPage: async (direction, id) => {
      calls.push(["load", direction, id]);
      visible = true;
      return true;
    },
    ...initial,
  };
  const code = ts.transpileModule(
    `${declaration} exports.jump=handleJumpToMessage;`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  vm.runInNewContext(code, context);
  return { calls, jump: context.exports.jump };
}

for (const target of [10, 150, 199]) {
  test(`web: reply target ${target} loads missing context and centers/highlights it`, async () => {
    const fixture = webReply({ visible: target !== 10 });
    await fixture.jump(`msg-saved-${target}`);
    assert.deepEqual(fixture.calls[0], ["load", "target", `saved-${target}`]);
    assert.equal(fixture.calls[1][0], "scroll");
    assert.equal(fixture.calls[1][1].block, "center");
    assert.deepEqual(fixture.calls[2], ["highlight", `saved-${target}`]);
  });
}

test("web: interior targets and true chat boundaries avoid history requests", async () => {
  for (const target of [150, 175, 199]) {
    const fixture = webReply({
      hasOlderHistory: false,
      hasNewerHistory: false,
    });
    await fixture.jump(`saved-${target}`);
    assert.equal(
      fixture.calls.some((call) => call[0] === "load"),
      false,
    );
    assert.equal(fixture.calls[0][1].block, "center");
  }
});

test("mobile: an unmeasured reply target retries after rendering, and stale retries cannot scroll another chat", () => {
  const fixture = mobileHistory();
  fixture.context.pendingJumpRef.current = {
    id: "saved-175",
    viewId: 1,
    attempts: 0,
  };
  fixture.callbacks.scrollToPendingMessage();
  fixture.callbacks.onScrollToIndexFailed({
    index: 25,
    averageItemLength: 100,
  });
  assert.equal(fixture.calls.at(-1)[0], "offset");
  assert.equal(fixture.calls.at(-1)[1].offset, 2500);
  fixture.timers.shift()();
  assert.equal(fixture.calls.at(-1)[0], "index");
  assert.equal(fixture.calls.at(-1)[1].index, 25);
  fixture.callbacks.onScrollToIndexFailed({
    index: 25,
    averageItemLength: 100,
  });
  fixture.context.conversationStore.active = {
    viewId: 2,
    state: { messages: messages(300, 350) },
  };
  const before = fixture.calls.length;
  fixture.timers.shift()();
  assert.equal(fixture.calls.length, before);
});

test("web: a refreshed latest window opens at the bottom even after revisiting a cached old reply", () => {
  const view = messageList({
    messages: messages(0, 11),
    hasNewerHistory: true,
    historyLatestRevision: 0,
  });
  view.container.scrollTop = 200;
  view.container.handlers.onWheel();
  view.props.messages = messages(150, 200);
  view.props.hasNewerHistory = false;
  view.props.historyLatestRevision = 1;
  view.render();
  assert.equal(view.container.scrollTop, 4600);
});

test("mobile: a refreshed latest window resets the initial position after cached old history", () => {
  const fixture = mobileHistory();
  fixture.callbacks.onContentSizeChange();
  fixture.context.historyGestureRef.current.interacted = true;
  fixture.context.isAtBottomRef.current = false;
  fixture.context.conversation.state.historyLatestRevision = 1;
  const before = fixture.calls.length;
  fixture.callbacks.onContentSizeChange();
  assert.equal(fixture.calls.length, before + 1);
  assert.equal(fixture.calls.at(-1)[0], "end");
  assert.equal(fixture.calls.at(-1)[1].animated, false);
});

test("mobile: exhausted native positioning retries stop and show a recoverable message", () => {
  const fixture = mobileHistory();
  fixture.context.pendingJumpRef.current = {
    id: "saved-175",
    viewId: 1,
    attempts: 5,
  };
  fixture.callbacks.onScrollToIndexFailed({
    index: 25,
    averageItemLength: 100,
  });
  assert.equal(fixture.context.pendingJumpRef.current, null);
  assert.equal(fixture.timers.length, 0);
  assert.equal(fixture.calls.at(-1)[0], "error");
  assert.match(fixture.calls.at(-1)[1], /tap the reply again/);
});

for (const direction of ["older", "newer", "latest", "target"]) {
  test(`web: ${direction} history loading stays visible at the appropriate edge`, () => {
    const view = messageList({
      messages: messages(50, 100),
      historyLoadingDirection: direction,
    });
    const status = find(view.tree, (node) => node.props.role === "status");
    assert.ok(status);
    assert.equal(status.props["aria-live"], "polite");
    assert.match(
      status.props.className,
      direction === "older" || direction === "target" ? /top-2/ : /bottom-12/,
    );
    assert.ok(status.children.includes("Loading messages..."));
    const position = view.container.scrollTop;
    view.props.historyLoadingDirection = null;
    view.render();
    assert.equal(
      find(view.tree, (node) => node.props.role === "status"),
      undefined,
    );
    assert.equal(view.container.scrollTop, position);
  });
}

test("mobile: history loading uses a visible overlay without changing the list layout", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../mobile/App.tsx"),
    "utf8",
  );
  const parsed = ts.createSourceFile(
    "App.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  function visit(node) {
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.expression.getText(parsed).startsWith("isLoadingHistory &&") &&
      node.expression
        .getText(parsed)
        .includes('accessibilityLabel="Loading messages"')
    )
      expression = node.expression.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression);
  const context = {
    exports: {},
    isLoadingHistory: true,
    historyLoadingDirection: "older",
    View: "View",
    Text: "Text",
    ActivityIndicator: "Spinner",
    StyleSheet: { hairlineWidth: 1 },
    theme: { bgCard: "white", textMuted: "gray" },
    React: {
      createElement: (type, props, ...children) => ({ type, props, children }),
    },
  };
  vm.runInNewContext(
    ts.transpileModule(`exports.render=()=>(${expression});`, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    }).outputText,
    context,
  );
  for (const direction of ["older", "newer", "latest", "target"]) {
    context.historyLoadingDirection = direction;
    const overlay = context.exports.render();
    assert.equal(overlay.props.style.position, "absolute");
    assert.equal(overlay.props.style.height, undefined);
    assert.equal(overlay.props.pointerEvents, "none");
    assert.equal(overlay.props.accessibilityRole, "progressbar");
    assert.ok(find(overlay, (node) => node.type === "Spinner"));
    assert.equal(
      overlay.props.style.top,
      direction === "older" || direction === "target" ? 8 : undefined,
    );
    assert.equal(
      overlay.props.style.bottom,
      direction === "newer" || direction === "latest" ? 52 : undefined,
    );
  }
  context.isLoadingHistory = false;
  assert.equal(context.exports.render(), false);
});
