import { useEffect, useMemo, useState } from "react";
import ByHandEvaluationCard from "./ByHandEvaluationCard.jsx";
import MachinePanel from "./MachinePanel";
import NestedEvaluationPanel from "./NestedEvaluationPanel";
import FunctionSpecBuilder, {
  COMPOSITION_FUNCTION_ORDER,
  expressionSelectStyle,
  normalizeFunctionSpec,
  validateFunctionSpec,
} from "./FunctionSpecBuilder";
import FunctionExpressionView, {
  buildFunctionCallNode,
  buildFunctionExpressionNode,
  createExpressionText,
} from "./FunctionExpressionView.jsx";
import {
  buildComposedTraceView,
  getCompositionStageSummary,
} from "./compositionTraceView";
import { buildPrimitiveRecursionStepView } from "./primitiveRecursionStepView.js";
import { COLORS, RADII, TYPOGRAPHY } from "../theme.js";
import {
  FUNCTION_ORDER,
  getFunctionDisplayName,
  normalizeFunctionKind,
} from "../functionMetadata.js";
import FunctionDefinitionPreview from "./FunctionDefinitionPreview.jsx";
import PrimitiveRecursionDefinitionPreview from "./PrimitiveRecursionDefinitionPreview.jsx";
import { InlineMath, MathEquals } from "./MathText.jsx";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
console.log("VITE_API_URL:", import.meta.env.VITE_API_URL);
console.log("API_URL used:", API_URL);
const DEFAULT_FUNCTION_SPEC = { kind: "successor" };
const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];
const PLAYBACK_INTERVAL_MS = 800;
const CONSTANT_FUNCTION_NOTE = "In this UI, constant(k) and zero are treated as 1-ary functions.";

function getVariableNames(count) {
  return Array.from({ length: count }, (_, index) => VARIABLE_NAMES[index] ?? `x${index + 1}`);
}

function getPrimitiveParameterNames(count) {
  const primitiveNames = ["x", "y", "z"];
  return Array.from({ length: count }, (_, index) => primitiveNames[index] ?? `x${index + 1}`);
}

function buildPrimitiveFunctionArgumentNames(baseArity, recursionIndex = 0) {
  const parameterNames = getPrimitiveParameterNames(Math.max(baseArity, 0));
  const totalArity = Math.max((Number.isInteger(baseArity) ? baseArity : 0) + 1, 1);
  const safeRecursionIndex =
    Number.isInteger(recursionIndex) && recursionIndex >= 0
      ? Math.min(recursionIndex, Math.max(totalArity - 1, 0))
      : 0;
  const args = [];
  let parameterCursor = 0;

  for (let index = 0; index < totalArity; index += 1) {
    if (index === safeRecursionIndex) {
      args.push("n");
      continue;
    }

    args.push(parameterNames[parameterCursor] ?? `x${parameterCursor + 1}`);
    parameterCursor += 1;
  }

  return {
    args,
    parameterNames,
    recursionIndex: safeRecursionIndex,
  };
}

function getPrimitiveStepArgumentNames(baseArity) {
  return ["n", "previous", ...getPrimitiveParameterNames(Math.max(baseArity, 0))];
}

function formatArgumentTuple(argumentNames) {
  return `(${argumentNames.join(", ")})`;
}

function formatFunctionCall(name, args) {
  return args.length > 0 ? `${name}(${args.join(", ")})` : `${name}()`;
}

function getPrimitiveEquationModel(baseArity, recursionIndex = 0) {
  const knownBaseArity = Number.isInteger(baseArity) && baseArity >= 0;
  const argumentModel = knownBaseArity
    ? buildPrimitiveFunctionArgumentNames(baseArity, recursionIndex)
    : { args: ["n", "x"], parameterNames: ["x"] };
  const parameterNames = knownBaseArity ? argumentModel.parameterNames : ["x"];
  const baseArgs = knownBaseArity
    ? argumentModel.args.map((value, index) => (index === argumentModel.recursionIndex ? "0" : value))
    : ["0", "x"];
  const stepArgs = knownBaseArity
    ? argumentModel.args.map((value, index) => (index === argumentModel.recursionIndex ? "n + 1" : value))
    : ["n + 1", "x"];
  const previousArgs = knownBaseArity
    ? argumentModel.args.map((value, index) => (index === argumentModel.recursionIndex ? "n" : value))
    : ["n", "x"];
  const baseLeft = formatFunctionCall("f", baseArgs);
  const stepLeft = formatFunctionCall("f", stepArgs);
  const previousValueCall = formatFunctionCall("f", previousArgs);
  const baseCaseCall = knownBaseArity ? formatFunctionCall("g", parameterNames) : "g(x)";
  const stepFunctionCall = knownBaseArity
    ? formatFunctionCall("h", ["n", previousValueCall, ...parameterNames])
    : "h(n, f(n, x), x)";
  const definitionTitle = knownBaseArity
    ? `Define ${formatFunctionCall("f", argumentModel.args)} by primitive recursion`
    : "Define f(n, x) by primitive recursion";
  const labeledStepArgs = knownBaseArity
    ? `h(${["n = n", `previous = ${previousValueCall}`, ...parameterNames.map((name) => `${name} = ${name}`)].join(", ")})`
    : "h(n = n, previous = f(n, x), x = x)";

  return {
    knownBaseArity,
    parameterNames,
    definitionTitle,
    baseLeft,
    stepLeft,
    previousValueCall,
    baseArgs: baseCaseCall,
    stepArgs: stepFunctionCall,
    labeledStepArgs,
    callSignature: knownBaseArity ? formatFunctionCall("f", argumentModel.args) : "f(n, x)",
    sampleCall(values) {
      return formatFunctionCall("f", values.map((value) => String(value ?? 0)));
    },
  };
}

function createDefaultFunctionSpec(kind = "successor") {
  if (kind === "constant") {
    return { kind, value: 3 };
  }

  if (kind === "projection") {
    return { kind, index: 1, arity: 1 };
  }

  if (kind === "compose") {
    return {
      kind,
      outer: createDefaultFunctionSpec("successor"),
      inner: createDefaultFunctionSpec("add"),
    };
  }

  if (kind === "primrec") {
    return {
      kind,
      base: createDefaultFunctionSpec("constant"),
      step: createDefaultFunctionSpec("successor"),
      recursion_index: 0,
    };
  }

  return { kind };
}

function updatePrimitiveRecursionIndex(spec, rawValue) {
  return {
    ...spec,
    recursion_index: rawValue === "" ? "" : Number(rawValue),
  };
}

function updateFunctionNumberField(spec, field, rawValue) {
  return {
    ...spec,
    [field]: rawValue === "" ? "" : Number(rawValue),
  };
}

function PrimitiveEvaluateField({ label, value, onChange, min = undefined }) {
  return (
    <label style={primitiveEvaluateFieldStyle} className="runner-variable-field">
      <span style={primitiveEvaluateLabelStyle}>
        <InlineMath value={label} />
        <MathEquals style={{ marginLeft: 4 }} />
      </span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={onChange}
        style={primitiveEvaluateInputStyle}
        className="dashboard-control runner-variable-input runner-toolbar-number-input"
      />
    </label>
  );
}

function SimpleModeParameterControls({ spec, onChange }) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "constant" || kind === "const") {
    return (
      <label style={simpleMetaControlStyle}>
        <span style={simpleMetaLabelStyle}>Value</span>
        <input
          type="number"
          value={spec?.value ?? ""}
          onChange={(e) => onChange((current) => updateFunctionNumberField(current, "value", e.target.value))}
          style={simpleMetaNumberStyle}
          className="dashboard-control runner-toolbar-number-input"
        />
      </label>
    );
  }

  if (kind === "projection" || kind === "proj") {
    return (
      <div style={simpleMetaControlStyle}>
        <span style={simpleMetaLabelStyle}>Projection</span>
        <div style={simpleProjectionFieldsStyle}>
          <label style={simpleInlineMetaFieldStyle}>
            <span style={simpleInlineMetaLabelStyle}>i</span>
            <input
              type="number"
              min="1"
              value={spec?.index ?? ""}
              onChange={(e) => onChange((current) => updateFunctionNumberField(current, "index", e.target.value))}
              style={simpleMetaNumberStyle}
              className="dashboard-control runner-toolbar-number-input"
            />
          </label>
          <label style={simpleInlineMetaFieldStyle}>
            <span style={simpleInlineMetaLabelStyle}>n</span>
            <input
              type="number"
              min="1"
              value={spec?.arity ?? ""}
              onChange={(e) => onChange((current) => updateFunctionNumberField(current, "arity", e.target.value))}
              style={simpleMetaNumberStyle}
              className="dashboard-control runner-toolbar-number-input"
            />
          </label>
        </div>
      </div>
    );
  }

  return null;
}

function PrimitiveDefinitionTitle({ callExpression }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
      <span>Define</span>
      <FunctionExpressionView expression={callExpression} size="lg" />
      <span>by primitive recursion</span>
    </div>
  );
}

function buildStepAdaptation(baseArity, selectedStepArity) {
  if (!Number.isInteger(baseArity) || baseArity < 0 || !Number.isInteger(selectedStepArity) || selectedStepArity < 0) {
    return null;
  }

  const expectedArgs = getPrimitiveStepArgumentNames(baseArity);
  const runtimePriority = ["previous", "n", ...getVariableNames(Math.max(baseArity, 0))];

  if (selectedStepArity === expectedArgs.length) {
    return {
      mode: "exact",
      expectedArgs,
      usedArgs: expectedArgs,
      ignoredArgs: [],
    };
  }

  if (selectedStepArity < expectedArgs.length) {
    const usedArgs = runtimePriority.slice(0, selectedStepArity);
    const ignoredArgs = expectedArgs.filter((name) => !usedArgs.includes(name));

    return {
      mode: "adapted",
      expectedArgs,
      usedArgs,
      ignoredArgs,
      runtimePriority,
    };
  }

  return {
    mode: "incompatible",
    expectedArgs,
    usedArgs: expectedArgs,
    ignoredArgs: [],
  };
}

function derivePrimitiveRecursionDetails(spec) {
  const baseArity = deriveFunctionArity(spec?.base);
  const stepArity = deriveFunctionArity(spec?.step);

  if (baseArity.status === "incompatible") {
    return baseArity;
  }

  if (stepArity.status === "incompatible") {
    return stepArity;
  }

  if (baseArity.status !== "known") {
    return {
      status: "unknown",
      source: "Choose a base case with a known arity to infer primitive recursion inputs.",
      baseArity: null,
      selectedStepArity: stepArity.status === "known" ? stepArity.arity : null,
      requiredStepArity: null,
      resultingArity: null,
      stepArgumentNames: [],
      compatibility: "unknown",
      adaptation: null,
    };
  }

  const requiredStepArity = baseArity.arity + 2;
  const resultingArity = baseArity.arity + 1;
  const stepArgumentNames = getPrimitiveStepArgumentNames(baseArity.arity);

  if (stepArity.status !== "known") {
    return {
      status: "unknown",
      source: "Choose a step function with a known arity to infer primitive recursion inputs.",
      baseArity: baseArity.arity,
      selectedStepArity: null,
      requiredStepArity,
      resultingArity,
      stepArgumentNames,
      compatibility: "unknown",
      adaptation: null,
    };
  }

  const adaptation = buildStepAdaptation(baseArity.arity, stepArity.arity);

  if (stepArity.arity > requiredStepArity) {
    return {
      status: "incompatible",
      source: "The selected step function needs more inputs than this primitive recursion provides.",
      detail: `The selected base case has arity ${baseArity.arity}, so the step function must take ${requiredStepArity} arguments: ${formatArgumentTuple(stepArgumentNames)}. The selected step function currently has arity ${stepArity.arity}.`,
      baseArity: baseArity.arity,
      selectedStepArity: stepArity.arity,
      requiredStepArity,
      resultingArity,
      stepArgumentNames,
      compatibility: "incompatible",
      adaptation,
    };
  }

  if (stepArity.arity < requiredStepArity) {
    const usedArgs = adaptation?.usedArgs ?? [];
    const ignoredArgs = adaptation?.ignoredArgs ?? [];
    const ignoredText = ignoredArgs.length > 0 ? ` and ignore ${ignoredArgs.join(", ")}` : "";
    const usageText = usedArgs.length > 0 ? usedArgs.join(", ") : "no arguments";

    return {
      status: "known",
      arity: resultingArity,
      source: `Primitive recursion inferred from base arity ${baseArity.arity} and an adapted step arity ${stepArity.arity}.`,
      detail: `Mathematically the step function is expected to take ${requiredStepArity} arguments ${formatArgumentTuple(stepArgumentNames)}. The selected step function has arity ${stepArity.arity}, so the current runtime will adapt it to use ${usageText}${ignoredText}.`,
      baseArity: baseArity.arity,
      selectedStepArity: stepArity.arity,
      requiredStepArity,
      resultingArity,
      stepArgumentNames,
      compatibility: "adapted",
      adaptation,
      parameterCount: baseArity.arity,
    };
  }

  return {
    status: "known",
    arity: resultingArity,
    source: `Primitive recursion inferred from base arity ${baseArity.arity} and step arity ${stepArity.arity}.`,
    detail: `The selected base case has arity ${baseArity.arity}, so the step function must take ${requiredStepArity} arguments: ${formatArgumentTuple(stepArgumentNames)}.`,
    baseArity: baseArity.arity,
    selectedStepArity: stepArity.arity,
    requiredStepArity,
    resultingArity,
    stepArgumentNames,
    compatibility: "exact",
    adaptation,
    parameterCount: baseArity.arity,
  };
}

function deriveFunctionArity(spec) {
  const kind = normalizeFunctionKind(spec?.kind);

  if (kind === "successor" || kind === "succ") {
    return { status: "known", arity: 1, source: "successor uses one input register" };
  }

  if (kind === "add" || kind === "addition") {
    return { status: "known", arity: 2, source: "add uses two inputs" };
  }

  if (kind === "bounded_sub" || kind === "sub" || kind === "truncated_sub" || kind === "truncated_subtraction") {
    return { status: "known", arity: 2, source: "bounded subtraction uses two inputs" };
  }

  if (kind === "projection" || kind === "proj") {
    const arity = Number(spec?.arity);

    if (Number.isInteger(arity) && arity >= 0) {
      return { status: "known", arity, source: "projection arity comes from the selected parameter" };
    }

    return { status: "unknown", source: "projection needs an explicit arity value" };
  }

  if (kind === "compose") {
    if (!spec?.inner) {
      return { status: "unknown", source: "compose needs an inner function to infer visible inputs" };
    }

    const innerArity = deriveFunctionArity(spec.inner);

    if (innerArity.status === "known") {
      return { status: "known", arity: innerArity.arity, source: "compose uses the inner function arity" };
    }

    return innerArity;
  }

  if (kind === "zero" || kind === "constant" || kind === "const") {
    return { status: "known", arity: 1, source: CONSTANT_FUNCTION_NOTE };
  }

  if (kind === "primrec" || kind === "primitive_rec" || kind === "primitive_recursion") {
    return derivePrimitiveRecursionDetails(spec);
  }

  return { status: "unknown", source: "this function kind does not have a UI arity rule yet" };
}

function buildPrimitiveRecursionInputs(arity, recursionIndex, registerValues) {
  if (!Number.isInteger(arity) || arity <= 0) {
    return { recursionField: null, parameterFields: [] };
  }

  const values = resizeInputs(registerValues, arity);
  const parameterNames = getVariableNames(Math.max(arity - 1, 0));
  let parameterCursor = 0;
  let recursionField = null;
  const parameterFields = [];

  for (let index = 0; index < arity; index += 1) {
    const field = {
      index,
      value: values[index] ?? 0,
    };

    if (index === recursionIndex) {
      recursionField = {
        ...field,
        label: "n",
        description: "Recursion input",
      };
      continue;
    }

    parameterFields.push({
      ...field,
      label: parameterNames[parameterCursor] ?? `x${parameterCursor + 1}`,
      description: "Parameter",
    });
    parameterCursor += 1;
  }

  return { recursionField, parameterFields };
}

function mapRunErrorMessage(rawMessage, functionSpec) {
  if (!rawMessage) {
    return "Unable to run the selected function.";
  }

  if (!isPrimitiveRecursionSpec(functionSpec)) {
    return rawMessage;
  }

  if (rawMessage.includes("recursion_index is out of range")) {
    return "The recursion input position is outside the inferred input list.";
  }

  if (rawMessage.includes("recursion input must be a nonnegative integer")) {
    return "The recursion input n must be a nonnegative integer.";
  }

  if (rawMessage.includes("requires `base`")) {
    return "Choose a base case before running primitive recursion.";
  }

  if (rawMessage.includes("requires `step`")) {
    return "Choose a step function before running primitive recursion.";
  }

  return rawMessage.startsWith("Request failed:")
    ? "Cannot build primitive recursion from the selected functions."
    : rawMessage;
}

function resizeInputs(values, nextLength) {
  if (nextLength <= 0) return [];
  return Array.from({ length: nextLength }, (_, index) => values[index] ?? 0);
}

function isPrimitiveRecursionSpec(spec) {
  const kind = normalizeFunctionKind(spec?.kind);
  return kind === "primrec" || kind === "primitive_rec" || kind === "primitive_recursion";
}

export default function FunctionRunner({
  initialFunctionSpec = DEFAULT_FUNCTION_SPEC,
  initialInputs = [7],
  fixedFunctionSpec = null,
  showFunctionModeSelector = true,
  autoRunOnMount = false,
}) {
  const [functionSpec, setFunctionSpec] = useState(() => fixedFunctionSpec ?? initialFunctionSpec);
  const [registerValues, setRegisterValues] = useState(() => [...initialInputs]);

  const [runData, setRunData] = useState(null);
  const [currentTraceIndex, setCurrentTraceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const [isPrimitiveSetupExpanded, setIsPrimitiveSetupExpanded] = useState(true);

  async function handleRunFunction() {
    try {
      setError("");

      const validationError = validateFunctionSpec(functionSpec);

      if (validationError) {
        throw new Error(validationError);
      }

      const payload = {
        function: normalizeFunctionSpec(functionSpec),
        initial_registers: registerValues,
      };

      const response = await fetch(`${API_URL}/run-function`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
      setRunData(json);
      setCurrentTraceIndex(0);
      setIsPlaying(false);
    } catch (err) {
      setError(mapRunErrorMessage(err.message, functionSpec));
    }
  }

  const composedTraceView = useMemo(() => buildComposedTraceView(runData), [runData]);
  const primitiveStepView = useMemo(() => buildPrimitiveRecursionStepView(runData), [runData]);
  const selectedPrimitiveStep = useMemo(() => {
    const groups = primitiveStepView?.stepGroups;
    if (!Array.isArray(groups)) return null;

    return groups.find((group) => {
      if (!Number.isInteger(group?.startRowIndex) || !Number.isInteger(group?.endRowIndex)) {
        return false;
      }
      return currentTraceIndex >= group.startRowIndex && currentTraceIndex <= group.endRowIndex;
    }) ?? null;
  }, [currentTraceIndex, primitiveStepView]);
  const selectedPrimitiveStepIndex = selectedPrimitiveStep?.stepIndex ?? null;
  const activeTrace = useMemo(
    () => composedTraceView?.trace ?? runData?.trace ?? [],
    [composedTraceView, runData],
  );
  const activeTraceLength = activeTrace.length;
  const playbackLength = activeTraceLength;
  const maxPlaybackIndex = Math.max(0, playbackLength - 1);
  const activeTraceRowIndex = currentTraceIndex;

  const currentRow = useMemo(() => {
    if (!runData || activeTraceLength === 0) return null;
    return activeTrace[activeTraceRowIndex] ?? null;
  }, [runData, activeTrace, activeTraceRowIndex, activeTraceLength]);

  useEffect(() => {
    if (!isPlaying || playbackLength === 0) return;

    if (currentTraceIndex >= playbackLength - 1) {
      setIsPlaying(false);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentTraceIndex((i) => i + 1);
    }, PLAYBACK_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [isPlaying, currentTraceIndex, playbackLength]);

  useEffect(() => {
    if (currentTraceIndex <= maxPlaybackIndex) return;
    setCurrentTraceIndex(maxPlaybackIndex);
  }, [currentTraceIndex, maxPlaybackIndex]);

  const stageSummary = composedTraceView
    ? getCompositionStageSummary(currentRow, composedTraceView.stageCount)
    : "";

  const panelProgram =
    composedTraceView && currentRow?.stageKey
      ? composedTraceView.programSections.find((section) => section.key === currentRow.stageKey)?.program ?? []
      : runData?.program ?? [];

  const panelFinalRegisters = composedTraceView?.finalRegisters ?? runData?.final_registers ?? [];
  const arityInfo = useMemo(() => deriveFunctionArity(functionSpec), [functionSpec]);

  function handleRegisterChange(index, rawValue) {
    setRegisterValues((current) =>
      current.map((value, valueIndex) =>
        valueIndex === index ? (rawValue === "" ? 0 : Number(rawValue)) : value
      )
    );
  }

  function handleAddRegister() {
    setRegisterValues((current) => [...current, 0]);
  }

  function handleRemoveRegister(index) {
    setRegisterValues((current) => current.filter((_, valueIndex) => valueIndex !== index));
  }

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

  useEffect(() => {
    if (!fixedFunctionSpec) return;

    setFunctionSpec((current) => {
      const currentNormalized = JSON.stringify(normalizeFunctionSpec(current));
      const fixedNormalized = JSON.stringify(normalizeFunctionSpec(fixedFunctionSpec));
      return currentNormalized === fixedNormalized ? current : fixedFunctionSpec;
    });
  }, [fixedFunctionSpec]);

  useEffect(() => {
    if (arityInfo.status !== "known") return;

    setRegisterValues((current) => {
      const nextValues = resizeInputs(current, arityInfo.arity);

      if (
        nextValues.length === current.length &&
        nextValues.every((value, index) => value === current[index])
      ) {
        return current;
      }

      return nextValues;
    });
  }, [arityInfo]);

  const inputCount = arityInfo.status === "known" ? arityInfo.arity : Math.max(registerValues.length, 2);
  const variableNames = getVariableNames(inputCount);
  const visibleInputValues = resizeInputs(registerValues, inputCount);
  const isPrimitiveRecursion = isPrimitiveRecursionSpec(functionSpec);
  const primitiveRecursionIndex = Number(functionSpec?.recursion_index ?? 0);
  const primitiveArityInfo = isPrimitiveRecursion ? arityInfo : null;
  const primitiveEquationModel = useMemo(
    () => getPrimitiveEquationModel(primitiveArityInfo?.baseArity, primitiveRecursionIndex),
    [primitiveArityInfo?.baseArity, primitiveRecursionIndex],
  );
  const compositionLeftExpression = useMemo(
    () => buildFunctionCallNode("f", variableNames.map((name) => createExpressionText(name))),
    [variableNames],
  );
  const primitiveStructureMessage = useMemo(() => {
    if (!isPrimitiveRecursion) return "";

    if (!Number.isInteger(primitiveRecursionIndex) || primitiveRecursionIndex < 0) {
      return "Recursion input must be a nonnegative position.";
    }

    if (arityInfo.status === "incompatible") {
      return `${arityInfo.source} ${arityInfo.detail}`;
    }

    if (arityInfo.status !== "known") {
      return arityInfo.source;
    }

    if (primitiveRecursionIndex >= arityInfo.arity) {
      return "The recursion input position is outside the inferred input list.";
    }

    return "";
  }, [arityInfo, isPrimitiveRecursion, primitiveRecursionIndex]);
  const primitiveFields = useMemo(
    () =>
      isPrimitiveRecursion && arityInfo.status === "known" && primitiveRecursionIndex >= 0 && primitiveRecursionIndex < arityInfo.arity
        ? buildPrimitiveRecursionInputs(arityInfo.arity, primitiveRecursionIndex, registerValues)
        : { recursionField: null, parameterFields: [] },
    [arityInfo, isPrimitiveRecursion, primitiveRecursionIndex, registerValues],
  );
  const primitiveEvaluationInputs = useMemo(() => {
    if (!primitiveFields.recursionField) return [];

    return [
      {
        key: "n",
        label: "n",
        index: primitiveFields.recursionField.index,
        value: primitiveFields.recursionField.value,
        min: 0,
      },
      ...primitiveFields.parameterFields.map((field) => ({
        key: field.label,
        label: field.label,
        index: field.index,
        value: field.value,
      })),
    ];
  }, [primitiveFields]);
  const primitiveTitleArgs = useMemo(
    () =>
      primitiveEquationModel.knownBaseArity
        ? buildPrimitiveFunctionArgumentNames(primitiveArityInfo?.baseArity, primitiveRecursionIndex).args
        : ["n", "x"],
    [primitiveArityInfo?.baseArity, primitiveEquationModel.knownBaseArity, primitiveRecursionIndex],
  );
  const disableRun = Boolean(primitiveStructureMessage);
  const showByHandEvaluation = arityInfo.status === "known" && !primitiveStructureMessage;
  const maxTraceIndex = maxPlaybackIndex;
  const playbackProgressPercent = maxTraceIndex === 0
    ? 0
    : Math.round((currentTraceIndex / maxTraceIndex) * 100);
  const hasPrimitiveTrace = isPrimitiveRecursion && activeTraceLength > 0;
  const nonPrimitiveKind = normalizeFunctionKind(functionSpec?.kind);
  const useExpandedDefinitionLayout = nonPrimitiveKind === "compose";
  const primitiveTitleExpression = useMemo(
    () => buildFunctionCallNode(
      "f",
      primitiveTitleArgs.map((value) => createExpressionText(value)),
    ),
    [primitiveTitleArgs],
  );
  const primitiveBuilderLayout = useMemo(() => {
    const args = primitiveTitleArgs.length > 0 ? primitiveTitleArgs : ["n", "x"];
    const safeIndex = Math.min(Math.max(primitiveRecursionIndex, 0), Math.max(args.length - 1, 0));
    const baseArgs = args.map((value, index) => (index === safeIndex ? "0" : value));
    const previousArgs = args.map((value, index) => (index === safeIndex ? "n" : value));
    const nextArgs = args.map((value, index) => (index === safeIndex ? "n+1" : value));
    const carriedArgs = args.filter((_, index) => index !== safeIndex);
    const previousCall = buildFunctionCallNode(
      "f",
      previousArgs.map((value) => createExpressionText(value)),
    );

    return {
      baseLeft: buildFunctionCallNode("f", baseArgs.map((value) => createExpressionText(value))),
      stepLeft: buildFunctionCallNode("f", nextArgs.map((value) => createExpressionText(value))),
      baseExpressionArgs: carriedArgs.map((value) => createExpressionText(value)),
      stepExpressionArgs: [
        createExpressionText("n"),
        previousCall,
        ...carriedArgs.map((value) => createExpressionText(value)),
      ],
    };
  }, [primitiveRecursionIndex, primitiveTitleArgs]);

  useEffect(() => {
    if (!isPrimitiveRecursion) {
      setIsPrimitiveSetupExpanded(true);
      return;
    }

    if (hasPrimitiveTrace) {
      setIsPrimitiveSetupExpanded(false);
    }
  }, [hasPrimitiveTrace, isPrimitiveRecursion]);

  useEffect(() => {
    if (!autoRunOnMount) return;
    void handleRunFunction();
  // Intentionally run once for the configured initial demo/default state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="function-runner" style={{ marginBottom: 16 }}>
      <div className="runner-toolbar-shell">
        <div className={`runner-toolbar${isPrimitiveRecursion ? " runner-toolbar-primrec" : ""}`}>
          {isPrimitiveRecursion ? (
            <>
              <div style={primitiveEquationCardStyle}>
                <div style={primitiveBodyLayoutStyle}>
                  <div style={primitiveMainColumnStyle}>
                    <div style={primitiveDefinitionHeaderStyle}>
                      <PrimitiveDefinitionTitle callExpression={primitiveTitleExpression} />
                      {hasPrimitiveTrace ? (
                        <button
                          type="button"
                          onClick={() => setIsPrimitiveSetupExpanded((current) => !current)}
                          style={primitiveSetupToggleStyle}
                          className="app-secondary-button"
                          aria-expanded={isPrimitiveSetupExpanded}
                        >
                          {isPrimitiveSetupExpanded ? "Hide setup" : "Show setup"}
                        </button>
                      ) : null}
                    </div>

                    {isPrimitiveSetupExpanded ? (
                      <div style={primitiveBuilderBlockStyle}>
                        <div style={primitiveBuilderEquationStyle}>
                          <FunctionExpressionView expression={primitiveBuilderLayout.baseLeft} size="lg" style={expressionPreviewStyle} />
                          <MathEquals style={compositionEqualsStyle} />
                          <FunctionSpecBuilder
                            spec={functionSpec.base ?? { kind: "constant", value: 3 }}
                            onChange={(nextBase) => setFunctionSpec((current) => ({ ...current, base: nextBase }))}
                            title=""
                            layout="expressionChild"
                            expressionArgs={primitiveBuilderLayout.baseExpressionArgs}
                          />
                        </div>

                        <div style={primitiveBuilderEquationStyle}>
                          <FunctionExpressionView expression={primitiveBuilderLayout.stepLeft} size="lg" style={expressionPreviewStyle} />
                          <MathEquals style={compositionEqualsStyle} />
                          <FunctionSpecBuilder
                            spec={functionSpec.step ?? { kind: "successor" }}
                            onChange={(nextStep) => setFunctionSpec((current) => ({ ...current, step: nextStep }))}
                            title=""
                            layout="expressionChild"
                            expressionArgs={primitiveBuilderLayout.stepExpressionArgs}
                          />
                        </div>
                      </div>
                    ) : null}

                    <PrimitiveRecursionDefinitionPreview
                      functionSpec={functionSpec}
                      primitiveArityInfo={primitiveArityInfo}
                      recursionIndex={primitiveRecursionIndex}
                      inputValues={visibleInputValues}
                      title=""
                      showSchemaCalls={false}
                      showAuxiliary={false}
                    />
                  </div>

                  <div style={primitiveControlColumnStyle}>
                    <div style={primitiveControlClusterStyle}>
                      {showFunctionModeSelector ? (
                        <label style={compositionModeControlStyle}>
                          <span style={compositionModeLabelStyle}>Mode</span>
                          <select
                            value={normalizeFunctionKind(functionSpec?.kind)}
                            onChange={(e) => setFunctionSpec(createDefaultFunctionSpec(e.target.value))}
                            style={compositionModeSelectStyle}
                            className="dashboard-control runner-toolbar-select"
                          >
                            {FUNCTION_ORDER.map((option) => (
                              <option key={option} value={option}>
                                {getFunctionDisplayName(option)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}

                      <div style={primitiveEvaluationCardStyle}>
                        {primitiveEvaluationInputs.length > 0 ? (
                          <div style={primitiveEvaluateRowStyle}>
                            <div style={primitiveEvaluateActionRowStyle}>
                              <div style={primitiveEvaluateFieldsRowStyle}>
                                {primitiveEvaluationInputs.map((field) => (
                                  <PrimitiveEvaluateField
                                    key={field.key}
                                    label={field.label}
                                    value={field.value}
                                    min={field.min}
                                    onChange={(e) => handleRegisterChange(field.index, e.target.value)}
                                  />
                                ))}
                              </div>
                              <button
                                onClick={handleRunFunction}
                                style={primitiveRunButtonStyle}
                                className="app-primary-button runner-run-button"
                                disabled={disableRun}
                              >
                                Run
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={primitiveEvaluatePendingStyle}>
                            <div style={primitivePendingTextStyle}>
                              Input fields appear automatically once the definition has enough arity information.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={useExpandedDefinitionLayout ? compositionCardExpandedStyle : simpleDefinitionCardStyle}>
                {useExpandedDefinitionLayout ? (
                  <>
                    <div style={compositionBuilderShellStyle}>
                      <div style={compositionBuilderRowStyle}>
                        <FunctionExpressionView expression={compositionLeftExpression} size="lg" style={expressionPreviewStyle} />
                        <MathEquals style={compositionEqualsStyle} />
                        <FunctionSpecBuilder
                          spec={functionSpec}
                          onChange={setFunctionSpec}
                          title=""
                          layout="expressionChild"
                          allowedKinds={COMPOSITION_FUNCTION_ORDER}
                        />
                      </div>
                      {showFunctionModeSelector ? (
                        <label style={compositionModeControlStyle}>
                          <span style={compositionModeLabelStyle}>Mode</span>
                          <select
                            value={normalizeFunctionKind(functionSpec?.kind)}
                            onChange={(e) => setFunctionSpec(createDefaultFunctionSpec(e.target.value))}
                            style={compositionModeSelectStyle}
                            className="dashboard-control runner-toolbar-select"
                          >
                            {FUNCTION_ORDER.map((option) => (
                              <option key={option} value={option}>
                                {getFunctionDisplayName(option)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>

                    <div style={compositionSummaryRowStyle}>
                      <div style={compositionSummaryDefinitionStyle}>
                        <FunctionDefinitionPreview
                          functionSpec={functionSpec}
                          arityInfo={arityInfo}
                          inputValues={visibleInputValues}
                          title=""
                          showStructural={false}
                          compact
                          stackLabels
                        />
                      </div>

                      <div style={compositionSummaryControlsStyle}>
                        <div style={compositionControlsRowStyle} className="runner-inputs-lane">
                          <div style={variableEditorStyle} className="runner-inputs-strip">
                            {visibleInputValues.map((value, index) => (
                              <label key={index} style={variableFieldStyle} className="runner-variable-field">
                                <span style={variableLabelStyle} className="runner-variable-label">
                                  <InlineMath value={variableNames[index]} />
                                  <MathEquals style={{ marginLeft: 4 }} />
                                </span>
                                <input
                                  type="number"
                                  value={value}
                                  onChange={(e) => handleRegisterChange(index, e.target.value)}
                                  style={registerInputStyle}
                                  className="dashboard-control runner-variable-input runner-toolbar-number-input"
                                />
                                {arityInfo.status !== "known" && registerValues.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveRegister(index)}
                                    style={removeRegisterButtonStyle}
                                    aria-label={`Remove variable ${variableNames[index]}`}
                                  >
                                    ×
                                  </button>
                                )}
                              </label>
                            ))}

                            {arityInfo.status !== "known" && (
                              <button
                                type="button"
                                onClick={handleAddRegister}
                                style={addRegisterButtonStyle}
                                className="runner-add-register-button"
                                aria-label="Add variable"
                              >
                                +
                              </button>
                            )}
                          </div>
                          <button onClick={handleRunFunction} style={runButtonStyle} className="app-primary-button runner-run-button">
                            Run
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={simpleSummaryRowStyle}>
                    <div style={compositionSummaryDefinitionStyle}>
                      <FunctionDefinitionPreview
                        functionSpec={functionSpec}
                        arityInfo={arityInfo}
                        inputValues={visibleInputValues}
                        title=""
                        compact
                        stackLabels
                      />
                    </div>

                    <div style={simpleSummaryControlsStyle}>
                      {showFunctionModeSelector ? (
                        <label style={compositionModeControlStyle}>
                          <span style={compositionModeLabelStyle}>Mode</span>
                          <select
                            value={normalizeFunctionKind(functionSpec?.kind)}
                            onChange={(e) => setFunctionSpec(createDefaultFunctionSpec(e.target.value))}
                            style={compositionModeSelectStyle}
                            className="dashboard-control runner-toolbar-select"
                          >
                            {FUNCTION_ORDER.map((option) => (
                              <option key={option} value={option}>
                                {getFunctionDisplayName(option)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <SimpleModeParameterControls spec={functionSpec} onChange={setFunctionSpec} />
                      <div style={simpleEvaluateRowStyle}>
                        <div style={compositionControlsRowStyle} className="runner-inputs-lane">
                          <div style={variableEditorStyle} className="runner-inputs-strip">
                            {visibleInputValues.map((value, index) => (
                              <label key={index} style={variableFieldStyle} className="runner-variable-field">
                                <span style={variableLabelStyle} className="runner-variable-label">
                                  <InlineMath value={variableNames[index]} />
                                  <MathEquals style={{ marginLeft: 4 }} />
                                </span>
                                <input
                                  type="number"
                                  value={value}
                                  onChange={(e) => handleRegisterChange(index, e.target.value)}
                                  style={compactRegisterInputStyle}
                                  className="dashboard-control runner-variable-input runner-toolbar-number-input"
                                />
                                {arityInfo.status !== "known" && registerValues.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveRegister(index)}
                                    style={removeRegisterButtonStyle}
                                    aria-label={`Remove variable ${variableNames[index]}`}
                                  >
                                    ×
                                  </button>
                                )}
                              </label>
                            ))}

                            {arityInfo.status !== "known" && (
                              <button
                                type="button"
                                onClick={handleAddRegister}
                                style={addRegisterButtonStyle}
                                className="runner-add-register-button"
                                aria-label="Add variable"
                              >
                                +
                              </button>
                            )}
                          </div>
                          <button onClick={handleRunFunction} style={compactRunButtonStyle} className="app-primary-button runner-run-button">
                            Run
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {!isPrimitiveRecursion && arityInfo.status !== "known" && (
            <div style={arityHintStyle} className="runner-arity-hint">
              Arity not inferred: {arityInfo.source}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ color: "var(--feedback-error-text)", marginBottom: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      {runData && (
        <>
          <MachinePanel
            title={
              selectedPrimitiveStep
                ? `Execution: ${selectedPrimitiveStep.label}${selectedPrimitiveStep.callText ? ` — ${selectedPrimitiveStep.callText}` : ""}`
                : `Function: ${getFunctionDisplayName(runData.function)}`
            }
            program={panelProgram}
            row={currentRow}
            finalRegisters={panelFinalRegisters}
            trace={activeTrace}
            currentTraceIndex={activeTraceRowIndex}
            isPlaying={isPlaying}
            traceShowStepGroups
            playbackControls={(
              <div className="runner-playback-bar">
                <div className="runner-playback-actions">
                  <button
                    onClick={handlePrevStep}
                    disabled={currentTraceIndex === 0}
                    style={playbackButtonStyle}
                  >
                    Prev
                  </button>

                  <button
                    onClick={handleTogglePlayback}
                    disabled={playbackLength === 0}
                    style={playbackButtonStyle}
                  >
                    {isPlaying ? "Pause" : "Play"}
                  </button>

                  <button
                    onClick={handleNextStep}
                    disabled={currentTraceIndex >= playbackLength - 1}
                    style={playbackButtonStyle}
                  >
                    Next
                  </button>
                </div>
                <div className="runner-playback-slider-shell">
                  <input
                    type="range"
                    min="0"
                    max={maxTraceIndex}
                    value={currentTraceIndex}
                    onChange={(e) => {
                      setIsPlaying(false);
                      setCurrentTraceIndex(Number(e.target.value));
                    }}
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
                <div
                  className="runner-playback-meta runner-playback-summary"
                  style={playbackStepLabelStyle}
                >
                  <span className="runner-playback-summary-step">Step {currentTraceIndex} / {maxTraceIndex}</span>
                </div>
              </div>
            )}
            programSections={composedTraceView?.programSections ?? null}
            combinedProgramRows={composedTraceView?.combinedProgramRows ?? null}
            stageSummary={stageSummary}
            traceFooter={
              showByHandEvaluation ? (
                <ByHandEvaluationCard
                  functionSpec={functionSpec}
                  inputValues={visibleInputValues}
                  selectedStepIndex={selectedPrimitiveStepIndex}
                />
              ) : null
            }
          />
          {runData.evaluation && (
            !primitiveStepView && normalizeFunctionKind(runData.evaluation?.kind) !== "compose" ? (
              <div className="runner-evaluation-strip">
                <NestedEvaluationPanel
                  evaluation={runData.evaluation}
                  selectedStepIndex={selectedPrimitiveStepIndex}
                />
              </div>
            ) : null
          )}
        </>
      )}
    </div>
  );
}

const controlStyle = {
  ...TYPOGRAPHY.styles.uiText,
  height: 36,
  padding: "0 10px",
  border: "1px solid var(--input-border)",
  borderRadius: RADII.control,
  background: "var(--input-bg)",
  color: "var(--input-text)",
  WebkitTextFillColor: "var(--input-text)",
  boxSizing: "border-box",
};

const buttonStyle = {
  ...TYPOGRAPHY.styles.control,
  height: 36,
  padding: "0 12px",
  borderRadius: RADII.button,
  border: "1px solid var(--border-default)",
  background: "var(--surface-card)",
  fontWeight: TYPOGRAPHY.weights.regular,
  color: "var(--surface-text-primary)",
  cursor: "pointer",
  opacity: 1,
};

const compositionCardStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 7,
  width: "100%",
  padding: "4px 0 0",
  border: "none",
  borderRadius: RADII.panel,
  background: "transparent",
};

const simpleDefinitionCardStyle = {
  ...compositionCardStyle,
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: 12,
};

const compositionCardExpandedStyle = {
  ...compositionCardStyle,
  display: "grid",
  gap: 9,
  padding: "2px 0 0",
};

const compositionBuilderShellStyle = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  minWidth: 0,
  flexWrap: "wrap",
};

const compositionModeControlStyle = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 6,
  justifyItems: "start",
  flex: "0 0 auto",
};

const compositionModeLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  color: "var(--surface-text-structural)",
  opacity: 0.74,
};

const compositionModeSelectStyle = {
  ...expressionSelectStyle,
  minWidth: 140,
  width: "auto",
};

const compositionDefinitionRowStyle = {
  display: "inline-flex",
  flexWrap: "nowrap",
  alignItems: "baseline",
  gap: 2,
  minWidth: 0,
  flex: "1 1 auto",
  fontFamily: "var(--font-math)",
  color: "var(--surface-text-primary)",
};

const compositionBuilderRowStyle = {
  display: "inline-flex",
  flexWrap: "nowrap",
  alignItems: "baseline",
  gap: 0,
  minWidth: 0,
  flex: "1 1 auto",
  fontFamily: "var(--font-math)",
  color: "var(--surface-text-primary)",
};

const compositionEqualsStyle = {
  ...TYPOGRAPHY.styles.codeStrong,
  color: "var(--surface-text-primary)",
  fontSize: TYPOGRAPHY.sizes.lg,
};

const compositionSummaryRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "end",
  justifyContent: "space-between",
  gap: 10,
  width: "100%",
};

const compositionSummaryDefinitionStyle = {
  flex: "1 1 360px",
  minWidth: 0,
};

const compositionSummaryControlsStyle = {
  display: "grid",
  gap: 3,
  justifyItems: "end",
  flex: "0 1 360px",
  minWidth: 280,
};

const simpleSummaryRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "start",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
};

const simpleSummaryControlsStyle = {
  display: "grid",
  gap: 5,
  justifyItems: "end",
  alignContent: "start",
  flex: "0 1 320px",
  minWidth: 260,
};

const simpleMetaControlStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
  minWidth: 0,
  flexWrap: "wrap",
};

const simpleMetaLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  fontSize: TYPOGRAPHY.sizes.xs,
  color: "var(--surface-text-structural)",
  opacity: 0.72,
};

const simpleMetaNumberStyle = {
  ...controlStyle,
  ...TYPOGRAPHY.styles.code,
  width: 68,
  minWidth: 68,
  height: 28,
  padding: "0 6px",
  borderRadius: RADII.control,
  textAlign: "center",
};

const simpleProjectionFieldsStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 5,
  flexWrap: "wrap",
};

const simpleInlineMetaFieldStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const simpleInlineMetaLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  fontSize: TYPOGRAPHY.sizes.xs,
  color: "var(--surface-text-structural)",
  opacity: 0.72,
};

const compositionActionRowStyle = {
  display: "inline-flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  justifyContent: "flex-start",
  flex: "0 1 auto",
};

const compositionEvaluateLeadStyle = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 3,
  flexWrap: "wrap",
  justifyItems: "start",
  minWidth: 0,
  flex: "0 0 auto",
};

const compositionControlsRowStyle = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 3,
  minWidth: 0,
  flex: "0 1 auto",
  justifyContent: "flex-end",
};

const simpleEvaluateRowStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: 4,
  minWidth: 0,
};

const registerInputStyle = {
  ...controlStyle,
  ...TYPOGRAPHY.styles.code,
  width: 58,
  minWidth: 58,
  height: 36,
  padding: "0 6px",
  borderRadius: RADII.control,
  textAlign: "center",
};

const runButtonStyle = {
  height: 36,
  padding: "0 12px",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

const compactRegisterInputStyle = {
  ...registerInputStyle,
  height: 32,
};

const compactRunButtonStyle = {
  ...runButtonStyle,
  height: 32,
};

const variableEditorStyle = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "nowrap",
  gap: 4,
  minWidth: 0,
  flex: "0 1 auto",
};

const variableFieldStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: 0,
};

const variableLabelStyle = {
  fontFamily: "var(--font-math)",
  fontSize: TYPOGRAPHY.sizes.base,
  fontWeight: TYPOGRAPHY.weights.regular,
  lineHeight: TYPOGRAPHY.lineHeights.normal,
  color: "var(--surface-text-primary)",
  whiteSpace: "nowrap",
};

const expressionPreviewStyle = {
  margin: 0,
  padding: "1px 0",
  whiteSpace: "nowrap",
  color: "var(--surface-text-primary)",
  minWidth: 0,
  fontFamily: "var(--font-math)",
};

const addRegisterButtonStyle = {
  ...buttonStyle,
  width: 28,
  minWidth: 28,
  height: 28,
  padding: 0,
  borderRadius: RADII.control,
  fontSize: TYPOGRAPHY.sizes.xl,
  lineHeight: TYPOGRAPHY.lineHeights.tight,
};

const removeRegisterButtonStyle = {
  ...buttonStyle,
  width: 18,
  minWidth: 18,
  height: 18,
  padding: 0,
  border: "none",
  background: "transparent",
  color: "var(--surface-text-muted)",
  fontSize: TYPOGRAPHY.sizes.lg,
  lineHeight: TYPOGRAPHY.lineHeights.tight,
};

const arityHintStyle = {
  ...TYPOGRAPHY.styles.uiText,
  fontSize: TYPOGRAPHY.sizes.sm,
  color: "var(--surface-text-structural)",
};

const primitivePendingTextStyle = {
  ...TYPOGRAPHY.styles.uiText,
  fontSize: TYPOGRAPHY.sizes.sm,
  color: "var(--surface-text-structural)",
  maxWidth: 420,
};

const primitiveStructureHintStyle = {
  ...TYPOGRAPHY.styles.uiText,
  fontSize: TYPOGRAPHY.sizes.sm,
  color: "var(--feedback-error-text)",
  background: "var(--feedback-error-bg)",
  border: "1px solid var(--feedback-error-border)",
  borderRadius: RADII.panel,
  padding: "8px 10px",
};

const primitiveEquationCardStyle = {
  display: "grid",
  gap: 0,
  width: "100%",
  padding: "2px 0 0",
  border: "none",
  borderRadius: RADII.panel,
  background: "transparent",
};

const primitiveDefinitionHeaderStyle = {
  ...TYPOGRAPHY.styles.sectionHeading,
  color: "var(--surface-text-primary)",
  marginBottom: 1,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const primitiveBodyLayoutStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "start",
  gap: 12,
  width: "100%",
};

const primitiveMainColumnStyle = {
  display: "grid",
  gap: 7,
  alignContent: "start",
  flex: "1 1 500px",
  minWidth: 0,
};

const primitiveBuilderBlockStyle = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const primitiveSetupToggleStyle = {
  ...buttonStyle,
  height: 28,
  padding: "0 10px",
  borderRadius: RADII.control,
  fontSize: TYPOGRAPHY.sizes.sm,
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

const primitiveBuilderEquationStyle = {
  display: "inline-flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: 1,
  minWidth: 0,
  fontFamily: "var(--font-math)",
  color: "var(--surface-text-primary)",
  lineHeight: 1.3,
};

const primitiveControlColumnStyle = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "flex-start",
  flex: "0 1 276px",
  minWidth: 228,
};

const primitiveControlClusterStyle = {
  display: "grid",
  gap: 6,
  alignContent: "start",
  width: "100%",
  maxWidth: 270,
  minWidth: 0,
};

const primitiveMetaNumberStyle = {
  ...registerInputStyle,
  width: 72,
  minWidth: 72,
  height: 28,
};

const primitiveEvaluationCardStyle = {
  display: "grid",
  gap: 3,
  padding: 0,
  border: "none",
  borderRadius: RADII.panel,
  background: "transparent",
  width: "100%",
  minWidth: 0,
};

const primitiveEvaluateRowStyle = {
  display: "grid",
  gap: 0,
  width: "100%",
  minWidth: 0,
};

const primitiveEvaluateFieldsRowStyle = {
  display: "inline-flex",
  flexWrap: "wrap",
  gap: 3,
  alignItems: "center",
  minWidth: 0,
  flex: "0 1 auto",
};

const primitiveEvaluateActionRowStyle = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
  minWidth: 0,
};

const primitiveEvaluateFieldStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
};

const primitiveEvaluateLabelStyle = {
  fontFamily: "var(--font-math)",
  fontSize: TYPOGRAPHY.sizes.base,
  fontWeight: TYPOGRAPHY.weights.regular,
  lineHeight: TYPOGRAPHY.lineHeights.normal,
  color: "var(--surface-text-primary)",
  whiteSpace: "nowrap",
};

const primitiveEvaluateInputStyle = {
  ...registerInputStyle,
  width: 64,
  minWidth: 64,
  height: 28,
};

const primitiveRunButtonStyle = {
  ...runButtonStyle,
  minWidth: 68,
  alignSelf: "flex-end",
};

const primitiveEvaluatePendingStyle = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const playbackSliderStyle = {
  margin: 0,
  width: "100%",
  verticalAlign: "middle",
  minWidth: 0,
  maxWidth: 160,
};

const playbackButtonStyle = {
  ...buttonStyle,
  height: 27,
  padding: "0 9px",
  border: "1px solid var(--border-default)",
  background: "var(--surface-card)",
  borderRadius: RADII.control,
  color: "var(--surface-text-primary)",
  fontSize: TYPOGRAPHY.sizes.md,
  lineHeight: TYPOGRAPHY.lineHeights.tight,
};

const playbackStepLabelStyle = {
  ...TYPOGRAPHY.styles.label,
  fontSize: TYPOGRAPHY.sizes.sm,
  color: "var(--surface-text-primary)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
