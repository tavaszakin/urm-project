import { normalizeFunctionKind, renderFunctionExpression } from "../functionMetadata.js";

function formatCanonicalCall(stepIndex, remainingInputs) {
  const args = [stepIndex, ...(Array.isArray(remainingInputs) ? remainingInputs : [])];
  return `f(${args.join(", ")})`;
}

function getTraceRows(trace, traceRange) {
  if (!Array.isArray(trace) || !traceRange) {
    return [];
  }

  const start = Number(traceRange.start_row_index);
  const end = Number(traceRange.end_row_index);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return [];
  }

  return trace.slice(start, end + 1);
}

function getNodeOutputValue(node) {
  if (typeof node?.output_value === "number") return node.output_value;
  return null;
}

function formatApplicationText(node) {
  if (!node?.function) {
    return "";
  }

  const args = Array.isArray(node?.input_registers)
    ? node.input_registers.map((value) => String(value))
    : [];

  return renderFunctionExpression(node.function, args);
}

export function buildPrimitiveRecursionStepView(runData) {
  const evaluation = runData?.evaluation;

  if (normalizeFunctionKind(evaluation?.kind) !== "primrec") {
    return null;
  }

  const remainingInputs = Array.isArray(evaluation?.remaining_inputs) ? evaluation.remaining_inputs : [];
  const unifiedTrace = Array.isArray(runData?.trace) ? runData.trace : [];
  const stepNodes = [
    { stepIndex: 0, node: evaluation?.base },
    ...(Array.isArray(evaluation?.iterations) ? evaluation.iterations : []).map((iteration) => ({
      stepIndex: Number(iteration?.iteration ?? 0) + 1,
      node: iteration,
    })),
  ];

  const stepGroups = [];
  let previousValue = null;

  for (const { stepIndex, node } of stepNodes) {
    const rows = getTraceRows(unifiedTrace, node?.trace_range);
    const outputValue = getNodeOutputValue(node);

    stepGroups.push({
      stepIndex,
      label: stepIndex === 0 ? "Step 0" : `Step ${stepIndex}`,
      callText: formatCanonicalCall(stepIndex, remainingInputs),
      startRowIndex: node?.trace_range?.start_row_index ?? null,
      endRowIndex: node?.trace_range?.end_row_index ?? null,
      rowCount: rows.length,
      rows,
      outputValue,
      previousValue,
      applicationText: formatApplicationText(node),
      programRange: node?.program_range ?? null,
      function: node?.function ?? null,
      inputRegisters: Array.isArray(node?.input_registers) ? node.input_registers : [],
    });

    previousValue = outputValue;
  }

  return {
    trace: unifiedTrace,
    stepGroups,
    finalization: evaluation?.finalization ?? null,
    compiledProgram: evaluation?.compiled_program ?? null,
  };
}
