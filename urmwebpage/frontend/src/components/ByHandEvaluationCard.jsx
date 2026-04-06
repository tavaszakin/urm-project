import { useMemo, useState } from "react";
import { TYPOGRAPHY } from "../theme.js";
import { normalizeFunctionKind } from "../functionMetadata.js";
import FunctionExpressionView, {
  buildFunctionCallNode,
  buildFunctionExpressionNode,
  createExpressionText,
} from "./FunctionExpressionView.jsx";
import { getProjectionArrayIndex, getProjectionVariableMeaning } from "../utils/mathNotation.jsx";
import KatexMath from "./KatexMath.jsx";
import { chainToLatex, expressionToLatex } from "../utils/expressionToLatex.js";

const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];

function getVariableNames(count) {
  return Array.from({ length: count }, (_, index) => VARIABLE_NAMES[index] ?? `x${index + 1}`);
}

function formatValue(value) {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return String(value);
}

function joinArgs(args) {
  return args.map((value) => formatValue(value)).join(", ");
}

function buildLine(expression, annotation = "", key = String(annotation ?? expression ?? "")) {
  return { expression, annotation, key: String(key) };
}

function buildChain(...lines) {
  return cleanChain(lines);
}

function cleanChain(lines) {
  const nextLines = [];

  for (const rawLine of lines) {
    const line = typeof rawLine === "string" ? buildLine(rawLine) : rawLine;
    const key = String(line?.key ?? "").trim();

    if (!key) continue;

    const previous = nextLines[nextLines.length - 1];
    if (previous?.key === key) {
      if (!previous.annotation && line.annotation) {
        previous.annotation = line.annotation;
      }
      continue;
    }

    nextLines.push(buildLine(line.expression, line.annotation ?? "", key));
  }

  return nextLines;
}

function serializeMathValue(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (value && typeof value === "object") {
    if (value.type === "text" || value.type === "placeholder") {
      return String(value.value ?? "");
    }

    if (value.type === "call") {
      const callee = serializeMathValue(value.callee);
      const args = Array.isArray(value.args)
        ? value.args.map((arg) => serializeMathValue(arg)).join(",")
        : "";
      return `${callee}(${args})`;
    }
  }

  return String(value);
}

function buildMathLine(expression, annotation = "", key = null) {
  const derivedKey = key ?? serializeMathValue(expression);
  return buildLine(expression, annotation, derivedKey);
}

function isAtomicKind(kind) {
  return ["zero", "successor", "constant", "projection", "add", "bounded_sub"].includes(kind);
}

function renderConcreteCall(spec, args) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "compose") {
    const innerCall = renderConcreteCall(spec?.inner, args);
    return renderConcreteCall(spec?.outer, [innerCall.expression]);
  }

  if (kind === "constant") {
    const value = spec?.value ?? 0;
    const label = `constant(${value})`;
    return {
      expression: createExpressionText(label),
      key: label,
    };
  }

  const normalizedArgs = args.map((value) =>
    value && typeof value === "object" && ["text", "call"].includes(value.type)
      ? value
      : createExpressionText(formatValue(value))
  );

  return {
    expression: buildFunctionExpressionNode(spec, normalizedArgs),
    key: serializeExpression(spec, args),
  };
}

function renderByHandExpression(spec, args) {
  const kind = normalizeFunctionKind(spec?.kind);
  const safeArgs = args.map((value) =>
    value && typeof value === "object" && ["text", "call", "placeholder"].includes(value.type)
      ? value
      : createExpressionText(formatValue(value))
  );
  const argText = args.map((value) => formatValue(value));

  if (kind === "successor") {
    return {
      expression: buildFunctionCallNode("S", [safeArgs[0] ?? createExpressionText("x")]),
      key: `S(${serializeMathValue(safeArgs[0] ?? "x")})`,
    };
  }

  if (kind === "constant") {
    const value = String(spec?.value ?? 0);
    return {
      expression: createExpressionText(value),
      key: value,
    };
  }

  if (kind === "zero") {
    return {
      expression: createExpressionText("0"),
      key: "0",
    };
  }

  if (kind === "projection") {
    const expression = buildFunctionExpressionNode(spec, safeArgs);
    return {
      expression,
      key: serializeMathValue(expression),
    };
  }

  if (kind === "add") {
    const expression = createExpressionText(`${argText[0] ?? "x"}+${argText[1] ?? "y"}`);
    return {
      expression,
      key: serializeMathValue(expression),
    };
  }

  if (kind === "bounded_sub") {
    const expression = createExpressionText(`${argText[0] ?? "x"}∸${argText[1] ?? "y"}`);
    return {
      expression,
      key: serializeMathValue(expression),
    };
  }

  if (kind === "compose") {
    const expression = buildFunctionExpressionNode(spec, safeArgs);
    return {
      expression,
      key: serializeMathValue(expression),
    };
  }

  const expression = buildFunctionExpressionNode(spec, safeArgs);
  return {
    expression,
    key: serializeMathValue(expression),
  };
}

function serializeExpression(spec, args) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "compose") {
    const inner = serializeExpression(spec?.inner, args);
    return serializeExpression(spec?.outer, [inner]);
  }

  const callee = kind === "add"
    ? "addition"
    : kind === "bounded_sub"
      ? "truncated_subtraction"
      : kind === "projection"
        ? `projection:${spec?.index ?? "?"}:${spec?.arity ?? "?"}`
        : kind === "constant"
          ? `constant:${spec?.value ?? 0}`
          : kind || "function";

  return `${callee}(${args.map((value) => formatValue(value)).join(",")})`;
}

function atomicEvaluation(spec, args) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "successor") {
    const input = Number(args[0] ?? 0);
    const rendered = renderConcreteCall(spec, [input]);
    const result = input + 1;

    return {
      kind,
      expression: rendered.expression,
      result,
      mainChains: [buildChain(buildLine(rendered.expression, "", rendered.key), buildLine(String(result), "", String(result)))],
      detailSections: [],
    };
  }

  if (kind === "add") {
    const left = Number(args[0] ?? 0);
    const right = Number(args[1] ?? 0);
    const rendered = renderConcreteCall(spec, [left, right]);
    const result = left + right;

    return {
      kind,
      expression: rendered.expression,
      result,
      mainChains: [buildChain(buildLine(rendered.expression, "", rendered.key), buildLine(String(result), "", String(result)))],
      detailSections: [],
    };
  }

  if (kind === "bounded_sub") {
    const left = Number(args[0] ?? 0);
    const right = Number(args[1] ?? 0);
    const rendered = renderConcreteCall(spec, [left, right]);
    const result = Math.max(0, left - right);

    return {
      kind,
      expression: rendered.expression,
      result,
      mainChains: [buildChain(buildLine(rendered.expression, "", rendered.key), buildLine(String(result), "", String(result)))],
      detailSections: [
        {
          title: "Detailed steps",
          chains: [
            buildChain(
              buildLine(rendered.expression, "", rendered.key),
              buildLine(`max(0, ${left} - ${right})`, "", `max:${left}:${right}`),
              buildLine(String(result), "", String(result)),
            ),
          ],
        },
      ],
    };
  }

  if (kind === "projection") {
    const arrayIndex = getProjectionArrayIndex(spec);
    const selectedValue = formatValue(args[arrayIndex] ?? 0);
    const rendered = renderConcreteCall(spec, args);
    const symbolicMeaning = getProjectionVariableMeaning(spec, getVariableNames(args.length), args.length);

    return {
      kind,
      expression: rendered.expression,
      result: Number(args[arrayIndex] ?? 0),
      mainChains: [buildChain(
        buildLine(rendered.expression, "", rendered.key),
        buildLine(createExpressionText(symbolicMeaning), "", `${rendered.key}:meaning`),
        buildLine(selectedValue, "", selectedValue),
      )],
      detailSections: [],
    };
  }

  if (kind === "constant") {
    const value = Number(spec?.value ?? 0);
    const rendered = renderConcreteCall(spec, []);

    return {
      kind,
      expression: rendered.expression,
      result: value,
      mainChains: [buildChain(buildLine(rendered.expression, "", rendered.key), buildLine(String(value), "", String(value)))],
      detailSections: [],
    };
  }

  if (kind === "zero") {
    const rendered = renderConcreteCall(spec, args);

    return {
      kind,
      expression: rendered.expression,
      result: 0,
      mainChains: [buildChain(buildLine(rendered.expression, "", rendered.key), buildLine("0", "", "0"))],
      detailSections: [],
    };
  }

  return null;
}

function deriveFunctionArityForByHand(spec) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "successor" || kind === "constant" || kind === "zero") {
    return 1;
  }

  if (kind === "add" || kind === "bounded_sub") {
    return 2;
  }

  if (kind === "projection") {
    const arity = Number(spec?.arity);
    return Number.isInteger(arity) && arity >= 0 ? arity : null;
  }

  if (kind === "compose") {
    return deriveFunctionArityForByHand(spec?.inner);
  }

  if (kind === "primrec") {
    const baseArity = deriveFunctionArityForByHand(spec?.base);
    return Number.isInteger(baseArity) && baseArity >= 0 ? baseArity + 1 : null;
  }

  return null;
}

function buildPrimitiveStepRuntimeArgs(stepSpec, iteration, previousValue, carriedInputs) {
  const carriedValues = Array.isArray(carriedInputs) ? carriedInputs : [];
  const valueMap = {
    n: iteration,
    previous: previousValue,
  };

  getVariableNames(carriedValues.length).forEach((name, index) => {
    valueMap[name] = carriedValues[index];
  });

  const expectedArgs = ["n", "previous", ...getVariableNames(carriedValues.length)];
  const runtimePriority = ["previous", "n", ...getVariableNames(carriedValues.length)];
  const stepArity = deriveFunctionArityForByHand(stepSpec);

  if (Number.isInteger(stepArity) && stepArity >= 0 && stepArity < expectedArgs.length) {
    return runtimePriority.slice(0, stepArity).map((name) => valueMap[name]);
  }

  return expectedArgs.map((name) => valueMap[name]);
}

function buildPrimitiveConcreteCall(args, recursionIndex, recursionValue) {
  return buildFunctionCallNode(
    "f",
    args.map((value, index) =>
      createExpressionText(formatValue(index === recursionIndex ? recursionValue : value))
    ),
  );
}

function composeOuterSubstitutionChain(reducedOuterExpression, outerEvaluation) {
  const outerChain = outerEvaluation.mainChains[0] ?? [];

  return cleanChain([
    buildLine(reducedOuterExpression.expression, "", reducedOuterExpression.key),
    ...outerChain.slice(1),
  ]);
}

function composeDetailSections(innerEvaluation, outerEvaluation, reducedOuterExpression) {
  const sections = [];
  const trivialComposition =
    isAtomicKind(innerEvaluation.kind) &&
    isAtomicKind(outerEvaluation.kind) &&
    innerEvaluation.mainChains.length <= 1 &&
    outerEvaluation.mainChains.length <= 1;

  if (trivialComposition) {
    return sections;
  }

  sections.push({
    title: "Evaluate inner function",
    chains: innerEvaluation.mainChains,
  });

  sections.push({
    title: "Substitute into outer function",
    chains: [composeOuterSubstitutionChain(reducedOuterExpression, outerEvaluation)],
  });

  return sections;
}

function composeEvaluation(spec, args) {
  const innerEvaluation = evaluateFunction(spec?.inner, args);
  const outerEvaluation = evaluateFunction(spec?.outer, [innerEvaluation.result]);
  const expression = renderConcreteCall(spec, args);
  const reducedOuterExpression = renderConcreteCall(spec?.outer, [innerEvaluation.result]);
  const compactChain = buildChain(
    buildLine(expression.expression, "", expression.key),
    buildLine(reducedOuterExpression.expression, "", reducedOuterExpression.key),
    buildLine(String(outerEvaluation.result), "", String(outerEvaluation.result)),
  );

  return {
    kind: "compose",
    expression: expression.expression,
    result: outerEvaluation.result,
    mainChains: [compactChain],
    detailSections: composeDetailSections(innerEvaluation, outerEvaluation, reducedOuterExpression),
    innerEvaluation,
    outerEvaluation,
  };
}

function primitiveStepSummaryChain(iteration) {
  return buildChain(
    buildMathLine(iteration.nextCall, "", `next:${iteration.iteration}`),
    buildMathLine(iteration.symbolicStepCall, "", `step-symbolic:${iteration.iteration}`),
    buildMathLine(iteration.concreteStepCall.expression, "", iteration.concreteStepCall.key),
    buildMathLine(String(iteration.result), "", `result:${iteration.iteration}:${iteration.result}`),
  );
}

function primitiveRecursionEvaluation(spec, args) {
  const recursionIndex = Number(spec?.recursion_index ?? 0);
  const recursionValue = Number(args[recursionIndex] ?? 0);
  const carriedInputs = args.filter((_, index) => index !== recursionIndex);
  const concreteCall = buildPrimitiveConcreteCall(args, recursionIndex, recursionValue);

  const baseEvaluation = evaluateFunction(spec?.base, carriedInputs);
  const baseMeaning = renderByHandExpression(spec?.base, carriedInputs);
  const baseChain = buildChain(
    buildMathLine(buildPrimitiveConcreteCall(args, recursionIndex, 0), "", `f-base:${joinArgs(args)}`),
    buildMathLine(buildFunctionCallNode("g", carriedInputs.map((value) => createExpressionText(formatValue(value)))), "", `g:${joinArgs(carriedInputs)}`),
    buildMathLine(baseMeaning.expression, "", baseMeaning.key),
    buildMathLine(String(baseEvaluation.result), "", String(baseEvaluation.result)),
  );

  const iterations = [];
  let previousValue = baseEvaluation.result;
  let previousCall = buildPrimitiveConcreteCall(args, recursionIndex, 0);

  for (let iteration = 0; iteration < recursionValue; iteration += 1) {
    const nextCall = buildPrimitiveConcreteCall(args, recursionIndex, iteration + 1);
    const symbolicStepCall = buildFunctionCallNode(
      "h",
      [
        createExpressionText(String(iteration)),
        previousCall,
        ...carriedInputs.map((value) => createExpressionText(formatValue(value))),
      ],
    );
    const stepArgs = buildPrimitiveStepRuntimeArgs(spec?.step, iteration, previousValue, carriedInputs);
    const concreteStepCall = renderByHandExpression(spec?.step, stepArgs);
    const stepEvaluation = evaluateFunction(spec?.step, stepArgs);

    previousValue = stepEvaluation.result;
    iterations.push({
      iteration,
      nextCall,
      symbolicStepCall,
      concreteStepCall,
      stepArgs,
      stepEvaluation,
      result: stepEvaluation.result,
    });
    previousCall = nextCall;
  }

  const mainChains = [
    baseChain,
    ...iterations.map((iteration) => primitiveStepSummaryChain(iteration)),
  ];

  return {
    kind: "primrec",
    expression: concreteCall,
    result: previousValue,
    mainChains,
    detailSections: [],
    baseEvaluation,
    iterations,
  };
}

function fallbackEvaluation(spec, args) {
  const expression = renderConcreteCall(spec, args);

  return {
    kind: normalizeFunctionKind(spec?.kind) || "function",
    expression: expression.expression,
    result: null,
    mainChains: [[buildLine("No by-hand derivation is available for this function kind yet.", "", "unsupported")]],
    detailSections: [],
  };
}

function evaluateFunction(spec, args) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "compose") {
    return composeEvaluation(spec, args);
  }

  if (kind === "primrec") {
    return primitiveRecursionEvaluation(spec, args);
  }

  return atomicEvaluation(spec, args) ?? fallbackEvaluation(spec, args);
}

function buildByHandEvaluation(spec, args, enabled) {
  if (!enabled) return null;

  const evaluation = evaluateFunction(spec, args);
  const detailSections = (evaluation.detailSections ?? []).filter(
    (section) => Array.isArray(section?.chains) && section.chains.some((chain) => chain.length > 0),
  );

  return {
    ...evaluation,
    detailSections,
    hasDetails: detailSections.length > 0,
  };
}

function DerivationLine({ line, isResult = false, showAnnotation = false, showEquals = true }) {
  const latex = expressionToLatex(line.expression);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        color: isResult ? "var(--surface-text-primary)" : "var(--surface-text-secondary)",
        ...TYPOGRAPHY.styles.code,
        fontWeight: isResult ? TYPOGRAPHY.weights.bold : TYPOGRAPHY.weights.medium,
        lineHeight: 1.28,
        wordBreak: "break-word",
      }}
    >
      {showEquals ? <KatexMath expression="=" style={{ color: "var(--surface-text-primary)", flex: "0 0 auto" }} /> : <span aria-hidden="true" style={{ width: 10, flex: "0 0 10px" }} />}
      <KatexMath expression={latex} style={{ color: isResult ? "var(--surface-text-primary)" : "var(--surface-text-secondary)" }} />
      {showAnnotation && line.annotation ? (
        <span
          style={{
            color: "var(--surface-text-muted)",
            ...TYPOGRAPHY.styles.uiText,
            fontSize: TYPOGRAPHY.sizes.xs,
          }}
        >
          ({line.annotation})
        </span>
      ) : null}
    </div>
  );
}

function InlineDerivation({ chain }) {
  const latex = chainToLatex(chain.map((line) => line.expression));

  return (
    <KatexMath
      expression={latex}
      style={{
        color: "var(--surface-text-primary)",
        lineHeight: 1.22,
        wordBreak: "break-word",
      }}
    />
  );
}

function DerivationChain({ chain }) {
  if (chain.every((line) => !line?.annotation)) {
    return <InlineDerivation chain={chain} />;
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      {chain.map((line, lineIndex) => (
        <DerivationLine
          key={`${line.key}-${lineIndex}`}
          line={line}
          showEquals={lineIndex > 0}
          isResult={lineIndex === chain.length - 1}
        />
      ))}
    </div>
  );
}

function DetailSection({ section }) {
  if (!section?.chains?.length) return null;

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <div
        style={{
          ...TYPOGRAPHY.styles.label,
          color: "var(--surface-text-secondary)",
        }}
      >
        {section.title}
      </div>
      <div style={{ display: "grid", gap: 8, width: "100%" }}>
        {section.chains.map((chain, chainIndex) => (
          <DerivationChain key={`${section.title}-${chainIndex}`} chain={chain} />
        ))}
      </div>
    </div>
  );
}

export default function ByHandEvaluationCard({
  functionSpec,
  inputValues,
  enabled = true,
  selectedStepIndex = null,
}) {
  const [showDetails, setShowDetails] = useState(false);
  const evaluation = useMemo(
    () => buildByHandEvaluation(functionSpec, inputValues, enabled),
    [enabled, functionSpec, inputValues],
  );

  if (!evaluation) return null;

  const isPrimitiveEvaluation = normalizeFunctionKind(evaluation.kind) === "primrec";

  return (
    <section
      style={{
        background: "var(--surface-card)",
        padding: "10px 12px 14px",
        display: "grid",
        gap: 8,
        color: "var(--surface-text-primary)",
      }}
    >
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          gap: 12,
        }}
      >
        <div
          style={{
            ...TYPOGRAPHY.styles.label,
            fontSize: TYPOGRAPHY.sizes.sm,
            color: "var(--surface-text-structural)",
          }}
        >
          By-hand evaluation
        </div>

        <div
          style={{
            justifySelf: "end",
            alignSelf: "start",
            paddingTop: 1,
          }}
        >
          {!isPrimitiveEvaluation ? (
            <div
              className="math-inline"
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid color-mix(in srgb, var(--theme-current-strong, #ee7733) 52%, transparent)",
                background: "color-mix(in srgb, var(--theme-current-bg, rgba(244, 185, 143, 0.28)) 86%, transparent)",
                color: "var(--surface-text-primary)",
                fontFamily: "var(--font-math)",
                fontSize: TYPOGRAPHY.sizes.sm,
                lineHeight: TYPOGRAPHY.lineHeights.normal,
                fontWeight: TYPOGRAPHY.weights.semibold,
                whiteSpace: "nowrap",
              }}
            >
              {evaluation.result === null ? "Result pending" : `Result = ${evaluation.result}`}
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          width: "100%",
          display: "grid",
          gap: 9,
          justifyItems: "start",
          paddingBottom: 2,
        }}
      >
        <div style={{ display: "grid", gap: isPrimitiveEvaluation ? 8 : 5, width: "100%" }}>
          {evaluation.mainChains.map((chain, chainIndex) => (
            <DerivationChain key={`main-chain-${chainIndex}`} chain={chain} />
          ))}
        </div>

        {!isPrimitiveEvaluation && evaluation.hasDetails && (
          <div style={{ display: "grid", gap: 8, justifyItems: "start", width: "100%", marginBottom: 1 }}>
            <button
              type="button"
              onClick={() => setShowDetails((current) => !current)}
              style={{
                border: "1px solid color-mix(in srgb, var(--border-default) 82%, transparent)",
                borderRadius: 4,
                background: "var(--surface-card-alt)",
                color: "var(--surface-text-primary)",
                padding: "5px 9px",
                cursor: "pointer",
                ...TYPOGRAPHY.styles.control,
                fontSize: TYPOGRAPHY.sizes.md,
              }}
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>

            {showDetails && (
              <div
                style={{
                  width: "100%",
                  paddingTop: 8,
                  paddingBottom: 2,
                  borderTop: "1px solid color-mix(in srgb, var(--border-default) 52%, transparent)",
                  display: "grid",
                  gap: 10,
                  justifyItems: "start",
                }}
              >
                <div
                  style={{
                    ...TYPOGRAPHY.styles.label,
                    color: "var(--surface-text-secondary)",
                  }}
                >
                  Detailed steps
                </div>
                <div style={{ display: "grid", gap: 10, width: "100%" }}>
                  {evaluation.detailSections.map((section, sectionIndex) => (
                    <DetailSection key={`${section.title}-${sectionIndex}`} section={section} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
