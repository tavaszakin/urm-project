import { DEMO_ROUTE } from "../demoDefaults.js";

const NAV_ITEMS = [
  { label: "Overview", path: "/" },
  { label: "URM Simulator", path: "/playground" },
  { label: "Demo", path: DEMO_ROUTE },
  { label: "Compute", path: "/compute" },
  { label: "Flow Diagram", path: "/flow-diagram" },
  { label: "S-m-n", path: "/smn" },
  { label: "Encoding", path: "/encoding" },
  { label: "State Codes", path: "/state-codes" },
  { label: "Program Equivalence", path: "/program-equivalence" },
];

export default function AppHeader({
  activePath,
  onNavigate,
  subtitle,
  light = false,
}) {
  const lightClass = light ? " app-header-light" : "";
  const titleClass = light ? " app-title-light" : "";
  const subtitleClass = light ? " app-header-subtitle-light" : "";
  const navClass = light ? " app-nav-light" : "";
  const linkClass = light ? " app-nav-link-light" : "";

  return (
    <header className={`app-header${lightClass}`}>
      <div className="app-header-copy">
        <h1 className={`app-title${titleClass}`}>Computability Through URMs</h1>
        <div className={`app-header-subtitle${subtitleClass}`}>{subtitle}</div>
      </div>

      <nav className={`app-nav${navClass}`} aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.path}
            href={item.path}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(item.path);
            }}
            className={`app-nav-link${linkClass}${activePath === item.path ? " app-nav-link-active" : ""}`}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
