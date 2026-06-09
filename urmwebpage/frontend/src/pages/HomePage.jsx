const overviewItems = [
  {
    step: "1",
    title: "Unlimited Register Machine Simulator",
    path: "/playground",
  },
  {
    step: "2",
    title: "Demo",
    path: "/demo",
  },
  {
    step: "3",
    title: "Compute",
    path: "/compute",
  },
  {
    step: "4",
    title: "S-m-n",
    path: "/smn",
  },
  {
    step: "5",
    title: "Encoding",
    path: "/encoding",
  },
  {
    step: "6",
    title: "State and Computation Codes",
    path: "/state-codes",
  },
  {
    step: "7",
    title: "Program Equivalence",
    path: "/program-equivalence",
  },
];

export default function HomePage({ onNavigate }) {
  return (
    <main className="home-page" aria-labelledby="home-title">
      <section className="home-landing">
        <div className="home-copy">
          <h1 id="home-title" className="home-title">Computability Through URMs</h1>
        </div>

        <nav className="home-overview" aria-label="Overview">
          <ol className="home-overview-list">
            {overviewItems.map((item) => (
              <li key={item.path} className="home-overview-item">
                <span className="home-overview-number">{item.step}</span>
                <button
                  type="button"
                  className="home-overview-link"
                  onClick={() => onNavigate(item.path)}
                >
                  {item.title}
                </button>
                {item.note ? <span className="home-overview-note">{item.note}</span> : null}
              </li>
            ))}
          </ol>
        </nav>
      </section>
    </main>
  );
}
