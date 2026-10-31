import { Fragment } from "react";
import "./AppHeader.css";

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
  if (activePath === "/compute" || activePath === "/flow-diagram") {
    return (
      <header>
        <nav className="public-tool-nav" aria-label="Primary">
          {[{ label: "URM stuff", path: "/" }, ...NAV_ITEMS].map((item, index) => (
            <Fragment key={item.path}>
              {index > 0 ? <span aria-hidden="true"> | </span> : null}
              <a
                href={item.path}
                aria-current={activePath === item.path ? "page" : undefined}
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
                {item.label}
              </a>
            </Fragment>
          ))}
        </nav>
      </header>
    );
  }

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
