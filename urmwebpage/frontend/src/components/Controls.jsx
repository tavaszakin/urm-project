export default function Controls({
  alignmentIndex,
  alignmentLength,
  onPrev,
  onNext,
  onSlider,
}) {
  return (
    <div className="compare-controls">
      <button className="compare-controls-button" onClick={onPrev} disabled={alignmentIndex === 0}>
        Prev
      </button>

      <input
        className="compare-controls-slider"
        type="range"
        min="0"
        max={Math.max(0, alignmentLength - 1)}
        value={alignmentIndex}
        onChange={(e) => onSlider(Number(e.target.value))}
      />

      <button
        className="compare-controls-button"
        onClick={onNext}
        disabled={alignmentIndex >= alignmentLength - 1}
      >
        Next
      </button>

      <div className="compare-controls-meta">
        Alignment step: {alignmentIndex} / {Math.max(0, alignmentLength - 1)}
      </div>
    </div>
  );
}
