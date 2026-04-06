import { DEMO_ROUTE } from "../demoDefaults.js";

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
        <h1 className={`app-title${titleClass}`}>URM Visualizer</h1>
        <div className={`app-header-subtitle${subtitleClass}`}>{subtitle}</div>
      </div>

      <nav className={`app-nav${navClass}`} aria-label="Primary">
        <a
          href="/compute"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("/compute");
          }}
          className={`app-nav-link${linkClass}${activePath === "/compute" ? " app-nav-link-active" : ""}`}
        >
          Compute
        </a>
        <a
          href={DEMO_ROUTE}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(DEMO_ROUTE);
          }}
          className={`app-nav-link${linkClass}${activePath === DEMO_ROUTE ? " app-nav-link-active" : ""}`}
        >
          Demo
        </a>
      </nav>
    </header>
  );
}
