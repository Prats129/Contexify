// Render the real assistant components with deterministic hooks and host views.
// This exercises handlers/lifecycle wiring, not DOM layout or an Android device.
const fs = require("node:fs");
const ts = require("../../frontend/node_modules/typescript");
const { createTypeScriptLoader } = require("./typescript_modules.cjs");

// React components and shared strict plain-object validators run in one JS realm.
// Supply only the fixture's host ports, as with the TypeScript module loader.
function runComponent(code, environment) {
  new Function(...Object.keys(environment), code)(
    ...Object.values(environment),
  );
}

function assistantUI(
  platform,
  props,
  component = "AssistantPreview",
  ports = {},
) {
  const slots = [],
    events = new Map();
  let frame = slots;
  const children = new Map();
  let index = 0,
    dirty = false,
    effects = [],
    tree;
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value) {
      return (frame[index++] ||= { current: value });
    },
    useState(initial) {
      const slot = (frame[index++] ||= {
        value: typeof initial === "function" ? initial() : initial,
      });
      return [
        slot.value,
        (value) => {
          slot.value = typeof value === "function" ? value(slot.value) : value;
          dirty = true;
        },
      ];
    },
    useEffect(run, deps) {
      const i = index++;
      const active = frame;
      if (!active[i] || !same(active[i].deps, deps)) {
        const previous = active[i];
        active[i] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          active[i].cleanup = run();
        });
      }
    },
  };
  const add = (name, fn) => {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(fn);
    return { remove: () => events.get(name).delete(fn) };
  };
  const appState = { currentState: "active", addEventListener: add };
  const dialog = { showModal() {}, close() {} };
  const jsx = (type, props, key) => {
    if (typeof type === "function") {
      const id = `${type.name}:${key ?? ""}`;
      if (!children.has(id)) children.set(id, []);
      const parentFrame = frame,
        parentIndex = index;
      frame = children.get(id);
      index = 0;
      try {
        return type(props);
      } finally {
        frame = parentFrame;
        index = parentIndex;
      }
    }
    if (props?.ref) props.ref.current = dialog;
    return { type, props: props || {} };
  };
  const load = createTypeScriptLoader();
  const core = load("packages/assistant-core/src/index.ts");
  const voice = {
    availability: async () => ({
      recognition: false,
      synthesis: false,
      message: "Voice disabled",
    }),
    listen: async () => "",
    stop() {},
    cancel() {},
    speak: async () => {},
    dispose() {},
  };
  const document = {
    visibilityState: "visible",
    addEventListener: add,
    removeEventListener: (name, fn) => events.get(name)?.delete(fn),
  };
  const window = {
    addEventListener: add,
    removeEventListener: document.removeEventListener,
  };
  const filename = [
    "ReminderManager",
    "AlarmManager",
    "AppleAssistantTools",
    "AppleAlarmManager",
    "CommunicationManager",
  ].includes(component)
    ? `mobile/src/components/${component}.tsx`
    : platform === "android" || platform === "ios"
      ? "mobile/src/components/AssistantPreview.tsx"
      : "frontend/src/components/Modals/AssistantPreview.tsx";
  const source = fs
    .readFileSync(filename, "utf8")
    .replaceAll("import.meta.env.VITE_ASSISTANT_VOICE_ENABLED", '"false"');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  runComponent(code, {
    exports,
    process,
    AbortController,
    setTimeout,
    clearTimeout,
    document,
    window,
    require(name) {
      if (name === "./AppleAssistantTools")
        return { AppleAssistantTools: () => jsx("AppleAssistantTools", {}) };
      if (name === "./CommunicationManager")
        return {
          CommunicationManager: (props) => jsx("CommunicationManager", props),
        };
      if (name === "./AppleAlarmManager")
        return { AppleAlarmManager: () => jsx("AppleAlarmManager", {}) };
      if (name === "./AlarmManager")
        return { AlarmManager: () => jsx("AlarmManager", {}) };
      if (name === "./ReminderManager")
        return { ReminderManager: () => jsx("ReminderManager", {}) };
      if (name === "./ClarificationForm") {
        const filename =
          platform === "android"
            ? "mobile/src/components/ClarificationForm.tsx"
            : "frontend/src/components/Modals/ClarificationForm.tsx";
        const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText;
        const output = {};
        runComponent(code, {
          exports: output,
          require(name) {
            if (name === "react") return react;
            if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
            if (name === "@contexify/assistant-core") return core;
            if (name === "react-native")
              return {
                Text: "Text",
                TextInput: "TextInput",
                TouchableOpacity: "TouchableOpacity",
                View: "View",
              };
            throw Error("Unexpected clarification UI import " + name);
          },
        });
        return output;
      }
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@contexify/assistant-core") return core;
      if (name === "react-native")
        return {
          Platform: { OS: platform },
          AppState: appState,
          Keyboard: { dismiss() {} },
          Modal: "Modal",
          KeyboardAvoidingView: "KeyboardAvoidingView",
          View: "View",
          Text: "Text",
          TextInput: "TextInput",
          TouchableOpacity: "TouchableOpacity",
          ScrollView: "ScrollView",
        };
      if (name === "react-native-safe-area-context")
        return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name.endsWith("/assistant_voice"))
        return {
          createMobileVoiceAdapter: () => voice,
          createBrowserVoiceAdapter: () => voice,
        };
      if (name.endsWith("/assistant_volume"))
        return load("mobile/src/services/assistant_volume.ts");
      if (name.endsWith("/assistant_platform")) return ports.apple;
      if (name.endsWith("/assistant_communications"))
        return ports.communications;
      if (name.endsWith("/assistant_brightness"))
        return load("mobile/src/services/assistant_brightness.ts");
      if (name.endsWith("/assistant_device_readiness"))
        return {
          readDeviceControlReadiness: async () => ({}),
          describeDeviceControlReadiness: () => "checked",
        };
      throw Error("Unexpected assistant UI import: " + name);
    },
  });
  function render(changes) {
    props = { ...props, ...changes };
    for (let iteration = 0; iteration < 20; iteration++) {
      index = 0;
      dirty = false;
      effects = [];
      tree = exports[component](props);
      effects.forEach((run) => run());
      if (!dirty) return tree;
    }
    throw Error("Assistant render did not settle");
  }
  function nodes(value) {
    if (value == null || typeof value === "boolean") return [];
    if (Array.isArray(value)) return value.flatMap((item) => nodes(item));
    if (typeof value !== "object") return [value];
    return [value, ...nodes(value.props.children)];
  }
  const text = (value) =>
    nodes(value)
      .filter((item) => typeof item === "string" || typeof item === "number")
      .join(" ");
  const find = (type, label) =>
    nodes(tree).find(
      (node) =>
        node?.type === type &&
        (!label ||
          text(node).includes(label) ||
          node.props.accessibilityLabel === label ||
          node.props["aria-label"] === label),
    );
  render();
  return {
    render,
    find,
    text: () => text(tree),
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
      render();
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
    emit(name, value) {
      if (name === "change") appState.currentState = value;
      events.get(name)?.forEach((fn) => fn(value));
      render();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
      children.forEach((slots) => slots.forEach((slot) => slot?.cleanup?.()));
    },
  };
}
module.exports = { assistantUI };
