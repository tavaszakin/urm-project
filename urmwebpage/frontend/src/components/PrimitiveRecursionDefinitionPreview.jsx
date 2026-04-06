import { RADII, TYPOGRAPHY } from "../theme.js";
import FunctionExpressionView, {
  buildFunctionCallNode,
  buildFunctionExpressionNode,
  createExpressionText,
} from "./FunctionExpressionView.jsx";
import { getProjectionVariableMeaning } from "../utils/mathNotation.jsx";
import DefinitionMathLine from "./DefinitionMathLine.jsx";

const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];

function getVariableNames(count) {
  return Array.from({ length: count }, (_, index) => VARIABLE_NAMES[index] ?? `x${index + 1}`);
}

function normalizeRecursionIndex(recursionIndex, arity) {
  if (!Number.isInteger(recursionIndex) || recursionIndex < 0) return 0;
  if (!Number.isInteger(arity) || arity <= 0) return recursionIndex;
  return Math.min(recursionIndex, Math.max(arity - 1, 0));
}

function buildFunctionArgumentNames(baseArity, recursionIndex) {
  const arity = Math.max(Number(baseArity ?? 0) + 1, 1);
  const safeRecursionIndex = normalizeRecursionIndex(recursionIndex, arity);
  const carriedNames = getVariableNames(Math.max(arity - 1, 0));
  const args = [];
  let carriedCursor = 0;

  for (let index = 0; index < arity; index += 1) {
    if (index === safeRecursionIndex) {
      args.push("n");
      continue;
    }

    args.push(carriedNames[carriedCursor] ?? `x${carriedCursor + 1}`);
    carriedCursor += 1;
  }

  return {
    args,
    carriedArgs: args.filter((_, index) => index !== safeRecursionIndex),
    recursionIndex: safeRecursionIndex,
  };
}

function replaceAt(values, index, nextValue) {
  return values.map((value, valueIndex) => (valueIndex === index ? nextValue : value));
}

function getStepArgumentNames(baseArity) {
  return ["n", "previous", ...getVariableNames(Math.max(baseArity, 0))];
}

function getStepUsedArgs(primitiveArityInfo, baseArity) {
  if (Array.isArray(primitiveArityInfo?.adaptation?.usedArgs) && primitiveArityInfo.adaptation.usedArgs.length > 0) {
    return primitiveArityInfo.adaptation.usedArgs;
  }

  return getStepArgumentNames(baseArity);
}

function toExpressionNode(value) {
  return value && typeof value === "object" && (value.type || value.$$typeof)
    ? value
    : createExpressionText(value);
}

function formatExpressionValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);

  if (value && typeof value === "object" && value.type === "text") {
    return String(value.value ?? "");
  }

  if (value && typeof value === "object" && value.type === "placeholder") {
    return String(value.value ?? "_");
  }

  if (value && typeof value === "object" && value.type === "call") {
    const callee = formatExpressionValue(value.callee);
    const args = Array.isArray(value.args) ? value.args.map((arg) => formatExpressionValue(arg)).join(",") : "";
    return `${callee}(${args})`;
  }

  return String(value);
}

function buildCall(name, args) {
  return buildFunctionCallNode(name, args.map((value) => toExpressionNode(value)));
}

function renderConcreteExpression(spec, args = []) {
  const kind = String(spec?.kind ?? "").trim().toLowerCase().replace(/-/g, "_");
  const safeArgs = args.filter((value) => value !== undefined);
  const argNodes = safeArgs.map((value) => toExpressionNode(value));
  const argText = safeArgs.map((value) => formatExpressionValue(value));

  if (kind === "successor" || kind === "succ") {
    return [buildCall("S", [argNodes[0] ?? createExpressionText("x")])];
  }

  if (kind === "zero") {
    return [createExpressionText("0")];
  }

  if (kind === "constant" || kind === "const") {
    return [createExpressionText(String(spec?.value ?? 0))];
  }

  if (kind === "projection" || kind === "proj") {
    return [
      buildFunctionExpressionNode(spec, argNodes),
      createExpressionText(getProjectionVariableMeaning(spec, argText, argText.length)),
    ];
  }

  if (kind === "add" || kind === "addition") {
    return [createExpressionText(`${argText[0] ?? "x"}+${argText[1] ?? "y"}`)];
  }

  if (kind === "bounded_sub" || kind === "sub" || kind === "truncated_sub" || kind === "truncated_subtraction") {
    return [createExpressionText(`${argText[0] ?? "x"}∸${argText[1] ?? "y"}`)];
  }

  if (kind === "compose") {
    return [buildFunctionExpressionNode(spec, argNodes)];
  }

  return [buildFunctionExpressionNode(spec, argNodes)];
}

export default function PrimitiveRecursionDefinitionPreview({
  functionSpec,
  primitiveArityInfo,
  recursionIndex = 0,
  title = "",
  inputValues = null,
  showSchemaCalls = true,
  showAuxiliary = true,
  hideDefinitionLabel = false,
  hideCurrentCallLabel = false,
}) {
  const baseArity = Number.isInteger(primitiveArityInfo?.baseArity) ? primitiveArityInfo.baseArity : 1;
  const functionArgs = buildFunctionArgumentNames(baseArity, recursionIndex);
  const baseCallArgs = replaceAt(functionArgs.args, functionArgs.recursionIndex, "0");
  const previousCallArgs = replaceAt(functionArgs.args, functionArgs.recursionIndex, "n");
  const nextCallArgs = replaceAt(functionArgs.args, functionArgs.recursionIndex, "n+1");
  const stepUsedArgs = getStepUsedArgs(primitiveArityInfo, baseArity);

  const previousRecursiveCall = buildCall("f", previousCallArgs);

  const symbolicStepValues = {
    n: "n",
    previous: "z",
  };
  const recursiveStepValues = {
    n: "n",
    previous: previousRecursiveCall,
  };

  functionArgs.carriedArgs.forEach((name) => {
    symbolicStepValues[name] = name;
    recursiveStepValues[name] = name;
  });

  const symbolicStepArgs = stepUsedArgs.map((name) => symbolicStepValues[name] ?? name);
  const recursiveStepArgs = stepUsedArgs.map((name) => recursiveStepValues[name] ?? name);

  const baseLeft = buildCall("f", baseCallArgs);
  const stepLeft = buildCall("f", nextCallArgs);
  const gCall = buildCall("g", functionArgs.carriedArgs);
  const hRecursiveCall = buildCall("h", recursiveStepArgs);
  const hSymbolicCall = buildCall("h", ["n", "z", ...functionArgs.carriedArgs]);

  const baseLine = showSchemaCalls
    ? [baseLeft, gCall, ...renderConcreteExpression(functionSpec?.base, functionArgs.carriedArgs)]
    : [baseLeft, ...renderConcreteExpression(functionSpec?.base, functionArgs.carriedArgs)];
  const stepLine = showSchemaCalls
    ? [stepLeft, hRecursiveCall, ...renderConcreteExpression(functionSpec?.step, recursiveStepArgs)]
    : [stepLeft, ...renderConcreteExpression(functionSpec?.step, recursiveStepArgs)];
  const gLine = [
    gCall,
    ...renderConcreteExpression(functionSpec?.base, functionArgs.carriedArgs),
  ];
  const hLine = [
    hSymbolicCall,
    ...renderConcreteExpression(functionSpec?.step, symbolicStepArgs),
  ];

  const currentCallExpression = Array.isArray(inputValues) && inputValues.length > 0
    ? buildCall(
        "f",
        inputValues
          .slice(0, functionArgs.args.length)
          .map((value) => String(value ?? 0)),
      )
    : null;

  return (
    <section style={previewPanelStyle} aria-label="Primitive recursion definition">
      <div style={previewContentStyle}>
        {title ? (
          <div style={previewTitleStyle}>{title}</div>
        ) : null}

        <div style={currentCallExpression ? previewSummaryColumnsStyle : previewSingleColumnStyle}>
          <div style={previewDefinitionRowStyle}>
            {hideDefinitionLabel ? <div /> : <div style={previewLabelStyle}>Definition</div>}
            <div className="math-text" style={previewMathSectionStyle}>
              <div style={previewPrimaryMathStyle}>
                <DefinitionMathLine expressions={baseLine} />
                <DefinitionMathLine expressions={stepLine} />
              </div>
              {showAuxiliary ? (
                <div className="math-text" style={previewSecondaryMathStyle}>
                  <DefinitionMathLine expressions={gLine} tone="muted" />
                  <DefinitionMathLine expressions={hLine} tone="muted" />
                </div>
              ) : null}
            </div>
          </div>

          {currentCallExpression ? (
            <div style={previewCallRowStyle}>
              {hideCurrentCallLabel ? <div /> : <div style={previewLabelStyle}>Current call</div>}
              <div className="math-text" style={previewCallMathBlockStyle}>
                <DefinitionMathLine expressions={[currentCallExpression]} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const previewPanelStyle = {
  padding: 0,
};

const previewContentStyle = {
  display: "grid",
  gap: 5,
};

const previewTitleStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--surface-text-structural)",
  opacity: 0.86,
};

const previewDefinitionRowStyle = {
  display: "grid",
  gap: 3,
  minWidth: 0,
};

const previewSingleColumnStyle = {
  display: "grid",
  gap: 0,
  minWidth: 0,
};

const previewSummaryColumnsStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 14,
  alignItems: "start",
  minWidth: 0,
};

const previewMathSectionStyle = {
  display: "grid",
  gap: 2,
  minWidth: 0,
  fontSize: "1.04em",
};

const previewPrimaryMathStyle = {
  display: "grid",
  gap: 2,
  minWidth: 0,
};

const previewLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--surface-text-structural)",
  paddingTop: 3,
  opacity: 0.74,
};

const previewCallRowStyle = {
  display: "grid",
  gap: 2,
  minWidth: 0,
};

const previewMathBlockStyle = {
  minWidth: 0,
  lineHeight: 1.45,
};

const previewCallMathBlockStyle = {
  ...previewMathBlockStyle,
  fontWeight: TYPOGRAPHY.weights.semibold,
};

const previewSecondaryMathStyle = {
  display: "grid",
  gap: 3,
  color: "var(--surface-text-secondary)",
  opacity: 0.88,
};
