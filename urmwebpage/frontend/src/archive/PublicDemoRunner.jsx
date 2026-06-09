import { useEffect, useMemo, useRef, useState } from "react";
import ProgramListing from "./ProgramListing.jsx";
import TraceTable from "./TraceTable.jsx";
import FunctionDefinitionPreview from "./FunctionDefinitionPreview.jsx";
import { DEMO_EXPLANATION, DEMO_FUNCTION_SPEC, DEMO_INPUTS } from "../demoDefaults.js";
import { getFunctionDisplayName } from "../functionMetadata.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const PLAYBACK_INTERVAL_MS = 800;

function resizeInputs(values, count) {
  return Array.from({ length: count }, (_, index) => Number(values[index] ?? 0));
}

export default function PublicDemoRunner() {
  const [inputValues, setInputValues] = useState(() => [...DEMO_INPUTS]);
  const [runData, setRunData] = useState(null);
  const [currentTraceIndex, setCurrentTraceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const hasAutoLoadedRef = useRef(false);
  const programRowRefs = useRef([]);

  async function runDemo(nextInputValues = inputValues) {
    const normalizedInputs = resizeInputs(nextInputValues, DEMO_INPUTS.length);

    try {
      setIsLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/run-function`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          function: DEMO_FUNCTION_SPEC,
          initial_registers: normalizedInputs,
        }),
      });

      if (!response.ok) {
        let detail = "";

        try {
          const failure = await response.json();
          detail = failure?.detail ?? failure?.message ?? "";
        } catch {
          detail = "";
        }

        throw new Error(detail || `Request failed: ${response.status}`);
      }

      const json = await response.json();
      setInputValues(normalizedInputs);
      setRunData(json);
      setCurrentTraceIndex(0);
      setIsPlaying(false);
    } catch (err) {
      setError(err.message || "Unable to load the demo right now.");
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (hasAutoLoadedRef.current) return;
    hasAutoLoadedRef.current = true;
    void runDemo(DEMO_INPUTS);
  }, []);

  const trace = runData?.trace ?? [];
  const traceLength = trace.length;
  const maxTraceIndex = Math.max(0, traceLength - 1);
  const currentRow = trace[currentTraceIndex] ?? null;
  const currentRegisters = currentRow?.registers ?? runData?.final_registers ?? [];
  const changedRegisters = currentRow?.changedRegisters ?? [];
  const resultValue = runData?.final_registers?.[0] ?? "—";
  const playbackProgressPercent =
    maxTraceIndex === 0 ? 0 : Math.round((currentTraceIndex / maxTraceIndex) * 100);

  useEffect(() => {
    if (!isPlaying || traceLength === 0) return;

    if (currentTraceIndex >= traceLength - 1) {
      setIsPlaying(false);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentTraceIndex((index) => index + 1);
    }, PLAYBACK_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [currentTraceIndex, isPlaying, traceLength]);

  useEffect(() => {
    if (!currentRow) return;
    programRowRefs.current[currentRow.instructionIndex]?.scrollIntoView({ block: "nearest" });
  }, [currentRow]);

  const traceSummary = useMemo(
    () => [
      { label: "Function", value: getFunctionDisplayName(DEMO_FUNCTION_SPEC) },
      { label: "Inputs", value: inputValues.join(", ") },
      { label: "Result", value: String(resultValue) },
    ],
    [inputValues, resultValue],
  );

  function handleInputChange(index, rawValue) {
    setInputValues((current) =>
      current.map((value, valueIndex) =>
        valueIndex === index ? (rawValue === "" ? 0 : Number(rawValue)) : value,
      ),
    );
  }

  function handleReset() {
    void runDemo(DEMO_INPUTS);
  }

  function handleTogglePlayback() {
    if (traceLength === 0) return;

    if (currentTraceIndex >= traceLength - 1) {
      setCurrentTraceIndex(0);
      setIsPlaying(true);
      return;
    }

    setIsPlaying((current) => !current);
  }

  function handlePrevStep() {
    setIsPlaying(false);
    setCurrentTraceIndex((index) => Math.max(0, index - 1));
  }

  function handleNextStep() {
    setIsPlaying(false);
    setCurrentTraceIndex((index) => Math.min(traceLength - 1, index + 1));
  }

  return (
    <section className="demo-main" aria-labelledby="demo-title">
      <div className="demo-topbar">
        <div className="demo-summary">
          {traceSummary.map((item) => (
            <div key={item.label} className="demo-summary-item">
              <span className="demo-summary-label">{item.label}</span>
              <span className="demo-summary-value math-inline">{item.value}</span>
            </div>
          ))}
        </div>

        <div className="demo-inputs">
          <label className="demo-input-field">
            <span className="demo-input-label math-inline">x</span>
            <input
              type="number"
              value={inputValues[0] ?? 0}
              onChange={(event) => handleInputChange(0, event.target.value)}
              className="demo-number-input"
            />
          </label>
          <label className="demo-input-field">
            <span className="demo-input-label math-inline">y</span>
            <input
              type="number"
              value={inputValues[1] ?? 0}
              onChange={(event) => handleInputChange(1, event.target.value)}
              className="demo-number-input"
            />
          </label>
          <button type="button" onClick={() => runDemo()} className="app-primary-button demo-primary-button" disabled={isLoading}>
            {isLoading ? "Running..." : "Run"}
          </button>
          <button type="button" onClick={handleReset} className="demo-secondary-button" disabled={isLoading}>
            Reset
          </button>
        </div>
      </div>

      {error ? <div className="demo-error">{error}</div> : null}

      <FunctionDefinitionPreview
        functionSpec={DEMO_FUNCTION_SPEC}
        arityInfo={{ status: "known", arity: DEMO_INPUTS.length }}
        inputValues={inputValues}
        title="Function meaning"
      />

      <div className="demo-machine-theme demo-surface">
        <div className="demo-playback-bar">
          <div className="demo-playback-copy">
            <div className="demo-section-kicker">Step Through Execution</div>
            <div className="demo-step-pill">
              {traceLength > 0 ? `Step ${currentTraceIndex} of ${maxTraceIndex}` : "Waiting for trace"}
            </div>
          </div>

          <div className="demo-playback-controls">
            <button type="button" onClick={handlePrevStep} className="demo-control-button" disabled={currentTraceIndex === 0}>
              Prev
            </button>
            <button type="button" onClick={handleTogglePlayback} className="demo-control-button" disabled={traceLength === 0}>
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={handleNextStep}
              className="demo-control-button"
              disabled={traceLength === 0 || currentTraceIndex >= traceLength - 1}
            >
              Next
            </button>
          </div>

          <div className="demo-slider-row">
            <input
              type="range"
              min="0"
              max={maxTraceIndex}
              value={Math.min(currentTraceIndex, maxTraceIndex)}
              onChange={(event) => {
                setIsPlaying(false);
                setCurrentTraceIndex(Number(event.target.value));
              }}
              className="demo-slider"
              style={{
                "--playback-progress": `${playbackProgressPercent}%`,
                "--slider-track": "var(--demo-border)",
                "--slider-active": "var(--demo-slider-active)",
                "--slider-thumb": "var(--demo-primary)",
                "--slider-thumb-shadow": "none",
              }}
              disabled={traceLength === 0}
              aria-label="Trace step"
            />
            <div className="demo-slider-meta">{currentTraceIndex} / {maxTraceIndex}</div>
          </div>
        </div>

        <div className="demo-visual-grid">
          <div className="demo-trace-panel">
            <div className="demo-panel-header">
              <div className="demo-panel-title">Computation Trace</div>
              <div className="demo-panel-caption">Current step in yellow. Changed registers in pink.</div>
            </div>
            <div className="demo-trace-shell">
              <TraceTable
                trace={trace}
                currentTraceIndex={currentTraceIndex}
                isPlaying={isPlaying}
                maxHeight={560}
              />
            </div>
          </div>

          <aside className="demo-status-panel">
            <div className="demo-panel-header">
              <div className="demo-panel-title">URM Program</div>
              <div className="demo-panel-caption">
                The active instruction stays highlighted and in view during playback.
              </div>
            </div>

            <div className="demo-program-shell demo-machine-theme">
              <ProgramListing
                program={runData?.program ?? []}
                activeInstructionIndex={currentRow?.instructionIndex ?? null}
                maxHeight={420}
                rowRefs={programRowRefs}
              />
            </div>

            <div className="demo-status-block">
              <div className="demo-status-label">Registers</div>
              <div className="demo-register-list">
                {currentRegisters.map((value, index) => {
                  const isChanged = changedRegisters.includes(index);

                  return (
                    <div
                      key={index}
                      className={`demo-register-row${isChanged ? " is-changed" : ""}`}
                    >
                      <span className="demo-register-name">R{index}</span>
                      <span className="demo-register-value">{value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className="demo-details-stack">
        <details className="demo-details">
          <summary className="demo-details-summary">Show explanation</summary>
          <div className="demo-details-body">
            {DEMO_EXPLANATION.map((line) => (
              <p key={line} className="demo-details-copy">{line}</p>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
