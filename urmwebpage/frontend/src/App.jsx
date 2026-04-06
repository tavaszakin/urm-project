import { useEffect, useMemo, useState } from "react";
import AppHeader from "./components/AppHeader.jsx";
import ThemeToggleButton from "./components/ThemeToggleButton.jsx";
import ComputePage from "./pages/ComputePage.jsx";
import HomePage from "./pages/HomePage.jsx";
import PublicDemoPage from "./pages/PublicDemoPage.jsx";
import TranslatePage from "./pages/TranslatePage.jsx";
import { DEMO_ROUTE } from "./demoDefaults.js";
import { RADII, THEMES, THEME_MODES, THEME_STORAGE_KEY, TYPOGRAPHY } from "./theme.js";

const HOME_PATHS = new Set(["/"]);
const COMPUTE_PATHS = new Set(["/compute"]);
const DEMO_PATHS = new Set([DEMO_ROUTE, "/public", "/soft-launch"]);

function getRouteFromPath(pathname) {
  if (HOME_PATHS.has(pathname)) return "/";
  if (DEMO_PATHS.has(pathname)) return DEMO_ROUTE;
  if (COMPUTE_PATHS.has(pathname)) return "/compute";
  if (pathname === "/learn") return "/learn";
  if (pathname === "/translate") return "/translate";
  return "/";
}

function getInitialThemeMode() {
  if (typeof window === "undefined") return THEME_MODES.light;

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === THEME_MODES.light || storedTheme === THEME_MODES.night) {
    return storedTheme;
  }

  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return THEME_MODES.night;
  }

  return THEME_MODES.light;
}

export default function App() {
  const [route, setRoute] = useState(() => getRouteFromPath(window.location.pathname));
  const [themeMode, setThemeMode] = useState(getInitialThemeMode);
  const theme = THEMES[themeMode] ?? THEMES[THEME_MODES.light];

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRouteFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.setAttribute("data-theme", themeMode);
    root.style.colorScheme = themeMode === THEME_MODES.night ? "dark" : "light";
    root.style.backgroundColor = theme.surface.pageBackgroundAlt;
    body.style.backgroundColor = theme.surface.pageBackgroundAlt;
    body.style.color = theme.text.primary;
  }, [theme, themeMode]);

  const activePage = useMemo(
    () =>
      route === "/"
        ? "Home"
        : route === DEMO_ROUTE
        ? "Demo"
        : route === "/learn"
          ? "Learn"
          : "Compute",
    [route],
  );
  const isDemoRoute = route === DEMO_ROUTE;
  const isComputeRoute = route === "/compute";
  const isHomeRoute = route === "/";
  const useWorkspaceLayout = isDemoRoute || isComputeRoute;

  function toggleTheme() {
    setThemeMode((current) => (current === THEME_MODES.night ? THEME_MODES.light : THEME_MODES.night));
  }

  function handleNavigate(nextPath) {
    const normalizedPath = getRouteFromPath(nextPath);
    const nextBrowserPath =
      normalizedPath === "/"
        ? "/"
        : normalizedPath === DEMO_ROUTE
        ? DEMO_ROUTE
        : normalizedPath === "/compute"
        ? nextPath
        : normalizedPath === "/learn"
          ? "/learn"
          : "/translate";

    if (window.location.pathname !== nextBrowserPath) {
      window.history.pushState({}, "", nextBrowserPath);
    }

    setRoute(normalizedPath);
  }

  return (
    <div
      className={`app-root${isHomeRoute ? " app-root-home" : ""}`}
      style={{
        "--slider-track": theme.surface.borderSoft,
        "--slider-thumb-fill": theme.surface.cardBackground,
        "--slider-thumb-border": theme.accent.primary,
        "--page-background-start": theme.surface.pageBackground,
        "--page-background-end": theme.surface.pageBackgroundAlt,
        "--panel-background": theme.surface.panelBackground,
        "--panel-background-alt": theme.surface.panelBackgroundAlt,
        "--surface-card": theme.surface.cardBackground,
        "--surface-card-alt": theme.surface.insetBackground,
        "--surface-card-muted": theme.surface.panelBackgroundAlt,
        "--workspace-background": theme.surface.workspaceBackground,
        "--workspace-background-alt": theme.surface.workspaceBackgroundAlt,
        "--app-border": theme.surface.border,
        "--app-border-soft": theme.surface.borderSoft,
        "--border-default": theme.border.default,
        "--border-strong": theme.border.strong,
        "--app-text-primary": theme.text.primary,
        "--app-text-secondary": theme.text.secondary,
        "--app-text-muted": theme.text.muted,
        "--app-text-subtle": theme.text.subtle,
        "--surface-text-primary": theme.text.primaryOnLight,
        "--surface-text-secondary": theme.text.secondaryOnLight,
        "--surface-text-structural": theme.text.structuralOnLight,
        "--surface-text-muted": theme.text.subtle,
        "--app-text-inverse": theme.text.inverse,
        "--app-card-shadow": theme.shadow.card,
        "--app-focus-ring": theme.shadow.focusRing,
        "--app-button-dark": theme.button.darkBackground,
        "--app-button-dark-hover": theme.button.darkBackgroundHover,
        "--app-button-dark-text": theme.button.darkText,
        "--app-button-ghost-border": theme.button.ghostBorder,
        "--app-button-ghost-border-hover": theme.button.ghostBorderHover,
        "--app-button-ghost-border-focus": theme.button.ghostBorderFocus,
        "--app-button-ghost-background": theme.button.ghostBackground,
        "--app-button-ghost-background-hover": theme.button.ghostBackgroundHover,
        "--input-bg-light": theme.input.lightBackground,
        "--input-text-light": theme.input.lightText,
        "--input-border-light": theme.input.lightBorder,
        "--input-placeholder-light": theme.input.lightPlaceholder,
        "--input-hover-bg-light": theme.input.lightHoverBackground,
        "--input-readonly-bg-light": theme.input.lightReadonlyBackground,
        "--input-bg-dark": theme.input.darkBackground,
        "--input-text-dark": theme.input.darkText,
        "--input-border-dark": theme.input.darkBorder,
        "--input-placeholder-dark": theme.input.darkPlaceholder,
        "--input-hover-bg-dark": theme.input.darkHoverBackground,
        "--input-readonly-bg-dark": theme.input.darkReadonlyBackground,
        "--input-focus": theme.input.focus,
        "--input-disabled-opacity": theme.input.disabledOpacity,
        "--token-bg-light": theme.token.lightBackground,
        "--token-text-light": theme.token.lightText,
        "--token-border-light": theme.token.lightBorder,
        "--token-bg-dark": theme.token.darkBackground,
        "--token-text-dark": theme.token.darkText,
        "--token-border-dark": theme.token.darkBorder,
        "--token-strong-bg": theme.token.strongBackground,
        "--token-strong-text": theme.token.strongText,
        "--token-strong-border": theme.token.strongBorder,
        "--feedback-warning-bg": theme.feedback.warningBackground,
        "--feedback-warning-text": theme.feedback.warningText,
        "--feedback-warning-border": theme.feedback.warningBorder,
        "--feedback-error-bg": theme.feedback.errorBackground,
        "--feedback-error-text": theme.feedback.errorText,
        "--feedback-error-border": theme.feedback.errorBorder,
        "--theme-accent-primary": theme.accent.primary,
        "--theme-accent-hover": themeMode === THEME_MODES.night ? "#74b8ff" : "#006699",
        "--theme-accent-soft": themeMode === THEME_MODES.night ? "rgba(78, 161, 255, 0.14)" : "#E6F2F8",
        "--theme-surface": theme.surface.cardBackground,
        "--theme-surface-alt": theme.surface.insetBackground,
        "--theme-surface-muted": theme.surface.panelBackgroundAlt,
        "--theme-workspace-surface": theme.surface.workspaceBackground,
        "--theme-workspace-surface-alt": theme.surface.workspaceBackgroundAlt,
        "--theme-border": theme.border.default,
        "--theme-border-strong": theme.border.strong,
        "--theme-text": theme.text.primaryOnLight,
        "--theme-secondary": theme.text.secondaryOnLight,
        "--theme-structural": theme.text.structuralOnLight,
        "--theme-muted": theme.text.subtle,
        "--theme-current-bg": theme.current.background,
        "--theme-current-strong": theme.current.border,
        "--theme-current-text": themeMode === THEME_MODES.night ? "#fff4eb" : "#111111",
        "--theme-changed-bg": theme.changed.background,
        "--theme-changed-border": theme.changed.border,
        "--theme-changed-text": theme.changed.text,
        "--theme-trace-index-border": theme.surface.borderSoft,
        "--theme-trace-index-background": theme.surface.insetBackground,
        "--theme-slider-track": themeMode === THEME_MODES.night ? "rgba(134, 153, 178, 0.26)" : "rgba(148, 163, 184, 0.28)",
        "--theme-slider-active": theme.text.secondaryOnLight,
        "--theme-slider-thumb": theme.text.primaryOnLight,
        "--theme-slider-thumb-shadow": themeMode === THEME_MODES.night ? "0 1px 2px rgba(0, 0, 0, 0.34)" : "0 1px 2px rgba(15, 23, 42, 0.18)",
        "--app-header-title-color": theme.text.primaryOnLight,
        "--app-header-subtitle-color": theme.text.secondaryOnLight,
        "--app-header-nav-color": theme.text.secondaryOnLight,
        "--app-header-nav-active": theme.text.primaryOnLight,
        "--app-toggle-bg": theme.surface.insetBackground,
        "--app-toggle-border": theme.border.default,
        "--app-toggle-text": theme.text.primaryOnLight,
        "--app-toggle-hover": theme.surface.panelBackgroundAlt,
        "--font-ui": TYPOGRAPHY.families.ui,
        "--font-mono": TYPOGRAPHY.families.mono,
        "--font-weight-regular": TYPOGRAPHY.weights.regular,
        "--font-weight-medium": TYPOGRAPHY.weights.medium,
        "--font-weight-semibold": TYPOGRAPHY.weights.semibold,
        "--font-weight-bold": TYPOGRAPHY.weights.bold,
        "--font-size-xs": `${TYPOGRAPHY.sizes.xs}px`,
        "--font-size-sm": `${TYPOGRAPHY.sizes.sm}px`,
        "--font-size-md": `${TYPOGRAPHY.sizes.md}px`,
        "--font-size-base": `${TYPOGRAPHY.sizes.base}px`,
        "--font-size-lg": `${TYPOGRAPHY.sizes.lg}px`,
        "--font-size-xl": `${TYPOGRAPHY.sizes.xl}px`,
        "--font-size-section": `${TYPOGRAPHY.sizes.section}px`,
        "--font-size-title": `${TYPOGRAPHY.sizes.title}px`,
        "--line-height-tight": TYPOGRAPHY.lineHeights.tight,
        "--line-height-snug": TYPOGRAPHY.lineHeights.snug,
        "--line-height-normal": TYPOGRAPHY.lineHeights.normal,
        "--line-height-relaxed": TYPOGRAPHY.lineHeights.relaxed,
        "--tracking-tight": TYPOGRAPHY.letterSpacing.tight,
        "--tracking-normal": TYPOGRAPHY.letterSpacing.normal,
        "--tracking-wide": TYPOGRAPHY.letterSpacing.wide,
        "--tracking-label": TYPOGRAPHY.letterSpacing.label,
        "--radius-sharp": `${RADII.sharp}px`,
        "--radius-panel": `${RADII.panel}px`,
        "--radius-control": `${RADII.control}px`,
        "--radius-button": `${RADII.button}px`,
        "--radius-chip": `${RADII.chip}px`,
        minHeight: "100vh",
        background: theme.surface.pageBackgroundAlt,
        color: theme.text.primary,
        padding: useWorkspaceLayout ? "0" : "14px 18px 22px",
        boxSizing: "border-box",
      }}
      data-theme={themeMode}
    >
      <div className="site-topbar">
        <div className="site-topbar-inner">
          <ThemeToggleButton themeMode={themeMode} onToggleTheme={toggleTheme} />
        </div>
      </div>

      {isDemoRoute ? (
        <PublicDemoPage onNavigate={handleNavigate} themeMode={themeMode} />
      ) : isHomeRoute ? (
        <HomePage onNavigate={handleNavigate} />
      ) : (
        <div className={`app-shell${isComputeRoute ? " app-shell-light" : ""}`}>
          <AppHeader
            activePath={route}
            onNavigate={handleNavigate}
            subtitle={activePage}
            light={themeMode === THEME_MODES.light}
          />

          {route === "/learn" ? (
            <div className="page-stack">
              <section className="page-intro page-intro-compact">
                <div>
                  <h2 className="page-title">Learn</h2>
                  <p className="page-copy">
                    The Learn page is currently unavailable from the main application.
                  </p>
                </div>
              </section>
            </div>
          ) : route === "/translate" ? (
            <TranslatePage />
          ) : (
            <ComputePage onNavigate={handleNavigate} />
          )}
        </div>
      )}
    </div>
  );
}
