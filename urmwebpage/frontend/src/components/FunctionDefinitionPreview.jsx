import { RADII, TYPOGRAPHY } from "../theme.js";
import {
  getFunctionDisplayName,
  normalizeFunctionKind,
  renderFunctionLabel,
} from "../functionMetadata.js";
import FunctionExpressionView, {
  buildFunctionCallNode,
  buildFunctionExpressionNode,
  createExpressionText,
} from "./FunctionExpressionView.jsx";
import PrimitiveRecursionDefinitionPreview from "./PrimitiveRecursionDefinitionPreview.jsx";
import DefinitionMathLine from "./DefinitionMathLine.jsx";
import { getProjectionVariableMeaning } from "../utils/mathNotation.jsx";

const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];

function getVariableNames(count) {
  if (count <= 0) return ["x"];
  return Array.from({ length: count }, (_, index) => VARIABLE_NAMES[index] ?? `x${index + 1}`);
}

function inferFunctionArity(spec) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "successor" || kind === "succ" || kind === "zero" || kind === "constant" || kind === "const") {
    return 1;
  }

  if (kind === "add" || kind === "addition" || kind === "bounded_sub" || kind === "sub" || kind === "truncated_sub" || kind === "truncated_subtraction") {
    return 2;
  }

  if (kind === "projection" || kind === "proj") {
    const arity = Number(spec?.arity);
    return Number.isInteger(arity) && arity > 0 ? arity : 2;
  }

  if (kind === "compose") {
    return inferFunctionArity(spec?.inner);
  }

  if (kind === "primrec" || kind === "primitive_rec" || kind === "primitive_recursion") {
    return inferFunctionArity(spec?.base) + 1;
  }

  return 1;
}

function formatArgs(args) {
  return args.join(", ");
}

function buildFunctionCall(name, args) {
  return buildFunctionCallNode(name, args.map((value) => createExpressionText(value)));
}

function renderMeaningExpression(spec, args = []) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "successor" || kind === "succ") {
    return {
      primary: createExpressionText(`S(${args[0] ?? "x"})`),
      familiar: createExpressionText(`${args[0] ?? "x"}+1`),
    };
  }

  if (kind === "zero") {
    return {
      primary: createExpressionText("0"),
      familiar: null,
    };
  }

  if (kind === "constant" || kind === "const") {
    return {
      primary: createExpressionText(String(spec?.value ?? 0)),
      familiar: null,
    };
  }

  if (kind === "projection" || kind === "proj") {
    const projected = getProjectionVariableMeaning(spec, args, args.length);
    return {
      primary: buildFunctionExpressionNode(
        spec,
        args.map((value) => createExpressionText(value)),
      ),
      familiar: null,
      semantic: createExpressionText(projected),
    };
  }

  if (kind === "add" || kind === "addition") {
    return {
      primary: createExpressionText(`${args[0] ?? "x"}+${args[1] ?? "y"}`),
      familiar: null,
    };
  }

  if (kind === "bounded_sub" || kind === "sub" || kind === "truncated_sub" || kind === "truncated_subtraction") {
    return {
      primary: createExpressionText(`${args[0] ?? "x"}∸${args[1] ?? "y"}`),
      familiar: null,
    };
  }

  if (kind === "compose") {
    const innerMeaning = renderMeaningExpression(spec?.inner, args);
    const structuralInnerText = renderFunctionLabel(spec?.inner) === "successor"
      ? `S(${args[0] ?? "x"})`
      : innerMeaning.familiar
        ? innerMeaning.familiar.value
        : innerMeaning.primary.value ?? `${renderFunctionLabel(spec?.inner)}(${formatArgs(args)})`;
    const outerMeaning = renderMeaningExpression(spec?.outer, [structuralInnerText]);
    return {
      primary: outerMeaning.familiar ?? outerMeaning.primary,
      familiar: null,
      structural: createExpressionText(`${renderFunctionLabel(spec?.outer)}(${structuralInnerText})`),
    };
  }

  return {
    primary: createExpressionText(`${getFunctionDisplayName(spec)}(${formatArgs(args)})`),
    familiar: null,
  };
}

export default function FunctionDefinitionPreview({
  functionSpec,
  arityInfo = null,
  recursionIndex = 0,
  inputValues = null,
  title = "Definition",
  hideDefinitionLabel = false,
  hideCurrentCallLabel = false,
  currentCallLabel = "Current call",
  showStructural = true,
  compact = false,
  stackLabels = false,
}) {
  const kind = normalizeFunctionKind(functionSpec?.kind);

  if (kind === "primrec" || kind === "primitive_rec" || kind === "primitive_recursion") {
    return (
      <PrimitiveRecursionDefinitionPreview
        functionSpec={functionSpec}
        primitiveArityInfo={arityInfo}
        recursionIndex={recursionIndex}
        title={title}
        inputValues={inputValues}
      />
    );
  }

  const arity =
    arityInfo?.status === "known" && Number.isInteger(arityInfo?.arity)
      ? arityInfo.arity
      : inferFunctionArity(functionSpec);
  const args = getVariableNames(arity);
  const meaning = renderMeaningExpression(functionSpec, args);
  const currentCallValues = Array.isArray(inputValues) && inputValues.length > 0
    ? inputValues.slice(0, arity).map((value) => String(value ?? 0))
    : null;
  const definitionExpressions = [
    buildFunctionCall("f", args),
    meaning.primary,
    ...(meaning.familiar ? [meaning.familiar] : []),
    ...(meaning.semantic ? [meaning.semantic] : []),
  ];

  return (
    <section style={previewPanelStyle} aria-label="Mathematical definition">
      <div style={compact ? previewCompactContentStyle : previewContentStyle}>
        {title ? (
          <div style={previewTitleStyle}>{title}</div>
        ) : null}

        {compact && stackLabels && currentCallValues ? (
          <div style={previewInlineSummaryStyle}>
            <div style={previewStackedSectionStyle}>
              {hideDefinitionLabel ? null : <div style={previewLabelStyle}>Definition</div>}
              <div className="math-text" style={previewCompactMathBlockStyle}>
                <DefinitionMathLine expressions={definitionExpressions} />
                {showStructural && meaning.structural ? (
                  <div className="math-text" style={previewSecondaryMathStyle}>
                    <DefinitionMathLine expressions={[meaning.structural]} tone="muted" />
                  </div>
                ) : null}
              </div>
            </div>
            <div style={previewStackedSectionStyle}>
              {hideCurrentCallLabel ? null : <div style={previewLabelStyle}>{currentCallLabel}</div>}
              <div className="math-text" style={previewCompactCallBlockStyle}>
                <DefinitionMathLine expressions={[buildFunctionCall("f", currentCallValues)]} />
              </div>
            </div>
          </div>
        ) : compact && stackLabels ? (
          <div style={previewStackedSectionStyle}>
            {hideDefinitionLabel ? null : <div style={previewLabelStyle}>Definition</div>}
            <div className="math-text" style={previewCompactMathBlockStyle}>
              <DefinitionMathLine expressions={definitionExpressions} />
              {showStructural && meaning.structural ? (
                <div className="math-text" style={previewSecondaryMathStyle}>
                  <DefinitionMathLine expressions={[meaning.structural]} tone="muted" />
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div style={compact ? previewCompactRowStyle : previewRowStyle}>
            {hideDefinitionLabel ? <div /> : <div style={previewLabelStyle}>Definition</div>}
            <div className="math-text" style={compact ? previewCompactMathBlockStyle : previewMathBlockStyle}>
              <DefinitionMathLine expressions={definitionExpressions} />
              {showStructural && meaning.structural ? (
                <div className="math-text" style={previewSecondaryMathStyle}>
                  <DefinitionMathLine expressions={[meaning.structural]} tone="muted" />
                </div>
              ) : null}
            </div>
          </div>
        )}

        {currentCallValues ? (
          compact && stackLabels ? null : (
            <div style={compact ? previewCompactCallRowStyle : previewRowStyle}>
              {hideCurrentCallLabel ? <div /> : <div style={previewLabelStyle}>{currentCallLabel}</div>}
              <div className="math-text" style={compact ? previewCompactCallBlockStyle : previewMathBlockStyle}>
                <DefinitionMathLine expressions={[buildFunctionCall("f", currentCallValues)]} />
              </div>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

const previewPanelStyle = {
  padding: 0,
};

const previewContentStyle = {
  display: "grid",
  gap: 8,
};

const previewCompactContentStyle = {
  ...previewContentStyle,
  gap: 3,
};

const previewTitleStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--surface-text-structural)",
};

const previewRowStyle = {
  display: "grid",
  gridTemplateColumns: "92px minmax(0, 1fr)",
  gap: 8,
  alignItems: "start",
};

const previewCompactRowStyle = {
  display: "grid",
  gridTemplateColumns: "0 minmax(0, 1fr)",
  gap: 0,
  alignItems: "start",
};

const previewCompactCallRowStyle = {
  ...previewCompactRowStyle,
  paddingLeft: 16,
};

const previewStackedSectionStyle = {
  display: "grid",
  gap: 3,
  minWidth: 0,
};

const previewInlineSummaryStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 14,
  alignItems: "start",
  minWidth: 0,
};

const previewLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--surface-text-structural)",
  paddingTop: 2,
  opacity: 0.82,
};

const previewMathBlockStyle = {
  display: "grid",
  gap: 3,
  fontFamily: "var(--font-math)",
  fontSize: "1.04em",
  lineHeight: 1.45,
};

const previewCompactMathBlockStyle = {
  ...previewMathBlockStyle,
  gap: 2,
};

const previewCompactCallBlockStyle = {
  ...previewCompactMathBlockStyle,
};

const previewSecondaryMathStyle = {
  color: "var(--surface-text-secondary)",
  fontSize: TYPOGRAPHY.sizes.sm,
  fontFamily: "var(--font-math)",
  lineHeight: 1.4,
};
