import TraceTable from "./TraceTable.jsx";

function formatPreviousValueLabel(stepGroup) {
  if (stepGroup.stepIndex === 0) {
    return "Base case";
  }

  return stepGroup.previousValue === null || stepGroup.previousValue === undefined
    ? "Uses previous value"
    : `Uses previous = ${stepGroup.previousValue}`;
}

export default function PrimitiveTraceStrip({
  trace,
  stepGroups,
  selectedStepIndex = 0,
  currentTraceIndex = null,
  isPlaying = false,
}) {
  if (!Array.isArray(stepGroups) || stepGroups.length === 0) {
    return (
      <div className="machine-trace-empty-state">
        No primitive-recursion trace data.
      </div>
    );
  }

  return (
    <div className="machine-step-trace-shell">
      <div className="machine-step-trace-stack">
        {stepGroups.map((group) => {
          const rows = Array.isArray(group.rows)
            ? group.rows
            : trace.slice(group.startRowIndex, group.endRowIndex + 1);
          const isSelected = group.stepIndex === selectedStepIndex;
          const localCurrentTraceIndex =
            isSelected && currentTraceIndex !== null
              ? Math.max(0, currentTraceIndex - group.startRowIndex)
              : null;

          return (
            <section
              key={`primitive-step-${group.stepIndex}`}
              className={`machine-step-card${isSelected ? " machine-step-card-active" : ""}`}
              aria-label={`${group.label} summary`}
            >
              <div className="machine-step-card-header">
                <div className="machine-step-card-title">
                  {group.label}
                  {group.callText ? ` — ${group.callText}` : ""}
                </div>
                <div className="machine-step-card-kicker">
                  {formatPreviousValueLabel(group)}
                </div>
              </div>

              <div className="machine-step-summary-grid">
                <div className="machine-step-summary-item">
                  <div className="machine-step-summary-label">Call</div>
                  <div className="machine-step-summary-value">{group.callText ?? "—"}</div>
                </div>
                <div className="machine-step-summary-item">
                  <div className="machine-step-summary-label">Application</div>
                  <div className="machine-step-summary-value">{group.applicationText || "—"}</div>
                </div>
                <div className="machine-step-summary-item">
                  <div className="machine-step-summary-label">Result</div>
                  <div className="machine-step-summary-value machine-step-summary-value-strong">
                    {group.outputValue ?? "—"}
                  </div>
                </div>
              </div>

              <details className="machine-step-details">
                <summary className="machine-step-details-summary">Show URM trace for this step</summary>
                <div className="machine-step-details-body">
                  <TraceTable
                    trace={rows}
                    currentTraceIndex={localCurrentTraceIndex}
                    selectedStepIndex={null}
                    isPlaying={isPlaying && isSelected}
                    maxHeight={220}
                    compact
                    showStepGroups={false}
                  />
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}
