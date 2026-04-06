export default function HomePage({ onNavigate }) {
  return (
    <main className="home-page" aria-labelledby="home-title">
      <section className="home-landing">
        <div className="home-copy">
          <h1 id="home-title" className="home-title">Unlimited Register Machine Visualizer</h1>
          <p className="home-subtitle">
            See how computable functions execute step by step as register machine programs.
          </p>
        </div>

        <div className="home-actions" role="navigation" aria-label="Primary">
          <button
            type="button"
            className="home-nav-card home-nav-card-primary"
            onClick={() => onNavigate("/demo")}
          >
            <span className="home-nav-head">
              <span className="home-nav-title">Demo</span>
            </span>
            <span className="home-nav-kicker">(Start here)</span>
            <span className="home-nav-copy">
              Step through a complete example and watch the machine evolve.
            </span>
          </button>

          <button
            type="button"
            className="home-nav-card"
            onClick={() => onNavigate("/compute")}
          >
            <span className="home-nav-head">
              <span className="home-nav-title">Compute</span>
            </span>
            <span className="home-nav-copy">
              Build a function, run it, and inspect its execution step by step.
            </span>
          </button>
        </div>
      </section>
    </main>
  );
}
