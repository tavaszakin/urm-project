import FunctionExpressionView, {
  buildFunctionCallNode,
  buildFunctionExpressionNode,
  createExpressionText,
} from "./FunctionExpressionView.jsx";
import { InlineMath, MathEquals } from "./MathText.jsx";

const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];

function getVariableNames(count) {
  return Array.from({ length: count }, (_, index) => VARIABLE_NAMES[index] ?? `x${index + 1}`);
}

function formatValue(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function formatInstructionRange(range) {
  if (!range) return "—";
  const start = Number(range.start_instruction);
  const end = Number(range.end_instruction);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "—";
  return `I${start}–I${end}`;
}

function buildDefinitionSummary(functionSpec, evaluation) {
  const carriedInputs = Array.isArray(evaluation?.remaining_inputs) ? evaluation.remaining_inputs : [];
  const parameterNames = getVariableNames(carriedInputs.length);
  const parameterNodes = parameterNames.map((name) => createExpressionText(name));
  const baseLeft = buildFunctionCallNode("f", [createExpressionText("0"), ...parameterNodes]);
  const previousCall = buildFunctionCallNode("f", [createExpressionText("n"), ...parameterNodes]);
  const stepLeft = buildFunctionCallNode("f", [createExpressionText("n + 1"), ...parameterNodes]);
  const baseRight = buildFunctionExpressionNode(functionSpec?.base, parameterNodes);
  const stepRight = buildFunctionExpressionNode(functionSpec?.step, [
    createExpressionText("n"),
    previousCall,
    ...parameterNodes,
  ]);

  return {
    parameterNames,
    baseLeft,
    baseRight,
    stepLeft,
    stepRight,
  };
}

function MetaItem({ label, value, strong = false }) {
  return (
    <div className="primitive-translation-meta-item">
      <div className="primitive-translation-meta-label">{label}</div>
      <div className={`primitive-translation-meta-value${strong ? " is-strong" : ""}`}>{value}</div>
    </div>
  );
}

function ProgramSection({ title, note = "", range }) {
  return (
    <section className="primitive-translation-program-card">
      <div className="primitive-translation-program-header">
        <div className="primitive-translation-program-title">{title}</div>
        {note ? <div className="primitive-translation-program-note">{note}</div> : null}
      </div>
      <div className="primitive-translation-meta-grid" style={{ gridTemplateColumns: "1fr" }}>
        <MetaItem label="Instruction range" value={<InlineMath value={formatInstructionRange(range)} />} strong />
      </div>
    </section>
  );
}

export default function PrimitiveRecursionTranslationSummary({
  functionSpec,
  evaluation,
  stepGroups,
  selectedStepIndex = null,
  introKicker = "Primitive recursion",
}) {
  if (!evaluation) {
    return null;
  }

  const definition = buildDefinitionSummary(functionSpec, evaluation);
  const carriedInputs = Array.isArray(evaluation?.remaining_inputs) ? evaluation.remaining_inputs : [];
  const carriedInputsText =
    definition.parameterNames.length > 0
      ? definition.parameterNames.map((name, index) => `${name} = ${formatValue(carriedInputs[index])}`).join(", ")
      : null;
  const selectedStep = Array.isArray(stepGroups)
    ? stepGroups.find((group) => group.stepIndex === selectedStepIndex) ?? null
    : null;
  const selectedStepLabel = selectedStep
    ? (
        <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
          <span>{selectedStep.label}</span>
          <InlineMath value={selectedStep.callText} />
        </span>
      )
    : "No recursion stage selected";
  const recursionIndex = Number.isInteger(evaluation?.recursion_index) ? evaluation.recursion_index : 0;
  const sections = evaluation?.compiled_program?.sections ?? {};
  return (
    <section className="primitive-translation-panel" aria-label="Primitive recursion translation summary">
      <div className="primitive-translation-section">
        <div className="primitive-translation-kicker">{introKicker}</div>
        <div className="primitive-translation-equations">
          <div className="primitive-translation-equation">
            <FunctionExpressionView expression={definition.baseLeft} size="lg" />
            <MathEquals className="primitive-translation-equation-equals" />
            <FunctionExpressionView expression={definition.baseRight} size="lg" />
          </div>
          <div className="primitive-translation-equation">
            <FunctionExpressionView expression={definition.stepLeft} size="lg" />
            <MathEquals className="primitive-translation-equation-equals" />
            <FunctionExpressionView expression={definition.stepRight} size="lg" />
          </div>
        </div>
      </div>

      <div className="primitive-translation-section">
        <div className="primitive-translation-kicker">Compilation summary</div>
        <div className="primitive-translation-meta-grid">
          <MetaItem label="Base function g" value={<InlineMath value="g" />} strong />
          <MetaItem label="Step function h" value={<InlineMath value="h" />} strong />
          <MetaItem label="Recursive variable" value={<span><InlineMath value="n" /> <span>(input slot {recursionIndex})</span></span>} />
          <MetaItem label="Carried inputs" value={carriedInputsText ? <InlineMath value={carriedInputsText} /> : "none"} />
          <MetaItem label="Output register" value={<InlineMath value="R0" />} />
          <MetaItem label="Current recursion stage" value={selectedStepLabel} />
        </div>
      </div>
      <div className="primitive-translation-section">
        <div className="primitive-translation-kicker">Program sections</div>
        <div className="primitive-translation-program-grid">
          <ProgramSection
            title="Base section"
            note={<span>Computes <InlineMath value="g" />, stores it as the current result, and initializes the loop counter.</span>}
            range={sections.base_complete}
          />
          <ProgramSection
            title="Loop test"
            note={<span>Checks whether the current counter has reached the recursion input <InlineMath value="n" />.</span>}
            range={sections.loop_test}
          />
          <ProgramSection
            title="Step section"
            note={<span>Loads <InlineMath value="(z,i)" />, together with the carried inputs, runs <InlineMath value="h" /> once, stores the new result, and increments the counter.</span>}
            range={sections.step_complete}
          />
          <ProgramSection
            title="Finalize"
            note={<span>Copies the accumulated result back into <InlineMath value="R0" />.</span>}
            range={sections.finalize}
          />
        </div>
      </div>
    </section>
  );
}
