import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../api.js";
import {
  FunctionCard,
  FunctionCardControls,
  FunctionCardLabel,
  FunctionCardMath,
  FunctionCardRow,
  FunctionCardRows,
} from "../components/FunctionCardLayout.jsx";
import FurtherReading from "../components/FurtherReading.jsx";
import KatexMath from "../components/KatexMath.jsx";
import MachinePlaybackControls from "../components/MachinePlaybackControls.jsx";
import MachinePanel from "../components/MachinePanel.jsx";
import { getAdaptiveTracePresentation } from "../components/TraceTable.jsx";
import { RADII, TYPOGRAPHY } from "../theme.js";
import { encodeTuple, estimateTupleDecimalDigits } from "../utils/sequenceEncoding.js";

const DISPLAY_CODE_DIGIT_LIMIT = 48;
const PLAYBACK_INTERVAL_MS = 800;
const MANY_PROGRAMS_TRACE_SIZING_FLOOR = {
  traceLength: 180,
  registerColumnCount: 8,
};

const EQUIVALENCE_EXAMPLES = [
  {
    id: "addition",
    label: "Addition",
    arity: 2,
    functionLatex: "f(x,y)=x+y",
    inputValues: [2, 3],
    outputValue: 5,
    reference: {
      id: "addition-P_0",
      codeId: "e_0",
      label: "P_0",
      description: "Adds the second input into the output register.",
      program: [
        ["Z", 2],
        ["J", 2, 1, 5],
        ["S", 0],
        ["S", 2],
        ["J", 0, 0, 1],
      ],
    },
    alternatives: [
      {
        id: "addition-P_1",
        codeId: "e_1",
        label: "P_1",
        description: "Rebuilds the output through two loops.",
        program: [
          ["T", 0, 2],
          ["Z", 0],
          ["Z", 3],
          ["J", 3, 2, 7],
          ["S", 0],
          ["S", 3],
          ["J", 0, 0, 3],
          ["Z", 3],
          ["J", 3, 1, 12],
          ["S", 0],
          ["S", 3],
          ["J", 0, 0, 8],
        ],
      },
      {
        id: "addition-P_2",
        codeId: "e_2",
        label: "P_2",
        description: "Pads the reference loop with scratch-register setup.",
        program: [
          ["Z", 3],
          ["Z", 2],
          ["J", 2, 1, 6],
          ["S", 0],
          ["S", 2],
          ["J", 0, 0, 2],
        ],
      },
      {
        id: "addition-P_3",
        codeId: "e_3",
        label: "P_3",
        description: "Pads the reference loop with a harmless self-copy.",
        program: [
          ["T", 0, 0],
          ["Z", 2],
          ["J", 2, 1, 6],
          ["S", 0],
          ["S", 2],
          ["J", 0, 0, 2],
        ],
      },
    ],
  },
  {
    id: "successor",
    label: "Successor",
    arity: 1,
    functionLatex: "f(x)=x+1",
    inputValues: [3],
    outputValue: 4,
    reference: {
      id: "successor-P_0",
      codeId: "e_0",
      label: "P_0",
      description: "Applies successor directly to the output register.",
      program: [["S", 0]],
    },
    alternatives: [
      {
        id: "successor-P_1",
        codeId: "e_1",
        label: "P_1",
        description: "Takes a harmless jump before applying successor.",
        program: [
          ["J", 0, 0, 1],
          ["S", 0],
        ],
      },
      {
        id: "successor-P_2",
        codeId: "e_2",
        label: "P_2",
        description: "Copies the output register to itself before successor.",
        program: [
          ["T", 0, 0],
          ["S", 0],
        ],
      },
      {
        id: "successor-P_3",
        codeId: "e_3",
        label: "P_3",
        description: "Clears a scratch register before successor.",
        program: [
          ["Z", 1],
          ["S", 0],
        ],
      },
    ],
  },
  {
    id: "identity",
    label: "Identity",
    arity: 1,
    functionLatex: "f(x)=x",
    inputValues: [3],
    outputValue: 3,
    reference: {
      id: "identity-P_0",
      codeId: "e_0",
      label: "P_0",
      description: "Copies the output register to itself.",
      program: [["T", 0, 0]],
    },
    alternatives: [
      {
        id: "identity-P_1",
        codeId: "e_1",
        label: "P_1",
        description: "Takes a harmless jump before the no-op copy.",
        program: [
          ["J", 0, 0, 1],
          ["T", 0, 0],
        ],
      },
      {
        id: "identity-P_2",
        codeId: "e_2",
        label: "P_2",
        description: "Clears a scratch register before the no-op copy.",
        program: [
          ["Z", 1],
          ["T", 0, 0],
        ],
      },
      {
        id: "identity-P_3",
        codeId: "e_3",
        label: "P_3",
        description: "Changes then clears a scratch register before the no-op copy.",
        program: [
          ["S", 1],
          ["Z", 1],
          ["T", 0, 0],
        ],
      },
    ],
  },
];

function instructionToTuple(instruction) {
  const opcode = instruction?.[0];

  if (opcode === "Z") return [0, Number(instruction[1])];
  if (opcode === "S") return [1, Number(instruction[1])];
  if (opcode === "T") return [2, Number(instruction[1]), Number(instruction[2])];
  if (opcode === "J") return [3, Number(instruction[1]), Number(instruction[2]), Number(instruction[3])];

  throw new Error(`Unsupported opcode: ${opcode}`);
}

function buildProgramCode(program) {
  const instructionCodes = program.map((instruction) => encodeTuple(instructionToTuple(instruction)));
  const digitEstimate = estimateTupleDecimalDigits(instructionCodes, DISPLAY_CODE_DIGIT_LIMIT);

  return {
    value: digitEstimate <= DISPLAY_CODE_DIGIT_LIMIT ? encodeTuple(instructionCodes).toString() : null,
    digitEstimate,
  };
}

function getExampleById(id) {
  return EQUIVALENCE_EXAMPLES.find((example) => example.id === id) ?? EQUIVALENCE_EXAMPLES[0];
}

function getAlternativeById(example, alternativeId) {
  return example.alternatives.find((alternative) => alternative.id === alternativeId) ?? example.alternatives[0];
}

function getRunOutput(runData) {
  if (typeof runData?.output === "number") return runData.output;
  const finalTraceRow = Array.isArray(runData?.trace) ? runData.trace[runData.trace.length - 1] : null;
  return finalTraceRow?.registers?.[0] ?? runData?.final_registers?.[0] ?? null;
}

function getTraceMetrics(trace) {
  const traceRows = Array.isArray(trace) ? trace : [];

  return {
    traceLength: traceRows.length,
    registerColumnCount: traceRows.reduce(
      (max, row) => Math.max(max, row?.registers?.length ?? 0),
      0,
    ),
  };
}

function getTraceTableColumnCount(metrics) {
  return metrics ? 1 + metrics.registerColumnCount : null;
}

function buildInputTupleLatex(inputValues) {
  return `\\langle ${inputValues.join(",")}\\rangle`;
}

function buildFunctionApplicationLatex(inputValues) {
  return `\\left(${inputValues.join(",")}\\right)`;
}

function ProgramCode({ label, code }) {
  return (
    <div className="many-programs-code-note">
      <KatexMath expression={`${label}=\\#${label.replace("e", "P")}`} />
      {code?.value ? <code>{code.value}</code> : <span>symbolic code shown</span>}
    </div>
  );
}

function ProgramRunPanel({
  roleLabel,
  example,
  inputValues,
  code,
  tracePresentation,
  traceTableWidthPercent,
  onTraceMetricsChange,
  playbackExternallyControlled = false,
  externalTraceIndex = 0,
  externalIsPlaying = false,
  onExternalTraceIndexChange = null,
  onExternalIsPlayingChange = null,
  playbackControlsDisabled = false,
  onPlaybackInfoChange = null,
}) {
  const [runData, setRunData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentTraceIndex, setCurrentTraceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  function setPlaybackTraceIndex(nextValue) {
    if (playbackExternallyControlled && typeof onExternalTraceIndexChange === "function") {
      const resolvedValue =
        typeof nextValue === "function" ? nextValue(externalTraceIndex) : nextValue;
      onExternalTraceIndexChange(resolvedValue);
      return;
    }

    setCurrentTraceIndex(nextValue);
  }

  function setPlaybackIsPlaying(nextValue) {
    if (playbackExternallyControlled && typeof onExternalIsPlayingChange === "function") {
      const resolvedValue =
        typeof nextValue === "function" ? nextValue(externalIsPlaying) : nextValue;
      onExternalIsPlayingChange(resolvedValue);
      return;
    }

    setIsPlaying(nextValue);
  }

  useEffect(() => {
    const controller = new AbortController();

    async function runProgram() {
      setIsLoading(true);
      setErrorMessage("");
      setRunData(null);
      setPlaybackTraceIndex(0);
      setPlaybackIsPlaying(false);

      try {
        const response = await fetch(`${API_URL}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            program: example.program,
            initial_registers: inputValues,
          }),
          signal: controller.signal,
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.detail || "Failed to run the program.");
        }

        if (!controller.signal.aborted) {
          onTraceMetricsChange?.(example.id, getTraceMetrics(payload?.trace));
          setRunData(payload);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to run the program.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void runProgram();

    return () => controller.abort();
  }, [example, inputValues, onTraceMetricsChange]);

  const trace = Array.isArray(runData?.trace) ? runData.trace : [];
  const maxTraceIndex = Math.max(trace.length - 1, 0);
  const playbackTraceIndex = playbackExternallyControlled ? externalTraceIndex : currentTraceIndex;
  const playbackIsPlaying = playbackExternallyControlled ? externalIsPlaying : isPlaying;
  const outputValue = getRunOutput(runData);

  useEffect(() => {
    setPlaybackTraceIndex(0);
    setPlaybackIsPlaying(false);
  }, [runData?.trace?.length, example.id]);

  useEffect(() => {
    if (!playbackExternallyControlled) return;

    setCurrentTraceIndex(externalTraceIndex);
    setIsPlaying(externalIsPlaying);
  }, [externalIsPlaying, externalTraceIndex, playbackExternallyControlled]);

  useEffect(() => {
    if (playbackExternallyControlled || !playbackIsPlaying || trace.length <= 1) return undefined;

    if (playbackTraceIndex >= maxTraceIndex) {
      setPlaybackIsPlaying(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPlaybackTraceIndex((current) => Math.min(current + 1, maxTraceIndex));
    }, PLAYBACK_INTERVAL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [maxTraceIndex, playbackExternallyControlled, playbackIsPlaying, playbackTraceIndex, trace.length]);

  useEffect(() => {
    if (playbackTraceIndex <= maxTraceIndex) return;
    setPlaybackTraceIndex(maxTraceIndex);
  }, [maxTraceIndex, playbackTraceIndex]);

  useEffect(() => {
    if (typeof onPlaybackInfoChange !== "function") return;

    onPlaybackInfoChange({
      currentTraceIndex: playbackTraceIndex,
      maxTraceIndex,
      isPlaying: playbackIsPlaying,
      hasTrace: trace.length > 0,
    });
  }, [maxTraceIndex, onPlaybackInfoChange, playbackIsPlaying, playbackTraceIndex, trace.length]);

  if (isLoading) {
    return <div className="many-programs-panel-state">Running {example.label} on the fixed input.</div>;
  }

  if (errorMessage) {
    return <div className="many-programs-panel-state many-programs-panel-error">{errorMessage}</div>;
  }

  if (!runData) {
    return null;
  }

  return (
    <MachinePanel
      title={roleLabel}
      headerContent={(
        <div className="many-programs-panel-header">
          <div className="many-programs-panel-role">{roleLabel}</div>
          <div className="many-programs-panel-meta">
            <span>{example.label}</span>
            <KatexMath expression={`f${buildFunctionApplicationLatex(inputValues)}=${outputValue ?? "?"}`} />
            <span>TRACE STEP {playbackTraceIndex} / {maxTraceIndex}</span>
          </div>
        </div>
      )}
      hideSectionCaptions
      traceCompact
      program={runData.program ?? example.program}
      row={trace[playbackTraceIndex] ?? null}
      finalRegisters={runData.final_registers ?? []}
      trace={trace}
      currentTraceIndex={playbackTraceIndex}
      hideStageColumns
      isPlaying={playbackIsPlaying}
      programPanelTitle={`Program ${example.label}`}
      programPanelCaption={example.description ?? "URM instruction list."}
      showProgramHeader
      traceShowStepGroups={false}
      outputIsFinal={runData?.status_summary?.output_is_final === true}
      tracePresentation={tracePresentation}
      traceTableWidthPercent={traceTableWidthPercent}
      traceEqualColumnWidths
      traceStandaloneTable
      statusPanelFooter={<ProgramCode label={example.codeId} code={code} />}
      playbackControls={(
        <MachinePlaybackControls
          disabled={playbackControlsDisabled}
          isPlaying={playbackIsPlaying}
          currentIndex={playbackTraceIndex}
          maxIndex={maxTraceIndex}
          playbackLength={trace.length}
          showSummary={false}
          onPrev={() => {
            setPlaybackIsPlaying(false);
            setPlaybackTraceIndex((current) => Math.max(current - 1, 0));
          }}
          onToggle={() => {
            if (playbackTraceIndex >= maxTraceIndex) {
              setPlaybackTraceIndex(0);
            }
            setPlaybackIsPlaying((current) => !current);
          }}
          onNext={() => {
            setPlaybackIsPlaying(false);
            setPlaybackTraceIndex((current) => Math.min(current + 1, maxTraceIndex));
          }}
          onChange={(nextIndex) => {
            setPlaybackIsPlaying(false);
            setPlaybackTraceIndex(nextIndex);
          }}
        />
      )}
    />
  );
}

export default function ManyProgramsPage() {
  const [selectedExampleId, setSelectedExampleId] = useState(EQUIVALENCE_EXAMPLES[0].id);
  const [selectedAlternativeId, setSelectedAlternativeId] = useState(EQUIVALENCE_EXAMPLES[0].alternatives[0].id);
  const [traceMetricsByProgramId, setTraceMetricsByProgramId] = useState({});
  const [syncPlaybackEnabled, setSyncPlaybackEnabled] = useState(false);
  const [syncIsPlaying, setSyncIsPlaying] = useState(false);
  const [referenceTraceIndex, setReferenceTraceIndex] = useState(0);
  const [referenceMaxTraceIndex, setReferenceMaxTraceIndex] = useState(0);
  const [alternativeTraceIndex, setAlternativeTraceIndex] = useState(0);
  const [alternativeMaxTraceIndex, setAlternativeMaxTraceIndex] = useState(0);
  const [referenceHasTrace, setReferenceHasTrace] = useState(false);
  const [alternativeHasTrace, setAlternativeHasTrace] = useState(false);
  const selectedExample = getExampleById(selectedExampleId);
  const selectedReference = selectedExample.reference;
  const selectedAlternative = getAlternativeById(selectedExample, selectedAlternativeId);
  const referenceCode = useMemo(
    () => buildProgramCode(selectedReference.program),
    [selectedReference],
  );
  const alternativeCode = useMemo(
    () => buildProgramCode(selectedAlternative.program),
    [selectedAlternative],
  );
  const sharedTraceSizing = useMemo(() => {
    const referenceMetrics = traceMetricsByProgramId[selectedReference.id];
    const alternativeMetrics = traceMetricsByProgramId[selectedAlternative.id];

    return {
      traceLength: Math.max(
        MANY_PROGRAMS_TRACE_SIZING_FLOOR.traceLength,
        referenceMetrics?.traceLength ?? 0,
        alternativeMetrics?.traceLength ?? 0,
      ),
      registerColumnCount: Math.max(
        MANY_PROGRAMS_TRACE_SIZING_FLOOR.registerColumnCount,
        referenceMetrics?.registerColumnCount ?? 0,
        alternativeMetrics?.registerColumnCount ?? 0,
      ),
    };
  }, [selectedAlternative.id, selectedReference.id, traceMetricsByProgramId]);
  const sharedTracePresentation = useMemo(
    () => getAdaptiveTracePresentation({
      traceLength: sharedTraceSizing.traceLength,
      registerColumnCount: sharedTraceSizing.registerColumnCount,
      compact: true,
    }),
    [sharedTraceSizing],
  );
  const traceTableWidthPercents = useMemo(() => {
    const referenceColumnCount = getTraceTableColumnCount(traceMetricsByProgramId[selectedReference.id]);
    const alternativeColumnCount = getTraceTableColumnCount(traceMetricsByProgramId[selectedAlternative.id]);

    if (!referenceColumnCount || !alternativeColumnCount) {
      return {
        reference: 100,
        alternative: 100,
      };
    }

    const widerColumnCount = Math.max(referenceColumnCount, alternativeColumnCount);

    return {
      reference: (referenceColumnCount / widerColumnCount) * 100,
      alternative: (alternativeColumnCount / widerColumnCount) * 100,
    };
  }, [selectedAlternative.id, selectedReference.id, traceMetricsByProgramId]);

  const handleTraceMetricsChange = useCallback((programId, metrics) => {
    setTraceMetricsByProgramId((current) => ({
      ...current,
      [programId]: metrics,
    }));
  }, []);
  const syncPlaybackReady = referenceHasTrace && alternativeHasTrace;
  const syncMaxTraceIndex = Math.max(referenceMaxTraceIndex, alternativeMaxTraceIndex);
  const syncTraceIndex = Math.max(referenceTraceIndex, alternativeTraceIndex);
  const syncBothFinished =
    referenceTraceIndex >= referenceMaxTraceIndex &&
    alternativeTraceIndex >= alternativeMaxTraceIndex;

  useEffect(() => {
    setSyncIsPlaying(false);
    setTraceMetricsByProgramId({});
    setReferenceTraceIndex(0);
    setReferenceMaxTraceIndex(0);
    setAlternativeTraceIndex(0);
    setAlternativeMaxTraceIndex(0);
    setReferenceHasTrace(false);
    setAlternativeHasTrace(false);
  }, [selectedAlternative.id, selectedExample.id]);

  useEffect(() => {
    setSelectedAlternativeId(selectedExample.alternatives[0].id);
  }, [selectedExample.id]);

  useEffect(() => {
    if (!syncPlaybackEnabled) {
      setSyncIsPlaying(false);
    }
  }, [syncPlaybackEnabled]);

  useEffect(() => {
    if (!syncPlaybackEnabled || !syncIsPlaying) return undefined;

    const referenceFinished = referenceTraceIndex >= referenceMaxTraceIndex;
    const alternativeFinished = alternativeTraceIndex >= alternativeMaxTraceIndex;

    if (referenceFinished && alternativeFinished) {
      setSyncIsPlaying(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setReferenceTraceIndex((current) => Math.min(current + 1, referenceMaxTraceIndex));
      setAlternativeTraceIndex((current) => Math.min(current + 1, alternativeMaxTraceIndex));
    }, PLAYBACK_INTERVAL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    alternativeMaxTraceIndex,
    alternativeTraceIndex,
    referenceMaxTraceIndex,
    referenceTraceIndex,
    syncIsPlaying,
    syncPlaybackEnabled,
  ]);

  const handleReferencePlaybackInfoChange = useCallback(({ currentTraceIndex, maxTraceIndex, hasTrace }) => {
    setReferenceTraceIndex(currentTraceIndex);
    setReferenceMaxTraceIndex(maxTraceIndex);
    setReferenceHasTrace(hasTrace);
  }, []);

  const handleAlternativePlaybackInfoChange = useCallback(({ currentTraceIndex, maxTraceIndex, hasTrace }) => {
    setAlternativeTraceIndex(currentTraceIndex);
    setAlternativeMaxTraceIndex(maxTraceIndex);
    setAlternativeHasTrace(hasTrace);
  }, []);

  function handleToggleSyncPlayback() {
    setSyncIsPlaying(false);

    if (!syncPlaybackEnabled) {
      setReferenceTraceIndex(0);
      setAlternativeTraceIndex(0);
      setSyncPlaybackEnabled(true);
      return;
    }

    setSyncPlaybackEnabled(false);
  }

  function handleSyncPrev() {
    setSyncIsPlaying(false);
    setReferenceTraceIndex((current) => Math.max(0, current - 1));
    setAlternativeTraceIndex((current) => Math.max(0, current - 1));
  }

  function handleSyncNext() {
    setSyncIsPlaying(false);
    setReferenceTraceIndex((current) => Math.min(current + 1, referenceMaxTraceIndex));
    setAlternativeTraceIndex((current) => Math.min(current + 1, alternativeMaxTraceIndex));
  }

  function handleSyncPlayToggle() {
    if (!syncPlaybackReady) return;

    if (syncBothFinished) {
      setReferenceTraceIndex(0);
      setAlternativeTraceIndex(0);
      setSyncIsPlaying(true);
      return;
    }

    setSyncIsPlaying((current) => !current);
  }

  function handleSyncSliderChange(nextIndex) {
    setSyncIsPlaying(false);
    setReferenceTraceIndex(Math.min(nextIndex, referenceMaxTraceIndex));
    setAlternativeTraceIndex(Math.min(nextIndex, alternativeMaxTraceIndex));
  }

  return (
    <div className="page-stack compute-page many-programs-page">
      <section className="page-intro page-intro-compact">
        <div className="page-intro-copy">
          <h2 className="page-title">Program Equivalence</h2>
          <p className="page-copy">
            Different URM programs can have different codes while computing the same function.
          </p>
        </div>
      </section>

      <FunctionCard>
        <FunctionCardRows>
          <FunctionCardRow>
            <FunctionCardLabel>Function</FunctionCardLabel>
            <FunctionCardMath>
              <KatexMath expression={selectedExample.functionLatex} />
            </FunctionCardMath>
            <FunctionCardControls>
              <select
                value={selectedExampleId}
                onChange={(event) => setSelectedExampleId(event.target.value)}
                className="dashboard-control runner-toolbar-select"
              >
                {EQUIVALENCE_EXAMPLES.map((example) => (
                  <option key={example.id} value={example.id}>
                    {example.label}
                  </option>
                ))}
              </select>
            </FunctionCardControls>
          </FunctionCardRow>

          <FunctionCardRow>
            <FunctionCardLabel>Input</FunctionCardLabel>
            <FunctionCardMath>
              <KatexMath expression={buildInputTupleLatex(selectedExample.inputValues)} />
            </FunctionCardMath>
            <FunctionCardControls />
          </FunctionCardRow>

          <FunctionCardRow>
            <FunctionCardLabel>Reference</FunctionCardLabel>
            <FunctionCardMath>
              <KatexMath expression={selectedReference.label} />
            </FunctionCardMath>
            <FunctionCardControls />
          </FunctionCardRow>

          <FunctionCardRow>
            <FunctionCardLabel>Alternative</FunctionCardLabel>
            <FunctionCardMath>
              <KatexMath expression={selectedAlternative.label} />
            </FunctionCardMath>
            <FunctionCardControls>
              <select
                value={selectedAlternative.id}
                onChange={(event) => setSelectedAlternativeId(event.target.value)}
                className="dashboard-control runner-toolbar-select"
              >
                {selectedExample.alternatives.map((alternative) => (
                  <option key={alternative.id} value={alternative.id}>
                    Alternative {alternative.label}
                  </option>
                ))}
              </select>
            </FunctionCardControls>
          </FunctionCardRow>
        </FunctionCardRows>
      </FunctionCard>

      <div style={programEquivalenceSyncToolbarStyle}>
        <label style={programEquivalenceSyncToggleStyle}>
          <input
            type="checkbox"
            checked={syncPlaybackEnabled}
            onChange={handleToggleSyncPlayback}
            style={programEquivalenceSyncCheckboxStyle}
          />
          <span style={programEquivalenceSyncToggleTextStyle}>Sync playback</span>
        </label>

        {syncPlaybackEnabled ? (
          <div style={programEquivalenceSyncTransportStyle}>
            <MachinePlaybackControls
              disabled={!syncPlaybackReady}
              isPlaying={syncIsPlaying}
              currentIndex={syncTraceIndex}
              maxIndex={syncMaxTraceIndex}
              playbackLength={syncMaxTraceIndex + 1}
              showSummary={false}
              onPrev={handleSyncPrev}
              onToggle={handleSyncPlayToggle}
              onNext={handleSyncNext}
              onChange={handleSyncSliderChange}
            />
          </div>
        ) : null}
      </div>

      <section className="many-programs-comparison-grid" aria-label="Program comparison">
        <div className="many-programs-comparison-column">
          <div className="many-programs-column-label">REFERENCE PROGRAM</div>
          <div className="many-programs-comparison-execution">
            <ProgramRunPanel
              roleLabel="REFERENCE PROGRAM"
              example={selectedReference}
              inputValues={selectedExample.inputValues}
              code={referenceCode}
              tracePresentation={sharedTracePresentation}
              traceTableWidthPercent={traceTableWidthPercents.reference}
              onTraceMetricsChange={handleTraceMetricsChange}
              playbackExternallyControlled={syncPlaybackEnabled}
              externalTraceIndex={referenceTraceIndex}
              externalIsPlaying={syncIsPlaying}
              onExternalTraceIndexChange={setReferenceTraceIndex}
              onExternalIsPlayingChange={setSyncIsPlaying}
              playbackControlsDisabled={syncPlaybackEnabled}
              onPlaybackInfoChange={handleReferencePlaybackInfoChange}
            />
          </div>
        </div>

        <div className="many-programs-comparison-column">
          <div className="many-programs-column-label">ALTERNATIVE PROGRAM</div>
          <div className="many-programs-comparison-execution">
            <ProgramRunPanel
              roleLabel="ALTERNATIVE PROGRAM"
              example={selectedAlternative}
              inputValues={selectedExample.inputValues}
              code={alternativeCode}
              tracePresentation={sharedTracePresentation}
              traceTableWidthPercent={traceTableWidthPercents.alternative}
              onTraceMetricsChange={handleTraceMetricsChange}
              playbackExternallyControlled={syncPlaybackEnabled}
              externalTraceIndex={alternativeTraceIndex}
              externalIsPlaying={syncIsPlaying}
              onExternalTraceIndexChange={setAlternativeTraceIndex}
              onExternalIsPlayingChange={setSyncIsPlaying}
              playbackControlsDisabled={syncPlaybackEnabled}
              onPlaybackInfoChange={handleAlternativePlaybackInfoChange}
            />
          </div>
        </div>
      </section>

      <FunctionCard className="many-programs-theorem-card">
        <FunctionCardRows>
          <FunctionCardRow>
            <FunctionCardLabel>Different programs</FunctionCardLabel>
            <FunctionCardMath>
              <KatexMath expression={`${selectedReference.label} \\ne ${selectedAlternative.label}`} />
            </FunctionCardMath>
            <FunctionCardControls />
          </FunctionCardRow>
          <FunctionCardRow>
            <FunctionCardLabel>Different codes</FunctionCardLabel>
            <FunctionCardMath>
              <KatexMath expression={`${selectedReference.codeId} \\ne ${selectedAlternative.codeId}`} />
            </FunctionCardMath>
            <FunctionCardControls />
          </FunctionCardRow>
          <FunctionCardRow>
            <FunctionCardLabel>Same function</FunctionCardLabel>
            <FunctionCardMath>
              <KatexMath expression={`\\varphi^{(${selectedExample.arity})}_{${selectedReference.codeId}}=\\varphi^{(${selectedExample.arity})}_{${selectedAlternative.codeId}}`} />
            </FunctionCardMath>
            <FunctionCardControls />
          </FunctionCardRow>
          <FunctionCardRow>
            <FunctionCardLabel>Same value</FunctionCardLabel>
            <FunctionCardMath>
              <KatexMath expression={`\\varphi^{(${selectedExample.arity})}_{${selectedReference.codeId}}${buildFunctionApplicationLatex(selectedExample.inputValues)}=\\varphi^{(${selectedExample.arity})}_{${selectedAlternative.codeId}}${buildFunctionApplicationLatex(selectedExample.inputValues)}=${selectedExample.outputValue}`} />
            </FunctionCardMath>
            <FunctionCardControls />
          </FunctionCardRow>
        </FunctionCardRows>
      </FunctionCard>

      <FurtherReading items={["Cutland, Computability, §4.2"]} />
    </div>
  );
}

const programEquivalenceSyncToolbarStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 12px",
  border: "1px solid color-mix(in srgb, var(--compute-border) 84%, var(--compute-text) 16%)",
  borderRadius: RADII.panel,
  background: "color-mix(in srgb, var(--compute-surface-alt) 78%, transparent)",
  color: "var(--compute-text)",
};

const programEquivalenceSyncToggleStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const programEquivalenceSyncCheckboxStyle = {
  margin: 0,
  inlineSize: 15,
  blockSize: 15,
  accentColor: "var(--compute-accent)",
};

const programEquivalenceSyncToggleTextStyle = {
  ...TYPOGRAPHY.styles.uiText,
  color: "var(--compute-text)",
  whiteSpace: "nowrap",
};

const programEquivalenceSyncTransportStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  minWidth: 0,
};
