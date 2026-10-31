import "./HomePage.css";

const overviewItems = [
  {
    step: "1",
    title: "Simulator",
    path: "/compute",
  },
  {
    step: "2",
    title: "Flow Diagram",
    path: "/flow-diagram",
  },
];

export default function HomePage({ onNavigate }) {
  return (
    <main className="home-page" aria-labelledby="home-title">
      <section className="home-landing">
        <div className="home-copy">
          <h1 id="home-title" className="home-title">URM stuff</h1>
        </div>

        <nav className="home-overview" aria-label="Overview">
          <ol className="home-overview-list">
            {overviewItems.map((item) => (
              <li key={item.path} className="home-overview-item">
                <span className="home-overview-number">{item.step}</span>
                <a
                  href={item.path}
                  className="home-overview-link"
                  onClick={(event) => {
                    if (
                      event.defaultPrevented ||
                      event.button !== 0 ||
                      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
                    ) return;
                    event.preventDefault();
                    onNavigate(item.path);
                  }}
                >
                  {item.title}
                </a>
                {item.note ? <span className="home-overview-note">{item.note}</span> : null}
              </li>
            ))}
          </ol>
        </nav>
      </section>
    </main>
  );
}
