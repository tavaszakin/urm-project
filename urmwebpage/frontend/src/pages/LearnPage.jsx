import BuildingBlockDemoCard from "../components/BuildingBlockDemoCard.jsx";
import { getLearnDemos } from "../utils/learnDemos.js";

const DEMOS = getLearnDemos();

export default function LearnPage({ onNavigate }) {
  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <h2 className="page-title">Learn</h2>
          <p className="page-copy">
            This page shows the small URM instruction patterns that underlie larger computations.
            Step through each example to see how individual instructions change the registers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate("/compute")}
          className="page-subtle-link"
        >
          Try these ideas in the main tool →
        </button>
      </section>

      <section className="learn-section">
        <div className="learn-section-heading">
          <div className="learn-section-kicker">URM building blocks</div>
          <h3 className="learn-section-title">Small patterns, visible cause and effect</h3>
          <p className="learn-section-copy">
            Each card isolates one machine pattern so you can step through the trace manually.
          </p>
        </div>

        <div className="learn-demo-list">
          {DEMOS.map((demo) => (
            <BuildingBlockDemoCard key={demo.id} {...demo} />
          ))}
        </div>
      </section>

      <section className="learn-flat-section">
        <details className="learn-details" open>
          <summary className="learn-details-summary">Why these 4 instructions are enough</summary>
          <div className="learn-details-body">
            <div><code>Z(i)</code> gives memory a clean starting point.</div>
            <div><code>S(i)</code> changes state one step at a time.</div>
            <div><code>T(i, j)</code> carries values into the next part of a computation.</div>
            <div><code>J(i, j, q)</code> chooses what instruction comes next.</div>
            <div className="learn-details-closing">
              Together they give a URM memory, state change, and control flow.
            </div>
          </div>
        </details>
      </section>

      <section className="learn-flat-section learn-flat-section-divider">
        <div className="learn-section-heading">
          <div className="learn-section-kicker">Connection</div>
          <h3 className="learn-section-title">From machine steps to recursive functions</h3>
          <p className="learn-section-copy">
            Recursive-function programs are assembled from familiar patterns: base-case setup,
            copying carried values, updating a running value, and using small control loops to
            decide what happens next. The Compute page keeps the mathematical definition in front;
            these cards show the register-level moves underneath it.
          </p>
        </div>
      </section>
    </div>
  );
}
