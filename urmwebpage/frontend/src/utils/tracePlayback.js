export const DEFAULT_PLAYBACK_INTERVAL_MS = 680;
export const MIN_ADAPTIVE_PLAYBACK_INTERVAL_MS = 70;
export const PLAYBACK_ACCELERATION_START_TRACE_LENGTH = 22;
export const PLAYBACK_ACCELERATION_MAX_TRACE_LENGTH = 260;
export const PLAYBACK_ACCELERATION_CURVE_EXPONENT = 0.66;
export const SLOW_DOWN_CONTROL_INTERVAL_THRESHOLD_MS = 590;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function getTracePlaybackTiming({
  traceLength,
  slowPlaybackRequested = false,
} = {}) {
  const safeTraceLength = Number.isFinite(traceLength) ? Math.max(0, traceLength) : 0;
  const baseSpeedScale =
    safeTraceLength <= PLAYBACK_ACCELERATION_START_TRACE_LENGTH
      ? 0
      : safeTraceLength >= PLAYBACK_ACCELERATION_MAX_TRACE_LENGTH
      ? 1
      : smoothstep(
          (safeTraceLength - PLAYBACK_ACCELERATION_START_TRACE_LENGTH) /
            (PLAYBACK_ACCELERATION_MAX_TRACE_LENGTH - PLAYBACK_ACCELERATION_START_TRACE_LENGTH),
        );
  const speedScale =
    baseSpeedScale <= 0
      ? 0
      : Math.pow(baseSpeedScale, PLAYBACK_ACCELERATION_CURVE_EXPONENT);
  const adaptiveIntervalMs = Math.round(
    DEFAULT_PLAYBACK_INTERVAL_MS -
      speedScale * (DEFAULT_PLAYBACK_INTERVAL_MS - MIN_ADAPTIVE_PLAYBACK_INTERVAL_MS),
  );
  const isAdaptiveSpeedUpAvailable = adaptiveIntervalMs < DEFAULT_PLAYBACK_INTERVAL_MS;
  const isAdaptiveSpeedUpActive = isAdaptiveSpeedUpAvailable && !slowPlaybackRequested;
  const isSlowDownControlAvailable =
    adaptiveIntervalMs <= SLOW_DOWN_CONTROL_INTERVAL_THRESHOLD_MS && !slowPlaybackRequested;

  return {
    intervalMs: isAdaptiveSpeedUpActive ? adaptiveIntervalMs : DEFAULT_PLAYBACK_INTERVAL_MS,
    adaptiveIntervalMs,
    defaultIntervalMs: DEFAULT_PLAYBACK_INTERVAL_MS,
    isAdaptiveSpeedUpActive,
    isAdaptiveSpeedUpAvailable,
    isSlowDownControlAvailable,
    speedScale,
  };
}
