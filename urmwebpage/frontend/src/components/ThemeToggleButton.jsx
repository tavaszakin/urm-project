import { THEME_MODES } from "../theme.js";

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      className="theme-toggle-icon theme-toggle-icon-sun"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="currentColor">
        <circle cx="12" cy="12" r="4.15" />
        <rect x="11" y="1.8" width="2" height="4.1" rx="1" />
        <rect x="11" y="18.1" width="2" height="4.1" rx="1" />
        <rect x="18.1" y="11" width="4.1" height="2" rx="1" />
        <rect x="1.8" y="11" width="4.1" height="2" rx="1" />
        <rect x="16.95" y="4.25" width="2" height="4" rx="1" transform="rotate(45 17.95 6.25)" />
        <rect x="16.95" y="15.75" width="2" height="4" rx="1" transform="rotate(-45 17.95 17.75)" />
        <rect x="5.05" y="15.75" width="2" height="4" rx="1" transform="rotate(45 6.05 17.75)" />
        <rect x="5.05" y="4.25" width="2" height="4" rx="1" transform="rotate(-45 6.05 6.25)" />
      </g>
    </svg>
  );
}

export default function ThemeToggleButton({ themeMode = THEME_MODES.light, onToggleTheme }) {
  if (!onToggleTheme) {
    return null;
  }

  const nextModeLabel = themeMode === THEME_MODES.night ? "light" : "night";
  const isNightMode = themeMode === THEME_MODES.night;

  return (
    <button
      type="button"
      className="app-theme-toggle site-theme-toggle"
      onClick={onToggleTheme}
      aria-label={`Switch to ${nextModeLabel} mode`}
      title={`Switch to ${nextModeLabel} mode`}
    >
      {isNightMode ? (
        <SunIcon />
      ) : (
        <span aria-hidden="true" className="theme-toggle-icon theme-toggle-icon-moon">☾</span>
      )}
    </button>
  );
}
