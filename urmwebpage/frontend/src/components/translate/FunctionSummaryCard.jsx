export default function FunctionSummaryCard({ x, y, result }) {
  return (
    <section className="translate-card translate-card-function">
      <div className="translate-card-header">
        <div>
          <div className="translate-card-kicker">Section A</div>
          <h3 className="translate-card-title">Function</h3>
        </div>
      </div>

      <div className="translate-function-card">
        <div className="translate-function-label-row">
          <span className="translate-function-name">Addition</span>
          <span className="translate-function-formula">f(x, y) = x + y</span>
        </div>
        <div className="translate-function-values">
          <div className="translate-function-value-chip">x = {x}</div>
          <div className="translate-function-value-chip">y = {y}</div>
          <div className="translate-function-value-chip">output = {result}</div>
        </div>
      </div>
    </section>
  );
}
