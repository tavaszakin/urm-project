import { useEffect } from "react";
import { RADII, TYPOGRAPHY } from "../theme.js";
import {
  FUNCTION_ORDER,
  getFunctionDescription,
  getFunctionDisplayName,
  getFunctionTooltip,
} from "../functionMetadata.js";
import FunctionExpressionView, {
  createExpressionCall,
  createExpressionPlaceholder,
  createExpressionText,
} from "./FunctionExpressionView.jsx";
import { InlineMath } from "./MathText.jsx";

export const COMPOSITION_FUNCTION_ORDER = FUNCTION_ORDER.filter((value) => value !== "primrec");

function buildFunctionOptions(values) {
  return values.map((value) => ({
    value,
    label: getFunctionDisplayName(value),
  }));
}

function isAllowedFunctionKind(kind, allowedKinds) {
  return Array.isArray(allowedKinds) && allowedKinds.includes(kind);
}

function getSpecRenderKey(spec) {
  const kind = String(spec?.kind ?? "successor").trim() || "successor";

  if (kind === "compose") {
    return `compose:${getSpecRenderKey(spec?.inner)}:${getSpecRenderKey(spec?.outer)}`;
  }

  if (kind === "primrec") {
    return `primrec:${getSpecRenderKey(spec?.base)}:${getSpecRenderKey(spec?.step)}`;
  }

  if (kind === "constant") {
    return `constant:${spec?.value ?? ""}`;
  }

  if (kind === "projection") {
    return `projection:${spec?.index ?? ""}:${spec?.arity ?? ""}`;
  }

  return kind;
}

function createDefaultSpec(kind = "successor") {
  if (kind === "constant") {
    return { kind, value: 3 };
  }

  if (kind === "projection") {
    return { kind, index: 1, arity: 1 };
  }

  if (kind === "compose") {
    return {
      kind,
      outer: createDefaultSpec("successor"),
      inner: createDefaultSpec("add"),
    };
  }

  if (kind === "primrec") {
    return {
      kind,
      base: createDefaultSpec("constant"),
      step: createDefaultSpec("successor"),
      recursion_index: 0,
    };
  }

  return { kind };
}

function updateNumberField(spec, field, rawValue) {
  return {
    ...spec,
    [field]: rawValue === "" ? "" : Number(rawValue),
  };
}

function nestedCardStyle(depth, layout = "card") {
  if (layout === "pipelineChild") {
    return {
      padding: 0,
      border: "none",
      borderRadius: 0,
      background: "transparent",
      boxShadow: "none",
      marginTop: 0,
      marginLeft: 0,
      minWidth: 0,
    };
  }

  return {
    border: "1px solid var(--border-default)",
    borderRadius: RADII.panel,
    padding: 9,
    background: depth === 0 ? "var(--surface-card)" : "var(--surface-card-alt)",
    marginTop: depth === 0 ? 0 : 8,
    marginLeft: depth === 0 ? 0 : 10,
  };
}

function isNonnegativeInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function getDefaultArgumentNodes(kind, spec) {
  if (kind === "add" || kind === "bounded_sub") {
    return [createExpressionText("x"), createExpressionText("y")];
  }

  if (kind === "compose") {
    return getDefaultArgumentNodes(String(spec?.inner?.kind ?? "successor"), spec?.inner);
  }

  if (kind === "projection") {
    const arity = Number(spec?.arity);
    const count = Number.isInteger(arity) && arity > 0 ? arity : 2;
    return Array.from({ length: count }, (_, index) =>
      createExpressionText(index === 0 ? "x" : index === 1 ? "y" : `x${index + 1}`),
    );
  }

  return [createExpressionText("x")];
}

function getExpectedArgumentCount(kind, spec) {
  if (kind === "add" || kind === "bounded_sub") return 2;
  if (kind === "projection") {
    const arity = Number(spec?.arity);
    return Number.isInteger(arity) && arity > 0 ? arity : 2;
  }
  if (kind === "compose") {
    return getExpectedArgumentCount(String(spec?.inner?.kind ?? "successor"), spec?.inner);
  }
  if (kind === "primrec") return 2;
  return 1;
}

function fillEditableArgsToArity(args, count) {
  const nextArgs = Array.isArray(args) ? [...args] : [];

  while (nextArgs.length < count) {
    nextArgs.push(createExpressionPlaceholder());
  }

  return nextArgs.slice(0, count);
}

function buildEditableExpressionNode(spec, onChange, depth = 0, args = undefined, allowedKinds = FUNCTION_ORDER) {
  const rawKind = spec?.kind ?? "successor";
  const kind = isAllowedFunctionKind(rawKind, allowedKinds) ? rawKind : allowedKinds[0] ?? "successor";
  const functionOptions = buildFunctionOptions(allowedKinds);
  const workingSpec = kind === rawKind ? spec : createDefaultSpec(kind);
  const fallbackArgs = fillEditableArgsToArity(
    Array.isArray(args) && args.length > 0 ? args : getDefaultArgumentNodes(kind, workingSpec),
    getExpectedArgumentCount(kind, workingSpec),
  );
  const kindControl = (
    <select
      value={kind}
      onChange={(e) => onChange(createDefaultSpec(e.target.value))}
      style={expressionSelectStyle}
      className="dashboard-control function-toolbar-select runner-toolbar-select"
      title={getFunctionTooltip(workingSpec)}
    >
      {functionOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  if (kind === "constant") {
    return createExpressionCall(
      <span key={`constant-${depth}`} style={expressionProjectionHeadStyle}>
        {kindControl}
        <input
          type="number"
          value={workingSpec.value ?? ""}
          onChange={(e) => onChange(updateNumberField(workingSpec, "value", e.target.value))}
          style={expressionNumberInputStyle}
          className="dashboard-control runner-toolbar-number-input"
          aria-label="Constant value"
          title="Constant value"
          placeholder="k"
        />
      </span>,
      fallbackArgs,
    );
  }

  if (kind === "projection") {
    return createExpressionCall(
      <span key={`projection-${depth}`} style={expressionProjectionHeadStyle}>
        {kindControl}
        <input
          type="number"
          value={workingSpec.index ?? ""}
          onChange={(e) => onChange(updateNumberField(workingSpec, "index", e.target.value))}
          style={expressionNumberInputStyle}
          className="dashboard-control runner-toolbar-number-input"
          aria-label="Projection index"
          title="Projection index"
          placeholder="i"
        />
        <input
          type="number"
          value={workingSpec.arity ?? ""}
          onChange={(e) => onChange(updateNumberField(workingSpec, "arity", e.target.value))}
          style={expressionNumberInputStyle}
          className="dashboard-control runner-toolbar-number-input"
          aria-label="Projection arity"
          title="Projection arity"
          placeholder="n"
        />
      </span>,
      fallbackArgs,
    );
  }

  if (kind === "compose") {
    const innerExpression = buildEditableExpressionNode(
      workingSpec.inner ?? createDefaultSpec("add"),
      (nextInner) => onChange({ ...workingSpec, inner: nextInner }),
      depth + 1,
      fallbackArgs,
      allowedKinds,
    );
    const outerExpression = buildEditableExpressionNode(
      workingSpec.outer ?? createDefaultSpec("successor"),
      (nextOuter) => onChange({ ...workingSpec, outer: nextOuter }),
      depth + 1,
      [innerExpression],
      allowedKinds,
    );
    return (
      <span key={`compose-${depth}`} style={expressionComposeWrapStyle}>
        <FunctionExpressionView expression={outerExpression} size="md" />
      </span>
    );
  }

  if (kind === "zero" || kind === "successor" || kind === "add" || kind === "bounded_sub") {
    return createExpressionCall(kindControl, fallbackArgs);
  }

  if (kind === "primrec") {
    return createExpressionCall(kindControl, [
      buildEditableExpressionNode(
        workingSpec.base ?? createDefaultSpec("constant"),
        (nextBase) => onChange({ ...workingSpec, base: nextBase }),
        depth + 1,
        [createExpressionText("x")],
        allowedKinds,
      ),
      buildEditableExpressionNode(
        workingSpec.step ?? createDefaultSpec("successor"),
        (nextStep) => onChange({ ...workingSpec, step: nextStep }),
        depth + 1,
        [createExpressionText("n"), createExpressionText("previous"), createExpressionText("x")],
        allowedKinds,
      ),
    ]);
  }

  return createExpressionCall(kindControl, fallbackArgs);
}

export function validateFunctionSpec(spec, path = "Function") {
  if (!spec || typeof spec !== "object") {
    return `${path} is required.`;
  }

  const kind = String(spec.kind ?? "").trim();

  if (!kind) {
    return `${path} kind is required.`;
  }

  if (kind === "constant") {
    if (spec.value === "" || !isNonnegativeInteger(spec.value)) {
      return `${path} requires a nonnegative integer value.`;
    }
  }

  if (kind === "projection") {
    if (spec.index === "" || !isPositiveInteger(spec.index)) {
      return `${path} requires a positive integer index.`;
    }

    if (spec.arity !== "" && spec.arity !== undefined && !isPositiveInteger(spec.arity)) {
      return `${path} arity must be a positive integer.`;
    }

    if (
      spec.arity !== "" &&
      spec.arity !== undefined &&
      isPositiveInteger(spec.index) &&
      isPositiveInteger(spec.arity) &&
      Number(spec.index) > Number(spec.arity)
    ) {
      return `${path} index must be at most the selected arity.`;
    }
  }

  if (kind === "compose") {
    if (!spec.outer) {
      return `${path} requires an outer function.`;
    }

    if (!spec.inner) {
      return `${path} requires an inner function.`;
    }

    return (
      validateFunctionSpec(spec.outer, `${path} outer`) ||
      validateFunctionSpec(spec.inner, `${path} inner`)
    );
  }

  if (kind === "primrec") {
    if (!spec.base) {
      return `${path} requires a base function.`;
    }

    if (!spec.step) {
      return `${path} requires a step function.`;
    }

    if (
      spec.recursion_index !== "" &&
      spec.recursion_index !== undefined &&
      !isNonnegativeInteger(spec.recursion_index)
    ) {
      return `${path} recursion index must be a nonnegative integer.`;
    }

    return (
      validateFunctionSpec(spec.base, `${path} base`) ||
      validateFunctionSpec(spec.step, `${path} step`)
    );
  }

  return "";
}

export function normalizeFunctionSpec(spec) {
  const kind = String(spec?.kind ?? "").trim();

  if (kind === "constant") {
    return {
      kind,
      value: Number(spec.value),
    };
  }

  if (kind === "projection") {
    const normalized = {
      kind,
      index: Number(spec.index),
    };

    if (spec.arity !== "" && spec.arity !== undefined) {
      normalized.arity = Number(spec.arity);
    }

    return normalized;
  }

  if (kind === "compose") {
    return {
      kind,
      outer: normalizeFunctionSpec(spec.outer),
      inner: normalizeFunctionSpec(spec.inner),
    };
  }

  if (kind === "primrec") {
    const normalized = {
      kind,
      base: normalizeFunctionSpec(spec.base),
      step: normalizeFunctionSpec(spec.step),
    };

    if (spec.recursion_index !== "" && spec.recursion_index !== undefined) {
      normalized.recursion_index = Number(spec.recursion_index);
    }

    return normalized;
  }

  return { kind };
}

export default function FunctionSpecBuilder({
  spec,
  onChange,
  title = "Function",
  depth = 0,
  layout = "card",
  expressionArgs = undefined,
  allowedKinds = FUNCTION_ORDER,
}) {
  const rawKind = spec?.kind ?? "successor";
  const kind = isAllowedFunctionKind(rawKind, allowedKinds) ? rawKind : allowedKinds[0] ?? "successor";
  const functionOptions = buildFunctionOptions(allowedKinds);
  const safeSpec = kind === rawKind ? spec : createDefaultSpec(kind);
  const renderKey = getSpecRenderKey(safeSpec);
  const isPipelineChild = layout === "pipelineChild";
  const isExpressionChild = layout === "expressionChild";
  const isToolbar = layout === "toolbar" || layout === "toolbarChild";
  const helperText = getFunctionDescription(safeSpec);

  useEffect(() => {
    if (kind !== rawKind) {
      onChange(createDefaultSpec(kind));
    }
  }, [kind, onChange, rawKind]);

  function handleKindChange(nextKind) {
    onChange(createDefaultSpec(nextKind));
  }

  if (isExpressionChild) {
    return (
      <FunctionExpressionView
        key={`${layout}-${depth}-${renderKey}`}
        expression={buildEditableExpressionNode(safeSpec, onChange, depth, expressionArgs, allowedKinds)}
        size="md"
      />
    );
  }

  if (isToolbar) {
    if (kind === "primrec" && layout === "toolbar") {
      return (
        <div style={toolbarDenseBuilderStyle} className="function-toolbar-primrec">
          <div style={toolbarDenseRowStyle} className="function-toolbar-primrec-row">
            <span style={toolbarDenseLeadStyle} className="function-toolbar-primrec-lead">
              <select
                value={kind}
                onChange={(e) => handleKindChange(e.target.value)}
                style={toolbarSelectStyle}
                className="dashboard-control function-toolbar-select runner-toolbar-select"
                title={getFunctionTooltip(safeSpec)}
              >
                {functionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <span style={toolbarFieldStyle}>
                <span style={toolbarTokenLabelStyle}>Recursion input</span>
                <input
                  type="number"
                  min="0"
                  value={safeSpec.recursion_index ?? 0}
                  onChange={(e) => onChange(updateNumberField(safeSpec, "recursion_index", e.target.value))}
                  style={toolbarNumberInputStyle}
                  className="dashboard-control runner-toolbar-number-input"
                />
              </span>
            </span>

            <span style={toolbarDenseRoleGroupStyle} className="function-toolbar-primrec-role">
              <span style={toolbarTokenLabelStyle}>Base case</span>
              <FunctionSpecBuilder
                spec={safeSpec.base ?? createDefaultSpec("constant")}
                onChange={(nextBase) => onChange({ ...safeSpec, base: nextBase })}
                depth={depth + 1}
                layout="toolbarChild"
                allowedKinds={allowedKinds}
              />
            </span>

            <span style={toolbarDenseRoleGroupStyle} className="function-toolbar-primrec-role">
              <span style={toolbarTokenLabelStyle}>Step function</span>
              <FunctionSpecBuilder
                spec={safeSpec.step ?? createDefaultSpec("successor")}
                onChange={(nextStep) => onChange({ ...safeSpec, step: nextStep })}
                depth={depth + 1}
                layout="toolbarChild"
                allowedKinds={allowedKinds}
              />
            </span>
          </div>
        </div>
      );
    }

    return (
      <div style={layout === "toolbar" ? toolbarBuilderStyle : toolbarChildBuilderStyle}>
        <span style={toolbarSelectWrapStyle}>
          <select
            key={`${layout}-${depth}-${renderKey}-kind`}
            value={kind}
            onChange={(e) => handleKindChange(e.target.value)}
            style={toolbarSelectStyle}
            className="dashboard-control function-toolbar-select runner-toolbar-select"
            title={getFunctionTooltip(safeSpec)}
          >
            {functionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>

        {kind === "constant" && (
          <>
            <span style={toolbarFieldStyle}>
              <input
                type="number"
                value={safeSpec.value ?? ""}
                onChange={(e) => onChange(updateNumberField(safeSpec, "value", e.target.value))}
                style={toolbarNumberInputStyle}
                className="dashboard-control runner-toolbar-number-input"
                aria-label="Constant value"
                title="Constant value"
                placeholder="value"
              />
            </span>
          </>
        )}

        {kind === "projection" && (
          <>
            <span style={toolbarFieldStyle}>
              <input
                type="number"
                value={safeSpec.index ?? ""}
                onChange={(e) => onChange(updateNumberField(safeSpec, "index", e.target.value))}
                style={toolbarNumberInputStyle}
                className="dashboard-control runner-toolbar-number-input"
                aria-label="Projection index"
                title="Projection index"
                placeholder="index"
              />
            </span>

            <span style={toolbarFieldStyle}>
              <input
                type="number"
                value={safeSpec.arity ?? ""}
                onChange={(e) => onChange(updateNumberField(safeSpec, "arity", e.target.value))}
                style={toolbarNumberInputStyle}
                className="dashboard-control runner-toolbar-number-input"
                aria-label="Projection arity"
                title="Projection arity"
                placeholder="arity"
              />
            </span>
          </>
        )}

        {kind === "compose" && (
          <FunctionExpressionView
            key={`${layout}-${depth}-${renderKey}-compose`}
            expression={buildEditableExpressionNode(safeSpec, onChange, depth, [
              createExpressionText("x"),
              createExpressionText("y"),
            ], allowedKinds)}
            style={toolbarComposeGroupStyle}
          />
        )}

        {kind === "primrec" && (
          <span style={toolbarPrimrecGroupStyle}>
            <span style={toolbarFieldStyle}>
              <span style={toolbarTokenLabelStyle}>Recursion input</span>
              <input
                type="number"
                min="0"
                value={safeSpec.recursion_index ?? 0}
                onChange={(e) => onChange(updateNumberField(safeSpec, "recursion_index", e.target.value))}
                style={toolbarNumberInputStyle}
                className="dashboard-control runner-toolbar-number-input"
              />
            </span>
            <span style={toolbarRoleGroupStyle}>
              <span style={toolbarTokenLabelStyle}>Base case</span>
              <FunctionSpecBuilder
                spec={safeSpec.base ?? createDefaultSpec("constant")}
                onChange={(nextBase) => onChange({ ...safeSpec, base: nextBase })}
                depth={depth + 1}
                layout="toolbarChild"
                allowedKinds={allowedKinds}
              />
            </span>
            <span style={toolbarRoleGroupStyle}>
              <span style={toolbarTokenLabelStyle}>Step function</span>
              <FunctionSpecBuilder
                spec={safeSpec.step ?? createDefaultSpec("successor")}
                onChange={(nextStep) => onChange({ ...safeSpec, step: nextStep })}
                depth={depth + 1}
                layout="toolbarChild"
                allowedKinds={allowedKinds}
              />
            </span>
          </span>
        )}
      </div>
    );
  }

  return (
    <div key={`${layout}-${depth}-${renderKey}`} style={nestedCardStyle(depth, layout)}>
      {title && !isPipelineChild && (
        <div
          style={{
            marginBottom: 8,
            ...TYPOGRAPHY.styles.label,
            fontSize: depth === 0 ? TYPOGRAPHY.sizes.md : TYPOGRAPHY.sizes.sm,
            fontWeight: TYPOGRAPHY.weights.semibold,
            color: "var(--surface-text-primary)",
          }}
        >
          {title}
        </div>
      )}

      <label style={isPipelineChild ? compactControlWrapStyle : labelStyle}>
        {!isPipelineChild && (
          <>
            Function kind
            <br />
          </>
        )}
        <select
          key={`${layout}-${depth}-${renderKey}-kind`}
          value={kind}
          onChange={(e) => handleKindChange(e.target.value)}
          style={isPipelineChild ? functionBlockSelectStyle : controlStyle}
          className="dashboard-control"
          title={getFunctionTooltip(safeSpec)}
        >
          {functionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {!isPipelineChild && helperText && <div style={helperTextStyle}>{helperText}</div>}

      {kind === "constant" && (
        <div style={isPipelineChild ? compactInlineFieldRowStyle : inlineFieldRowStyle}>
          <label style={isPipelineChild ? compactLabelStyle : labelStyle}>
            Value
            <br />
            <input
              type="number"
              value={safeSpec.value ?? ""}
              onChange={(e) => onChange(updateNumberField(safeSpec, "value", e.target.value))}
              style={isPipelineChild ? compactInputStyle : controlStyle}
              className="dashboard-control"
            />
          </label>
          {!isPipelineChild && (
            <div style={helperTextStyle}>
              <InlineMath value="constant(k)" /> is treated as a 1-ary constant function here.
            </div>
          )}
        </div>
      )}

      {kind === "projection" && (
        <div style={isPipelineChild ? compactFieldGridStyle : fieldGridStyle}>
          <label style={isPipelineChild ? compactLabelStyle : labelStyle}>
            Index
            <br />
            <input
              type="number"
              value={safeSpec.index ?? ""}
              onChange={(e) => onChange(updateNumberField(safeSpec, "index", e.target.value))}
              style={isPipelineChild ? compactInputStyle : controlStyle}
              className="dashboard-control"
            />
          </label>

          <label style={isPipelineChild ? compactLabelStyle : labelStyle}>
            Arity
            <br />
            <input
              type="number"
              value={safeSpec.arity ?? ""}
              onChange={(e) => onChange(updateNumberField(safeSpec, "arity", e.target.value))}
              style={isPipelineChild ? compactInputStyle : controlStyle}
              className="dashboard-control"
            />
          </label>
        </div>
      )}

      {kind === "compose" && (
        <div style={pipelineLayoutStyle}>
          <div style={pipelineColumnStyle}>
            <FunctionSpecBuilder
              spec={safeSpec.inner ?? createDefaultSpec("add")}
              onChange={(nextInner) => onChange({ ...safeSpec, inner: nextInner })}
              depth={depth + 1}
              layout="pipelineChild"
              allowedKinds={allowedKinds}
            />
          </div>

          <div style={pipelineArrowStyle} aria-hidden="true">
            →
          </div>

          <div style={pipelineColumnStyle}>
            <FunctionSpecBuilder
              spec={safeSpec.outer ?? createDefaultSpec("successor")}
              onChange={(nextOuter) => onChange({ ...safeSpec, outer: nextOuter })}
              depth={depth + 1}
              layout="pipelineChild"
              allowedKinds={allowedKinds}
            />
          </div>
        </div>
      )}

      {kind === "primrec" && (
        <>
          <div style={{ ...fieldGridStyle, marginTop: 10 }}>
            <label style={labelStyle}>
              Recursion input
              <br />
              <input
              type="number"
              min="0"
              value={safeSpec.recursion_index ?? 0}
              onChange={(e) => onChange(updateNumberField(safeSpec, "recursion_index", e.target.value))}
              style={controlStyle}
              className="dashboard-control"
            />
            </label>
          </div>

          <FunctionSpecBuilder
            spec={safeSpec.base ?? createDefaultSpec("constant")}
            onChange={(nextBase) => onChange({ ...safeSpec, base: nextBase })}
            title="Base case"
            depth={depth + 1}
            allowedKinds={allowedKinds}
          />
          <FunctionSpecBuilder
            spec={safeSpec.step ?? createDefaultSpec("successor")}
            onChange={(nextStep) => onChange({ ...safeSpec, step: nextStep })}
            title="Step function"
            depth={depth + 1}
            allowedKinds={allowedKinds}
          />
        </>
      )}
    </div>
  );
}

const labelStyle = {
  display: "block",
  ...TYPOGRAPHY.styles.uiStrong,
  fontSize: TYPOGRAPHY.sizes.sm,
  fontWeight: TYPOGRAPHY.weights.medium,
  color: "var(--surface-text-primary)",
};

const compactLabelStyle = {
  ...labelStyle,
  fontSize: TYPOGRAPHY.sizes.xs,
  lineHeight: TYPOGRAPHY.lineHeights.tight,
};

const fieldGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 8,
  marginTop: 8,
};

const compactFieldGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))",
  gap: 4,
  marginTop: 4,
};

const inlineFieldRowStyle = {
  marginTop: 8,
};

const expressionComposeWrapStyle = {
  display: "inline-flex",
  alignItems: "baseline",
  flexWrap: "nowrap",
  gap: 0,
  minWidth: 0,
  color: "var(--surface-text-primary)",
};

const compactInlineFieldRowStyle = {
  marginTop: 4,
};

const helperTextStyle = {
  marginTop: 6,
  ...TYPOGRAPHY.styles.uiText,
  fontSize: TYPOGRAPHY.sizes.xs,
  color: "var(--surface-text-muted)",
};

const pipelineLayoutStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginTop: 6,
};

const pipelineColumnStyle = {
  flex: "1 1 210px",
  minWidth: 0,
};

const pipelineArrowStyle = {
  flex: "0 0 auto",
  alignSelf: "center",
  padding: "0 2px",
  color: "var(--surface-text-primary)",
  ...TYPOGRAPHY.styles.sectionTitle,
  fontSize: 22,
  lineHeight: TYPOGRAPHY.lineHeights.tight,
  fontWeight: TYPOGRAPHY.weights.bold,
};

const compactControlWrapStyle = {
  display: "grid",
  gap: 4,
};

const controlStyle = {
  ...TYPOGRAPHY.styles.control,
  height: 30,
  padding: "4px 8px",
  border: "1px solid var(--input-border)",
  borderRadius: RADII.control,
  background: "var(--input-bg)",
  color: "var(--input-text)",
  WebkitTextFillColor: "var(--input-text)",
  boxSizing: "border-box",
  width: "100%",
};

const functionBlockSelectStyle = {
  ...controlStyle,
  height: 32,
  padding: "3px 10px",
  borderRadius: RADII.control,
  border: "1px solid var(--input-border)",
  background: "var(--input-bg)",
  fontWeight: 600,
  boxShadow: "none",
};

const compactInputStyle = {
  ...controlStyle,
  height: 28,
  padding: "3px 7px",
  borderRadius: RADII.control,
  fontSize: TYPOGRAPHY.sizes.md,
};

export const expressionSelectStyle = {
  ...compactInputStyle,
  width: "auto",
  minWidth: 0,
  height: 30,
  padding: "4px 28px 4px 8px",
  fontWeight: TYPOGRAPHY.weights.semibold,
};

const expressionNumberInputStyle = {
  ...compactInputStyle,
  ...TYPOGRAPHY.styles.code,
  width: 56,
  minWidth: 56,
  textAlign: "center",
  marginLeft: 4,
};

const expressionProjectionHeadStyle = {
  display: "inline-flex",
  alignItems: "center",
  minWidth: 0,
};

const toolbarBuilderStyle = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "nowrap",
  gap: 6,
  minWidth: 0,
};

const toolbarChildBuilderStyle = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "nowrap",
  gap: 5,
  minWidth: 0,
};

const toolbarSelectWrapStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};

const toolbarSelectStyle = {
  ...controlStyle,
  width: "auto",
  minWidth: 0,
  padding: "4px 28px 4px 8px",
  height: 30,
  fontSize: 12,
  fontWeight: 600,
};

const toolbarNumberInputStyle = {
  ...compactInputStyle,
  ...TYPOGRAPHY.styles.code,
  width: 64,
  minWidth: 64,
  textAlign: "center",
};

const toolbarFieldStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
};

const toolbarRoleGroupStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
};

const toolbarTokenLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--surface-text-muted)",
  whiteSpace: "nowrap",
};

const toolbarComposeGroupStyle = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "nowrap",
  gap: 5,
  minWidth: 0,
  padding: "2px 0",
};

const toolbarPrimrecGroupStyle = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "nowrap",
  gap: 5,
  minWidth: 0,
};

const toolbarDenseBuilderStyle = {
  display: "grid",
  gap: 6,
  minWidth: 0,
  width: "100%",
};

const toolbarDenseRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(160px, auto) minmax(0, 1fr) minmax(0, 1fr)",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
};

const toolbarDenseLeadStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  flexWrap: "wrap",
};

const toolbarDenseRoleGroupStyle = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};

const toolbarArrowStyle = {
  color: "var(--app-text-subtle)",
  ...TYPOGRAPHY.styles.codeStrong,
  fontSize: TYPOGRAPHY.sizes.base,
  lineHeight: TYPOGRAPHY.lineHeights.tight,
};
