import { useMemo } from "react";

function renderKatex(expression, displayMode) {
  if (typeof window === "undefined" || !window.katex?.renderToString) {
    return null;
  }

  try {
    return window.katex.renderToString(expression, {
      throwOnError: false,
      strict: "ignore",
      displayMode,
      trust: false,
      output: "html",
      macros: {
        "\\truncminus": "\\mathbin{\\dot{-}}",
      },
    });
  } catch {
    return null;
  }
}

export default function KatexMath({
  expression,
  displayMode = false,
  className = "",
  style = undefined,
}) {
  const math = String(expression ?? "");
  const html = useMemo(() => renderKatex(math, displayMode), [math, displayMode]);

  if (!html) {
    return (
      <span
        className={`math-text ${displayMode ? "math-display" : "math-inline"}${className ? ` ${className}` : ""}`}
        style={style}
      >
        {math}
      </span>
    );
  }

  return (
    <span
      className={`math-text ${displayMode ? "math-display" : "math-inline"}${className ? ` ${className}` : ""}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
