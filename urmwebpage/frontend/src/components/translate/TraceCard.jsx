import TraceTable from "../TraceTable.jsx";

export default function TraceCard({
  trace,
  currentStepIndex,
  maxStepIndex,
  onPrev,
  onNext,
  onReset,
  onSlider,
}) {
  return (
    <section className="translate-card translate-card-trace">
      <div className="translate-card-header">
        <div>
          <div className="translate-card-kicker">Section C</div>
          <h3 className="translate-card-title">Trace</h3>
        </div>
      </div>

      <div className="translate-trace-toolbar">
        <button
          type="button"
          className="compare-controls-button"
          onClick={onPrev}
          disabled={currentStepIndex === 0}
        >
          Prev
        </button>
        <input
          className="compare-controls-slider"
          type="range"
          min="0"
          max={maxStepIndex}
          value={currentStepIndex}
          onChange={(event) => onSlider(Number(event.target.value))}
        />
        <button
          type="button"
          className="compare-controls-button"
          onClick={onNext}
          disabled={currentStepIndex >= maxStepIndex}
        >
          Next
        </button>
        <button
          type="button"
          className="compare-controls-button"
          onClick={onReset}
          disabled={currentStepIndex === 0}
        >
          Reset
        </button>
        <div className="compare-controls-meta">
          Step: {currentStepIndex} / {maxStepIndex}
        </div>
      </div>

      <div className="translate-surface translate-trace-surface">
        <TraceTable
          trace={trace}
          currentTraceIndex={currentStepIndex}
          registerIndices={[1, 2, 3, 4]}
          maxHeight={320}
        />
      </div>
    </section>
  );
}
