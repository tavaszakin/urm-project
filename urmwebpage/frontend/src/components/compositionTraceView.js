import {
  getFunctionDisplayLabel,
  normalizeFunctionKind,
} from "../functionMetadata.js";

function formatFunctionLabel(spec) {
  return getFunctionDisplayLabel(spec);
}

function buildStageRows(node, stageKey, stageLabel, stageOrder) {
  const execution = node?.execution;
  const trace = Array.isArray(execution?.trace) ? execution.trace : null;

  if (!trace) {
    return null;
  }

  return trace.map((row, rowIndex) => ({
    ...row,
    stageKey,
    stageLabel,
    stageOrder,
    functionLabel: formatFunctionLabel(node?.function),
    localStep: typeof row.step === "number" ? row.step : rowIndex,
    globalStep: rowIndex,
    stageBoundary: rowIndex === 0,
  }));
}

function formatInstruction(inst) {
  if (!inst) return "—";
  const [op, ...args] = inst;
  return `${op}(${args.join(", ")})`;
}

function buildCombinedProgramRows(node, stageKey, stageLabel) {
  const program = Array.isArray(node?.execution?.program) ? node.execution.program : [];

  return program.map((instruction, instructionIndex) => ({
    key: `${stageKey}-${instructionIndex}`,
    stage: stageLabel,
    stageKey,
    functionName: formatFunctionLabel(node?.function),
    instructionIndex,
    instructionText: formatInstruction(instruction),
  }));
}

export function buildComposedTraceView(runData) {
  const evaluation = runData?.evaluation;

  if (normalizeFunctionKind(evaluation?.kind) !== "compose") {
    return null;
  }

  const inner = evaluation?.inner;
  const outer = evaluation?.outer;
  const innerRows = buildStageRows(inner, "inner", "Inner", 0);
  const outerRows = buildStageRows(outer, "outer", "Outer", 1);

  if (!innerRows || !outerRows) {
    return {
      missingStageExecutionData: true,
      trace: Array.isArray(runData?.trace) ? runData.trace : [],
      currentProgram: Array.isArray(runData?.program) ? runData.program : [],
      finalRegisters: runData?.final_registers ?? [],
      programSections: [],
      stageCount: 2,
    };
  }

  const trace = [...innerRows, ...outerRows].map((row, index) => ({
    ...row,
    globalStep: index,
  }));
  const combinedProgramRows = [
    ...buildCombinedProgramRows(inner, "inner", "Inner"),
    ...buildCombinedProgramRows(outer, "outer", "Outer"),
  ];

  return {
    missingStageExecutionData: false,
    trace,
    currentProgram: Array.isArray(inner?.execution?.program) ? inner.execution.program : [],
    finalRegisters: runData?.final_registers ?? outer?.execution?.final_registers ?? [],
    programSections: [
      {
        key: "inner",
        title: `Inner program (${formatFunctionLabel(inner?.function)})`,
        program: Array.isArray(inner?.execution?.program) ? inner.execution.program : [],
      },
      {
        key: "outer",
        title: `Outer program (${formatFunctionLabel(outer?.function)})`,
        program: Array.isArray(outer?.execution?.program) ? outer.execution.program : [],
      },
    ],
    combinedProgramRows,
    stageCount: 2,
  };
}

export function getCompositionStageSummary(row, stageCount = 2) {
  if (!row?.stageLabel) return "";
  return `${row.stageLabel} (${row.functionLabel ?? "unknown"})`;
}
