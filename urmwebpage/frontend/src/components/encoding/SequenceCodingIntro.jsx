import KatexMath from "../KatexMath.jsx";

function mathFallback(expression) {
  return String(expression ?? "")
    .replaceAll("\\operatorname", "")
    .replaceAll("\\left", "")
    .replaceAll("\\right", "")
    .replaceAll("\\langle", "<")
    .replaceAll("\\rangle", ">")
    .replaceAll("\\dots", "...")
    .replaceAll("\\mid", "|")
    .replaceAll("\\nmid", "∤")
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

export default function SequenceCodingIntro() {
  return (
    <section className="encoding-derivation encoding-concept-section" aria-labelledby="sequence-coding-heading">
      <div className="encoding-panel-header">
        <div>
          <h3 id="sequence-coding-heading" className="encoding-panel-title">Sequence coding</h3>
        </div>
      </div>

      <div className="encoding-concept-copy">
        <MathLine
          expression={"\\left\\langle a_0,\\dots,a_k\\right\\rangle=2^{a_0+1}3^{a_1+1}\\cdots p_k^{a_k+1}"}
          tone="result"
        />
      </div>
    </section>
  );
}
