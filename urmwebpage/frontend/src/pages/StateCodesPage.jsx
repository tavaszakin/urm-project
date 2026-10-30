import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FunctionCard,
  FunctionCardControls,
  FunctionCardLabel,
  FunctionCardMath,
  FunctionCardRow,
  FunctionCardRows,
} from "../components/FunctionCardLayout.jsx";
import FunctionRunner from "../components/FunctionRunner.jsx";
import FurtherReading from "../components/FurtherReading.jsx";
import { API_URL } from "../api.js";
import KatexMath from "../components/KatexMath.jsx";
import MachinePanel from "../components/MachinePanel.jsx";
import MachinePlaybackControls from "../components/MachinePlaybackControls.jsx";
import { FUNCTION_ORDER, getFunctionDisplayName } from "../functionMetadata.js";
import { getStateCodePresetById } from "../utils/stateCodePresets.js";
import { getTracePlaybackTiming } from "../utils/tracePlayback.js";
import { formatInstructionLatex } from "../utils/urmFormatting.js";

const STATE_CODES_TEMPLATE_FUNCTION_KIND = "template";
const STATE_CODES_TEMPLATE_PRESET = getStateCodePresetById("template");
const STATE_CODES_TEMPLATE_PROGRAM_LATEX = "e=\\#P=\\left\\langle \\#I_0,\\dots,\\#I_{s-1}\\right\\rangle";
const STATE_CODES_TEMPLATE_COMPUTATION_LATEX = "y=\\langle u_0,\\dots,u_k\\rangle";
const STATE_CODES_TEMPLATE_T_PREDICATE_LATEX = "T_n(e,\\vec{x},y)\\text{ holds}";
const STATE_CODES_TEMPLATE_OUTPUT_LATEX = "U(y)=\\text{final }R_0\\text{ value}";
const STATE_CODES_TEMPLATE_INPUT_TEXT = "Choose an example to instantiate the template.";
const STATE_CODES_FUNCTION_MODE_OPTIONS = [
  { value: STATE_CODES_TEMPLATE_FUNCTION_KIND, label: "Template" },
  ...FUNCTION_ORDER.map((kind) => ({ value: kind, label: getFunctionDisplayName(kind) })),
];

function mathFallback(expression) {
  return String(expression ?? "")
    .replaceAll("\\#", "#")
    .replace(/\\xrightarrow\{([^}]*)\}/g, "→ $1")
    .replaceAll("\\begin{aligned}", "")
    .replaceAll("\\end{aligned}", "")
    .replaceAll("\\\\", " ")
    .replaceAll("&", "")
    .replaceAll("\\left", "")
    .replaceAll("\\right", "")
    .replaceAll("\\langle", "<")
    .replaceAll("\\rangle", ">")
    .replaceAll("\\vec", "")
    .replaceAll("\\dots", "...")
    .replaceAll("\\ ", " ")
    .replaceAll("\\,", " ");
}

function StateCodesMathLine({ expression, tone = "default" }) {
  return (
    <div className={`state-codes-math-line state-codes-math-line-${tone}`}>
      <KatexMath expression={expression} displayMode fallback={mathFallback(expression)} />
    </div>
  );
}

function getChangedRegisters(previousRegisters, registers) {
  if (!Array.isArray(previousRegisters) || !Array.isArray(registers)) return [];

  return registers.reduce((changed, value, index) => {
    if (previousRegisters[index] !== value) {
      changed.push(index);
    }

    return changed;
  }, []);
}

function tupleLatex(values) {
  return `\\left\\langle ${values.join(",")} \\right\\rangle`;
}

function buildProgramLatex(program) {
  if (!Array.isArray(program)) {
    return "e=\\#P=\\left\\langle \\#I_0,\\dots,\\#I_{s-1}\\right\\rangle";
  }

  const finalInstructionIndex = Array.isArray(program) ? program.length - 1 : -1;

  if (finalInstructionIndex < 0) {
    return "e=\\#P=\\left\\langle \\right\\rangle";
  }

  return `e=\\#P=\\left\\langle \\#I_0,\\dots,\\#I_{${finalInstructionIndex}}\\right\\rangle`;
}

function buildInputLatex(inputs) {
  return `\\vec{x}=${tupleLatex(Array.isArray(inputs) ? inputs : [])}`;
}

function buildComputationCodeLatex(stateRows) {
  const finalStateIndex = Array.isArray(stateRows) ? stateRows.length - 1 : -1;

  if (finalStateIndex < 0) {
    return "y=\\left\\langle u_0,\\dots,u_n\\right\\rangle";
  }

  if (finalStateIndex <= 2) {
    const symbolicSequence = `\\left\\langle ${stateRows.map((row) => row.symbolLatex).join(",")}\\right\\rangle`;
    const expandedSequence = buildExpandedComputationTupleLatex(stateRows);

    return expandedSequence
      ? `y=${symbolicSequence}=${expandedSequence}`
      : `y=${symbolicSequence}`;
  }

  return `y=\\left\\langle u_0,u_1,\\dots,u_{${finalStateIndex - 1}},u_{${finalStateIndex}}\\right\\rangle`;
}

function buildExpandedComputationTupleLatex(stateRows) {
  if (!Array.isArray(stateRows) || stateRows.length === 0 || stateRows.length > 3) {
    return null;
  }

  return `\\left\\langle ${stateRows.map((row) => {
    const stateIndex = row.stateIndex ?? 0;
    const instructionCode = row.isHalting ? "0" : row.instructionCodeLatex;
    const registersLatex = row.registersLatex ?? tupleLatex([]);

    return `\\left\\langle ${stateIndex},${instructionCode},${registersLatex}\\right\\rangle`;
  }).join(",")} \\right\\rangle`;
}

function buildTPredicateProgramArgumentLatex(program) {
  if (!Array.isArray(program) || program.length === 0 || program.length > 2) {
    return "e";
  }

  return `\\left\\langle ${program.map((_, index) => `\\#I_{${index}}`).join(",")}\\right\\rangle`;
}

function buildStateRowsFromRunData(runData) {
  const program = Array.isArray(runData?.program) ? runData.program : [];
  const trace = Array.isArray(runData?.trace) ? runData.trace : [];

  return trace.map((traceRow, index) => {
    const registers = Array.isArray(traceRow?.registers) ? traceRow.registers : [];
    const stateIndex = Number.isInteger(traceRow?.pc) ? traceRow.pc : 0;
    const isHalting =
      traceRow?.halted === true ||
      (runData?.halted === true && index === trace.length - 1) ||
      stateIndex >= program.length;
    const instruction = isHalting ? null : program[stateIndex] ?? null;
    const instructionLatex = instruction ? formatInstructionLatex(instruction) : "\\mathrm{halt}";
    const instructionCodeLatex = isHalting ? "0" : `\\#I_{${stateIndex}}`;
    const registersLatex = tupleLatex(registers);

    return {
      id: `u${index}`,
      symbolLatex: `u_${index}`,
      stateIndex,
      nextInstructionLatex: instructionLatex,
      instructionCodeLatex,
      instructionIndex: isHalting ? null : stateIndex,
      registers,
      registersLatex,
      isHalting,
      note: isHalting ? "halting state" : traceRow?.note ?? "",
      latex: `u_${index}=\\left\\langle ${stateIndex},${instructionCodeLatex},${registersLatex}\\right\\rangle`,
    };
  });
}

function buildComputeTraceFromStateRows(stateRows) {
  return (Array.isArray(stateRows) ? stateRows : []).map((stateRow, index, rows) => {
    const registers = Array.isArray(stateRow.registers) ? stateRow.registers : [];
    const previousRegisters = index > 0 ? rows[index - 1]?.registers : null;

    return {
      globalStep: stateRow.stateIndex ?? index,
      step: stateRow.stateIndex ?? index,
      instructionIndex: stateRow.instructionIndex,
      registers,
      changedRegisters: getChangedRegisters(previousRegisters, registers),
    };
  });
}

function buildCurrentStateCodeExpression(stateRow, traceIndex) {
  if (!stateRow) return "";

  const stateCodeLabel = `u_{${traceIndex}}`;
  const nextInstructionIndex = stateRow.stateIndex ?? traceIndex;
  const instructionCode = stateRow.isHalting ? "0" : `\\#I_{${nextInstructionIndex}}`;
  const registers = Array.isArray(stateRow.registers) ? stateRow.registers : [];
  const registerTuple = `\\left\\langle ${registers.join(",")} \\right\\rangle`;

  return `${stateCodeLabel}=\\left\\langle ${nextInstructionIndex},${instructionCode},${registerTuple} \\right\\rangle`;
}

function CurrentStateCodePanel({ stateRow, traceIndex }) {
  const expression = buildCurrentStateCodeExpression(stateRow, traceIndex);

  if (!expression) return null;

  return (
    <div className="state-codes-current-state-code">
      <div className="state-codes-current-state-code-title">Current State Code</div>
      <StateCodesMathLine expression={expression} tone="result" />
    </div>
  );
}

function StateCodesTemplateSummaryRows() {
  return (
    <FunctionCardRows className="state-codes-unified-summary-rows state-codes-template-summary-rows">
      <FunctionCardRow>
        <FunctionCardLabel>Function</FunctionCardLabel>
        <FunctionCardMath className="state-codes-card-math state-codes-card-math-template">
          <KatexMath expression={STATE_CODES_TEMPLATE_PRESET.exampleLatex} />
        </FunctionCardMath>
        <FunctionCardControls />
      </FunctionCardRow>

      <FunctionCardRow>
        <FunctionCardLabel>Program</FunctionCardLabel>
        <FunctionCardMath className="state-codes-card-math state-codes-card-math-template">
          <KatexMath expression={STATE_CODES_TEMPLATE_PROGRAM_LATEX} />
        </FunctionCardMath>
        <FunctionCardControls />
      </FunctionCardRow>

      <FunctionCardRow>
        <FunctionCardLabel>Input</FunctionCardLabel>
        <FunctionCardMath className="state-codes-card-math state-codes-card-math-template">
          {STATE_CODES_TEMPLATE_INPUT_TEXT}
        </FunctionCardMath>
        <FunctionCardControls />
      </FunctionCardRow>
    </FunctionCardRows>
  );
}

function StateCodesTemplatePostRunSummary() {
  return (
    <FunctionCard className="state-codes-post-run-summary-card state-codes-template-post-run-summary-card">
      <FunctionCardRows>
        <FunctionCardRow>
          <FunctionCardLabel>Computation code</FunctionCardLabel>
          <FunctionCardMath className="state-codes-card-math state-codes-card-math-template">
            <KatexMath expression={STATE_CODES_TEMPLATE_COMPUTATION_LATEX} />
          </FunctionCardMath>
          <FunctionCardControls />
        </FunctionCardRow>

        <FunctionCardRow>
          <FunctionCardLabel>Valid halting run</FunctionCardLabel>
          <FunctionCardMath className="state-codes-card-math state-codes-card-math-template">
            <KatexMath expression={STATE_CODES_TEMPLATE_T_PREDICATE_LATEX} />
          </FunctionCardMath>
          <FunctionCardControls />
        </FunctionCardRow>

        <FunctionCardRow>
          <FunctionCardLabel>Output</FunctionCardLabel>
          <FunctionCardMath className="state-codes-card-math state-codes-card-math-template">
            <KatexMath expression={STATE_CODES_TEMPLATE_OUTPUT_LATEX} />
          </FunctionCardMath>
          <FunctionCardControls />
        </FunctionCardRow>
      </FunctionCardRows>
    </FunctionCard>
  );
}

function StateCodesConcreteSummaryRows({
  programLatex,
  inputLatex,
}) {
  return (
    <FunctionCardRows className="state-codes-unified-summary-rows">
      <FunctionCardRow>
        <FunctionCardLabel>Program</FunctionCardLabel>
        <FunctionCardMath className="state-codes-card-math">
          <KatexMath expression={programLatex} />
        </FunctionCardMath>
        <FunctionCardControls />
      </FunctionCardRow>

      <FunctionCardRow>
        <FunctionCardLabel>Input</FunctionCardLabel>
        <FunctionCardMath className="state-codes-card-math">
          <KatexMath expression={inputLatex} />
        </FunctionCardMath>
        <FunctionCardControls />
      </FunctionCardRow>
    </FunctionCardRows>
  );
}

function StateCodesPostRunSummary({
  computationCodeLatex,
  arityLabel,
  programArgumentLatex,
  inputTupleLatex,
  outputValue,
}) {
  return (
    <FunctionCard className="state-codes-post-run-summary-card">
      <FunctionCardRows>
        <FunctionCardRow>
          <FunctionCardLabel>Computation code</FunctionCardLabel>
          <FunctionCardMath className="state-codes-card-math">
            <KatexMath expression={computationCodeLatex} />
          </FunctionCardMath>
          <FunctionCardControls />
        </FunctionCardRow>

        <FunctionCardRow>
          <FunctionCardLabel>Valid halting run</FunctionCardLabel>
          <FunctionCardMath className="state-codes-card-math">
            <KatexMath expression={`T_${arityLabel}(${programArgumentLatex},${inputTupleLatex},y)\\text{ holds}`} />
          </FunctionCardMath>
          <FunctionCardControls />
        </FunctionCardRow>

        <FunctionCardRow>
          <FunctionCardLabel>Output</FunctionCardLabel>
          <FunctionCardMath className="state-codes-card-math">
            <KatexMath expression={`U(y)=${outputValue}`} />
          </FunctionCardMath>
          <FunctionCardControls />
        </FunctionCardRow>
      </FunctionCardRows>
    </FunctionCard>
  );
}

const stateCodesProgramPanelTitle = (
  <>
    Program <KatexMath expression="P" />
  </>
);

const stateCodesProgramPanelCaption = (
  <>
    Highlighted instruction: <KatexMath expression="I_t" />. Current state uses its code:{" "}
    <KatexMath expression="\\#I_t" />.
  </>
);

function renderStateCodesProgramIndex({ displayIndex }) {
  return (
    <KatexMath
      expression={`I_{${displayIndex}}`}
      style={{
        display: "inline-block",
        lineHeight: "inherit",
        fontSize: "0.95em",
        color: "inherit",
      }}
    />
  );
}

export default function StateCodesPage() {
  const [runData, setRunData] = useState(null);
  const [functionState, setFunctionState] = useState(null);
  const [compiledProgram, setCompiledProgram] = useState(null);
  const [currentTraceIndex, setCurrentTraceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [slowPlaybackRequested, setSlowPlaybackRequested] = useState(false);
  const handleRunDataChange = useCallback((nextRunData) => {
    setRunData(nextRunData);
    setCurrentTraceIndex(0);
    setIsPlaying(Boolean(nextRunData));
    setSlowPlaybackRequested(false);
  }, []);
  const handleFunctionStateChange = useCallback((nextState) => {
    setFunctionState((current) => {
      const currentKey = JSON.stringify({
        functionSpec: current?.functionSpec,
        visibleInputValues: current?.visibleInputValues,
      });
      const nextKey = JSON.stringify({
        functionSpec: nextState?.functionSpec,
        visibleInputValues: nextState?.visibleInputValues,
      });

      return currentKey === nextKey ? current : nextState;
    });
  }, []);
  const stateRows = useMemo(() => buildStateRowsFromRunData(runData), [runData]);
  const trace = useMemo(
    () => buildComputeTraceFromStateRows(stateRows),
    [stateRows],
  );
  const playbackLength = trace.length;
  const maxTraceIndex = Math.max(0, playbackLength - 1);
  const playbackTiming = useMemo(
    () => getTracePlaybackTiming({ traceLength: playbackLength, slowPlaybackRequested }),
    [playbackLength, slowPlaybackRequested],
  );
  const activeTraceRow = trace[currentTraceIndex] ?? trace[0] ?? null;
  const activeStateRow = stateRows[currentTraceIndex] ?? stateRows[0] ?? null;
  const functionSpec = runData?.function ?? functionState?.functionSpec ?? null;
  const selectedFunctionKind = functionState?.functionSpec?.kind ?? STATE_CODES_TEMPLATE_FUNCTION_KIND;
  const isTemplateMode = selectedFunctionKind === STATE_CODES_TEMPLATE_FUNCTION_KIND;
  const inputValues = runData?.initial_registers ?? functionState?.visibleInputValues ?? [];
  const program = Array.isArray(runData?.program) ? runData.program : [];
  const summaryProgram = Array.isArray(compiledProgram)
    ? compiledProgram
    : Array.isArray(runData?.program)
      ? runData.program
      : null;
  const programLatex = buildProgramLatex(isTemplateMode ? null : summaryProgram);
  const inputLatex = buildInputLatex(inputValues);
  const computationCodeLatex = runData ? buildComputationCodeLatex(stateRows) : null;
  const tPredicateProgramArgumentLatex = buildTPredicateProgramArgumentLatex(program);
  const inputTupleLatex = tupleLatex(inputValues);
  const outputIsFinal = runData?.status_summary?.output_is_final === true;
  const finalRegisters = trace[trace.length - 1]?.registers ?? [];
  const outputValue = finalRegisters[0] ?? runData?.output ?? 0;
  const arityLabel =
    functionState?.arityInfo?.status === "known" && Number.isInteger(functionState?.arityInfo?.arity)
      ? String(functionState.arityInfo.arity)
      : "n";
  const showPostRunSummary = Boolean(runData && outputIsFinal && computationCodeLatex && trace.length > 0);
  const functionSpecKey = JSON.stringify(functionState?.functionSpec ?? null);

  useEffect(() => {
    if (isTemplateMode || !functionState?.functionSpec) {
      setCompiledProgram(null);
      return undefined;
    }

    const controller = new AbortController();
    const functionSpecForCompile = functionState.functionSpec;

    setCompiledProgram(null);

    async function compileFunction() {
      try {
        const response = await fetch(`${API_URL}/compile-function`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(functionSpecForCompile),
          signal: controller.signal,
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.detail || "Failed to compile function.");
        }

        if (!controller.signal.aborted) {
          setCompiledProgram(Array.isArray(payload?.program) ? payload.program : []);
        }
      } catch {
        if (!controller.signal.aborted) {
          setCompiledProgram(null);
        }
      }
    }

    void compileFunction();

    return () => controller.abort();
  }, [functionSpecKey, functionState?.functionSpec, isTemplateMode]);

  const summaryContent = isTemplateMode ? (
    <StateCodesTemplateSummaryRows />
  ) : (
    <StateCodesConcreteSummaryRows
      programLatex={programLatex}
      inputLatex={inputLatex}
    />
  );

  useEffect(() => {
    if (!isPlaying || playbackLength === 0 || currentTraceIndex >= playbackLength - 1) return;

    const timer = setTimeout(() => {
      setCurrentTraceIndex((index) => {
        const nextIndex = Math.min(playbackLength - 1, index + 1);

        if (nextIndex >= playbackLength - 1) {
          setIsPlaying(false);
        }

        return nextIndex;
      });
    }, playbackTiming.intervalMs);

    return () => clearTimeout(timer);
  }, [currentTraceIndex, isPlaying, playbackLength, playbackTiming.intervalMs]);

  function handleTogglePlayback() {
    if (playbackLength === 0) return;

    if (currentTraceIndex >= playbackLength - 1) {
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
    setCurrentTraceIndex((index) => Math.min(playbackLength - 1, index + 1));
  }

  return (
    <div className="page-stack compute-page state-codes-page">
      <section className="page-intro page-intro-compact">
        <div className="page-intro-copy">
          <h2 className="page-title">State and Computation Codes</h2>
          <p className="page-copy">
            Encode URM machine states and full computation histories as natural numbers.
          </p>
        </div>
      </section>

      <main className="state-codes-workspace">
        <FunctionRunner
          initialFunctionSpec={{ kind: STATE_CODES_TEMPLATE_FUNCTION_KIND }}
          hideMachinePanel
          onRunDataChange={handleRunDataChange}
          onFunctionStateChange={handleFunctionStateChange}
          functionExecutionMode="flat"
          functionModeOptions={STATE_CODES_FUNCTION_MODE_OPTIONS}
          templateFunctionKind={STATE_CODES_TEMPLATE_FUNCTION_KIND}
          summaryContent={summaryContent}
        />

        {isTemplateMode ? (
          <StateCodesTemplatePostRunSummary />
        ) : !runData ? (
          <div className="state-codes-template-prompt">
            Run the program above to generate its state-code trace.
          </div>
        ) : (
          <>
            <MachinePanel
              title={`Function: ${getFunctionDisplayName(functionSpec)}`}
              program={program}
              row={activeTraceRow}
              finalRegisters={finalRegisters}
              trace={trace}
              currentTraceIndex={currentTraceIndex}
              hideStageColumns
              isPlaying={isPlaying}
              programPanelTitle={stateCodesProgramPanelTitle}
              tracePanelCaption=""
              programPanelCaption={stateCodesProgramPanelCaption}
              renderProgramIndex={renderStateCodesProgramIndex}
              traceShowStepGroups={false}
              outputIsFinal={outputIsFinal}
              traceIndexValueFormatter={(_, rowIndex) => `u_{${rowIndex}}`}
              statusPanelFooter={(
                <CurrentStateCodePanel stateRow={activeStateRow} traceIndex={currentTraceIndex} />
              )}
              playbackControls={(
                <MachinePlaybackControls
                  isPlaying={isPlaying}
                  currentIndex={currentTraceIndex}
                  maxIndex={maxTraceIndex}
                  playbackLength={playbackLength}
                  onPrev={handlePrevStep}
                  onToggle={handleTogglePlayback}
                  onNext={handleNextStep}
                  onChange={(nextIndex) => {
                    setIsPlaying(false);
                    setCurrentTraceIndex(nextIndex);
                  }}
                  showSlowDown={playbackTiming.isSlowDownControlAvailable}
                  onSlowDown={() => setSlowPlaybackRequested(true)}
                />
              )}
            />

            {showPostRunSummary ? (
              <StateCodesPostRunSummary
                computationCodeLatex={computationCodeLatex}
                arityLabel={arityLabel}
                programArgumentLatex={tPredicateProgramArgumentLatex}
                inputTupleLatex={inputTupleLatex}
                outputValue={outputValue}
              />
            ) : null}
          </>
        )}
      </main>

      <FurtherReading items={["Cutland, Computability, §§4.2, 5.1"]} />
    </div>
  );
}
