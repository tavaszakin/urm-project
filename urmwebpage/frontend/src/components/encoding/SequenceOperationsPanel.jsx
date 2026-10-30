import { useEffect, useMemo, useState } from "react";
import KatexMath from "../KatexMath.jsx";
import {
  buildLengthDivisibilityChecks,
  nthPrime,
  primeFactorLatexFromValues,
  tupleLatex,
} from "../../utils/sequenceEncoding.js";

const SEQUENCE_PRESETS = [
  {
    id: "simple-abstract",
    label: "Abstract sequence",
    kind: "template",
    values: [4, 1, 3],
    description: "A small sequence where the prime exponents are easy to inspect.",
  },
  {
    id: "with-zero",
    label: "Sequence with zero",
    values: [0, 2, 0],
    description: "The +1 in each exponent keeps zero entries visible in the code.",
  },
  {
    id: "register-snapshot",
    label: "Register snapshot",
    values: [2, 0, 5, 1],
    description: "A compact example of finite machine data stored as one code.",
  },
];

const OPERATION_OPTIONS = [
  { value: "length", label: "lh(u)" },
  { value: "entry", label: "(u)_i" },
];

function mathFallback(expression) {
  return String(expression ?? "")
    .replaceAll("\\operatorname", "")
    .replaceAll("\\left", "")
    .replaceAll("\\right", "")
    .replaceAll("\\langle", "<")
    .replaceAll("\\rangle", ">")
    .replaceAll("\\mid", "|")
    .replaceAll("\\nmid", "∤")
    .replaceAll("\\qquad", "   ")
    .replaceAll("\\text", "")
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

function getPresetById(id) {
  return SEQUENCE_PRESETS.find((preset) => preset.id === id) ?? SEQUENCE_PRESETS[0];
}

function ComputationLine({ expression, tone = "default" }) {
  return (
    <div className={`encoding-sequence-computation-line encoding-sequence-computation-line-${tone}`}>
      <KatexMath expression={expression} displayMode fallback={mathFallback(expression)} />
    </div>
  );
}

function LengthComputation({ checks, factorLatex, length }) {
  return (
    <>
      <div className="encoding-sequence-search-lines">
        {checks.map(({ index, prime, divides }) => (
          <ComputationLine
            key={`${index}-${prime.toString()}`}
            tone={divides ? "continue" : "stop"}
            expression={`k=${index},\\quad p_{${index}}=${prime.toString()},\\quad ${prime.toString()}${divides ? "\\mid" : "\\nmid"} ${factorLatex},\\quad \\text{${divides ? "continue" : "stop"}}`}
          />
        ))}
      </div>
      <ComputationLine
        tone="supporting"
        expression={`\\text{first missing prime found at }k=${length}`}
      />
      <ComputationLine tone="result" expression={`\\operatorname{lh}(u)=${length}`} />
    </>
  );
}

function EntryComputation({ factorLatex, selectedIndex, prime, exponent, entry }) {
  return (
    <>
      <div className="encoding-sequence-search-lines">
        <ComputationLine expression={`i=${selectedIndex},\\quad p_{${selectedIndex}}=${prime.toString()}`} />
        <ComputationLine expression={`u=${factorLatex}`} />
        <ComputationLine expression={`\\nu_{${prime.toString()}}(u)=${exponent.toString()}`} />
      </div>
      <ComputationLine tone="result" expression={`(u)_{${selectedIndex}}=${exponent.toString()}-1=${entry}`} />
    </>
  );
}

function SequenceReadingDefinitions({ operation }) {
  const isLengthOperation = operation === "length";

  return (
    <div className="encoding-sequence-definitions">
      {isLengthOperation ? (
        <>
          <MathLine expression={"\\operatorname{lh}(u)=\\text{length}"} tone="supporting" />
          <MathLine expression={"\\operatorname{lh}(u)=\\mu k\\,[\\,p_k\\nmid u\\,]"} tone="supporting" />
        </>
      ) : (
        <>
          <MathLine expression={"(u)_i=\\text{the }i\\text{-th entry }(0\\text{-based})"} tone="supporting" />
          <MathLine expression={"(u)_i=\\nu_{p_i}(u)-1"} tone="supporting" />
        </>
      )}
    </div>
  );
}

export default function SequenceOperationsPanel() {
  const [presetId, setPresetId] = useState(SEQUENCE_PRESETS[0].id);
  const [operation, setOperation] = useState(OPERATION_OPTIONS[0].value);
  const [selectedIndex, setSelectedIndex] = useState(1);

  const selectedPreset = useMemo(() => getPresetById(presetId), [presetId]);
  const isTemplatePreset = selectedPreset.kind === "template";
  const values = selectedPreset.values;
  const sequenceLatex = useMemo(() => tupleLatex(values), [values]);
  const factorLatex = useMemo(() => primeFactorLatexFromValues(values), [values]);
  const lengthChecks = useMemo(() => buildLengthDivisibilityChecks(values), [values]);
  const selectedEntry = values[selectedIndex] ?? 0;
  const selectedPrime = nthPrime(selectedIndex);
  const selectedExponent = BigInt(selectedEntry) + 1n;
  const codeExpression = `u=${sequenceLatex}=${factorLatex}`;

  useEffect(() => {
    if (selectedIndex >= values.length) {
      setSelectedIndex(Math.max(values.length - 1, 0));
    }
  }, [selectedIndex, values.length]);

  return (
    <section className="encoding-derivation encoding-sequence-operations" aria-labelledby="sequence-operations-heading">
      <div className="encoding-panel-header">
        <div>
          <h3 id="sequence-operations-heading" className="encoding-panel-title">Reading sequence codes</h3>
        </div>

        <div className="encoding-sequence-controls">
          <label className="encoding-control-field">
            <span className="encoding-control-field-label">Sequence</span>
            <select
              value={presetId}
              onChange={(event) => setPresetId(event.target.value)}
              className="dashboard-control runner-toolbar-select encoding-preset-select"
            >
              {SEQUENCE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="encoding-control-field">
            <span className="encoding-control-field-label">Operation</span>
            <select
              value={operation}
              onChange={(event) => setOperation(event.target.value)}
              className="dashboard-control runner-toolbar-select encoding-preset-select"
            >
              {OPERATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {operation === "entry" ? (
            <label className="encoding-control-field encoding-index-field">
              <span className="encoding-control-field-label">Index</span>
              <select
                value={selectedIndex}
                onChange={(event) => setSelectedIndex(Number(event.target.value))}
                className="dashboard-control runner-toolbar-select encoding-index-select"
              >
                {values.map((_, index) => (
                  <option key={index} value={index}>
                    {index}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      <SequenceReadingDefinitions operation={operation} />

      {isTemplatePreset ? null : (
        <div className="encoding-sequence-derivation-strip">
          <ComputationLine expression={codeExpression} tone="code" />
          {operation === "length" ? (
            <LengthComputation checks={lengthChecks} factorLatex={factorLatex} length={values.length} />
          ) : (
            <EntryComputation
              factorLatex={factorLatex}
              selectedIndex={selectedIndex}
              prime={selectedPrime}
              exponent={selectedExponent}
              entry={selectedEntry}
            />
          )}
        </div>
      )}
    </section>
  );
}

export { SEQUENCE_PRESETS };
