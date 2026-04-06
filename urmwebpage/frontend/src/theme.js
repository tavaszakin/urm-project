export const THEME_STORAGE_KEY = "urm-theme-mode";
export const THEME_MODES = {
  light: "light",
  night: "night",
};

const LIGHT_COLORS = {
  surface: {
    page: "#f8fafc",
    panel: "#ffffff",

    pageBackground: "#f8fafc",
    pageBackgroundAlt: "#ffffff",

    panelBackground: "#ffffff",
    panelBackgroundAlt: "#f8fafc",

    workspaceBackground: "#ffffff",
    workspaceBackgroundAlt: "#f8fafc",

    cardBackground: "#ffffff",
    insetBackground: "#f8fafc",

    border: "#d1d5db",
    borderStrong: "#9ca3af",
    borderSoft: "#d1d5db",
  },

  text: {
    primary: "#111111",
    secondary: "#111111",
    muted: "#111111",
    subtle: "#6b7280",
    primaryOnLight: "#0f172a",
    secondaryOnLight: "#475569",
    structuralOnLight: "#334155",
    inverse: "#f8fafb",
  },

  border: {
    default: "#d1d5db",
    strong: "#9ca3af",
  },

  shadow: {
    card: "0 2px 8px rgba(15, 23, 42, 0.08), 0 12px 28px rgba(15, 23, 42, 0.12)",
    focusRing: "0 0 0 2px rgba(99, 102, 241, 0.24)",
  },

  active: {
    row: "#efc24a",
    border: "#efc24a",
  },

  current: {
    background: "#efc24a",
    softBackground: "#efc24a",
    border: "#efc24a",
  },

  changed: {
    bg: "#de5f81",
    text: "#111111",
    background: "#de5f81",
    backgroundStrong: "#de5f81",
    backgroundSubtle: "#de5f81",
    border: "#de5f81",
    ring: "#de5f81",
  },

  instruction: {
    activeBg: "#efc24a",
    accent: "#efc24a",
  },

  execution: {
    bg: "#ffffff",
    border: "#d1d5db",
    highlight: "#fde68a",
  },

  accent: {
    primary: "#2563eb",
    blue: "#2563eb",
    error: "#ef4444",
  },

  button: {
    darkBackground: "#1f2937",
    darkBackgroundHover: "#273449",
    darkText: "#f9fafb",

    ghostBorder: "rgba(15, 23, 42, 0.16)",
    ghostBorderHover: "rgba(15, 23, 42, 0.24)",
    ghostBorderFocus: "rgba(99, 102, 241, 0.40)",

    ghostBackground: "rgba(255, 255, 255, 0.60)",
    ghostBackgroundHover: "rgba(255, 255, 255, 0.82)",
  },

  input: {
    lightBackground: "#ffffff",
    lightText: "#0f172a",
    lightBorder: "#cbd5e1",
    lightPlaceholder: "#64748b",
    lightHoverBackground: "#f8fafc",
    lightReadonlyBackground: "#f8fafc",
    darkBackground: "#1e293b",
    darkText: "#f8fafc",
    darkBorder: "#475569",
    darkPlaceholder: "#94a3b8",
    darkHoverBackground: "#273449",
    darkReadonlyBackground: "#334155",
    focus: "#6366f1",
    disabledOpacity: 0.6,
  },

  token: {
    lightBackground: "#e2e8f0",
    lightText: "#0f172a",
    lightBorder: "#94a3b8",
    darkBackground: "#243b53",
    darkText: "#f8fafc",
    darkBorder: "#60a5fa",
    strongBackground: "#1e3a5f",
    strongText: "#f8fafc",
    strongBorder: "#60a5fa",
  },

  feedback: {
    warningBackground: "rgba(254, 243, 199, 0.68)",
    warningText: "#92400e",
    warningBorder: "rgba(245, 158, 11, 0.26)",
    errorBackground: "rgba(254, 226, 226, 0.72)",
    errorText: "#991b1b",
    errorBorder: "rgba(248, 113, 113, 0.35)",
  },
};

const NIGHT_COLORS = {
  surface: {
    page: "#09111d",
    panel: "#0f1828",

    pageBackground: "#09111d",
    pageBackgroundAlt: "#101a2c",

    panelBackground: "#101b2d",
    panelBackgroundAlt: "#162235",

    workspaceBackground: "#0c1423",
    workspaceBackgroundAlt: "#121d31",

    cardBackground: "#101b2d",
    insetBackground: "#162235",

    border: "#28364c",
    borderStrong: "#415371",
    borderSoft: "#202d42",
  },

  text: {
    primary: "#e6edf7",
    secondary: "#d7e2f0",
    muted: "#9db0c7",
    subtle: "#8699b2",
    primaryOnLight: "#e6edf7",
    secondaryOnLight: "#bdcce0",
    structuralOnLight: "#d8e3f2",
    inverse: "#08101b",
  },

  border: {
    default: "#28364c",
    strong: "#415371",
  },

  shadow: {
    card: "0 14px 34px rgba(0, 0, 0, 0.34), 0 2px 10px rgba(0, 0, 0, 0.22)",
    focusRing: "0 0 0 2px rgba(78, 161, 255, 0.32)",
  },

  active: {
    row: "#f4b98f",
    border: "#ee7733",
  },

  current: {
    background: "rgba(238, 119, 51, 0.22)",
    softBackground: "rgba(238, 119, 51, 0.16)",
    border: "#f4b98f",
  },

  changed: {
    bg: "rgba(238, 51, 119, 0.22)",
    text: "#fde8f3",
    background: "rgba(238, 51, 119, 0.22)",
    backgroundStrong: "rgba(238, 51, 119, 0.28)",
    backgroundSubtle: "rgba(238, 51, 119, 0.16)",
    border: "#f472b6",
    ring: "#f472b6",
  },

  instruction: {
    activeBg: "rgba(238, 119, 51, 0.22)",
    accent: "#f4b98f",
  },

  execution: {
    bg: "#101b2d",
    border: "#28364c",
    highlight: "rgba(238, 119, 51, 0.2)",
  },

  accent: {
    primary: "#4ea1ff",
    blue: "#4ea1ff",
    error: "#f87171",
  },

  button: {
    darkBackground: "#dce8f8",
    darkBackgroundHover: "#f4f8ff",
    darkText: "#09111d",

    ghostBorder: "rgba(157, 176, 199, 0.26)",
    ghostBorderHover: "rgba(157, 176, 199, 0.4)",
    ghostBorderFocus: "rgba(78, 161, 255, 0.45)",

    ghostBackground: "rgba(12, 20, 35, 0.46)",
    ghostBackgroundHover: "rgba(22, 34, 53, 0.72)",
  },

  input: {
    lightBackground: "#ffffff",
    lightText: "#0f172a",
    lightBorder: "#cbd5e1",
    lightPlaceholder: "#64748b",
    lightHoverBackground: "#f8fafc",
    lightReadonlyBackground: "#f8fafc",
    darkBackground: "#0d1626",
    darkText: "#e6edf7",
    darkBorder: "#314159",
    darkPlaceholder: "#7f93ad",
    darkHoverBackground: "#132036",
    darkReadonlyBackground: "#182741",
    focus: "#4ea1ff",
    disabledOpacity: 0.6,
  },

  token: {
    lightBackground: "#e2e8f0",
    lightText: "#0f172a",
    lightBorder: "#94a3b8",
    darkBackground: "#182a45",
    darkText: "#e6edf7",
    darkBorder: "#4ea1ff",
    strongBackground: "#1e3353",
    strongText: "#f8fbff",
    strongBorder: "#70b5ff",
  },

  feedback: {
    warningBackground: "rgba(245, 158, 11, 0.16)",
    warningText: "#f7c46c",
    warningBorder: "rgba(245, 158, 11, 0.34)",
    errorBackground: "rgba(239, 68, 68, 0.16)",
    errorText: "#fecaca",
    errorBorder: "rgba(248, 113, 113, 0.34)",
  },
};

export const COLORS = LIGHT_COLORS;
export const THEMES = {
  [THEME_MODES.light]: LIGHT_COLORS,
  [THEME_MODES.night]: NIGHT_COLORS,
};

export const TYPOGRAPHY = {
  families: {
    ui: '"IBM Plex Sans", "Inter", "Avenir Next", "Segoe UI", system-ui, sans-serif',
    mono: '"IBM Plex Mono", "Fira Mono", "SFMono-Regular", Consolas, monospace',
    math: '"KaTeX_Math", "KaTeX_Main", "Latin Modern Math", "Latin Modern Roman", "CMU Serif", "Computer Modern Serif", "STIX Two Text", serif',
  },

  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  sizes: {
    xs: 10,
    sm: 11,
    md: 12,
    base: 14,
    lg: 14,
    xl: 16,
    section: 18,
    title: 32,
  },

  lineHeights: {
    tight: 1,
    snug: 1.2,
    normal: 1.35,
    relaxed: 1.45,
  },

  letterSpacing: {
    tight: "-0.02em",
    normal: "0.01em",
    wide: "0.02em",
    label: "0.05em",
  },

  styles: {
    title: {
      fontFamily: "var(--font-ui)",
      fontSize: 36,
      fontWeight: 600,
      lineHeight: 1.05,
      letterSpacing: "-0.02em",
    },
    sectionTitle: {
      fontFamily: "var(--font-ui)",
      fontSize: 18,
      fontWeight: 600,
      lineHeight: 1.2,
      letterSpacing: "0.01em",
    },
    sectionHeading: {
      fontFamily: "var(--font-ui)",
      fontSize: 14,
      fontWeight: 600,
      lineHeight: 1.35,
      letterSpacing: "0.01em",
    },
    label: {
      fontFamily: "var(--font-ui)",
      fontSize: 11,
      fontWeight: 500,
      lineHeight: 1.2,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    },
    uiText: {
      fontFamily: "var(--font-ui)",
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.45,
      letterSpacing: "0.01em",
    },
    uiStrong: {
      fontFamily: "var(--font-ui)",
      fontSize: 14,
      fontWeight: 600,
      lineHeight: 1.35,
      letterSpacing: "0.01em",
    },
    control: {
      fontFamily: "var(--font-ui)",
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1.35,
      letterSpacing: "0.01em",
    },
    code: {
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      fontWeight: 400,
      lineHeight: 1.35,
      fontVariantNumeric: "tabular-nums",
    },
    codeStrong: {
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1.35,
      fontVariantNumeric: "tabular-nums",
    },
    traceHeader: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      fontWeight: 500,
      lineHeight: 1.2,
      letterSpacing: "0.01em",
      fontVariantNumeric: "tabular-nums",
    },
    traceCell: {
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      fontWeight: 400,
      lineHeight: 1.35,
      fontVariantNumeric: "tabular-nums",
    },
  },
};

export const RADII = {
  sharp: 0,
  panel: 4,
  control: 4,
  button: 4,
  chip: 8,
};
