import { TYPOGRAPHY } from "../theme.js";
import {
  getFunctionTooltip,
  normalizeFunctionKind,
} from "../functionMetadata.js";
import FunctionExpressionView, {
  buildFunctionCallNode,
  buildFunctionExpressionNode,
  createExpressionText,
} from "./FunctionExpressionView.jsx";
import { InlineMath } from "./MathText.jsx";

const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];

function getVariableNames(count) {
  return Array.from({ length: count }, (_, index) => VARIABLE_NAMES[index] ?? `x${index + 1}`);
}

function formatValue(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function formatFunctionInvocation(spec, args) {
  return buildFunctionExpressionNode(
    spec,
    (Array.isArray(args) ? args : []).map((value) => createExpressionText(formatValue(value))),
  );
}

function formatLabeledInputs(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const labels = getVariableNames(values.length);
  return labels.map((label, index) => `${label} = ${formatValue(values[index])}`).join(", ");
}

function formatRecursiveCall(inputRegisters, recursionIndex) {
  if (!Array.isArray(inputRegisters) || inputRegisters.length === 0) return buildFunctionCallNode("f", []);

  const safeRecursionIndex =
    Number.isInteger(recursionIndex) && recursionIndex >= 0 && recursionIndex < inputRegisters.length
      ? recursionIndex
      : 0;
  const carriedInputs = inputRegisters.filter((_, index) => index !== safeRecursionIndex);
  const args = [inputRegisters[safeRecursionIndex], ...carriedInputs];
  return buildFunctionCallNode("f", args.map((value) => createExpressionText(formatValue(value))));
}

function formatPrimitiveStepCall(iteration, remainingInputs) {
  const rawInputs = Array.isArray(iteration?.input_registers) ? iteration.input_registers : [];
  const previousValue = rawInputs[0];
  const carriedValues = Array.isArray(remainingInputs) ? remainingInputs : [];
  return buildFunctionCallNode(
    "h",
    [iteration?.iteration ?? 0, previousValue, ...carriedValues].map((value) => createExpressionText(formatValue(value))),
  );
}

function formatIterationResultCall(iteration, remainingInputs) {
  return buildFunctionCallNode(
    "f",
    [(iteration?.iteration ?? 0) + 1, ...(Array.isArray(remainingInputs) ? remainingInputs : [])].map((value) =>
      createExpressionText(formatValue(value))
    ),
  );
}

function ValuePill({ children, strong = false }) {
  return (
    <span
      className="math-inline"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 7px",
        borderRadius: 2,
        border: `1px solid ${strong ? "var(--border-strong)" : "var(--border-default)"}`,
        background: strong ? "var(--surface-card-alt)" : "var(--surface-card)",
        color: "var(--surface-text-primary)",
        fontFamily: "var(--font-math)",
        fontSize: TYPOGRAPHY.sizes.base,
        lineHeight: TYPOGRAPHY.lineHeights.normal,
        fontWeight: strong ? TYPOGRAPHY.weights.bold : TYPOGRAPHY.weights.medium,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function SectionCard({ title, children }) {
  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        borderRadius: 2,
        background: "var(--surface-card)",
        padding: 10,
      }}
    >
      <div
        style={{
          marginBottom: 6,
          ...TYPOGRAPHY.styles.sectionHeading,
          color: "var(--app-text-primary, #0f172a)",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function EvaluationNodeCard({ label, node }) {
  if (!node) return null;

  return (
    <SectionCard title={label}>
      <div style={metaGridStyle}>
        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Function</span>
          <ValuePill>
            <span title={getFunctionTooltip(node.function)}>
              <FunctionExpressionView expression={buildFunctionExpressionNode(node.function)} />
            </span>
          </ValuePill>
        </div>

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Call</span>
          <ValuePill><FunctionExpressionView expression={formatFunctionInvocation(node.function, node.input_registers)} /></ValuePill>
        </div>

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Output</span>
          <ValuePill strong>{String(node.output_value ?? "—")}</ValuePill>
        </div>
      </div>

      {node.evaluation && (
        <div style={{ marginTop: 8 }}>
          <NestedEvaluationPanel evaluation={node.evaluation} compact />
        </div>
      )}
    </SectionCard>
  );
}

function PrimitiveRecursionEvaluation({ evaluation, selectedStepIndex = null }) {
  const iterations = Array.isArray(evaluation?.iterations) ? evaluation.iterations : [];
  const recursionIndex = Number(evaluation?.recursion_index ?? 0);
  const recursiveCall = formatRecursiveCall(evaluation?.input_registers, recursionIndex);
  const carriedInputsLabel = formatLabeledInputs(evaluation?.remaining_inputs);
  const baseCall = formatIterationResultCall({ iteration: -1 }, evaluation?.remaining_inputs);

  return (
    <>
      <div style={metaGridStyle}>
        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Call</span>
          <ValuePill><FunctionExpressionView expression={recursiveCall} /></ValuePill>
        </div>

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Recursion index</span>
          <ValuePill>{String(evaluation?.recursion_index ?? 0)}</ValuePill>
        </div>

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>n</span>
          <ValuePill>{String(evaluation?.recursion_value ?? 0)}</ValuePill>
        </div>

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Carried inputs</span>
          <ValuePill>
            {carriedInputsLabel ? <InlineMath value={carriedInputsLabel} /> : "none"}
          </ValuePill>
        </div>

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Final output</span>
          <ValuePill strong>{String(evaluation?.final_output ?? "—")}</ValuePill>
        </div>
      </div>

      <div style={{ marginTop: 9 }}>
        <SectionCard title="Step 0">
          <div style={{ display: "grid", gap: 8 }}>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>Call</span>
              <ValuePill><FunctionExpressionView expression={baseCall} /></ValuePill>
            </div>
            <div
              style={{
                border: `1px solid ${selectedStepIndex === 0 ? "var(--machine-active-border, rgba(238, 119, 51, 0.72))" : "var(--border-default)"}`,
                background: selectedStepIndex === 0 ? "var(--machine-active-link-bg, rgba(244, 196, 48, 0.18))" : "var(--surface-card)",
                padding: 8,
              }}
            >
              <EvaluationNodeCard
                label={(
                  <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <span>Computes</span>
                    <FunctionExpressionView expression={baseCall} />
                  </span>
                )}
                node={evaluation?.base}
              />
            </div>
          </div>
        </SectionCard>
      </div>

      <div style={{ marginTop: 9 }}>
        <SectionCard title={`Steps 1-${iterations.length}`}>
          {iterations.length === 0 ? (
            <div style={emptyTextStyle}>
              No step applications were needed because the recursion input is 0.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {iterations.map((iteration) => (
                <div
                  key={iteration.iteration}
                  style={{
                    border: `1px solid ${selectedStepIndex === iteration.iteration + 1 ? "var(--machine-active-border, rgba(238, 119, 51, 0.72))" : "var(--border-default)"}`,
                    borderRadius: 2,
                    background: selectedStepIndex === iteration.iteration + 1
                      ? "var(--machine-active-link-bg, rgba(244, 196, 48, 0.18))"
                      : "var(--surface-card)",
                    padding: 9,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      alignItems: "center",
                      marginBottom: 6,
                    }}
                  >
                    <ValuePill>{`Step ${iteration.iteration + 1}`}</ValuePill>
                    <span style={arrowStyle}>→</span>
                    <ValuePill><FunctionExpressionView expression={formatIterationResultCall(iteration, evaluation?.remaining_inputs)} /></ValuePill>
                    <span style={arrowStyle}>→</span>
                    <ValuePill><FunctionExpressionView expression={formatPrimitiveStepCall(iteration, evaluation?.remaining_inputs)} /></ValuePill>
                    <span style={arrowStyle}>→</span>
                    <ValuePill strong>{String(iteration.output_value ?? "—")}</ValuePill>
                  </div>

                  {iteration.evaluation && (
                    <NestedEvaluationPanel evaluation={iteration.evaluation} compact />
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

export default function NestedEvaluationPanel({ evaluation, compact = false, selectedStepIndex = null }) {
  if (!evaluation) return null;

  const kind = normalizeFunctionKind(evaluation.kind);
  if (kind === "compose") {
    return null;
  }

  const title =
    kind === "compose"
      ? "Composition Evaluation"
      : kind === "primrec"
        ? "Primitive Recursion Evaluation"
        : "Nested Evaluation";

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        borderRadius: 2,
        background: "var(--surface-card)",
        padding: compact ? 8 : 10,
      }}
    >
      <div
        style={{
          marginBottom: 8,
          textAlign: compact ? "left" : "center",
          ...TYPOGRAPHY.styles.sectionHeading,
          fontSize: compact ? TYPOGRAPHY.sizes.base : TYPOGRAPHY.sizes.lg,
          color: "var(--app-text-primary, #0f172a)",
        }}
      >
        {title}
      </div>

      {kind === "primrec" && (
        <PrimitiveRecursionEvaluation evaluation={evaluation} selectedStepIndex={selectedStepIndex} />
      )}
      {kind !== "primrec" && (
        <div style={emptyTextStyle}>Unsupported evaluation metadata shape.</div>
      )}
    </div>
  );
}

const arrowStyle = {
  color: "var(--app-text-primary, #111111)",
  fontFamily: "var(--font-math)",
  fontSize: TYPOGRAPHY.sizes.md,
  fontWeight: TYPOGRAPHY.weights.medium,
  lineHeight: TYPOGRAPHY.lineHeights.tight,
};

const metaGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 8,
};

const metaItemStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 4,
};

const metaLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--surface-text-secondary)",
};

const emptyTextStyle = {
  ...TYPOGRAPHY.styles.uiText,
  fontSize: TYPOGRAPHY.sizes.md,
  color: "var(--app-text-primary, #111111)",
};
