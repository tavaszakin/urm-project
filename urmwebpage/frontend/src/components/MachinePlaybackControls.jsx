import { TYPOGRAPHY } from "../theme.js";

const playbackSliderStyle = {
  margin: 0,
  width: "100%",
  verticalAlign: "middle",
  minWidth: 0,
  maxWidth: 160,
};

const playbackStepLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  fontSize: TYPOGRAPHY.sizes.sm,
  color: "var(--surface-text-primary)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

export default function MachinePlaybackControls({
  disabled = false,
  isPlaying = false,
  currentIndex = 0,
  maxIndex = 0,
  playbackLength = 0,
  onPrev,
  onToggle,
  onNext,
  onChange,
  showSummary = true,
  showSlowDown = false,
  onSlowDown = null,
}) {
  const safeMaxIndex = Math.max(0, maxIndex);
  const safeCurrentIndex = Math.min(Math.max(0, currentIndex), safeMaxIndex);
  const playbackProgressPercent =
    safeMaxIndex === 0 ? 0 : Math.round((safeCurrentIndex / safeMaxIndex) * 100);

  return (
    <div
      className={`runner-playback-bar${disabled ? " runner-playback-bar-disabled" : ""}`}
      aria-disabled={disabled}
    >
      <div className="runner-playback-actions transport-group">
        <button
          type="button"
          onClick={onPrev}
          disabled={disabled || safeCurrentIndex === 0}
          className="transport-btn"
        >
          Prev
        </button>

        <button
          type="button"
          onClick={onToggle}
          disabled={disabled || playbackLength === 0}
          className="transport-btn"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={disabled || safeCurrentIndex >= safeMaxIndex}
          className="transport-btn"
        >
          Next
        </button>
        {showSlowDown ? (
          <button
            type="button"
            onClick={onSlowDown}
            disabled={disabled}
            className="transport-btn runner-playback-slowdown"
          >
            Slow down
          </button>
        ) : null}
      </div>
      <div className="runner-playback-slider-shell">
        <input
          type="range"
          min="0"
          max={safeMaxIndex}
          value={safeCurrentIndex}
          disabled={disabled}
          onChange={(event) => onChange?.(Number(event.target.value))}
          className="runner-playback-slider"
          style={{
            ...playbackSliderStyle,
            "--playback-progress": `${playbackProgressPercent}%`,
            "--slider-track": "var(--theme-slider-track)",
            "--slider-active": "var(--theme-slider-active)",
            "--slider-thumb": "var(--theme-slider-thumb)",
            "--slider-thumb-shadow": "var(--theme-slider-thumb-shadow)",
          }}
        />
      </div>
      {showSummary ? (
        <div
          className="runner-playback-meta runner-playback-summary"
          style={playbackStepLabelStyle}
        >
          <span className="runner-playback-summary-step">Trace step {safeCurrentIndex} / {safeMaxIndex}</span>
        </div>
      ) : null}
    </div>
  );
}
