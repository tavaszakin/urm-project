import { Fragment, isValidElement } from "react";
import { TYPOGRAPHY } from "../theme.js";
import {
  normalizeFunctionKind,
} from "../functionMetadata.js";
import { ProjectionNotation } from "../utils/mathNotation.jsx";

const TOKEN_SEGMENT_PATTERN = /([A-Za-z]+(?:\d+)?|[0-9]+|_+|\s+|[^A-Za-z0-9_\s]+)/g;
const UPRIGHT_TEXT_TOKENS = new Set([
  "addition",
  "successor",
  "constant",
  "projection",
  "truncated",
  "truncated_subtraction",
  "subtraction",
  "zero",
  "compose",
  "previous",
  "function",
  "max",
  "min",
  "const",
  "pr",
]);

export function createExpressionText(value) {
  return { type: "text", value: String(value ?? "") };
}

export function createExpressionCall(callee, args = []) {
  return { type: "call", callee, args };
}

export function createExpressionPlaceholder(value = "_") {
  return { type: "placeholder", value: String(value ?? "_") };
}

function normalizeExpressionNode(node) {
  if (node === null || node === undefined) return createExpressionPlaceholder();
  if (typeof node === "string" || typeof node === "number") return createExpressionText(node);
  return node;
}

function getExpectedArity(kind, spec) {
  if (kind === "add" || kind === "bounded_sub") return 2;
  if (kind === "projection") {
    const arity = Number(spec?.arity);
    return Number.isInteger(arity) && arity > 0 ? arity : 2;
  }
  if (kind === "compose") {
    return getExpectedArity(normalizeFunctionKind(spec?.inner?.kind), spec?.inner);
  }
  if (kind === "primrec") return 2;
  return 1;
}

function getNamedVariables(count) {
  if (count <= 0) return [];
  if (count === 1) return ["x"];
  if (count === 2) return ["x", "y"];
  if (count === 3) return ["x", "y", "z"];
  return Array.from({ length: count }, (_, index) => `x${index + 1}`);
}

function getDefaultArgs(kind, spec) {
  return getNamedVariables(getExpectedArity(kind, spec)).map((name) => createExpressionText(name));
}

function fillArgsToArity(args, expectedArity) {
  const normalizedArgs = Array.isArray(args) ? args.map((arg) => normalizeExpressionNode(arg)) : [];
  const filledArgs = normalizedArgs.slice(0, expectedArity);

  while (filledArgs.length < expectedArity) {
    filledArgs.push(createExpressionPlaceholder());
  }

  return filledArgs;
}

function getDisplayCallee(spec) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "projection") {
    return <ProjectionNotation spec={spec} fallbackArity={spec?.arity} />;
  }

  if (kind === "constant") {
    return "constant";
  }

  if (kind === "add") {
    return "addition";
  }

  if (kind === "bounded_sub") {
    return "truncated_subtraction";
  }

  return kind || "function";
}

export function buildFunctionExpressionNode(spec, args = []) {
  const kind = normalizeFunctionKind(spec?.kind);
  const normalizedArgs = args.map((arg) => normalizeExpressionNode(arg));

  if (kind === "compose") {
    const innerKind = normalizeFunctionKind(spec?.inner?.kind);
    const innerArgs = fillArgsToArity(
      normalizedArgs,
      getExpectedArity(innerKind, spec?.inner),
    );
    const innerExpression = buildFunctionExpressionNode(spec?.inner, innerArgs);
    const outerKind = normalizeFunctionKind(spec?.outer?.kind);
    const outerArgs = fillArgsToArity(
      [innerExpression],
      getExpectedArity(outerKind, spec?.outer),
    );
    return buildFunctionExpressionNode(spec?.outer, outerArgs);
  }

  if (kind === "constant") {
    return createExpressionCall(`${getDisplayCallee(spec)}(${spec?.value ?? 0})`, fillArgsToArity(normalizedArgs, 1));
  }

  const expectedArity = getExpectedArity(kind, spec);
  const fallbackArgs =
    normalizedArgs.length > 0 ? fillArgsToArity(normalizedArgs, expectedArity) : getDefaultArgs(kind, spec);
  return createExpressionCall(getDisplayCallee(spec), fallbackArgs);
}

export function buildFunctionCallNode(name, args = []) {
  return createExpressionCall(name, args.map((arg) => normalizeExpressionNode(arg)));
}

function tokenizeMathText(value) {
  const text = String(value ?? "");
  return text.match(TOKEN_SEGMENT_PATTERN) ?? [text];
}

function getMathSegmentClass(segment, role = "text") {
  if (/^\s+$/.test(segment)) {
    return "math-token-punctuation";
  }

  if (/^_+$/.test(segment)) {
    return "math-token-placeholder";
  }

  if (/^R\d+$/.test(segment)) {
    return "math-token-register";
  }

  if (/^[0-9]+$/.test(segment)) {
    return "math-token-number";
  }

  if (/^[A-Za-z]+(?:\d+)?$/.test(segment)) {
    if (role === "callee") {
      return "math-token-callee";
    }

    const normalized = segment.toLowerCase();
    if (UPRIGHT_TEXT_TOKENS.has(normalized)) {
      return "math-token-word";
    }

    if (segment.length === 1 || /^[a-z]\d+$/i.test(segment)) {
      return "math-token-identifier";
    }

    return "math-token-word";
  }

  return "math-token-operator";
}

function renderTextSegments(value, key, tone, role = "text") {
  return tokenizeMathText(value).map((segment, index) => (
    <span
      key={`${key}-segment-${index}`}
      className={getMathSegmentClass(segment, role)}
      style={tokenSegmentStyle(tone, segment)}
    >
      {segment}
    </span>
  ));
}

function renderToken(token, key, tone, role = "text") {
  if (isValidElement(token)) {
    return <Fragment key={key}>{token}</Fragment>;
  }

  const normalized = normalizeExpressionNode(token);

  if (normalized.type === "call") {
    const renderedArgs = Array.isArray(normalized.args) ? normalized.args : [];
    return (
      <span key={key} style={callGroupStyle()}>
        <span style={calleeStyle(tone)}>{renderToken(normalized.callee, `${key}-callee`, tone, "callee")}</span>
        <span style={punctuationStyle(tone)}>(</span>
        {renderedArgs.map((arg, index) => {
          const normalizedArg = normalizeExpressionNode(arg);

          return (
            <Fragment key={`${key}-arg-${index}`}>
              {index > 0 ? <span style={separatorStyle(tone)}>,</span> : null}
              {renderToken(normalizedArg, `${key}-token-${index}`, tone)}
            </Fragment>
          );
        })}
        <span style={punctuationStyle(tone)}>)</span>
      </span>
    );
  }

  return (
    <span
      key={key}
      style={
        normalized.type === "placeholder"
          ? placeholderTokenStyle(tone)
          : textTokenStyle(tone)
      }
    >
      {renderTextSegments(normalized.value, key, tone, normalized.type === "placeholder" ? "placeholder" : role)}
    </span>
  );
}

export default function FunctionExpressionView({
  expression,
  tone = "default",
  size = "md",
  style = undefined,
  className = "",
}) {
  const fontSize =
    size === "lg"
      ? TYPOGRAPHY.sizes.lg
      : size === "sm"
        ? TYPOGRAPHY.sizes.md
        : TYPOGRAPHY.sizes.base;

  return (
    <span
      className={`function-expression-view math-text math-inline${size === "lg" ? " math-display" : ""}${className ? ` ${className}` : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 0,
        minWidth: 0,
        color: tone === "muted" ? "var(--surface-text-secondary)" : "var(--surface-text-primary)",
        fontFamily: "var(--font-math)",
        fontSize,
        fontWeight: TYPOGRAPHY.weights.regular,
        lineHeight: size === "lg" ? 1.45 : 1.35,
        letterSpacing: 0,
        ...style,
      }}
    >
      {renderToken(expression, "expression-root", tone)}
    </span>
  );
}

function textTokenStyle(tone) {
  return {
    color: tone === "muted" ? "var(--surface-text-secondary)" : "var(--surface-text-primary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
}

function tokenSegmentStyle(tone, segment) {
  return {
    color: tone === "muted" ? "var(--surface-text-secondary)" : "var(--surface-text-primary)",
    whiteSpace: /^\s+$/.test(segment) ? "pre" : "pre-wrap",
  };
}

function placeholderTokenStyle(tone) {
  return {
    ...textTokenStyle(tone),
    color: "var(--surface-text-muted)",
  };
}

function punctuationStyle(tone) {
  return {
    ...textTokenStyle(tone),
    opacity: 0.88,
  };
}

function separatorStyle(tone) {
  return punctuationStyle(tone);
}

function calleeStyle(tone) {
  return {
    ...textTokenStyle(tone),
    fontWeight: TYPOGRAPHY.weights.medium,
    color: "var(--surface-text-primary)",
  };
}

function callGroupStyle() {
  return {
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 0,
    minWidth: 0,
    padding: 0,
    border: "none",
    background: "transparent",
  };
}
