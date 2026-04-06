import { useMemo, useState } from "react";
import FunctionSummaryCard from "../components/translate/FunctionSummaryCard.jsx";
import ProgramCard from "../components/translate/ProgramCard.jsx";
import TraceCard from "../components/translate/TraceCard.jsx";
import { buildLearnDemoTrace } from "../utils/learnDemos.js";

// Deprecated page: kept for direct-route access and possible reuse.
// The Demo page is now the preferred execution visualization.

const ADDITION_PROGRAM = [
  ["T", 1, 3],
  ["Z", 4],
  ["J", 4, 2, 6],
  ["S", 3],
  ["S", 4],
  ["J", 0, 0, 2],
];

function getActiveInstructionIndex(stepIndex, trace) {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  if (stepIndex <= 0) return trace[1]?.instructionIndex ?? 0;
  return trace[stepIndex]?.instructionIndex ?? null;
}

function coerceInputValue(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, parsed);
}

export default function TranslatePage() {
  const [x, setX] = useState(2);
  const [y, setY] = useState(3);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const maxTraceSteps = Math.max(24, y * 3 + 6);

  const trace = useMemo(
    () => buildLearnDemoTrace(ADDITION_PROGRAM, [0, x, y, 0, 0], maxTraceSteps),
    [maxTraceSteps, x, y],
  );
  const result = x + y;
  const maxStepIndex = Math.max(0, trace.length - 1);
  const activeInstructionIndex = useMemo(
    () => getActiveInstructionIndex(currentStepIndex, trace),
    [currentStepIndex, trace],
  );

  function updateX(nextValue) {
    setX(coerceInputValue(nextValue));
    setCurrentStepIndex(0);
  }

  function updateY(nextValue) {
    setY(coerceInputValue(nextValue));
    setCurrentStepIndex(0);
  }

  return (
    <div className="page-stack translate-page">
      <section className="page-intro">
        <div>
          <h2 className="page-title">Translating Functions to URM</h2>
          <p className="page-copy">function → URM program → execution trace</p>
        </div>
      </section>

      <section className="translate-input-strip">
        <label className="translate-input-field">
          <span className="translate-input-label">x</span>
          <input
            type="number"
            min="0"
            value={x}
            onChange={(event) => updateX(event.target.value)}
            className="translate-number-input"
          />
        </label>
        <label className="translate-input-field">
          <span className="translate-input-label">y</span>
          <input
            type="number"
            min="0"
            value={y}
            onChange={(event) => updateY(event.target.value)}
            className="translate-number-input"
          />
        </label>
      </section>

      <FunctionSummaryCard x={x} y={y} result={result} />
      <div className="translate-machine-row">
        <ProgramCard program={ADDITION_PROGRAM} activeInstructionIndex={activeInstructionIndex} />
        <TraceCard
          trace={trace}
          currentStepIndex={currentStepIndex}
          maxStepIndex={maxStepIndex}
          onPrev={() => setCurrentStepIndex((index) => Math.max(0, index - 1))}
          onNext={() => setCurrentStepIndex((index) => Math.min(maxStepIndex, index + 1))}
          onReset={() => setCurrentStepIndex(0)}
          onSlider={setCurrentStepIndex}
        />
      </div>
    </div>
  );
}
