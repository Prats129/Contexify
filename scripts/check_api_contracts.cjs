// Parse generated wire declarations; never execute the source being checked.
const fs = require("node:fs");

let ts;
try {
  ts = require("../frontend/node_modules/typescript");
} catch {
  process.stderr.write(
    "API contract checks require frontend dependencies. Run npm ci --prefix frontend.\n",
  );
  process.exit(2);
}

function canonicalContract(source, filename) {
  const parsed = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (parsed.parseDiagnostics.length) {
    throw new Error(
      ts.flattenDiagnosticMessageText(
        parsed.parseDiagnostics[0].messageText,
        " ",
      ),
    );
  }
  const primitiveKinds = new Set([
    ts.SyntaxKind.StringKeyword,
    ts.SyntaxKind.NumberKeyword,
    ts.SyntaxKind.BooleanKeyword,
    ts.SyntaxKind.UnknownKeyword,
    ts.SyntaxKind.AnyKeyword,
    ts.SyntaxKind.NeverKeyword,
    ts.SyntaxKind.UndefinedKeyword,
  ]);
  function type(node) {
    if (ts.isParenthesizedTypeNode(node)) return type(node.type);
    if (primitiveKinds.has(node.kind))
      return ["primitive", ts.SyntaxKind[node.kind]];
    if (ts.isArrayTypeNode(node)) return ["array", type(node.elementType)];
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const args = (node.typeArguments || []).map(type);
      if (node.typeName.text === "Array" && args.length === 1) {
        return ["array", args[0]];
      }
      return ["reference", node.typeName.text, args];
    }
    if (ts.isLiteralTypeNode(node)) {
      const literal = node.literal;
      if (ts.isStringLiteral(literal)) return ["literal", literal.text];
      if (ts.isNumericLiteral(literal))
        return ["literal", Number(literal.text)];
      if (literal.kind === ts.SyntaxKind.NullKeyword) return ["literal", null];
      if (literal.kind === ts.SyntaxKind.TrueKeyword) return ["literal", true];
      if (literal.kind === ts.SyntaxKind.FalseKeyword)
        return ["literal", false];
      if (
        ts.isPrefixUnaryExpression(literal) &&
        literal.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(literal.operand)
      ) {
        return ["literal", -Number(literal.operand.text)];
      }
    }
    if (ts.isUnionTypeNode(node)) {
      const members = node.types.flatMap((member) => {
        const value = type(member);
        return value[0] === "union" ? value[1] : [value];
      });
      const unique = [
        ...new Set(members.map((member) => JSON.stringify(member))),
      ]
        .sort()
        .map((member) => JSON.parse(member));
      return unique.length === 1 ? unique[0] : ["union", unique];
    }
    if (ts.isTypeLiteralNode(node)) {
      const fields = new Map();
      for (const member of node.members) {
        if (
          !ts.isPropertySignature(member) ||
          !member.type ||
          !(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ||
          member.modifiers?.some(
            (modifier) => modifier.kind !== ts.SyntaxKind.ReadonlyKeyword,
          )
        ) {
          throw new Error("Unsupported contract member");
        }
        const name = member.name.text;
        if (fields.has(name))
          throw new Error(`Duplicate contract field: ${name}`);
        fields.set(name, [
          Boolean(member.questionToken),
          Boolean(member.modifiers?.length),
          type(member.type),
        ]);
      }
      return [
        "object",
        [...fields.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ];
    }
    throw new Error(`Unsupported contract type: ${ts.SyntaxKind[node.kind]}`);
  }
  const declarations = new Map();
  for (const statement of parsed.statements) {
    if (ts.isEmptyStatement(statement)) continue;
    if (
      !ts.isTypeAliasDeclaration(statement) ||
      statement.typeParameters?.length ||
      statement.modifiers?.length !== 1 ||
      statement.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword
    ) {
      throw new Error(
        "Only exported, non-generic wire type aliases are supported",
      );
    }
    if (declarations.has(statement.name.text)) {
      throw new Error(`Duplicate contract declaration: ${statement.name.text}`);
    }
    declarations.set(statement.name.text, JSON.stringify(type(statement.type)));
  }
  return declarations;
}

function compareContracts(expected, sources) {
  const baseline = canonicalContract(expected, "expected.ts");
  const errors = [];
  for (const [filename, source] of Object.entries(sources)) {
    try {
      const actual = canonicalContract(source, filename);
      for (const name of baseline.keys()) {
        if (!actual.has(name)) errors.push(`${filename}: missing ${name}`);
        else if (baseline.get(name) !== actual.get(name))
          errors.push(`${filename}: changed ${name}`);
      }
      for (const name of actual.keys()) {
        if (!baseline.has(name)) errors.push(`${filename}: unexpected ${name}`);
      }
    } catch (error) {
      errors.push(`${filename}: ${error.message}`);
    }
  }
  return errors;
}

if (require.main === module) {
  try {
    const { expected, sources } = JSON.parse(fs.readFileSync(0, "utf8"));
    const errors = compareContracts(expected, sources);
    process.stdout.write(JSON.stringify(errors) + "\n");
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(`Could not parse API contracts: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { canonicalContract, compareContracts };
