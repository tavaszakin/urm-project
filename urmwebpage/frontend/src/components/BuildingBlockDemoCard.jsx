import { useMemo, useState } from "react";
import ProgramListing from "./ProgramListing.jsx";
import TraceTable from "./TraceTable.jsx";
import { RADII, TYPOGRAPHY } from "../theme.js";

function getActiveInstructionIndex(stepIndex, trace) {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  if (stepIndex <= 0) return trace[1]?.instructionIndex ?? 0;
  return trace[stepIndex]?.instructionIndex ?? null;
}

export default function BuildingBlockDemoCard({
  title,
  meaning,
  program,
  trace,
  relevantRegisters,
  usedFor,
  note,
  showPc = false,
}) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const totalSteps = Math.max(0, trace.length - 1);
  const activeInstructionIndex = useMemo(
    () => getActiveInstructionIndex(currentStepIndex, trace),
    [currentStepIndex, trace],
  );

  return (
    <article className="learn-demo-card">
      <div className="learn-demo-header">
        <div className="learn-demo-header-copy">
          <h3 className="learn-demo-title">{title}</h3>
          <p className="learn-demo-meaning">{meaning}</p>
        </div>
        <div className="learn-demo-step-indicator">
          <span className="learn-demo-step-label">Step</span>
          <span className="learn-demo-step-value">
            {currentStepIndex} / {totalSteps}
          </span>
        </div>
      </div>

      <div className="learn-demo-grid">
        <section className="learn-demo-panel">
          <div className="learn-demo-label">Program</div>
          <div className="learn-demo-surface">
            <ProgramListing
              program={program}
              activeInstructionIndex={activeInstructionIndex}
              compact
              maxHeight={180}
            />
          </div>
        </section>

        <section className="learn-demo-panel">
          <div className="learn-demo-label">Trace</div>
          <div className="learn-demo-surface learn-demo-trace-surface">
            <TraceTable
              trace={trace}
              currentTraceIndex={currentStepIndex}
              registerIndices={relevantRegisters}
              showPc={showPc}
              maxHeight={180}
            />
          </div>
        </section>
      </div>

      <div className="learn-demo-controls">
        <button
          type="button"
          onClick={() => setCurrentStepIndex((index) => Math.min(totalSteps, index + 1))}
          disabled={currentStepIndex >= totalSteps}
          style={controlButtonStyle(currentStepIndex >= totalSteps)}
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => setCurrentStepIndex(0)}
          disabled={currentStepIndex === 0}
          style={secondaryControlButtonStyle(currentStepIndex === 0)}
        >
          Reset
        </button>
      </div>

      <div className="learn-demo-note">{note}</div>
      <div className="learn-demo-used-for">{usedFor}</div>
    </article>
  );
}

const baseButtonStyle = {
  ...TYPOGRAPHY.styles.control,
  height: 28,
  padding: "0 11px",
  borderRadius: RADII.button,
  cursor: "pointer",
  transition:
    "background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, opacity 0.18s ease, transform 0.18s ease",
};

function controlButtonStyle(disabled) {
  return {
    ...baseButtonStyle,
    border: "1px solid var(--app-button-dark)",
    background: disabled ? "color-mix(in srgb, var(--app-button-dark) 38%, transparent)" : "var(--app-button-dark)",
    color: "var(--app-button-dark-text)",
    opacity: disabled ? 0.68 : 1,
  };
}

function secondaryControlButtonStyle(disabled) {
  return {
    ...baseButtonStyle,
    border: "1px solid var(--app-button-ghost-border)",
    background: "var(--app-button-ghost-background)",
    color: disabled ? "var(--surface-text-muted)" : "var(--surface-text-structural)",
    opacity: disabled ? 0.7 : 1,
  };
}
