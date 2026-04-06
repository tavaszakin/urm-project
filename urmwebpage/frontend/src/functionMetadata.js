import { formatProjectionNotation, getProjectionArrayIndex, getProjectionVariableMeaning } from "./utils/mathNotation.jsx";

export const FUNCTION_METADATA = {
  zero: {
    display: "Zero",
    shortDisplay: "Zero",
    notation: "0",
    description: "Returns 0.",
    aliases: [],
  },
  successor: {
    display: "Successor",
    shortDisplay: "Successor",
    notation: "S(x)",
    description: "Returns x + 1.",
    aliases: ["succ"],
  },
  constant: {
    display: "Constant",
    shortDisplay: "Constant",
    notation: "C_k",
    description: "Returns a fixed nonnegative integer.",
    aliases: ["const"],
  },
  projection: {
    display: "Projection",
    shortDisplay: "Projection",
    notation: "P_i^n",
    description: "Returns the i-th input.",
    aliases: ["proj"],
  },
  add: {
    display: "Addition",
    shortDisplay: "Addition",
    notation: "x + y",
    description: "Adds two numbers.",
    aliases: ["addition"],
  },
  bounded_sub: {
    display: "Truncated subtraction",
    shortDisplay: "Truncated subtraction",
    notation: "x ∸ y",
    description: "Returns max(x − y, 0).",
    aliases: ["sub", "truncated_sub", "truncated_subtraction"],
  },
  compose: {
    display: "Composition",
    shortDisplay: "Composition",
    notation: "f ∘ g",
    description: "Applies an outer function to the result of an inner function.",
    aliases: [],
  },
  primrec: {
    display: "Primitive recursion",
    shortDisplay: "Primitive recursion",
    notation: "PR(g, h)",
    description: "Defined by a base function and a step function.",
    aliases: ["primitive_rec", "primitive_recursion"],
  },
};

const ALIAS_TO_CANONICAL = Object.entries(FUNCTION_METADATA).reduce((acc, [kind, metadata]) => {
  acc[kind] = kind;

  for (const alias of metadata.aliases) {
    acc[alias] = kind;
  }

  return acc;
}, {});

export const FUNCTION_ORDER = [
  "zero",
  "successor",
  "constant",
  "projection",
  "add",
  "bounded_sub",
  "compose",
  "primrec",
];

export function normalizeFunctionKind(kind) {
  const normalized = String(kind ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");

  return ALIAS_TO_CANONICAL[normalized] ?? normalized;
}

export function getFunctionMetadata(kindOrSpec) {
  const kind = normalizeFunctionKind(
    typeof kindOrSpec === "string" ? kindOrSpec : kindOrSpec?.kind
  );

  return (
    FUNCTION_METADATA[kind] ?? {
      display: kind || "Function",
      shortDisplay: kind || "Function",
      notation: "",
      description: "",
      aliases: [],
    }
  );
}

export function getFunctionDisplayName(kindOrSpec, { short = false } = {}) {
  const metadata = getFunctionMetadata(kindOrSpec);
  return short ? metadata.shortDisplay || metadata.display : metadata.display;
}

export function getFunctionNotation(spec) {
  const kind = normalizeFunctionKind(typeof spec === "string" ? spec : spec?.kind);

  if (kind === "projection") {
    return formatProjectionNotation(spec);
  }

  if (kind === "constant") {
    return `C_${spec?.value ?? 0}`;
  }

  return getFunctionMetadata(kind).notation;
}

export function getFunctionDescription(kindOrSpec) {
  return getFunctionMetadata(kindOrSpec).description;
}

export function getFunctionTooltip(spec) {
  const display = getFunctionDisplayName(spec);
  const notation = getFunctionNotation(spec);
  const description = getFunctionDescription(spec);
  return [display, notation, description].filter(Boolean).join(" • ");
}

export function getFunctionDisplayLabel(spec) {
  const display = getFunctionDisplayName(spec);
  const notation = getFunctionNotation(spec);

  if (!notation || notation === display) {
    return display;
  }

  if (normalizeFunctionKind(spec?.kind) === "zero") {
    return display;
  }

  return `${display} (${notation})`;
}

export function renderFunctionLabel(spec) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "projection") {
    return getFunctionNotation(spec);
  }

  if (kind === "constant") {
    return `const(${spec?.value ?? 0})`;
  }

  if (kind === "zero") {
    return "zero";
  }

  if (kind === "compose") {
    return `compose(${renderFunctionLabel(spec?.inner)}, ${renderFunctionLabel(spec?.outer)})`;
  }

  if (kind === "primrec") {
    return `PR(${renderFunctionLabel(spec?.base)}, ${renderFunctionLabel(spec?.step)})`;
  }

  if (kind === "bounded_sub") {
    return "truncated subtraction";
  }

  if (kind) {
    return kind;
  }

  return "function";
}

function wrapFunctionCall(name, args) {
  return `${name}(${args.join(",")})`;
}

export function renderFunctionExpression(spec, variables = []) {
  const kind = normalizeFunctionKind(spec?.kind);
  const args = variables.filter((value) => value !== undefined);

  if (kind === "successor") {
    return wrapFunctionCall("successor", [args[0] ?? "x"]);
  }

  if (kind === "add") {
    if (args.length >= 2) {
      return `${args[0]} + ${args[1]}`;
    }

    return wrapFunctionCall("add", [args[0] ?? "x", args[1] ?? "y"]);
  }

  if (kind === "bounded_sub") {
    if (args.length >= 2) {
      return `${args[0]} ∸ ${args[1]}`;
    }

    return wrapFunctionCall("truncated subtraction", [args[0] ?? "x", args[1] ?? "y"]);
  }

  if (kind === "projection") {
    const meaning = getProjectionVariableMeaning(spec, args, args.length);
    return `${wrapFunctionCall(getFunctionNotation(spec), args)}=${meaning}`;
  }

  if (kind === "zero") {
    return args.length > 0 ? wrapFunctionCall("zero", args) : "zero()";
  }

  if (kind === "constant") {
    return `constant(${spec?.value ?? 0})`;
  }

  if (kind === "compose") {
    const innerExpression = renderFunctionExpression(spec?.inner, args);
    const outerKind = normalizeFunctionKind(spec?.outer?.kind);

    if (outerKind === "zero") {
      return wrapFunctionCall("zero", [innerExpression]);
    }

    if (outerKind === "constant") {
      return wrapFunctionCall(`constant(${spec?.outer?.value ?? 0})`, [innerExpression]);
    }

    return renderFunctionExpression(spec?.outer, [innerExpression]);
  }

  if (kind === "primrec") {
    return `PR(${renderFunctionLabel(spec?.base)}, ${renderFunctionLabel(spec?.step)})`;
  }

  return renderFunctionLabel(spec);
}
