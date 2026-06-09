import { useEffect, useMemo, useState } from "react";
import KatexMath from "../components/KatexMath.jsx";
import {
  FunctionCard,
  FunctionCardControls,
  FunctionCardLabel,
  FunctionCardMath,
  FunctionCardRow,
  FunctionCardRows,
} from "../components/FunctionCardLayout.jsx";
import FurtherReading from "../components/FurtherReading.jsx";
import FunctionRunner from "../components/FunctionRunner.jsx";
import { API_URL } from "../api.js";
import MachinePanel from "../components/MachinePanel.jsx";
import { InlineMath } from "../components/MathText.jsx";
import { RADII, TYPOGRAPHY } from "../theme.js";
import {
  getFunctionDescription,
  getFunctionDisplayName,
  normalizeFunctionKind,
} from "../functionMetadata.js";

const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];
const PLAYBACK_INTERVAL_MS = 800;

const SUPPORTED_SMN_SOURCES = [
  {
    id: "zero",
    label: "Zero",
    spec: { kind: "zero" },
    arity: 1,
  },
  {
    id: "successor",
    label: "Successor",
    spec: { kind: "successor" },
    arity: 1,
  },
  {
    id: "constant",
    label: "Constant",
    spec: { kind: "constant", value: 3 },
    arity: 1,
  },
  {
    id: "add",
    label: "Addition",
    spec: { kind: "add" },
    arity: 2,
  },
  {
    id: "bounded_sub",
    label: "Truncated subtraction",
    spec: { kind: "bounded_sub" },
    arity: 2,
  },
];

function getVariableNames(count) {
  return Array.from({ length: count }, (_, index) => VARIABLE_NAMES[index] ?? `x${index + 1}`);
}

function parseNaturalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function buildFunctionCallLatex(name, args) {
  if (!Array.isArray(args) || args.length === 0) {
    return `${name}\\left(\\right)`;
  }

  return `${name}\\left(${args.join(", ")}\\right)`;
}

function buildSourceBodyLatex(spec, args) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "zero") {
    return "0";
  }

  if (kind === "successor") {
    return `${args[0] ?? "x"} + 1`;
  }

  if (kind === "constant") {
    return `${spec?.value ?? 0}`;
  }

  if (kind === "add") {
    return `${args[0] ?? "x"} + ${args[1] ?? "y"}`;
  }

  if (kind === "bounded_sub") {
    return `${args[0] ?? "x"} \\truncminus ${args[1] ?? "y"}`;
  }

  return "?";
}

function evaluateSupportedSource(spec, args) {
  const kind = normalizeFunctionKind(spec?.kind);
  const parsedArgs = args.map((value) => parseNaturalNumber(value));
  const allNumeric = parsedArgs.every((value) => value !== null);

  if (kind === "zero") {
    return 0;
  }

  if (kind === "constant") {
    return spec?.value ?? 0;
  }

  if (!allNumeric) {
    return null;
  }

  if (kind === "successor") {
    return parsedArgs[0] + 1;
  }

  if (kind === "add") {
    return parsedArgs[0] + parsedArgs[1];
  }

  if (kind === "bounded_sub") {
    return Math.max(parsedArgs[0] - parsedArgs[1], 0);
  }

  return null;
}

function buildDefinitionLatex(name, args, bodyLatex, value = null) {
  const call = buildFunctionCallLatex(name, args);
  const bodyText = String(bodyLatex ?? "");
  const valueText = value === null ? null : String(value);

  if (!bodyText) {
    return call;
  }

  if (valueText !== null && valueText !== bodyText) {
    return `${call} = ${bodyText} = ${valueText}`;
  }

  return `${call} = ${bodyText}`;
}

function buildSpecializedFunctionModel(sourceFunction, fixedVariables) {
  if (!sourceFunction) return null;

  const variableNames = getVariableNames(sourceFunction.arity);
  const freeVariableIndices = variableNames
    .map((_, index) => index)
    .filter((index) => !(index in fixedVariables));
  const freeVariableNames = freeVariableIndices.map((index) => variableNames[index]);
  const substitutedArgs = variableNames.map((name, index) =>
    index in fixedVariables ? String(fixedVariables[index]) : name
  );
  const sourceBodyLatex = buildSourceBodyLatex(sourceFunction.spec, variableNames);
  const specializedBodyLatex = buildSourceBodyLatex(sourceFunction.spec, substitutedArgs);
  const specializedValue = evaluateSupportedSource(sourceFunction.spec, substitutedArgs);

  return {
    freeVariableIndices,
    freeVariableNames,
    sourceDefinitionLatex: buildDefinitionLatex("f", variableNames, sourceBodyLatex),
    specializedDefinitionLatex: buildDefinitionLatex(
      "g",
      freeVariableNames,
      `${buildFunctionCallLatex("f", substitutedArgs)} = ${specializedBodyLatex}`,
      specializedValue,
    ),
  };
}

function mergeFreeAndFixedInputs(sourceFunction, fixedVariables, freeInputs) {
  if (!sourceFunction) return [];

  return Array.from({ length: sourceFunction.arity }, (_, index) => {
    if (index in fixedVariables) {
      return fixedVariables[index];
    }

    return freeInputs[index] ?? 0;
  });
}

function getSourceFunctionById(sourceId) {
  return SUPPORTED_SMN_SOURCES.find((source) => source.id === sourceId) ?? SUPPORTED_SMN_SOURCES[0];
}

function buildCurrentCallLatex(specializedModel, sourceVariableNames, freeInputs) {
  if (!specializedModel) {
    return "g\\left(\\right)";
  }

  const args = specializedModel.freeVariableIndices.map((index) => {
    const parsed = parseNaturalNumber(freeInputs[index]);
    return parsed === null ? sourceVariableNames[index] : String(parsed);
  });

  return buildFunctionCallLatex("g", args);
}

function maxRegisterIndex(program) {
  return (Array.isArray(program) ? program : []).reduce((maxValue, instruction) => {
    if (!Array.isArray(instruction) || instruction.length === 0) return maxValue;

    const opcode = String(instruction[0] ?? "").toUpperCase();

    if (opcode === "Z" || opcode === "S") {
      return Math.max(maxValue, Number(instruction[1]) || 0);
    }

    if (opcode === "T") {
      return Math.max(
        maxValue,
        Number(instruction[1]) || 0,
        Number(instruction[2]) || 0,
      );
    }

    if (opcode === "J") {
      return Math.max(
        maxValue,
        Number(instruction[1]) || 0,
        Number(instruction[2]) || 0,
      );
    }

    return maxValue;
  }, -1);
}

function shiftProgram(program, offset) {
  return (Array.isArray(program) ? program : []).map((instruction) => {
    if (!Array.isArray(instruction)) {
      return instruction;
    }

    const opcode = String(instruction[0] ?? "").toUpperCase();

    if (opcode === "J" && instruction.length >= 4) {
      return [instruction[0], instruction[1], instruction[2], Number(instruction[3]) + offset];
    }

    return [...instruction];
  });
}

function buildSpecializedProgram(sourceProgram, sourceArity, freeVariableIndices, fixedVariables) {
  const baseProgram = Array.isArray(sourceProgram) ? sourceProgram.map((instruction) => [...instruction]) : [];
  const safeSourceArity = Number.isInteger(sourceArity) && sourceArity >= 0 ? sourceArity : 0;
  const orderedFreeIndices = (Array.isArray(freeVariableIndices) ? freeVariableIndices : [])
    .filter((index) => Number.isInteger(index) && index >= 0 && index < safeSourceArity)
    .sort((left, right) => left - right);
  const fixedEntries = Object.entries(fixedVariables ?? {})
    .map(([index, value]) => [Number(index), value])
    .filter(
      ([index, value]) =>
        Number.isInteger(index) &&
        index >= 0 &&
        index < safeSourceArity &&
        Number.isInteger(value) &&
        value >= 0,
    )
    .sort((left, right) => left[0] - right[0]);

  if (
    fixedEntries.length === 0 &&
    orderedFreeIndices.length === safeSourceArity &&
    orderedFreeIndices.every((index, freeIndex) => index === freeIndex)
  ) {
    return baseProgram;
  }

  const highestSourceRegister = Math.max(maxRegisterIndex(baseProgram), safeSourceArity - 1);
  const tempBaseRegister = highestSourceRegister + 1;
  const prelude = [];

  orderedFreeIndices.forEach((sourceIndex, freeInputIndex) => {
    const tempRegister = tempBaseRegister + freeInputIndex;
    prelude.push(["Z", tempRegister]);
    prelude.push(["T", freeInputIndex, tempRegister]);
  });

  fixedEntries.forEach(([sourceIndex, fixedValue]) => {
    prelude.push(["Z", sourceIndex]);
    for (let step = 0; step < fixedValue; step += 1) {
      prelude.push(["S", sourceIndex]);
    }
  });

  orderedFreeIndices.forEach((sourceIndex, freeInputIndex) => {
    const tempRegister = tempBaseRegister + freeInputIndex;
    prelude.push(["T", tempRegister, sourceIndex]);
  });

  return [...prelude, ...shiftProgram(baseProgram, prelude.length)];
}

function SpecializedProgramRunner({
  request,
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
    if (!request) {
      setRunData(null);
      setErrorMessage("");
      setIsLoading(false);
      setPlaybackTraceIndex(0);
      setPlaybackIsPlaying(false);
      return;
    }

    let cancelled = false;

    async function runSpecializedProgram() {
      setIsLoading(true);
      setErrorMessage("");
      setRunData(null);
      setPlaybackTraceIndex(0);
      setPlaybackIsPlaying(false);

      try {
        const compileResponse = await fetch(`${API_URL}/compile-function`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.sourceFunctionSpec),
        });
        const compilePayload = await compileResponse.json();

        if (!compileResponse.ok) {
          throw new Error(compilePayload?.detail || "Failed to compile the source function.");
        }

        const specializedProgram = buildSpecializedProgram(
          compilePayload.program,
          request.sourceArity,
          request.freeVariableIndices,
          request.fixedVariables,
        );

        const runResponse = await fetch(`${API_URL}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            program: specializedProgram,
            initial_registers: request.initialRegisters,
          }),
        });
        const runPayload = await runResponse.json();

        if (!runResponse.ok) {
          throw new Error(runPayload?.detail || "Failed to execute the specialized program.");
        }

        if (!cancelled) {
          setRunData({
            ...runPayload,
            program: specializedProgram,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to run the specialized function.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    runSpecializedProgram();

    return () => {
      cancelled = true;
    };
  }, [request]);

  const trace = Array.isArray(runData?.trace) ? runData.trace : [];
  const maxTraceIndex = Math.max(trace.length - 1, 0);
  const playbackTraceIndex = playbackExternallyControlled ? externalTraceIndex : currentTraceIndex;
  const playbackIsPlaying = playbackExternallyControlled ? externalIsPlaying : isPlaying;
  const currentRow = trace[playbackTraceIndex] ?? null;
  const outputIsFinal = runData?.status_summary?.output_is_final === true;
  const playbackProgressPercent =
    maxTraceIndex > 0 ? (playbackTraceIndex / maxTraceIndex) * 100 : 0;

  useEffect(() => {
    setPlaybackTraceIndex(0);
    setPlaybackIsPlaying(false);
  }, [runData?.trace?.length, request?.runId]);

  useEffect(() => {
    if (!playbackExternallyControlled) return;

    setCurrentTraceIndex(externalTraceIndex);
    setIsPlaying(externalIsPlaying);
  }, [externalIsPlaying, externalTraceIndex, playbackExternallyControlled]);

  useEffect(() => {
    if (playbackExternallyControlled || !playbackIsPlaying || trace.length <= 1) return undefined;

    if (playbackTraceIndex >= trace.length - 1) {
      setPlaybackIsPlaying(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPlaybackTraceIndex((current) => Math.min(current + 1, trace.length - 1));
    }, PLAYBACK_INTERVAL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [playbackExternallyControlled, playbackIsPlaying, playbackTraceIndex, trace.length]);

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
    return <div style={smnRunnerStateStyle}>Compiling and running the specialized URM program…</div>;
  }

  if (errorMessage) {
    return <div style={smnRunnerErrorStyle}>{errorMessage}</div>;
  }

  if (!runData) {
    return null;
  }

  const headerContent = (
    <div className="panel-header" style={smnPanelHeaderRowStyle}>
      <div style={smnPanelHeaderTitleStyle}>{request?.headerTitle ?? "Specialized function"}</div>
      <div style={smnPanelHeaderMetaStyle}>
        <div style={smnPanelHeaderMetaItemStyle}>
          <span style={smnExecutionMetaLabelStyle}>Call:</span>
          <span style={smnExecutionMetaMathStyle}>
            <KatexMath expression={request?.headerCallLatex ?? "g\\left(\\right)"} />
          </span>
        </div>
      </div>
      <div style={smnPanelHeaderStepStyle}>TRACE STEP {playbackTraceIndex} / {maxTraceIndex}</div>
    </div>
  );

  return (
    <MachinePanel
      title="Specialized execution"
      headerContent={headerContent}
      hideSectionCaptions
      traceCompact
      program={runData.program ?? []}
      row={currentRow}
      finalRegisters={runData.final_registers ?? []}
      trace={trace}
      currentTraceIndex={playbackTraceIndex}
      isPlaying={playbackIsPlaying}
      traceShowStepGroups={false}
      outputIsFinal={outputIsFinal}
      playbackControls={(
        <div
          className={`runner-playback-bar${playbackControlsDisabled ? " runner-playback-bar-disabled" : ""}`}
          aria-disabled={playbackControlsDisabled}
        >
          <div className="runner-playback-actions transport-group">
            <button
              type="button"
              onClick={() => {
                setPlaybackIsPlaying(false);
                setPlaybackTraceIndex((current) => Math.max(current - 1, 0));
              }}
              disabled={playbackControlsDisabled || playbackTraceIndex === 0}
              className="transport-btn"
            >
              Prev
            </button>

            <button
              type="button"
              onClick={() => {
                if (playbackTraceIndex >= maxTraceIndex) {
                  setPlaybackTraceIndex(0);
                }
                setPlaybackIsPlaying((current) => !current);
              }}
              disabled={playbackControlsDisabled || trace.length === 0}
              className="transport-btn"
            >
              {playbackIsPlaying ? "Pause" : "Play"}
            </button>

            <button
              type="button"
              onClick={() => {
                setPlaybackIsPlaying(false);
                setPlaybackTraceIndex((current) => Math.min(current + 1, maxTraceIndex));
              }}
              disabled={playbackControlsDisabled || playbackTraceIndex >= maxTraceIndex}
              className="transport-btn"
            >
              Next
            </button>
          </div>

          <div className="runner-playback-slider-shell">
            <input
              type="range"
              min="0"
              max={maxTraceIndex}
              value={playbackTraceIndex}
              disabled={playbackControlsDisabled}
              onChange={(event) => {
                setPlaybackIsPlaying(false);
                setPlaybackTraceIndex(Number(event.target.value));
              }}
              className="runner-playback-slider"
              style={{
                "--playback-progress": `${playbackProgressPercent}%`,
                "--slider-track": "var(--theme-slider-track)",
                "--slider-active": "var(--theme-slider-active)",
                "--slider-thumb": "var(--theme-slider-thumb)",
                "--slider-thumb-shadow": "var(--theme-slider-thumb-shadow)",
              }}
            />
          </div>

        </div>
      )}
    />
  );
}

export default function SmnPage() {
  const [selectedSourceId, setSelectedSourceId] = useState(SUPPORTED_SMN_SOURCES[0].id);
  const [constantValue, setConstantValue] = useState("3");
  const [fixedSelections, setFixedSelections] = useState({});
  const [fixedInputs, setFixedInputs] = useState({});
  const [freeInputs, setFreeInputs] = useState({});
  const [runModel, setRunModel] = useState(null);
  const [specializedRunRequest, setSpecializedRunRequest] = useState(null);
  const [validationMessage, setValidationMessage] = useState("");
  const [syncPlaybackEnabled, setSyncPlaybackEnabled] = useState(false);
  const [syncIsPlaying, setSyncIsPlaying] = useState(false);
  const [originalTraceIndex, setOriginalTraceIndex] = useState(0);
  const [originalMaxTraceIndex, setOriginalMaxTraceIndex] = useState(0);
  const [specializedTraceIndex, setSpecializedTraceIndex] = useState(0);
  const [specializedMaxTraceIndex, setSpecializedMaxTraceIndex] = useState(0);
  const [originalHasTrace, setOriginalHasTrace] = useState(false);
  const [specializedHasTrace, setSpecializedHasTrace] = useState(false);
  const [pendingSyncAutoplayRunId, setPendingSyncAutoplayRunId] = useState(null);
  const baseSourceFunction = useMemo(() => getSourceFunctionById(selectedSourceId), [selectedSourceId]);
  const parsedConstantValue = useMemo(() => parseNaturalNumber(constantValue), [constantValue]);
  const sourceFunction = useMemo(() => {
    if (baseSourceFunction?.id !== "constant") {
      return baseSourceFunction;
    }

    return {
      ...baseSourceFunction,
      spec: {
        ...baseSourceFunction.spec,
        value: parsedConstantValue ?? 0,
      },
    };
  }, [baseSourceFunction, parsedConstantValue]);
  const sourceVariableNames = useMemo(
    () => getVariableNames(sourceFunction?.arity ?? 0),
    [sourceFunction?.arity],
  );

  useEffect(() => {
    setFixedSelections({});
    setFixedInputs({});
    setFreeInputs({});
    setRunModel(null);
    setSpecializedRunRequest(null);
    setValidationMessage("");
    setSyncPlaybackEnabled(false);
    setSyncIsPlaying(false);
    setOriginalTraceIndex(0);
    setOriginalMaxTraceIndex(0);
    setSpecializedTraceIndex(0);
    setSpecializedMaxTraceIndex(0);
    setOriginalHasTrace(false);
    setSpecializedHasTrace(false);
    setPendingSyncAutoplayRunId(null);
  }, [selectedSourceId]);

  const fixedVariableMap = useMemo(
    () =>
      Object.entries(fixedSelections).reduce((acc, [index, enabled]) => {
        if (!enabled) return acc;

        const parsed = parseNaturalNumber(fixedInputs[index]);
        if (parsed !== null) {
          acc[Number(index)] = parsed;
        }

        return acc;
      }, {}),
    [fixedInputs, fixedSelections],
  );

  const selectedFixedIndices = useMemo(
    () =>
      Object.entries(fixedSelections)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([index]) => Number(index)),
    [fixedSelections],
  );

  const invalidFixedIndex = selectedFixedIndices.find(
    (index) => parseNaturalNumber(fixedInputs[index]) === null,
  );

  const specializedModel = useMemo(
    () => buildSpecializedFunctionModel(sourceFunction, fixedVariableMap),
    [fixedVariableMap, sourceFunction],
  );

  const freeInputMap = useMemo(
    () =>
      (specializedModel?.freeVariableIndices ?? []).reduce((acc, index) => {
        const parsed = parseNaturalNumber(freeInputs[index]);
        if (parsed !== null) {
          acc[index] = parsed;
        }
        return acc;
      }, {}),
    [freeInputs, specializedModel?.freeVariableIndices],
  );

  const invalidFreeIndex = (specializedModel?.freeVariableIndices ?? []).find(
    (index) => parseNaturalNumber(freeInputs[index]) === null,
  );
  const constantValueInvalid = selectedSourceId === "constant" && parsedConstantValue === null;
  const sourceDefinitionLatex = constantValueInvalid
    ? "f\\left(x\\right) = k"
    : specializedModel?.sourceDefinitionLatex ?? "f\\left(x\\right)";
  const specializedDefinitionLatex = constantValueInvalid
    ? "\\text{Enter a nonnegative } k \\text{ to build } g"
    : specializedModel?.specializedDefinitionLatex ?? "g\\left(x\\right)";
  const currentCallLatex = buildCurrentCallLatex(specializedModel, sourceVariableNames, freeInputs);
  const originalCallLatex = runModel
    ? buildFunctionCallLatex("f", runModel.fullInputs.map(String))
    : buildFunctionCallLatex("f", sourceVariableNames);
  const specializedCallLatex = runModel
    ? buildCurrentCallLatex(
        specializedModel,
        sourceVariableNames,
        (specializedModel?.freeVariableIndices ?? []).reduce((acc, index) => {
          acc[index] = freeInputs[index] ?? "";
          return acc;
        }, {}),
      )
    : currentCallLatex;
  const syncPlaybackReady = Boolean(runModel && originalHasTrace && specializedHasTrace);
  const syncBothFinished =
    originalTraceIndex >= originalMaxTraceIndex &&
    specializedTraceIndex >= specializedMaxTraceIndex;

  useEffect(() => {
    if (!syncPlaybackEnabled) {
      setSyncIsPlaying(false);
    }
  }, [syncPlaybackEnabled]);

  useEffect(() => {
    if (
      pendingSyncAutoplayRunId === null ||
      !syncPlaybackEnabled ||
      !syncPlaybackReady ||
      runModel?.runId !== pendingSyncAutoplayRunId
    ) {
      return;
    }

    setOriginalTraceIndex(0);
    setSpecializedTraceIndex(0);
    setSyncIsPlaying(true);
    setPendingSyncAutoplayRunId(null);
  }, [pendingSyncAutoplayRunId, runModel?.runId, syncPlaybackEnabled, syncPlaybackReady]);

  useEffect(() => {
    if (!syncPlaybackEnabled || !syncIsPlaying) return undefined;

    const originalFinished = originalTraceIndex >= originalMaxTraceIndex;
    const specializedFinished = specializedTraceIndex >= specializedMaxTraceIndex;

    if (originalFinished && specializedFinished) {
      setSyncIsPlaying(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setOriginalTraceIndex((current) => Math.min(current + 1, originalMaxTraceIndex));
      setSpecializedTraceIndex((current) => Math.min(current + 1, specializedMaxTraceIndex));
    }, PLAYBACK_INTERVAL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    originalMaxTraceIndex,
    originalTraceIndex,
    specializedMaxTraceIndex,
    specializedTraceIndex,
    syncIsPlaying,
    syncPlaybackEnabled,
  ]);

  function handleToggleSyncPlayback() {
    if (syncPlaybackEnabled) {
      setPendingSyncAutoplayRunId(null);
    }
    setSyncPlaybackEnabled((current) => !current);
  }

  function handleSyncPrev() {
    setSyncIsPlaying(false);
    setOriginalTraceIndex((current) => Math.max(0, current - 1));
    setSpecializedTraceIndex((current) => Math.max(0, current - 1));
  }

  function handleSyncNext() {
    setSyncIsPlaying(false);
    setOriginalTraceIndex((current) => Math.min(current + 1, originalMaxTraceIndex));
    setSpecializedTraceIndex((current) => Math.min(current + 1, specializedMaxTraceIndex));
  }

  function handleSyncPlayToggle() {
    if (!syncPlaybackReady) return;

    if (syncBothFinished) {
      setOriginalTraceIndex(0);
      setSpecializedTraceIndex(0);
      setSyncIsPlaying(true);
      return;
    }

    setSyncIsPlaying((current) => !current);
  }

  function handleToggleFixed(index) {
    setFixedSelections((current) => ({
      ...current,
      [index]: !current[index],
    }));
    setFixedInputs((current) => ({
      ...current,
      [index]: current[index] ?? "0",
    }));
    setRunModel(null);
    setSpecializedRunRequest(null);
  }

  function handleFixedValueChange(index, nextValue) {
    setFixedInputs((current) => ({
      ...current,
      [index]: nextValue,
    }));
    setRunModel(null);
    setSpecializedRunRequest(null);
  }

  function handleFreeValueChange(index, nextValue) {
    setFreeInputs((current) => ({
      ...current,
      [index]: nextValue,
    }));
    setRunModel(null);
    setSpecializedRunRequest(null);
  }

  function handleRunSpecializedFunction() {
    if (!sourceFunction || !specializedModel) {
      setValidationMessage("Choose a source function before running a specialization.");
      return;
    }

    if (constantValueInvalid) {
      setValidationMessage("The constant value k must be a natural number.");
      return;
    }

    if (invalidFixedIndex !== undefined) {
      setValidationMessage(`The fixed value for ${sourceVariableNames[invalidFixedIndex]} must be a natural number.`);
      return;
    }

    if (invalidFreeIndex !== undefined) {
      setValidationMessage(`The free input ${sourceVariableNames[invalidFreeIndex]} must be a natural number.`);
      return;
    }

    const fullInputs = mergeFreeAndFixedInputs(sourceFunction, fixedVariableMap, freeInputMap);
    const specializedInitialRegisters = (specializedModel?.freeVariableIndices ?? []).map(
      (index) => freeInputMap[index] ?? 0,
    );
    const runId = Date.now();
    setValidationMessage("");
    setSyncPlaybackEnabled(true);
    setSyncIsPlaying(false);
    setOriginalTraceIndex(0);
    setOriginalMaxTraceIndex(0);
    setSpecializedTraceIndex(0);
    setSpecializedMaxTraceIndex(0);
    setOriginalHasTrace(false);
    setSpecializedHasTrace(false);
    setPendingSyncAutoplayRunId(runId);
    setRunModel({
      runId,
      functionSpec: sourceFunction.spec,
      fullInputs,
    });
    setSpecializedRunRequest({
      runId,
      sourceFunctionSpec: sourceFunction.spec,
      sourceArity: sourceFunction.arity,
      freeVariableIndices: specializedModel?.freeVariableIndices ?? [],
      fixedVariables: fixedVariableMap,
      initialRegisters: specializedInitialRegisters,
      headerTitle: "Specialized function",
      headerCallLatex: specializedCallLatex,
    });
  }

  return (
    <div className="page-stack compute-page smn-page">
      <section className="page-intro page-intro-compact">
        <div className="page-intro-copy">
          <h2 className="page-title">S-m-n</h2>
          <p className="page-copy">
            Fix some inputs of a function to create a new specialized function.
          </p>
        </div>
      </section>

      <FunctionCard>
        <FunctionCardRows>
          <FunctionCardRow>
            <FunctionCardLabel style={smnInfoLabelStyle}>Definition</FunctionCardLabel>
            <FunctionCardMath className="smn-stage-expression smn-stage-expression-definition" style={smnMathExpressionBlockStyle}>
              <KatexMath expression={sourceDefinitionLatex} />
            </FunctionCardMath>

            <FunctionCardControls className="smn-stage-controls smn-definition-controls" style={smnControlsClusterStyle}>
                <div style={smnDefinitionPickerGroupStyle}>
                  <div style={smnFormulaRowStyle}>
                    <InlineMath value="f" />
                    <span style={smnFormulaEqualsStyle}>=</span>
                    <select
                      value={selectedSourceId}
                      onChange={(event) => setSelectedSourceId(event.target.value)}
                      style={smnInlineSelectStyle}
                      className="dashboard-control runner-toolbar-select"
                    >
                      {SUPPORTED_SMN_SOURCES.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.label}
                        </option>
                      ))}
                    </select>
                    {selectedSourceId === "constant" ? (
                      <label style={smnInlineParameterStyle}>
                        <InlineMath value="k" />
                        <span style={smnFormulaEqualsStyle}>=</span>
                        <input
                          type="number"
                          min="0"
                          value={constantValue}
                          onChange={(event) => {
                            setConstantValue(event.target.value);
                            setRunModel(null);
                            setSpecializedRunRequest(null);
                          }}
                          style={smnInlineNumberStyle}
                          className="dashboard-control runner-toolbar-number-input"
                        />
                      </label>
                    ) : null}
                  </div>
                </div>
            </FunctionCardControls>
          </FunctionCardRow>

          <FunctionCardRow>
            <FunctionCardLabel style={smnInfoLabelStyle}>Specialization</FunctionCardLabel>
            <FunctionCardMath className="smn-stage-expression smn-stage-expression-specialization" style={smnMathExpressionStackStyle}>
              <KatexMath expression={specializedDefinitionLatex} />
            </FunctionCardMath>

            <FunctionCardControls className="smn-stage-controls smn-specialization-block" style={smnControlsClusterStyle}>
                {sourceVariableNames.map((variableName, index) => {
                  const isFixed = Boolean(fixedSelections[index]);

                  return (
                    <div key={variableName} className="smn-specialization-row" style={smnVariableControlUnitStyle}>
                      <div style={smnVariableIdentityStyle}>
                        <InlineMath value={variableName} />
                      </div>
                      <label style={smnVariableToggleLabelStyle}>
                        <input
                          type="checkbox"
                          checked={isFixed}
                          onChange={() => handleToggleFixed(index)}
                          style={smnVariableCheckboxStyle}
                        />
                        <span style={smnVariableToggleTextStyle}>Fix</span>
                      </label>
                      {isFixed ? (
                        <label style={smnVariableFixedInputWrapStyle}>
                          <span style={smnVariableFixedAtStyle}>at</span>
                          <input
                            type="number"
                            min="0"
                            value={fixedInputs[index] ?? "0"}
                            onChange={(event) => handleFixedValueChange(index, event.target.value)}
                            style={smnDenseNumberInputStyle}
                            className="dashboard-control runner-toolbar-number-input"
                          />
                        </label>
                      ) : null}
                    </div>
                  );
                })}
            </FunctionCardControls>
          </FunctionCardRow>

          <FunctionCardRow>
            <FunctionCardLabel style={smnInfoLabelStyle}>Current call</FunctionCardLabel>
            <FunctionCardMath className="smn-stage-expression smn-stage-expression-call" style={smnCurrentCallMathAreaStyle}>
              <div style={smnCurrentCallDisplayStyle}>
                <KatexMath expression={currentCallLatex} />
              </div>
            </FunctionCardMath>

            <FunctionCardControls className="smn-stage-controls smn-call-controls" style={smnControlsClusterStyle}>
                <div style={smnRunControlsInlineStyle} className="smn-run-controls">
                  {specializedModel?.freeVariableIndices?.length ? (
                    <div style={smnFreeInputsRowsStyle} className="smn-free-inputs">
                      {specializedModel.freeVariableIndices.map((index) => (
                        <label key={index} style={smnFreeInputRowStyle}>
                          <span style={smnFreeInputLabelStyle} className="runner-inline-math-label">
                            <InlineMath value={`${sourceVariableNames[index]} =`} />
                          </span>
                          <input
                            type="number"
                            min="0"
                            value={freeInputs[index] ?? "0"}
                            onChange={(event) => handleFreeValueChange(index, event.target.value)}
                            style={smnDenseNumberInputStyle}
                            className="dashboard-control runner-toolbar-number-input"
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div style={smnZeroArityNoteStyle}>
                      <InlineMath value="g\\left(\\right)" /> is 0-ary and ready to run.
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleRunSpecializedFunction}
                    style={smnRunButtonStyle}
                    className="app-primary-button runner-run-button"
                  >
                    Run specialized function
                  </button>
                </div>
            </FunctionCardControls>
          </FunctionCardRow>

          {constantValueInvalid ? (
            <div style={smnValidationStyle}>Enter a nonnegative value for k before specializing the constant function.</div>
          ) : null}

          {validationMessage ? (
            <div style={smnValidationStyle}>{validationMessage}</div>
          ) : null}
        </FunctionCardRows>
      </FunctionCard>

      {runModel ? (
        <section style={smnResultsShellStyle}>
          <div style={smnSyncToolbarStyle}>
            <label style={smnSyncToggleStyle}>
              <input
                type="checkbox"
                checked={syncPlaybackEnabled}
                onChange={handleToggleSyncPlayback}
                style={smnSyncCheckboxStyle}
              />
              <span style={smnSyncToggleTextStyle}>Sync playback</span>
            </label>

            {syncPlaybackEnabled ? (
              <div style={smnSyncTransportStyle} className="transport-group">
                <button
                  type="button"
                  onClick={handleSyncPrev}
                  disabled={!syncPlaybackReady || (originalTraceIndex === 0 && specializedTraceIndex === 0)}
                  className="transport-btn runner-sync-button"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={handleSyncPlayToggle}
                  disabled={!syncPlaybackReady}
                  className="transport-btn runner-sync-button"
                >
                  {syncIsPlaying ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={handleSyncNext}
                  disabled={!syncPlaybackReady || syncBothFinished}
                  className="transport-btn runner-sync-button"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>

          <div style={smnComparisonGridStyle} className="smn-comparison-grid">
            <section style={smnComparisonPanelStyle} className="smn-comparison-panel">
              <div className="smn-comparison-execution">
                <FunctionRunner
                  key={`smn-original-${runModel.runId}`}
                  fixedFunctionSpec={runModel.functionSpec}
                  initialInputs={runModel.fullInputs}
                  machinePanelHeaderContent={({ currentTraceIndex, maxTraceIndex }) => (
                    <div className="panel-header" style={smnPanelHeaderRowStyle}>
                      <div style={smnPanelHeaderTitleStyle}>Original function</div>
                      <div style={smnPanelHeaderMetaStyle}>
                        <div style={smnPanelHeaderMetaItemStyle}>
                          <span style={smnExecutionMetaLabelStyle}>Source:</span>
                          <span style={smnExecutionMetaValueStyle}>{getFunctionDisplayName(sourceFunction.spec)}</span>
                        </div>
                        <div style={smnPanelHeaderMetaItemStyle}>
                          <span style={smnExecutionMetaLabelStyle}>Call:</span>
                          <span style={smnExecutionMetaMathStyle}>
                            <KatexMath expression={originalCallLatex} />
                          </span>
                        </div>
                      </div>
                      <div style={smnPanelHeaderStepStyle}>TRACE STEP {currentTraceIndex} / {maxTraceIndex}</div>
                    </div>
                  )}
                  hideMachinePanelSectionCaptions
                  machinePanelTraceCompact
                  showPlaybackSummary={false}
                  playbackExternallyControlled={syncPlaybackEnabled}
                  externalTraceIndex={originalTraceIndex}
                  externalIsPlaying={syncIsPlaying}
                  onExternalTraceIndexChange={setOriginalTraceIndex}
                  onExternalIsPlayingChange={setSyncIsPlaying}
                  playbackControlsDisabled={syncPlaybackEnabled}
                  onPlaybackInfoChange={({ currentTraceIndex, maxTraceIndex, hasTrace }) => {
                    setOriginalTraceIndex(currentTraceIndex);
                    setOriginalMaxTraceIndex(maxTraceIndex);
                    setOriginalHasTrace(hasTrace);
                  }}
                  showFunctionModeSelector={false}
                  hideToolbar
                  autoRunOnMount
                />
              </div>
            </section>

            <section style={smnComparisonPanelStyle} className="smn-comparison-panel">
              <div className="smn-comparison-execution">
                <SpecializedProgramRunner
                  request={specializedRunRequest}
                  playbackExternallyControlled={syncPlaybackEnabled}
                  externalTraceIndex={specializedTraceIndex}
                  externalIsPlaying={syncIsPlaying}
                  onExternalTraceIndexChange={setSpecializedTraceIndex}
                  onExternalIsPlayingChange={setSyncIsPlaying}
                  playbackControlsDisabled={syncPlaybackEnabled}
                  onPlaybackInfoChange={({ currentTraceIndex, maxTraceIndex, hasTrace }) => {
                    setSpecializedTraceIndex(currentTraceIndex);
                    setSpecializedMaxTraceIndex(maxTraceIndex);
                    setSpecializedHasTrace(hasTrace);
                  }}
                />
              </div>
            </section>
          </div>
        </section>
      ) : null}

      <FurtherReading items={["Cutland, Computability, §4.4"]} />
    </div>
  );
}

const smnFormulaRowStyle = {
  display: "inline-flex",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: 8,
  minWidth: 0,
  color: "var(--compute-text)",
  fontFamily: "var(--font-math)",
};

const smnFormulaEqualsStyle = {
  ...TYPOGRAPHY.styles.codeStrong,
  color: "var(--compute-text)",
  fontSize: TYPOGRAPHY.sizes.lg,
};

const smnInlineSelectStyle = {
  minWidth: 160,
  height: 36,
  padding: "4px 28px 4px 8px",
  border: "1px solid var(--input-border)",
  borderRadius: RADII.control,
  background: "var(--input-bg)",
  color: "var(--input-text)",
};

const smnInlineParameterStyle = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 6,
  flexWrap: "wrap",
};

const smnInlineNumberStyle = {
  ...TYPOGRAPHY.styles.code,
  width: 76,
  height: 34,
  padding: "0 8px",
  borderRadius: RADII.control,
  textAlign: "center",
};

const smnInfoLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--compute-structural)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  paddingTop: 3,
};

const smnDefinitionPickerGroupStyle = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  minWidth: 0,
  color: "var(--compute-text)",
};

const smnMathExpressionBlockStyle = {
  minWidth: 0,
  color: "var(--compute-text)",
};

const smnMathExpressionStackStyle = {
  display: "grid",
  gap: 2,
  minWidth: 0,
  color: "var(--compute-text)",
};

const smnControlsClusterStyle = {
  minWidth: 0,
  color: "var(--compute-text)",
};

const smnVariableControlUnitStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  minHeight: 30,
  color: "var(--compute-text)",
};

const smnVariableIdentityStyle = {
  minWidth: 22,
  display: "inline-flex",
  alignItems: "center",
};

const smnVariableToggleLabelStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "var(--compute-text)",
};

const smnVariableCheckboxStyle = {
  margin: 0,
  inlineSize: 15,
  blockSize: 15,
  accentColor: "var(--compute-accent)",
};

const smnVariableToggleTextStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--compute-structural)",
  letterSpacing: "0.03em",
};

const smnVariableFixedInputWrapStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const smnVariableFixedAtStyle = {
  ...TYPOGRAPHY.styles.uiText,
  color: "var(--compute-secondary)",
};

const smnDenseNumberInputStyle = {
  ...TYPOGRAPHY.styles.code,
  width: 72,
  height: 30,
  padding: "0 6px",
  borderRadius: RADII.control,
  textAlign: "center",
};

const smnCurrentCallDisplayStyle = {
  display: "inline-grid",
  justifyItems: "start",
  padding: "2px 0",
  minWidth: 0,
};

const smnCurrentCallMathAreaStyle = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
};

const smnRunControlsInlineStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  flexWrap: "nowrap",
  gap: 8,
  minWidth: 0,
  width: "100%",
};

const smnFreeInputsRowsStyle = {
  display: "inline-flex",
  flexWrap: "nowrap",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  flex: "0 1 auto",
};

const smnFreeInputRowStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flex: "0 0 auto",
};

const smnFreeInputLabelStyle = {
  display: "inline-flex",
  alignItems: "center",
  color: "var(--compute-text)",
};

const smnZeroArityNoteStyle = {
  ...TYPOGRAPHY.styles.uiText,
  color: "var(--compute-secondary)",
};

const smnValidationStyle = {
  ...TYPOGRAPHY.styles.uiText,
  color: "var(--feedback-error-text)",
};

const smnRunButtonStyle = {
  minHeight: 36,
  padding: "0 14px",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

const smnRunnerStateStyle = {
  ...TYPOGRAPHY.styles.uiText,
  padding: "12px 14px",
  border: "1px solid color-mix(in srgb, var(--compute-border) 84%, var(--compute-text) 16%)",
  borderRadius: RADII.panel,
  background: "var(--compute-surface-alt)",
  color: "var(--compute-secondary)",
};

const smnRunnerErrorStyle = {
  ...smnRunnerStateStyle,
  color: "var(--feedback-error-text)",
};

const smnSyncToolbarStyle = {
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

const smnSyncToggleStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const smnSyncCheckboxStyle = {
  margin: 0,
  inlineSize: 15,
  blockSize: 15,
  accentColor: "var(--compute-accent)",
};

const smnSyncToggleTextStyle = {
  ...TYPOGRAPHY.styles.uiText,
  color: "var(--compute-text)",
  whiteSpace: "nowrap",
};

const smnSyncTransportStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  minWidth: 0,
};

const smnResultsShellStyle = {
  display: "grid",
  gap: 12,
};

const smnComparisonGridStyle = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  alignItems: "start",
};

const smnComparisonPanelStyle = {
  display: "grid",
  gap: 12,
  alignContent: "start",
};

const smnPanelHeaderTitleStyle = {
  ...TYPOGRAPHY.styles.uiStrong,
  fontSize: TYPOGRAPHY.sizes.lg,
  color: "var(--compute-text)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

const smnPanelHeaderRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
  width: "100%",
};

const smnPanelHeaderMetaStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
  flex: "1 1 auto",
  color: "var(--compute-secondary)",
};

const smnPanelHeaderMetaItemStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};

const smnPanelHeaderStepStyle = {
  ...TYPOGRAPHY.styles.codeStrong,
  color: "var(--compute-secondary)",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

const smnExecutionMetaStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
};

const smnExecutionMetaItemStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: 6,
  color: "var(--compute-text)",
};

const smnExecutionMetaLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--compute-structural)",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

const smnExecutionMetaValueStyle = {
  ...TYPOGRAPHY.styles.uiText,
  fontSize: TYPOGRAPHY.sizes.sm,
  color: "var(--compute-secondary)",
  whiteSpace: "nowrap",
};

const smnExecutionMetaMathStyle = {
  display: "inline-flex",
  alignItems: "center",
  color: "var(--compute-secondary)",
  whiteSpace: "nowrap",
};
