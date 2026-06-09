import { useEffect, useMemo, useState } from "react";
import ByHandEvaluationCard from "./ByHandEvaluationCard.jsx";
import MachinePanel from "./MachinePanel";
import MachinePlaybackControls from "./MachinePlaybackControls.jsx";
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
import { FunctionCard } from "./FunctionCardLayout.jsx";
import PrimitiveRecursionDefinitionPreview from "./PrimitiveRecursionDefinitionPreview.jsx";
import { InlineMath, MathEquals } from "./MathText.jsx";
import { API_URL } from "../api.js";
import { getTracePlaybackTiming } from "../utils/tracePlayback.js";
import {
  CHARACTERISTIC_RELATIONS,
  normalizeCharacteristicRelation,
} from "../characteristicMetadata.js";

const DEFAULT_FUNCTION_SPEC = { kind: "successor" };
const VARIABLE_NAMES = ["x", "y", "z", "w", "v"];
const CONSTANT_FUNCTION_NOTE = "In this UI, constant(k) and zero are treated as 1-ary functions.";
const CHARACTERISTIC_DIVIDES_BOUNDS = {
  x: { min: 1, max: 6 },
  y: { min: 1, max: 8 },
  defaultValues: [2, 6],
};

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

  if (kind === "minimization") {
    return {
      kind,
      inner: createDefaultFunctionSpec("bounded_sub"),
    };
  }

  if (kind === "characteristic") {
    return {
      kind,
      relation: "leq",
    };
  }

  return { kind };
}

function isCharacteristicDividesSpec(spec) {
  return (
    normalizeFunctionKind(spec?.kind) === "characteristic"
    && normalizeCharacteristicRelation(spec?.relation) === "divides"
  );
}

function clampRegisterValue(value, { min = undefined, max = undefined } = {}) {
  if (!Number.isFinite(value)) return min ?? 0;

  let nextValue = Math.trunc(value);

  if (Number.isInteger(min)) {
    nextValue = Math.max(min, nextValue);
  }

  if (Number.isInteger(max)) {
    nextValue = Math.min(max, nextValue);
  }

  return nextValue;
}

function getCharacteristicRegisterConstraint(spec, index) {
  if (normalizeFunctionKind(spec?.kind) !== "characteristic") {
    return null;
  }

  if (isCharacteristicDividesSpec(spec)) {
    return index === 0
      ? CHARACTERISTIC_DIVIDES_BOUNDS.x
      : CHARACTERISTIC_DIVIDES_BOUNDS.y;
  }

  return { min: 0 };
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
      <span style={primitiveEvaluateLabelStyle} className="runner-inline-math-label">
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

function SimpleModeParameterControls({ spec, onChange, onClearRunState = null }) {
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

  if (kind === "characteristic") {
    const relation = normalizeCharacteristicRelation(spec?.relation);

    return (
      <label style={simpleMetaControlStyle}>
        <span style={simpleMetaLabelStyle}>Relation</span>
        <select
          value={relation}
          onChange={(event) => {
            onChange((current) => ({
              ...current,
              relation: normalizeCharacteristicRelation(event.target.value),
            }));
            if (typeof onClearRunState === "function") {
              onClearRunState();
            }
          }}
          style={simpleMetaSelectStyle}
          className="dashboard-control runner-toolbar-select"
        >
          {CHARACTERISTIC_RELATIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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

  if (kind === "predecessor" || kind === "pred" || kind === "truncated_predecessor") {
    return { status: "known", arity: 1, source: "predecessor uses one input register" };
  }

  if (kind === "add" || kind === "addition") {
    return { status: "known", arity: 2, source: "add uses two inputs" };
  }

  if (kind === "bounded_sub" || kind === "sub" || kind === "truncated_sub" || kind === "truncated_subtraction") {
    return { status: "known", arity: 2, source: "bounded subtraction uses two inputs" };
  }

  if (kind === "characteristic") {
    return { status: "known", arity: 2, source: "characteristic functions for binary relations use two inputs" };
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

  if (kind === "minimization") {
    if (!spec?.inner) {
      return { status: "unknown", source: "minimization needs an inner function to infer visible inputs" };
    }

    const innerArity = deriveFunctionArity(spec.inner);

    if (innerArity.status === "known") {
      return {
        status: "known",
        arity: Math.max(innerArity.arity - 1, 0),
        source: "minimization uses the inner function arity minus the search variable",
      };
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

function formatCandidateCount(count) {
  return `${count} candidate${count === 1 ? "" : "s"}`;
}

function buildMinimizationSummaryModel(computationStructure) {
  if (!computationStructure || computationStructure.kind !== "minimization") {
    return null;
  }

  const iterations = Array.isArray(computationStructure.iterations)
    ? computationStructure.iterations
    : [];
  const iterationCount =
    Number.isInteger(computationStructure.iteration_count) && computationStructure.iteration_count >= 0
      ? computationStructure.iteration_count
      : iterations.length;
  const finalCandidate =
    Number.isInteger(computationStructure.final_candidate) && computationStructure.final_candidate >= 0
      ? computationStructure.final_candidate
      : null;

  if (computationStructure.is_complete && finalCandidate !== null) {
    return {
      title: "Minimization summary",
      lines: [
        `Tested ${formatCandidateCount(iterationCount)}.`,
        `First zero found at y = ${finalCandidate}.`,
      ],
    };
  }

  const incompleteIteration = iterations.find((iteration) => iteration?.decision === "incomplete") ?? null;

  if (incompleteIteration) {
    const completedCount = iterations.filter((iteration) => iteration?.decision !== "incomplete").length;

    return {
      title: "Minimization summary",
      lines: [
        completedCount === 0
          ? "No candidate was fully tested."
          : `Completed ${formatCandidateCount(completedCount)}.`,
        `Search stopped during y = ${incompleteIteration.candidate}.`,
      ],
    };
  }

  return {
    title: "Minimization summary",
    lines: [
      iterationCount === 0
        ? "No candidate was fully tested."
        : `Tested ${formatCandidateCount(iterationCount)} before stopping.`,
      "No zero was found before execution stopped.",
    ],
  };
}

function buildMinimizationIterationItems(computationStructure) {
  if (!computationStructure || computationStructure.kind !== "minimization") {
    return [];
  }

  const iterations = Array.isArray(computationStructure.iterations)
    ? computationStructure.iterations
    : [];

  return iterations
    .filter(
      (iteration) =>
        Number.isInteger(iteration?.candidate) &&
        Number.isInteger(iteration?.trace_start) &&
        Number.isInteger(iteration?.trace_end),
    )
    .map((iteration) => ({
      key: `min-iteration-${iteration.index ?? iteration.candidate}`,
      candidate: iteration.candidate,
      traceStart: iteration.trace_start,
      traceEnd: iteration.trace_end,
      decision: iteration.decision,
      role: "iteration",
    }));
}

function addBoundaryTraceBlocks(blocks, {
  idPrefix,
  kind,
  traceLength = null,
  setupLabel = "setup",
  finalizationLabel = "finalization",
}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return blocks ?? [];
  }

  const sortedBlocks = [...blocks].sort((left, right) => left.traceStart - right.traceStart);
  const firstBlock = sortedBlocks[0];
  const lastBlock = sortedBlocks[sortedBlocks.length - 1];
  const augmentedBlocks = [...sortedBlocks];

  if (Number.isInteger(firstBlock?.traceStart) && firstBlock.traceStart > 0) {
    augmentedBlocks.unshift({
      id: `${idPrefix}-setup`,
      kind,
      label: setupLabel,
      traceStart: 0,
      traceEnd: firstBlock.traceStart - 1,
      selected: false,
      role: "setup",
    });
  }

  if (
    Number.isInteger(traceLength) &&
    traceLength > 0 &&
    Number.isInteger(lastBlock?.traceEnd) &&
    lastBlock.traceEnd < traceLength - 1
  ) {
    augmentedBlocks.push({
      id: `${idPrefix}-finalization`,
      kind,
      label: finalizationLabel,
      traceStart: lastBlock.traceEnd + 1,
      traceEnd: traceLength - 1,
      selected: false,
      role: "finalization",
    });
  }

  return augmentedBlocks;
}

function buildPrimitiveRecursionTraceBlocks(primitiveStepView) {
  const stepGroups = Array.isArray(primitiveStepView?.stepGroups)
    ? primitiveStepView.stepGroups
    : [];

  const stepBlocks = stepGroups
    .filter(
      (group) =>
        Number.isInteger(group?.startRowIndex) &&
        Number.isInteger(group?.endRowIndex) &&
        group.endRowIndex >= group.startRowIndex,
    )
    .map((group) => ({
      id: `primrec-${group.stepIndex}`,
      kind: "primitive_recursion",
      label: group.label ?? `Step ${group.stepIndex ?? 0}`,
      traceStart: group.startRowIndex,
      traceEnd: group.endRowIndex,
      selected: false,
      role: "step",
    }));

  return addBoundaryTraceBlocks(stepBlocks, {
    idPrefix: "primrec",
    kind: "primitive_recursion",
    traceLength: Array.isArray(primitiveStepView?.trace) ? primitiveStepView.trace.length : null,
  });
}

function buildCompositionTraceBlocks(composedTraceView) {
  const trace = Array.isArray(composedTraceView?.trace) ? composedTraceView.trace : [];

  if (trace.length === 0) {
    return [];
  }

  const blocks = [];
  let currentBlock = null;

  for (let index = 0; index < trace.length; index += 1) {
    const row = trace[index];
    const stageKey = typeof row?.stageKey === "string" ? row.stageKey : null;
    if (!stageKey) continue;

    if (!currentBlock || currentBlock.stageKey !== stageKey) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }

      currentBlock = {
        id: `compose-${stageKey}-${index}`,
        kind: "composition",
        label: stageKey,
        stageKey,
        traceStart: index,
        traceEnd: index,
        selected: false,
      };
      continue;
    }

    currentBlock.traceEnd = index;
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
}

function buildSemanticTraceBlocks({
  minimizationIterations,
  selectedMinimizationCandidate,
  primitiveStepView,
  composedTraceView,
  traceLength,
  currentTraceIndex,
}) {
  const minimizationBlocks = addBoundaryTraceBlocks(minimizationIterations.map((iteration) => ({
    id: iteration.key,
    kind: "minimization",
    label: `y = ${iteration.candidate}`,
    traceStart: iteration.traceStart,
    traceEnd: iteration.traceEnd,
    selected: iteration.candidate === selectedMinimizationCandidate,
    role: iteration.role ?? "iteration",
  })), {
    idPrefix: "minimization",
    kind: "minimization",
    traceLength,
  });
  const primitiveBlocks = buildPrimitiveRecursionTraceBlocks(primitiveStepView);
  const compositionBlocks = buildCompositionTraceBlocks(composedTraceView);

  return [...minimizationBlocks, ...primitiveBlocks, ...compositionBlocks].map((block) => ({
    ...block,
    active: currentTraceIndex >= block.traceStart && currentTraceIndex <= block.traceEnd,
  }));
}

function MinimizationSummary({ summary, iterations, selectedCandidate, onSelectIteration }) {
  if (!summary) return null;

  return (
    <div style={minimizationSummaryStyle} className="runner-minimization-summary">
      <div style={minimizationSummaryTitleStyle}>{summary.title}</div>
      <div style={minimizationSummaryLinesStyle}>
        {summary.lines.map((line) => (
          <div key={line} style={minimizationSummaryLineStyle}>
            {line}
          </div>
        ))}
      </div>
      {iterations.length > 0 ? (
        <div style={minimizationIterationRowStyle}>
          {iterations.map((iteration) => {
            const isSelected = selectedCandidate === iteration.candidate;
            const isStop = iteration.decision === "stop";
            const isIncomplete = iteration.decision === "incomplete";

            return (
              <button
                key={iteration.key}
                type="button"
                onClick={() => onSelectIteration(iteration)}
                style={{
                  ...minimizationIterationChipStyle,
                  ...(isSelected ? minimizationIterationChipSelectedStyle : null),
                  ...(isStop ? minimizationIterationChipStopStyle : null),
                  ...(isIncomplete ? minimizationIterationChipIncompleteStyle : null),
                }}
                className="runner-minimization-chip"
                aria-pressed={isSelected}
              >
                {`y = ${iteration.candidate}`}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function FunctionRunner({
  initialFunctionSpec = DEFAULT_FUNCTION_SPEC,
  initialInputs = [7],
  fixedFunctionSpec = null,
  showFunctionModeSelector = true,
  hideToolbar = false,
  autoRunOnMount = false,
  machinePanelHeaderContent = null,
  machinePanelProgramCaption = null,
  hideMachinePanelSectionCaptions = false,
  machinePanelTraceCompact = false,
  showPlaybackSummary = true,
  playbackExternallyControlled = false,
  externalTraceIndex = 0,
  externalIsPlaying = false,
  onExternalTraceIndexChange = null,
  onExternalIsPlayingChange = null,
  playbackControlsDisabled = false,
  onPlaybackInfoChange = null,
  onRunDataChange = null,
  onFunctionStateChange = null,
  hideMachinePanel = false,
  functionExecutionMode = null,
  functionModeOptions = null,
  templateFunctionKind = null,
  summaryContent = null,
}) {
  const [functionSpec, setFunctionSpec] = useState(() => fixedFunctionSpec ?? initialFunctionSpec);
  const [registerValues, setRegisterValues] = useState(() => [...initialInputs]);

  const [runData, setRunData] = useState(null);
  const [currentTraceIndex, setCurrentTraceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const [isPrimitiveSetupExpanded, setIsPrimitiveSetupExpanded] = useState(true);
  const [selectedMinimizationCandidate, setSelectedMinimizationCandidate] = useState(null);
  const [slowPlaybackRequested, setSlowPlaybackRequested] = useState(false);

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

      if (functionExecutionMode) {
        payload.execution_mode = functionExecutionMode;
      }

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
      setPlaybackTraceIndex(0);
      setPlaybackIsPlaying(!playbackExternallyControlled && !hideMachinePanel);
      setSelectedMinimizationCandidate(null);
      setSlowPlaybackRequested(false);
    } catch (err) {
      setPlaybackIsPlaying(false);
      setError(mapRunErrorMessage(err.message, functionSpec));
    }
  }

  const composedTraceView = useMemo(() => buildComposedTraceView(runData), [runData]);
  const primitiveStepView = useMemo(() => buildPrimitiveRecursionStepView(runData), [runData]);
  const playbackTraceIndex = playbackExternallyControlled ? externalTraceIndex : currentTraceIndex;
  const playbackIsPlaying = playbackExternallyControlled ? externalIsPlaying : isPlaying;
  const selectedPrimitiveStep = useMemo(() => {
    const groups = primitiveStepView?.stepGroups;
    if (!Array.isArray(groups)) return null;

    return groups.find((group) => {
      if (!Number.isInteger(group?.startRowIndex) || !Number.isInteger(group?.endRowIndex)) {
        return false;
      }
      return playbackTraceIndex >= group.startRowIndex && playbackTraceIndex <= group.endRowIndex;
    }) ?? null;
  }, [playbackTraceIndex, primitiveStepView]);
  const selectedPrimitiveStepIndex = selectedPrimitiveStep?.stepIndex ?? null;
  const activeTrace = useMemo(
    () => composedTraceView?.trace ?? runData?.trace ?? [],
    [composedTraceView, runData],
  );
  const activeTraceLength = activeTrace.length;
  const playbackLength = activeTraceLength;
  const maxPlaybackIndex = Math.max(0, playbackLength - 1);
  const activeTraceRowIndex = playbackTraceIndex;
  const playbackTiming = useMemo(
    () => getTracePlaybackTiming({ traceLength: playbackLength, slowPlaybackRequested }),
    [playbackLength, slowPlaybackRequested],
  );

  const currentRow = useMemo(() => {
    if (!runData || activeTraceLength === 0) return null;
    return activeTrace[activeTraceRowIndex] ?? null;
  }, [runData, activeTrace, activeTraceRowIndex, activeTraceLength]);

  useEffect(() => {
    if (playbackExternallyControlled || !playbackIsPlaying || playbackLength === 0) return;

    if (playbackTraceIndex >= playbackLength - 1) {
      setPlaybackIsPlaying(false);
      return;
    }

    const timer = setTimeout(() => {
      setPlaybackTraceIndex((i) => i + 1);
    }, playbackTiming.intervalMs);

    return () => clearTimeout(timer);
  }, [playbackExternallyControlled, playbackIsPlaying, playbackLength, playbackTiming.intervalMs, playbackTraceIndex]);

  useEffect(() => {
    if (playbackTraceIndex <= maxPlaybackIndex) return;
    setPlaybackTraceIndex(maxPlaybackIndex);
  }, [maxPlaybackIndex, playbackTraceIndex]);

  useEffect(() => {
    if (!playbackExternallyControlled) return;

    setCurrentTraceIndex(externalTraceIndex);
    setIsPlaying(externalIsPlaying);
  }, [externalIsPlaying, externalTraceIndex, playbackExternallyControlled]);

  useEffect(() => {
    if (typeof onPlaybackInfoChange !== "function") return;

    onPlaybackInfoChange({
      currentTraceIndex: playbackTraceIndex,
      maxTraceIndex: maxPlaybackIndex,
      isPlaying: playbackIsPlaying,
      hasTrace: playbackLength > 0,
    });
  }, [maxPlaybackIndex, onPlaybackInfoChange, playbackIsPlaying, playbackLength, playbackTraceIndex]);

  const stageSummary = composedTraceView
    ? getCompositionStageSummary(currentRow, composedTraceView.stageCount)
    : "";

  const panelProgram =
    composedTraceView && currentRow?.stageKey
      ? composedTraceView.programSections.find((section) => section.key === currentRow.stageKey)?.program ?? []
      : runData?.program ?? [];

  const panelFinalRegisters = composedTraceView?.finalRegisters ?? runData?.final_registers ?? [];
  const outputIsFinal = runData?.status_summary?.output_is_final === true;
  const arityInfo = useMemo(() => deriveFunctionArity(functionSpec), [functionSpec]);

  function handleRegisterChange(index, rawValue) {
    const constraint = getCharacteristicRegisterConstraint(functionSpec, index);
    const fallbackValue = Number.isInteger(constraint?.min) ? constraint.min : 0;
    const parsedValue = rawValue === "" ? fallbackValue : Number(rawValue);
    const nextValue = constraint
      ? clampRegisterValue(parsedValue, constraint)
      : (rawValue === "" ? 0 : Number(rawValue));

    setRegisterValues((current) =>
      current.map((value, valueIndex) =>
        valueIndex === index ? nextValue : value
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

    if (playbackTraceIndex >= playbackLength - 1) {
      setPlaybackTraceIndex(0);
      setPlaybackIsPlaying(true);
      return;
    }

    setPlaybackIsPlaying((current) => !current);
  }

  function handlePrevStep() {
    setPlaybackIsPlaying(false);
    setPlaybackTraceIndex((index) => Math.max(0, index - 1));
  }

  function handleNextStep() {
    setPlaybackIsPlaying(false);
    setPlaybackTraceIndex((index) => Math.min(playbackLength - 1, index + 1));
  }

  function clearRunState() {
    setRunData(null);
    setError("");
    setPlaybackTraceIndex(0);
    setPlaybackIsPlaying(false);
    setSelectedMinimizationCandidate(null);
    setSlowPlaybackRequested(false);

    if (typeof onRunDataChange === "function") {
      onRunDataChange(null);
    }
  }

  function handleFunctionModeChange(nextKind) {
    clearRunState();
    const nextSpec =
      templateFunctionKind && nextKind === templateFunctionKind
        ? { kind: templateFunctionKind }
        : createDefaultFunctionSpec(nextKind);

    setFunctionSpec(nextSpec);

    if (normalizeFunctionKind(nextKind) === "characteristic") {
      setRegisterValues([2, 3]);
    }

    if (typeof onFunctionStateChange === "function") {
      onFunctionStateChange({
        functionSpec: nextSpec,
        registerValues,
        visibleInputValues,
        arityInfo,
        variableNames,
      });
    }
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

  useEffect(() => {
    if (!isCharacteristicDividesSpec(functionSpec)) return;

    setRegisterValues((current) => {
      const resized = resizeInputs(current, 2);
      const defaults = CHARACTERISTIC_DIVIDES_BOUNDS.defaultValues;
      const bounded = resized.map((value, index) => {
        const constraint = getCharacteristicRegisterConstraint(functionSpec, index);
        const fallbackValue = defaults[index] ?? 1;
        const safeValue = Number.isFinite(value) ? value : fallbackValue;
        return clampRegisterValue(safeValue, constraint ?? undefined);
      });

      if (
        bounded.length === current.length
        && bounded.every((value, index) => value === current[index])
      ) {
        return current;
      }

      return bounded;
    });
  }, [functionSpec]);

  const inputCount = arityInfo.status === "known" ? arityInfo.arity : Math.max(registerValues.length, 2);
  const variableNames = useMemo(() => getVariableNames(inputCount), [inputCount]);
  const visibleInputValues = useMemo(
    () => resizeInputs(registerValues, inputCount),
    [inputCount, registerValues],
  );

  useEffect(() => {
    if (typeof onRunDataChange !== "function") return;

    onRunDataChange(runData);
  }, [onRunDataChange, runData]);

  useEffect(() => {
    if (typeof onFunctionStateChange !== "function") return;

    onFunctionStateChange({
      functionSpec,
      registerValues,
      visibleInputValues,
      arityInfo,
      variableNames,
    });
  }, [arityInfo, functionSpec, onFunctionStateChange, registerValues, variableNames, visibleInputValues]);

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
  const resolvedMachinePanelHeaderContent =
    typeof machinePanelHeaderContent === "function"
      ? machinePanelHeaderContent({ currentTraceIndex: playbackTraceIndex, maxTraceIndex })
      : machinePanelHeaderContent;
  const hasPrimitiveTrace = isPrimitiveRecursion && activeTraceLength > 0;
  const minimizationSummary = useMemo(
    () => buildMinimizationSummaryModel(runData?.computation_structure),
    [runData?.computation_structure],
  );
  const minimizationIterations = useMemo(
    () => buildMinimizationIterationItems(runData?.computation_structure),
    [runData?.computation_structure],
  );
  const selectedMinimizationIteration = useMemo(
    () =>
      minimizationIterations.find(
        (iteration) => iteration.candidate === selectedMinimizationCandidate,
      ) ?? null,
    [minimizationIterations, selectedMinimizationCandidate],
  );
  const semanticTraceBlocks = useMemo(
    () =>
      buildSemanticTraceBlocks({
        minimizationIterations,
        selectedMinimizationCandidate,
        primitiveStepView,
        composedTraceView,
        traceLength: activeTraceLength,
        currentTraceIndex: playbackTraceIndex,
      }),
    [activeTraceLength, composedTraceView, minimizationIterations, playbackTraceIndex, primitiveStepView, selectedMinimizationCandidate],
  );
  const hideCompositionTraceColumns = useMemo(
    () => semanticTraceBlocks.some((block) => block.kind === "composition"),
    [semanticTraceBlocks],
  );
  const nonPrimitiveKind = normalizeFunctionKind(functionSpec?.kind);
  const isTemplateMode =
    Boolean(templateFunctionKind) && nonPrimitiveKind === normalizeFunctionKind(templateFunctionKind);
  const selectedFunctionMode = isTemplateMode ? templateFunctionKind : nonPrimitiveKind;
  const resolvedFunctionModeOptions = useMemo(
    () =>
      (Array.isArray(functionModeOptions) && functionModeOptions.length > 0
        ? functionModeOptions
        : FUNCTION_ORDER
      ).map((option) => {
        const value = typeof option === "string" ? option : option.value;
        const label = typeof option === "string" ? getFunctionDisplayName(option) : option.label;

        return {
          value,
          label: label ?? getFunctionDisplayName(value),
        };
      }),
    [functionModeOptions],
  );
  const useExpandedDefinitionLayout =
    nonPrimitiveKind === "compose" || nonPrimitiveKind === "minimization";
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

  useEffect(() => {
    if (
      selectedMinimizationCandidate === null ||
      minimizationIterations.some((iteration) => iteration.candidate === selectedMinimizationCandidate)
    ) {
      return;
    }

    setSelectedMinimizationCandidate(null);
  }, [minimizationIterations, selectedMinimizationCandidate]);

  function handleSelectMinimizationIteration(iteration) {
    setSelectedMinimizationCandidate(iteration.candidate);
    setPlaybackTraceIndex(iteration.traceStart);
    setPlaybackIsPlaying(false);
  }

  function renderFunctionModeSelect() {
    if (!showFunctionModeSelector) return null;

    return (
      <label style={compositionModeControlStyle}>
        <span style={compositionModeLabelStyle}>Mode</span>
        <select
          value={selectedFunctionMode}
          onChange={(e) => handleFunctionModeChange(e.target.value)}
          style={compositionModeSelectStyle}
          className="dashboard-control runner-toolbar-select"
        >
          {resolvedFunctionModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="function-runner" style={{ marginBottom: 16 }}>
      {!hideToolbar ? (
        <FunctionCard as="div">
          <div className={`runner-toolbar${isPrimitiveRecursion ? " runner-toolbar-primrec" : ""}`}>
          {isTemplateMode ? (
            <div style={simpleDefinitionCardStyle}>
              <div style={simpleSummaryRowStyle}>
                <div className="runner-template-summary-content" style={compositionSummaryDefinitionStyle}>
                  {summaryContent}
                </div>
                <div style={simpleSummaryControlsStyle}>
                  {renderFunctionModeSelect()}
                </div>
              </div>
            </div>
          ) : isPrimitiveRecursion ? (
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
                    {summaryContent}
                  </div>

                  <div style={primitiveControlColumnStyle}>
                    <div style={primitiveControlClusterStyle}>
                      {renderFunctionModeSelect()}

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
                      {renderFunctionModeSelect()}
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
                        {summaryContent}
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
                                {(() => {
                                  const constraint = getCharacteristicRegisterConstraint(functionSpec, index);
                                  return (
                                    <input
                                      type="number"
                                      min={constraint?.min}
                                      max={constraint?.max}
                                      step="1"
                                      value={value}
                                      onChange={(e) => handleRegisterChange(index, e.target.value)}
                                      style={registerInputStyle}
                                      className="dashboard-control runner-variable-input runner-toolbar-number-input"
                                    />
                                  );
                                })()}
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
                      {summaryContent}
                    </div>

                    <div style={simpleSummaryControlsStyle}>
                      {renderFunctionModeSelect()}
                      <SimpleModeParameterControls
                        spec={functionSpec}
                        onChange={setFunctionSpec}
                        onClearRunState={clearRunState}
                      />
                      <div style={simpleEvaluateRowStyle}>
                        <div style={compositionControlsRowStyle} className="runner-inputs-lane">
                          <div style={variableEditorStyle} className="runner-inputs-strip">
                            {visibleInputValues.map((value, index) => (
                              <label key={index} style={variableFieldStyle} className="runner-variable-field">
                                <span style={variableLabelStyle} className="runner-variable-label">
                                  <InlineMath value={variableNames[index]} />
                                  <MathEquals style={{ marginLeft: 4 }} />
                                </span>
                                {(() => {
                                  const constraint = getCharacteristicRegisterConstraint(functionSpec, index);
                                  return (
                                    <input
                                      type="number"
                                      min={constraint?.min}
                                      max={constraint?.max}
                                      step="1"
                                      value={value}
                                      onChange={(e) => handleRegisterChange(index, e.target.value)}
                                      style={compactRegisterInputStyle}
                                      className="dashboard-control runner-variable-input runner-toolbar-number-input"
                                    />
                                  );
                                })()}
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

          {!isTemplateMode && !isPrimitiveRecursion && arityInfo.status !== "known" && (
            <div style={arityHintStyle} className="runner-arity-hint">
              Arity not inferred: {arityInfo.source}
            </div>
          )}
          </div>
        </FunctionCard>
      ) : null}

      {error && (
        <div style={{ color: "var(--feedback-error-text)", marginBottom: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      {runData && !hideMachinePanel && (
        <>
          <MinimizationSummary
            summary={minimizationSummary}
            iterations={minimizationIterations}
            selectedCandidate={selectedMinimizationCandidate}
            onSelectIteration={handleSelectMinimizationIteration}
          />
          <MachinePanel
            title={
              selectedPrimitiveStep
                ? `Execution: ${selectedPrimitiveStep.label}${selectedPrimitiveStep.callText ? ` — ${selectedPrimitiveStep.callText}` : ""}`
                : `Function: ${getFunctionDisplayName(runData.function)}`
            }
            headerContent={resolvedMachinePanelHeaderContent}
            hideSectionCaptions={hideMachinePanelSectionCaptions}
            programPanelCaption={machinePanelProgramCaption}
            traceCompact={machinePanelTraceCompact}
            program={panelProgram}
            row={currentRow}
            finalRegisters={panelFinalRegisters}
            trace={activeTrace}
            currentTraceIndex={activeTraceRowIndex}
            semanticTraceBlocks={semanticTraceBlocks}
            hideStageColumns={hideCompositionTraceColumns}
            isPlaying={playbackIsPlaying}
            traceShowStepGroups
            outputIsFinal={outputIsFinal}
            playbackControls={(
              <MachinePlaybackControls
                disabled={playbackControlsDisabled}
                isPlaying={playbackIsPlaying}
                currentIndex={playbackTraceIndex}
                maxIndex={maxTraceIndex}
                playbackLength={playbackLength}
                onPrev={handlePrevStep}
                onToggle={handleTogglePlayback}
                onNext={handleNextStep}
                onChange={(nextIndex) => {
                  setPlaybackIsPlaying(false);
                  setPlaybackTraceIndex(nextIndex);
                }}
                showSummary={showPlaybackSummary}
                showSlowDown={playbackTiming.isSlowDownControlAvailable && !playbackExternallyControlled}
                onSlowDown={() => setSlowPlaybackRequested(true)}
              />
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

const minimizationSummaryStyle = {
  display: "grid",
  gap: 4,
  marginBottom: 10,
  padding: "10px 12px",
  border: "1px solid var(--border-default)",
  borderRadius: RADII.panel,
  background: "var(--surface-card)",
};

const minimizationSummaryTitleStyle = {
  ...TYPOGRAPHY.styles.label,
  fontSize: TYPOGRAPHY.sizes.xs,
  color: "var(--surface-text-structural)",
  opacity: 0.8,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const minimizationSummaryLinesStyle = {
  display: "grid",
  gap: 2,
};

const minimizationSummaryLineStyle = {
  ...TYPOGRAPHY.styles.uiText,
  fontSize: TYPOGRAPHY.sizes.sm,
  color: "var(--surface-text-secondary)",
};

const minimizationIterationRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 2,
};

const minimizationIterationChipStyle = {
  ...TYPOGRAPHY.styles.uiText,
  fontSize: TYPOGRAPHY.sizes.xs,
  padding: "4px 8px",
  borderRadius: RADII.pill ?? 999,
  border: "1px solid var(--border-default)",
  background: "var(--surface-canvas, var(--surface-card))",
  color: "var(--surface-text-secondary)",
  cursor: "pointer",
};

const minimizationIterationChipSelectedStyle = {
  borderColor: "var(--machine-active-border)",
  background: "var(--machine-active-link-bg)",
  color: "var(--surface-text-primary)",
  boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--machine-active-border) 20%, transparent)",
};

const minimizationIterationChipStopStyle = {
  color: "var(--surface-text-primary)",
};

const minimizationIterationChipIncompleteStyle = {
  borderStyle: "dashed",
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

const simpleMetaSelectStyle = {
  ...controlStyle,
  ...TYPOGRAPHY.styles.code,
  height: 28,
  minWidth: 110,
  padding: "0 8px",
  borderRadius: RADII.control,
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
