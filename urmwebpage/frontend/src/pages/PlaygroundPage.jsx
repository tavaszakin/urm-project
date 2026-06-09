import { useEffect, useMemo, useRef, useState } from "react";
import { FunctionCard } from "../components/FunctionCardLayout.jsx";
import FurtherReading from "../components/FurtherReading.jsx";
import KatexMath from "../components/KatexMath.jsx";
import MachinePlaybackControls from "../components/MachinePlaybackControls.jsx";
import ProgramListing from "../components/ProgramListing.jsx";
import { API_URL } from "../api.js";
import TraceTable from "../components/TraceTable.jsx";
import {
  PLAYGROUND_STARTER_PROGRAMS,
  createEditableStarterProgram,
} from "../utils/playgroundPresets.js";
import { getTracePlaybackTiming } from "../utils/tracePlayback.js";

const PLACEHOLDER_REGISTERS = [0, 0, 0, 0];
const DEFAULT_STARTER_PROGRAM_ID = PLAYGROUND_STARTER_PROGRAMS[0]?.id ?? "blank";
const PLAYGROUND_MAX_STEPS = 1000;
const INSTRUCTION_ARITY = {
  Z: 1,
  S: 1,
  T: 2,
  J: 3,
};

const INSTRUCTION_TOOLBOX_ITEMS = [
  {
    instruction: "Z(n)",
    parts: [
      { text: "set" },
      { math: "R_n" },
      { text: "to" },
      { math: "0" },
    ],
  },
  {
    instruction: "S(n)",
    parts: [
      { text: "add" },
      { math: "1" },
      { text: "to" },
      { math: "R_n" },
    ],
  },
  {
    instruction: "T(m,n)",
    parts: [
      { text: "copy" },
      { math: "R_m" },
      { text: "into" },
      { math: "R_n" },
    ],
  },
  {
    instruction: "J(m,n,q)",
    parts: [
      { text: "jump to" },
      { math: "I_q" },
      { text: "if" },
      { math: "R_m = R_n" },
    ],
  },
];

function validateEditableProgram(program) {
  if (!Array.isArray(program)) {
    return "Program must be a list of instructions.";
  }

  for (let index = 0; index < program.length; index += 1) {
    const instruction = program[index];
    const type = instruction?.type;
    const args = instruction?.args;
    const arity = INSTRUCTION_ARITY[type];

    if (!arity) {
      return `Instruction I${index} must use Z, S, T, or J.`;
    }

    if (!Array.isArray(args) || args.length !== arity) {
      return `Instruction I${index} has the wrong number of arguments for ${type}.`;
    }

    for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
      if (!Number.isInteger(args[argIndex]) || args[argIndex] < 0) {
        return `Instruction I${index} argument ${argIndex + 1} must be a nonnegative integer.`;
      }
    }

    if (type === "J") {
      const jumpTarget = args[2];

      if (jumpTarget < 0 || jumpTarget > program.length) {
        return `Instruction I${index} jump target must be between 0 and ${program.length}.`;
      }
    }
  }

  return "";
}

function validateInitialRegisters(initialRegisters) {
  if (!Array.isArray(initialRegisters)) {
    return "Initial registers must be a list of nonnegative integers.";
  }

  for (let index = 0; index < initialRegisters.length; index += 1) {
    const value = initialRegisters[index];

    if (!Number.isInteger(value) || value < 0) {
      return `Initial register R${index} must be a nonnegative integer.`;
    }
  }

  return "";
}

function toRunProgramPayload(program) {
  return program.map(({ type, args }) => [type, ...args]);
}

export default function PlaygroundPage() {
  const [selectedStarterId, setSelectedStarterId] = useState(DEFAULT_STARTER_PROGRAM_ID);
  const [program, setProgram] = useState(() => createEditableStarterProgram(DEFAULT_STARTER_PROGRAM_ID));
  const [initialRegisters, setInitialRegisters] = useState(PLACEHOLDER_REGISTERS);
  const [runData, setRunData] = useState(null);
  const [runError, setRunError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [playbackTraceIndex, setPlaybackTraceIndex] = useState(0);
  const [playbackIsPlaying, setPlaybackIsPlaying] = useState(false);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [slowPlaybackRequested, setSlowPlaybackRequested] = useState(false);
  const programRefs = useRef([]);
  const executionVersionRef = useRef(0);
  const activeTrace = Array.isArray(runData?.trace) ? runData.trace : [];
  const playbackLength = activeTrace.length;
  const maxTraceIndex = Math.max(0, playbackLength - 1);
  const playbackTiming = useMemo(
    () => getTracePlaybackTiming({ traceLength: playbackLength, slowPlaybackRequested }),
    [playbackLength, slowPlaybackRequested],
  );
  const activeTraceRow = hasPlaybackStarted
    ? activeTrace[playbackTraceIndex] ?? activeTrace[0] ?? null
    : null;
  const activeInstructionIndex = hasPlaybackStarted ? activeTraceRow?.instructionIndex ?? null : null;
  const outputIsFinal = runData?.status_summary?.output_is_final === true;
  const finalOutputValue = runData?.output_value ?? runData?.final_registers?.[0] ?? null;
  const showFinalOutput =
    playbackTraceIndex >= maxTraceIndex &&
    outputIsFinal &&
    finalOutputValue !== null;

  function resetExecutionState() {
    executionVersionRef.current += 1;
    setRunData(null);
    setRunError("");
    setIsRunning(false);
    setPlaybackIsPlaying(false);
    setPlaybackTraceIndex(0);
    setHasPlaybackStarted(false);
    setSlowPlaybackRequested(false);
  }

  useEffect(() => {
    if (activeInstructionIndex === null) return;

    const row = programRefs.current[activeInstructionIndex];
    const container = row?.closest(".program-listing");

    if (!row || !container) return;

    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeInstructionIndex]);

  useEffect(() => {
    if (!playbackIsPlaying) return undefined;

    if (playbackTraceIndex >= maxTraceIndex) {
      setPlaybackIsPlaying(false);
      return undefined;
    }

    if (playbackLength <= 1) return undefined;

    const timeoutId = window.setTimeout(() => {
      setPlaybackTraceIndex((index) => Math.min(index + 1, maxTraceIndex));
    }, playbackTiming.intervalMs);

    return () => window.clearTimeout(timeoutId);
  }, [maxTraceIndex, playbackIsPlaying, playbackLength, playbackTiming.intervalMs, playbackTraceIndex]);

  useEffect(() => {
    if (playbackTraceIndex <= maxTraceIndex) return;
    setPlaybackTraceIndex(maxTraceIndex);
  }, [maxTraceIndex, playbackTraceIndex]);

  function handlePrevStep() {
    setPlaybackIsPlaying(false);
    setPlaybackTraceIndex((index) => Math.max(0, index - 1));
  }

  function handleTogglePlayback() {
    if (playbackLength === 0) return;

    setHasPlaybackStarted(true);

    if (maxTraceIndex === 0) {
      setPlaybackTraceIndex(0);
      setPlaybackIsPlaying(false);
      return;
    }

    if (playbackTraceIndex >= maxTraceIndex) {
      setPlaybackTraceIndex(0);
      setPlaybackIsPlaying(true);
      return;
    }

    setPlaybackIsPlaying((current) => !current);
  }

  function handleNextStep() {
    if (playbackLength === 0) return;

    setHasPlaybackStarted(true);
    setPlaybackIsPlaying(false);
    setPlaybackTraceIndex((index) => Math.min(maxTraceIndex, index + 1));
  }

  function normalizeInstructionArgs(type, args = []) {
    const arity = INSTRUCTION_ARITY[type] ?? 1;

    return Array.from({ length: arity }, (_, index) => {
      const value = Number(args[index] ?? 0);
      return Number.isInteger(value) && value >= 0 ? value : 0;
    });
  }

  function handleInstructionTypeChange(index, type) {
    resetExecutionState();
    setProgram((currentProgram) =>
      currentProgram.map((instruction, instructionIndex) =>
        instructionIndex === index
          ? { type, args: normalizeInstructionArgs(type, instruction.args) }
          : instruction
      )
    );
  }

  function handleInstructionArgChange(index, argIndex, value) {
    const nextValue = Number(value);
    const safeValue = Number.isInteger(nextValue) && nextValue >= 0 ? nextValue : 0;

    resetExecutionState();
    setProgram((currentProgram) =>
      currentProgram.map((instruction, instructionIndex) =>
        instructionIndex === index
          ? {
              ...instruction,
              args: instruction.args.map((arg, currentArgIndex) =>
                currentArgIndex === argIndex ? safeValue : arg
              ),
            }
          : instruction
      )
    );
  }

  function handleAddInstruction() {
    resetExecutionState();
    setProgram((currentProgram) => [...currentProgram, { type: "S", args: [0] }]);
  }

  function handleStarterProgramChange(event) {
    const nextStarterId = event.target.value;

    setSelectedStarterId(nextStarterId);
    setProgram(createEditableStarterProgram(nextStarterId));
    resetExecutionState();
  }

  function handleInitialRegisterChange(index, value) {
    const nextValue = Number(value);
    const safeValue = Number.isInteger(nextValue) && nextValue >= 0 ? nextValue : 0;

    resetExecutionState();
    setInitialRegisters((currentRegisters) =>
      currentRegisters.map((registerValue, registerIndex) =>
        registerIndex === index ? safeValue : registerValue
      )
    );
  }

  async function handleRunProgram() {
    executionVersionRef.current += 1;
    const runVersion = executionVersionRef.current;
    const programValidationError = validateEditableProgram(program);
    const registerValidationError = validateInitialRegisters(initialRegisters);
    const validationError = programValidationError || registerValidationError;

    if (validationError) {
      setRunError(validationError);
      setRunData(null);
      setPlaybackIsPlaying(false);
      setPlaybackTraceIndex(0);
      setHasPlaybackStarted(false);
      setSlowPlaybackRequested(false);
      return;
    }

    setIsRunning(true);
    setRunError("");
    setPlaybackIsPlaying(false);
    setPlaybackTraceIndex(0);
    setHasPlaybackStarted(false);
    setSlowPlaybackRequested(false);

    try {
      const response = await fetch(`${API_URL}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          program: toRunProgramPayload(program),
          initial_registers: initialRegisters,
          max_steps: PLAYGROUND_MAX_STEPS,
        }),
      });

      const payload = await response.json();

      if (runVersion !== executionVersionRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(payload?.detail || payload?.message || `Request failed: ${response.status}`);
      }

      setRunData(payload);
      setRunError("");
      setPlaybackTraceIndex(0);
      setPlaybackIsPlaying(true);
      setHasPlaybackStarted(true);
    } catch (error) {
      if (runVersion !== executionVersionRef.current) {
        return;
      }

      setRunData(null);
      setRunError(error instanceof Error ? error.message : "Unable to run the URM program.");
      setPlaybackIsPlaying(false);
      setPlaybackTraceIndex(0);
      setHasPlaybackStarted(false);
    } finally {
      if (runVersion === executionVersionRef.current) {
        setIsRunning(false);
      }
    }
  }

  function renderEditableInstruction({ instruction, index }) {
    const type = instruction?.type ?? "S";
    const args = normalizeInstructionArgs(type, instruction?.args);

    return (
      <span className="playground-instruction-editor">
        <select
          className="playground-instruction-select"
          value={type}
          aria-label={`Instruction ${index} type`}
          onChange={(event) => handleInstructionTypeChange(index, event.target.value)}
        >
          <option value="Z">Z</option>
          <option value="S">S</option>
          <option value="T">T</option>
          <option value="J">J</option>
        </select>
        <span className="playground-instruction-paren">(</span>
        {args.map((arg, argIndex) => (
          <span className="playground-instruction-arg" key={argIndex}>
            {argIndex > 0 ? <span className="playground-instruction-comma">,</span> : null}
            <input
              className="playground-instruction-input"
              type="number"
              min="0"
              step="1"
              value={arg}
              aria-label={`Instruction ${index} argument ${argIndex + 1}`}
              onChange={(event) => handleInstructionArgChange(index, argIndex, event.target.value)}
            />
          </span>
        ))}
        <span className="playground-instruction-paren">)</span>
      </span>
    );
  }

  function renderInstructionToolbox() {
    return (
      <section className="playground-instruction-toolbox" aria-labelledby="instruction-toolbox-title">
        <div className="playground-instruction-toolbox-label" id="instruction-toolbox-title">
          Instruction toolbox
        </div>
        <div className="playground-instruction-toolbox-list">
          {INSTRUCTION_TOOLBOX_ITEMS.map((item) => (
            <div className="playground-instruction-toolbox-item" key={item.instruction}>
              <KatexMath
                className="playground-instruction-toolbox-op"
                expression={item.instruction}
              />
              <span className="playground-instruction-toolbox-definition">
                {item.parts.map((part, partIndex) =>
                  part.math ? (
                    <KatexMath expression={part.math} key={`${item.instruction}-${part.math}`} />
                  ) : (
                    <span key={`${item.instruction}-${partIndex}`}>{part.text}</span>
                  )
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="page-stack compute-page playground-page">
      <section className="page-intro page-intro-compact">
        <div className="page-intro-copy">
          <h2 className="page-title">Unlimited Register Machine Simulator</h2>
          <p className="page-copy">
            Build and run a URM program instruction by instruction.
          </p>
        </div>
      </section>

      <main className="playground-workspace" aria-label="URM playground workspace">
        <div className="playground-split-grid">
          <FunctionCard className="playground-split-card playground-trace-card">
            <div className="playground-card-header">
              <h3 className="playground-card-title">Computation Trace</h3>
              <div className="runner-playback-meta runner-playback-summary playground-trace-step-badge">
                TRACE STEP {playbackTraceIndex} / {maxTraceIndex}
              </div>
            </div>

            <div className="playground-registers-row">
              <div className="playground-registers-label">Initial registers</div>
              <div className="playground-registers-strip">
                {initialRegisters.map((value, index) => (
                  <label className="playground-register-control" key={index}>
                    <span className="playground-register-math">
                      <KatexMath expression={`R_{${index}}`} />
                    </span>
                    <span className="playground-register-equals">=</span>
                    <input
                      className="playground-register-input"
                      type="number"
                      min="0"
                      step="1"
                      value={value}
                      aria-label={`Initial register R${index}`}
                      onChange={(event) => handleInitialRegisterChange(index, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="playground-run-row">
              <button
                type="button"
                className="app-primary-button runner-run-button playground-run-button"
                onClick={handleRunProgram}
                disabled={isRunning}
              >
                {isRunning ? "Running..." : "Run"}
              </button>
              {runError ? (
                <div className="playground-run-message playground-run-error" role="alert">
                  {runError}
                </div>
              ) : isRunning ? (
                <div className="playground-run-message">Executing current program...</div>
              ) : null}
            </div>

            <MachinePlaybackControls
              disabled={isRunning || playbackLength === 0}
              isPlaying={playbackIsPlaying}
              currentIndex={playbackTraceIndex}
              maxIndex={maxTraceIndex}
              playbackLength={playbackLength}
              onPrev={handlePrevStep}
              onToggle={handleTogglePlayback}
              onNext={handleNextStep}
              onChange={(nextIndex) => {
                setHasPlaybackStarted(true);
                setPlaybackIsPlaying(false);
                setPlaybackTraceIndex(nextIndex);
              }}
              showSummary={false}
              showSlowDown={playbackTiming.isSlowDownControlAvailable}
              onSlowDown={() => setSlowPlaybackRequested(true)}
            />

            <div className="machine-panel-caption playground-card-caption">
              Current trace step in yellow. Changed registers in pink.
            </div>

            <div className="machine-trace-shell">
              <div className="machine-trace-table-shell">
                <TraceTable
                  trace={activeTrace}
                  currentTraceIndex={playbackTraceIndex}
                  hideStageColumns
                  isPlaying={playbackIsPlaying}
                  maxHeight={524}
                  showStepGroups={false}
                  progressiveReveal
                  outputIsFinal={outputIsFinal}
                  suppressActiveHighlight={!hasPlaybackStarted}
                  columnWidths={{ step: 34, register: 48 }}
                  bodyCellFontSize="0.9em"
                />
              </div>
            </div>

            {showFinalOutput ? (
              <div className="playground-final-output" aria-live="polite">
                <KatexMath expression={`\\text{Final output: } R_0 = ${finalOutputValue}`} />
              </div>
            ) : null}
          </FunctionCard>

          <FunctionCard className="playground-split-card playground-program-card">
            <div className="playground-card-header">
              <h3 className="playground-card-title">URM Program</h3>
              <div className="playground-card-actions">
                <button type="button" className="runner-add-register-button" onClick={handleAddInstruction}>
                  + Add instruction
                </button>
              </div>
            </div>

            <div className="playground-starter-control">
              <label className="playground-starter-label" htmlFor="playground-starter-program">
                Starter program
              </label>
              <select
                className="dashboard-control runner-toolbar-select playground-starter-select"
                id="playground-starter-program"
                value={selectedStarterId}
                onChange={handleStarterProgramChange}
              >
                {PLAYGROUND_STARTER_PROGRAMS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="machine-program-card machine-program-card-inline playground-program-table-card">
              <div className="machine-program-shell machine-program-inline-section playground-program-shell">
                <ProgramListing
                  program={program}
                  activeInstructionIndex={activeInstructionIndex}
                  maxHeight={420}
                  rowRefs={programRefs}
                  renderInstruction={renderEditableInstruction}
                  showHeader
                />
              </div>
            </div>

            {renderInstructionToolbox()}
          </FunctionCard>
        </div>
      </main>

      <FurtherReading items={["Cutland, Computability, §1.2"]} />
    </div>
  );
}
