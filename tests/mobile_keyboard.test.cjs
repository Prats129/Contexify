// Exercise the installed React Native keyboard layout logic with the app's props.
// Native views and events are mocked; no device, backend or network is used.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../frontend/node_modules/typescript");
const babel = require("../mobile/node_modules/@babel/core");

function parse(relativePath) {
  const filename = path.join(__dirname, "..", relativePath);
  return ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function appKeyboardProps() {
  const source = parse("mobile/App.tsx");
  const props = {};
  function visit(node) {
    if (
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(source) === "KeyboardAvoidingView"
    ) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (!["behavior", "enabled", "keyboardVerticalOffset"].includes(name))
          continue;
        const initializer = attribute.initializer;
        props[name] = !initializer
          ? true
          : ts.isStringLiteral(initializer)
            ? initializer.text
            : vm.runInNewContext(initializer.expression.getText(source), {
                Platform: { OS: "android" },
              });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return props;
}

function keyboardLayout() {
  const listeners = new Map();
  const react = {
    Component: class {
      constructor(props) {
        this.props = props;
      }
      setState(update) {
        this.state = { ...this.state, ...update };
      }
    },
    createRef: () => ({ current: null }),
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
  };
  const filename = path.join(
    __dirname,
    "../mobile/node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js",
  );
  const code = babel.transformSync(fs.readFileSync(filename, "utf8"), {
    filename,
    configFile: false,
    babelrc: false,
    plugins: [
      require("../mobile/node_modules/@babel/plugin-transform-flow-strip-types"),
      require("../mobile/node_modules/@babel/plugin-transform-react-jsx"),
      require("../mobile/node_modules/@babel/plugin-transform-modules-commonjs"),
    ],
  }).code;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name.endsWith("/Platform")) return { OS: "android" };
      if (name.endsWith("/LayoutAnimation")) return { configureNext() {} };
      if (name.endsWith("/StyleSheet")) return { compose: (a, b) => [a, b] };
      if (name.endsWith("/View")) return "View";
      if (name.endsWith("/AccessibilityInfo")) return {};
      if (name === "./Keyboard")
        return {
          isVisible: () => false,
          addListener(event, callback) {
            listeners.set(event, callback);
            return { remove: () => listeners.delete(event) };
          },
        };
      throw new Error(`Unexpected React Native import: ${name}`);
    },
  });
  const instance = new exports.default(appKeyboardProps());
  instance.componentDidMount();
  return {
    layout: (height) =>
      instance._onLayout({
        persist() {},
        nativeEvent: { layout: { x: 0, y: 0, width: 400, height } },
      }),
    async show(screenY, height = 300) {
      listeners.get("keyboardDidShow")({
        endCoordinates: { screenY, height },
        duration: 0,
      });
      await new Promise(setImmediate);
    },
    async hide() {
      listeners.get("keyboardDidHide")();
      await new Promise(setImmediate);
    },
    padding: () =>
      Object.assign({}, ...instance.render().props.style.flat(Infinity))
        .paddingBottom,
    dispose: () => instance.componentWillUnmount(),
    listeners,
  };
}

test("mobile: Android lifts the composer when native resize leaves the keyboard overlapping", async () => {
  const fixture = keyboardLayout();
  await fixture.layout(800);
  await fixture.show(500);
  assert.equal(fixture.padding(), 300);
  // Partial native resize needs only the remaining overlap.
  await fixture.layout(620);
  assert.equal(fixture.padding(), 120);
  fixture.dispose();
  assert.equal(fixture.listeners.size, 0);
});

test("mobile: native resize does not create a second keyboard-sized gap in either event order", async () => {
  for (const resizeFirst of [true, false]) {
    const fixture = keyboardLayout();
    await fixture.layout(800);
    if (resizeFirst) await fixture.layout(500);
    await fixture.show(500);
    if (!resizeFirst) await fixture.layout(500);
    assert.equal(fixture.padding(), 0);
    await fixture.hide();
    await fixture.layout(800);
    assert.equal(fixture.padding(), 0);
    fixture.dispose();
  }
});

test("mobile: keyboard reopening, height changes and rotation recalculate overlap without accumulating padding", async () => {
  const fixture = keyboardLayout();
  await fixture.layout(800);
  for (let repeat = 0; repeat < 3; repeat++) {
    await fixture.show(500);
    assert.equal(fixture.padding(), 300);
    await fixture.show(400, 400);
    assert.equal(fixture.padding(), 400);
    await fixture.hide();
    assert.equal(fixture.padding(), 0);
  }
  await fixture.layout(400);
  await fixture.show(220, 180);
  assert.equal(fixture.padding(), 180);
  await fixture.show(400, 0);
  assert.equal(fixture.padding(), 0);
  fixture.dispose();
});

test("mobile: a composer mounted while the keyboard is visible starts in the open state", () => {
  const source = parse("mobile/src/components/ChatInput.tsx");
  let initializer;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements[0]?.name?.getText(source) === "isKeyboardOpen"
    )
      initializer = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(initializer);
  for (const visible of [true, false]) {
    const value = vm.runInNewContext(`(${initializer})`, {
      Keyboard: { isVisible: () => visible },
    });
    assert.equal(typeof value === "function" ? value() : value, visible);
  }
});
