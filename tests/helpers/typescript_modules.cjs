// Offline loader for the real TypeScript modules with explicitly supplied platform ports.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("../../frontend/node_modules/typescript");

function createTypeScriptLoader(imports = {}) {
  const cache = new Map();
  return function load(filename) {
    filename = path.resolve(filename);
    if (!path.extname(filename))
      filename = fs.existsSync(filename + ".ts")
        ? filename + ".ts"
        : path.join(filename, "index.ts");
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    new Function("module", "exports", "require", code)(
      module,
      module.exports,
      (reference) => {
        if (Object.prototype.hasOwnProperty.call(imports, reference))
          return imports[reference];
        if (reference === "@contexify/assistant-core")
          return load("packages/assistant-core/src/index.ts");
        if (reference.startsWith("."))
          return load(path.resolve(path.dirname(filename), reference));
        throw Error("Unexpected dependency " + reference);
      },
    );
    return module.exports;
  };
}
module.exports = { createTypeScriptLoader };
