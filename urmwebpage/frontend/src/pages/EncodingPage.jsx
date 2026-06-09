import { useMemo, useState } from "react";
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
import SequenceCodingIntro from "../components/encoding/SequenceCodingIntro.jsx";
import SequenceOperationsPanel from "../components/encoding/SequenceOperationsPanel.jsx";
import {
  DEFAULT_ENCODING_PRESET_ID,
  ENCODING_PRESETS,
  getEncodingPresetById,
} from "../utils/encodingPresets.js";
import {
  encodeTuple,
  estimateTupleDecimalDigits,
  tupleLatex,
  tuplePrimeFactorForm,
} from "../utils/sequenceEncoding.js";
import { formatInstructionLatex } from "../utils/urmFormatting.js";

const DECIMAL_EXPANSION_DIGIT_LIMIT = 48;
const DECIMAL_OMITTED_MESSAGE =
  "Decimal expansion omitted; the exact prime-factorized encoding is shown above.";
const TEMPLATE_PROGRAM_LATEX = "P=\\left(I_0,I_1,\\dots,I_{s-1}\\right)";
const TEMPLATE_PROGRAM_CODE_LATEX = "\\#P=\\left\\langle \\#I_0,\\#I_1,\\dots,\\#I_{s-1}\\right\\rangle";
const TEMPLATE_INSTRUCTION_DERIVATION_ROWS = [
  {
    identity: "I_i=Z(n)",
    structured: "\\#I_i=\\#Z(n)=\\left\\langle 0,n\\right\\rangle",
  },
  {
    identity: "I_i=S(n)",
    structured: "\\#I_i=\\#S(n)=\\left\\langle 1,n\\right\\rangle",
  },
  {
    identity: "I_i=T(m,n)",
    structured: "\\#I_i=\\#T(m,n)=\\left\\langle 2,m,n\\right\\rangle",
  },
  {
    identity: "I_i=J(m,n,q)",
    structured: "\\#I_i=\\#J(m,n,q)=\\left\\langle 3,m,n,q\\right\\rangle",
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

function buildPresetEncodingDetails(program) {
  const programList = Array.isArray(program) ? program : [];
  const instructionDetails = programList.map((instruction) => {
    const tuple = instructionToTuple(instruction);
    const code = encodeTuple(tuple);

    return {
      instruction,
      tuple,
      code: code.toString(),
      codeValue: code,
      prime_factor_form: tuplePrimeFactorForm(tuple),
    };
  });
  const instructionCodes = instructionDetails.map((detail) => detail.codeValue);
  const programCodeDigits = estimateTupleDecimalDigits(instructionCodes, DECIMAL_EXPANSION_DIGIT_LIMIT);
  const programCodeValue =
    programCodeDigits <= DECIMAL_EXPANSION_DIGIT_LIMIT ? encodeTuple(instructionCodes) : null;

  return {
    program: programList,
    instruction_details: instructionDetails,
    instruction_codes: instructionDetails.map((detail) => detail.code),
    program_tuple: instructionDetails.map((detail) => detail.code),
    program_code: programCodeValue === null ? null : programCodeValue.toString(),
    program_code_decimal_digits: programCodeValue === null ? null : programCodeDigits,
    program_code_decimal_omitted: programCodeValue === null,
    program_prime_factor_form: tuplePrimeFactorForm(instructionCodes),
  };
}

function getDecimalDisplay(value) {
  const decimal = String(value ?? "").trim();

  if (!decimal || !/^\d+$/.test(decimal)) {
    return { decimal: "", shouldShow: false, digitCount: 0 };
  }

  return {
    decimal,
    shouldShow: decimal.length <= DECIMAL_EXPANSION_DIGIT_LIMIT,
    digitCount: decimal.length,
  };
}

function DecimalExpansion({ value, expressionPrefix }) {
  const display = getDecimalDisplay(value);

  if (display.shouldShow) {
    return <MathLine expression={`${expressionPrefix}=${display.decimal}`} tone="result" />;
  }

  return <div className="encoding-decimal-note">{DECIMAL_OMITTED_MESSAGE}</div>;
}

function InstructionDetailTable({ details }) {
  if (!Array.isArray(details) || details.length === 0) {
    return <div className="encoding-empty-state">No instruction details to display.</div>;
  }

  return (
    <div className="encoding-table-shell">
      <table className="encoding-table encoding-decoded-instruction-table">
        <thead>
          <tr>
            <th>I</th>
            <th>Instruction</th>
            <th>Tuple</th>
            <th>Code</th>
            <th>Prime factors</th>
          </tr>
        </thead>
        <tbody>
          {details.map((detail, index) => {
            const codeDisplay = getDecimalDisplay(detail.code);
            const primeFactorExpression = primeFactorLatex(detail.prime_factor_form);

            return (
              <tr key={`${detail.code}-${index}`}>
                <td className="encoding-table-index">{index}</td>
                <td><KatexMath expression={formatInstructionLatex(detail.instruction)} /></td>
                <td><KatexMath expression={tupleLatex(detail.tuple)} /></td>
                <td className="encoding-table-code">
                  {codeDisplay.shouldShow ? (
                    <KatexMath expression={detail.code} />
                  ) : (
                    <span className="encoding-decimal-note encoding-decimal-note-table">
                      Decimal omitted
                    </span>
                  )}
                </td>
                <td className="encoding-table-prime-factors">
                  {primeFactorExpression ? <KatexMath expression={primeFactorExpression} /> : <span>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function primeFactorLatex(value) {
  const factorForm = String(value ?? "").trim();
  if (!factorForm) return null;

  return factorForm
    .split(/\s*\*\s*/)
    .map((factor) => {
      const [, base, exponent] = factor.match(/^(\d+)\^(\d+)$/) ?? [];
      if (!base || !exponent) return factor;

      return `${base}^{${exponent}}`;
    })
    .join("\\cdot ");
}

function buildInstructionIdentityLines(program) {
  return (Array.isArray(program) ? program : []).map(
    (instruction, index) => `I_{${index}}=${formatInstructionLatex(instruction)}`,
  );
}

function buildInstructionDerivationRows(program, result) {
  const identityLines = buildInstructionIdentityLines(program);
  const details = Array.isArray(result?.instruction_details) ? result.instruction_details : [];

  return identityLines.map((identity, index) => {
    const detail = details[index];
    const primeFactorForm = primeFactorLatex(detail?.prime_factor_form);
    const structured = detail
      ? `\\#${formatInstructionLatex(detail.instruction)}=${tupleLatex(detail.tuple)}`
      : null;
    const factorized = detail
      ? `${tupleLatex(detail.tuple)}=${primeFactorForm ?? "?"}`
      : null;

    return {
      identity,
      structured,
      factorized,
      decimal: detail?.code ?? null,
      decimalPrefix: detail ? `\\#${formatInstructionLatex(detail.instruction)}` : null,
    };
  });
}

function buildProgramSummaryLatex(program) {
  const instructions = Array.isArray(program) ? program : [];
  if (instructions.length === 0) {
    return "P=\\left(\\right)";
  }

  return `P=\\left(${instructions.map(formatInstructionLatex).join(",\\ ")}\\right)`;
}

function buildProgramCodeLines(result) {
  if (!result?.program_tuple) return null;

  const primeFactorForm = primeFactorLatex(result.program_prime_factor_form);
  const structured = `\\#P=${tupleLatex(result.program_tuple)}`;
  const factorized = primeFactorForm ? `${tupleLatex(result.program_tuple)}=${primeFactorForm}` : null;

  return {
    structured,
    factorized,
    decimal: result.program_code ?? null,
    decimalPrefix: "\\#P",
  };
}

function buildDecodeLine(result) {
  if (!result?.code) return null;

  const primeFactorForm = primeFactorLatex(result.program_prime_factor_form);
  if (!primeFactorForm) {
    return `${result.code}\\longmapsto ${tupleLatex(result.program_tuple)}\\longmapsto P`;
  }

  return `${result.code}\\longmapsto ${primeFactorForm}\\longmapsto ${tupleLatex(result.program_tuple)}\\longmapsto P`;
}

function buildSelectedExampleDecodeResult(preset, result) {
  if (preset?.kind === "template" || !result?.program) return null;

  const program = Array.isArray(result.program) ? result.program : [];
  const instructionDetails = Array.isArray(result.instruction_details) ? result.instruction_details : [];
  const opcodeCounts = program.reduce((counts, instruction) => {
    const opcode = instruction?.[0];
    if (opcode) {
      counts[opcode] = (counts[opcode] ?? 0) + 1;
    }
    return counts;
  }, {});

  return {
    code: result.program_code ?? "\\#P",
    code_is_decimal: Boolean(result.program_code),
    example_label: preset?.label ?? "Selected example",
    program,
    instruction_tuples: instructionDetails.map((item) => item.tuple),
    program_tuple: result.program_tuple ?? [],
    instruction_details: instructionDetails,
    program_prime_factor_form: result.program_prime_factor_form,
    instruction_count: program.length,
    opcode_sequence: program.map((instruction) => instruction?.[0]).filter(Boolean),
    opcode_counts: opcodeCounts,
    is_empty_program: program.length === 0,
  };
}

function mathFallback(expression) {
  return String(expression ?? "")
    .replaceAll("\\#", "#")
    .replaceAll("\\longrightarrow", "→")
    .replaceAll("\\longmapsto", "↦")
    .replaceAll("\\left", "")
    .replaceAll("\\right", "")
    .replaceAll("\\langle", "<")
    .replaceAll("\\rangle", ">")
    .replaceAll("\\ ", " ")
    .replaceAll("\\,", " ");
}

function MathLine({ expression, tone = "default" }) {
  return (
    <div className={`encoding-math-line encoding-math-line-${tone}`}>
      <KatexMath expression={expression} displayMode fallback={mathFallback(expression)} />
    </div>
  );
}

function InstructionDerivationRow({ row, index }) {
  return (
    <div className="encoding-instruction-derivation-row" key={`instruction-row-${index}-${row.identity}`}>
      <MathLine expression={row.identity} tone="muted" />
      {row.structured ? (
        <div className="encoding-code-breakdown">
          <MathLine expression={row.structured} tone="supporting" />
          {row.factorized ? <MathLine expression={row.factorized} /> : null}
          {row.decimal != null ? <DecimalExpansion value={row.decimal} expressionPrefix={row.decimalPrefix} /> : null}
        </div>
      ) : (
        <div className="encoding-derivation-pending">Instruction code appears after encoding.</div>
      )}
    </div>
  );
}

export default function EncodingPage() {
  const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_ENCODING_PRESET_ID);

  const selectedPreset = useMemo(() => getEncodingPresetById(selectedPresetId), [selectedPresetId]);
  const isTemplateMode = selectedPreset?.kind === "template";
  const programResult = useMemo(
    () => buildPresetEncodingDetails(selectedPreset?.program ?? []),
    [selectedPreset?.program],
  );
  const instructionDerivationRows = useMemo(
    () => buildInstructionDerivationRows(selectedPreset?.program, programResult),
    [selectedPreset?.program, programResult],
  );
  const programSummaryLatex = useMemo(
    () => buildProgramSummaryLatex(selectedPreset?.program),
    [selectedPreset?.program],
  );
  const programCodeLines = useMemo(() => buildProgramCodeLines(programResult), [programResult]);
  const selectedDecodeResult = useMemo(
    () => buildSelectedExampleDecodeResult(selectedPreset, programResult),
    [selectedPreset, programResult],
  );
  const selectedDecodeLine = useMemo(() => buildDecodeLine(selectedDecodeResult), [selectedDecodeResult]);

  function handlePresetChange(event) {
    setSelectedPresetId(event.target.value);
  }

  return (
    <div className="page-stack compute-page encoding-page">
      <section className="page-intro page-intro-compact">
        <div className="page-intro-copy">
          <h2 className="page-title">URM Encoding</h2>
        </div>
      </section>

      <main className="encoding-workspace">
        <SequenceCodingIntro />

        <SequenceOperationsPanel />

        <FunctionCard className="encoding-control-card encoding-example-card" aria-labelledby="selected-example-heading">
          <div className="encoding-example-card-header">
            <h3 id="selected-example-heading" className="encoding-panel-title">Program coding example</h3>
          </div>

          <FunctionCardRows className="encoding-example-summary">
            <FunctionCardRow>
              <FunctionCardLabel>{isTemplateMode ? null : "Example"}</FunctionCardLabel>
              <FunctionCardMath className="encoding-card-math">
                {!isTemplateMode ? (
                  <KatexMath expression={selectedPreset?.functionLatex ?? selectedPreset?.functionLabel ?? ""} />
                ) : null}
              </FunctionCardMath>
              <FunctionCardControls className="encoding-example-selector-controls">
                <label className="encoding-control-field">
                  <span className="encoding-control-field-label">Choose example</span>
                  <select
                    value={selectedPreset?.id ?? ""}
                    onChange={handlePresetChange}
                    className="dashboard-control runner-toolbar-select encoding-preset-select"
                  >
                    {ENCODING_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
              </FunctionCardControls>
            </FunctionCardRow>

            <FunctionCardRow>
              <FunctionCardLabel>Program</FunctionCardLabel>
              <FunctionCardMath className="encoding-card-math encoding-program-summary">
                <KatexMath expression={isTemplateMode ? TEMPLATE_PROGRAM_LATEX : programSummaryLatex} />
              </FunctionCardMath>
              <FunctionCardControls />
            </FunctionCardRow>
          </FunctionCardRows>

          {isTemplateMode ? (
            <div className="encoding-example-flow">
              <div className="encoding-example-subsection">
                <div className="encoding-derivation-lines">
                  <div className="encoding-instruction-derivation-list">
                    {TEMPLATE_INSTRUCTION_DERIVATION_ROWS.map((row, index) => (
                      <InstructionDerivationRow row={row} index={index} key={`template-row-${index}-${row.identity}`} />
                    ))}
                  </div>

                  <div className="encoding-code-breakdown encoding-program-code-breakdown encoding-final-code-summary">
                    <MathLine expression={TEMPLATE_PROGRAM_CODE_LATEX} tone="supporting" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="encoding-example-flow">
              <div className="encoding-example-subsection">
                <div className="encoding-derivation-lines">
                  <div className="encoding-instruction-derivation-list">
                    {instructionDerivationRows.map((row, index) => (
                      <InstructionDerivationRow row={row} index={index} key={`concrete-row-${index}-${row.identity}`} />
                    ))}
                  </div>

                  {programResult ? (
                    programCodeLines ? (
                      <div className="encoding-code-breakdown encoding-program-code-breakdown encoding-final-code-summary">
                        <MathLine expression={programCodeLines.structured} tone="supporting" />
                        {programCodeLines.factorized ? <MathLine expression={programCodeLines.factorized} /> : null}
                        <DecimalExpansion value={programCodeLines.decimal} expressionPrefix={programCodeLines.decimalPrefix} />
                      </div>
                    ) : null
                  ) : (
                    <div className="encoding-derivation-placeholder">
                      Encoding will show the instruction codes and the final program code here.
                    </div>
                  )}
                </div>
              </div>

              <div className="encoding-example-subsection">
                {selectedDecodeLine ? <MathLine expression={selectedDecodeLine} tone="supporting" /> : null}
                {selectedDecodeResult ? (
                  <div className="encoding-decode-result">
                    <InstructionDetailTable details={selectedDecodeResult.instruction_details} />
                  </div>
                ) : (
                  <div className="encoding-stage-placeholder encoding-stage-placeholder-compact">
                    Choose a concrete program example to decode its program code.
                  </div>
                )}
              </div>
            </div>
          )}
        </FunctionCard>

      </main>

      <FurtherReading items={["Cutland, Computability, §4.1"]} />
    </div>
  );
}
