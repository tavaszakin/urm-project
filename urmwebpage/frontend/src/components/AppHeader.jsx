const NAV_ITEMS = [
  { label: "Simulator", path: "/compute" },
  { label: "Flow Diagram", path: "/flow-diagram" },
];

export default function AppHeader({
  activePath,
  onNavigate,
  subtitle,
  light = false,
  showTitle = true,
}) {
  const lightClass = light ? " app-header-light" : "";
  const titleClass = light ? " app-title-light" : "";
  const subtitleClass = light ? " app-header-subtitle-light" : "";
  const navClass = light ? " app-nav-light" : "";
  const linkClass = light ? " app-nav-link-light" : "";

  return (
    <header
      className={`app-header${lightClass}`}
      style={showTitle ? undefined : { justifyContent: "flex-end" }}
    >
      {showTitle ? (
        <div className="app-header-copy">
          <h1 className={`app-title${titleClass}`}>URM stuff</h1>
          <div className={`app-header-subtitle${subtitleClass}`}>{subtitle}</div>
        </div>
      ) : null}

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
