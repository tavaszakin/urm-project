import { RADII, TYPOGRAPHY } from "../theme.js";
import {
  getFunctionDisplayName,
  normalizeFunctionKind,
  renderFunctionExpression,
  renderFunctionLabel,
} from "../functionMetadata.js";
import FunctionExpressionView, {
  buildFunctionCallNode,
  buildFunctionExpressionNode,
  createExpressionText,
} from "./FunctionExpressionView.jsx";
import PrimitiveRecursionDefinitionPreview from "./PrimitiveRecursionDefinitionPreview.jsx";
import DefinitionMathLine from "./DefinitionMathLine.jsx";
import KatexMath from "./KatexMath.jsx";
import {
  FunctionCardControls,
  FunctionCardLabel,
  FunctionCardMath,
  FunctionCardRow,
  FunctionCardRows,
} from "./FunctionCardLayout.jsx";
import { getProjectionVariableMeaning } from "../utils/mathNotation.jsx";
import {
  getCharacteristicRelationMetadata,
} from "../characteristicMetadata.js";

const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];

function getVariableNames(count) {
  if (count <= 0) return ["x"];
  return Array.from({ length: count }, (_, index) => VARIABLE_NAMES[index] ?? `x${index + 1}`);
}

function inferFunctionArity(spec) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "successor" || kind === "succ" || kind === "predecessor" || kind === "pred" || kind === "truncated_predecessor" || kind === "zero" || kind === "constant" || kind === "const" || kind === "divisor_count") {
    return 1;
  }

  if (kind === "add" || kind === "addition" || kind === "multiplication" || kind === "exponentiation" || kind === "geometric_sum" || kind === "bounded_sub" || kind === "sub" || kind === "truncated_sub" || kind === "truncated_subtraction") {
    return 2;
  }

  if (kind === "characteristic") {
    return 2;
  }

  if (kind === "projection" || kind === "proj") {
    const arity = Number(spec?.arity);
    return Number.isInteger(arity) && arity > 0 ? arity : 2;
  }

  if (kind === "compose") {
    return inferFunctionArity(spec?.inner);
  }

  if (kind === "minimization") {
    return Math.max(inferFunctionArity(spec?.inner) - 1, 0);
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

  if (kind === "predecessor" || kind === "pred" || kind === "truncated_predecessor") {
    return {
      primary: createExpressionText(`${args[0] ?? "x"}∸1`),
      familiar: createExpressionText(`max(${args[0] ?? "x"}-1,0)`),
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

  if (kind === "multiplication") {
    return {
      primary: createExpressionText(`${args[0] ?? "x"}×${args[1] ?? "y"}`),
      familiar: null,
    };
  }

  if (kind === "exponentiation") {
    return {
      primary: createExpressionText(`${args[0] ?? "x"}^${args[1] ?? "y"}`),
      familiar: null,
    };
  }

  if (kind === "factorial") {
    return {
      primary: createExpressionText(`${args[0] ?? "n"}!`),
      familiar: null,
    };
  }

  if (kind === "geometric_sum") {
    return {
      primary: createExpressionText(`1+${args[0] ?? "x"}+\\dots+${args[0] ?? "x"}^{${args[1] ?? "y"}}`),
      familiar: null,
    };
  }

  if (kind === "divisor_count") {
    const n = args[0] ?? "n";
    return {
      primary: createExpressionText(`τ(${n})`),
      familiar: createExpressionText(`# {d: 1≤d≤${n}, d|${n}}`),
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

  if (kind === "minimization") {
    const innerExpression = renderFunctionExpression(spec?.inner, [...args, "y"]);
    return {
      primary: createExpressionText(`μy[${innerExpression}=0]`),
      familiar: null,
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

  if (kind === "characteristic") {
    const relation = getCharacteristicRelationMetadata(functionSpec?.relation);
    const relationLatex = relation.latex;
    const negatedLatex = relation.negatedLatex;
    const currentCallValues = Array.isArray(inputValues) && inputValues.length > 0
      ? inputValues.slice(0, 2).map((value) => String(value ?? 0))
      : null;
    const currentCallLatex = currentCallValues
      ? `\\chi_R\\left(${currentCallValues.join(",")}\\right)`
      : null;
    const definitionLatex = `\\chi_R(x,y)=\\begin{cases}1 & \\text{if } ${relationLatex},\\\\0 & \\text{if } ${negatedLatex}.\\end{cases}`;

    return (
      <section style={previewPanelStyle} aria-label="Mathematical definition">
        <div style={compact ? previewCompactContentStyle : previewContentStyle}>
          {title ? (
            <div style={previewTitleStyle}>{title}</div>
          ) : null}

          <FunctionCardRows>
            <FunctionCardRow>
              {hideDefinitionLabel ? <div /> : <FunctionCardLabel style={previewLabelStyle}>Definition</FunctionCardLabel>}
              <FunctionCardMath className="math-text" style={compact ? previewCompactMathBlockStyle : previewMathBlockStyle}>
                <KatexMath expression={`R(x,y): ${relationLatex}`} />
                <KatexMath expression={definitionLatex} />
              </FunctionCardMath>
              <FunctionCardControls />
            </FunctionCardRow>
            {currentCallLatex ? (
              <FunctionCardRow>
                {hideCurrentCallLabel ? <div /> : <FunctionCardLabel style={previewLabelStyle}>{currentCallLabel}</FunctionCardLabel>}
                <FunctionCardMath className="math-text" style={compact ? previewCompactCallBlockStyle : previewMathBlockStyle}>
                  <KatexMath expression={currentCallLatex} />
                </FunctionCardMath>
                <FunctionCardControls />
              </FunctionCardRow>
            ) : null}
          </FunctionCardRows>
        </div>
      </section>
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
          <FunctionCardRows>
            <FunctionCardRow>
              {hideDefinitionLabel ? <div /> : <FunctionCardLabel style={previewLabelStyle}>Definition</FunctionCardLabel>}
              <FunctionCardMath className="math-text" style={previewCompactMathBlockStyle}>
                <DefinitionMathLine expressions={definitionExpressions} />
                {showStructural && meaning.structural ? (
                  <div className="math-text" style={previewSecondaryMathStyle}>
                    <DefinitionMathLine expressions={[meaning.structural]} tone="muted" />
                  </div>
                ) : null}
              </FunctionCardMath>
              <FunctionCardControls />
            </FunctionCardRow>
            <FunctionCardRow>
              {hideCurrentCallLabel ? <div /> : <FunctionCardLabel style={previewLabelStyle}>{currentCallLabel}</FunctionCardLabel>}
              <FunctionCardMath className="math-text" style={previewCompactCallBlockStyle}>
                <DefinitionMathLine expressions={[buildFunctionCall("f", currentCallValues)]} />
              </FunctionCardMath>
              <FunctionCardControls />
            </FunctionCardRow>
          </FunctionCardRows>
        ) : compact && stackLabels ? (
          <FunctionCardRows>
            <FunctionCardRow>
              {hideDefinitionLabel ? <div /> : <FunctionCardLabel style={previewLabelStyle}>Definition</FunctionCardLabel>}
              <FunctionCardMath className="math-text" style={previewCompactMathBlockStyle}>
              <DefinitionMathLine expressions={definitionExpressions} />
              {showStructural && meaning.structural ? (
                <div className="math-text" style={previewSecondaryMathStyle}>
                  <DefinitionMathLine expressions={[meaning.structural]} tone="muted" />
                </div>
              ) : null}
              </FunctionCardMath>
              <FunctionCardControls />
            </FunctionCardRow>
          </FunctionCardRows>
        ) : (
          <FunctionCardRows>
            <FunctionCardRow>
              {hideDefinitionLabel ? <div /> : <FunctionCardLabel style={previewLabelStyle}>Definition</FunctionCardLabel>}
              <FunctionCardMath className="math-text" style={compact ? previewCompactMathBlockStyle : previewMathBlockStyle}>
              <DefinitionMathLine expressions={definitionExpressions} />
              {showStructural && meaning.structural ? (
                <div className="math-text" style={previewSecondaryMathStyle}>
                  <DefinitionMathLine expressions={[meaning.structural]} tone="muted" />
                </div>
              ) : null}
              </FunctionCardMath>
              <FunctionCardControls />
            </FunctionCardRow>
          </FunctionCardRows>
        )}

        {currentCallValues ? (
          compact && stackLabels ? null : (
            <FunctionCardRows>
              <FunctionCardRow>
                {hideCurrentCallLabel ? <div /> : <FunctionCardLabel style={previewLabelStyle}>{currentCallLabel}</FunctionCardLabel>}
                <FunctionCardMath className="math-text" style={compact ? previewCompactCallBlockStyle : previewMathBlockStyle}>
                <DefinitionMathLine expressions={[buildFunctionCall("f", currentCallValues)]} />
                </FunctionCardMath>
                <FunctionCardControls />
              </FunctionCardRow>
            </FunctionCardRows>
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
