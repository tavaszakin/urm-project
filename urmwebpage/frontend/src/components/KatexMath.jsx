import { useEffect, useMemo, useState } from "react";

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
  fallback = undefined,
}) {
  const math = String(expression ?? "");
  const [katexReady, setKatexReady] = useState(() => (
    typeof window !== "undefined" && Boolean(window.katex?.renderToString)
  ));
  const html = useMemo(() => {
    void katexReady;
    return renderKatex(math, displayMode);
  }, [math, displayMode, katexReady]);

  useEffect(() => {
    if (html || katexReady || typeof window === "undefined") {
      return undefined;
    }

    let attempts = 0;
    const retryRender = () => {
      attempts += 1;
      if (window.katex?.renderToString) {
        setKatexReady(true);
      }
    };
    const intervalId = window.setInterval(() => {
      if (window.katex?.renderToString || attempts >= 20) {
        retryRender();
        window.clearInterval(intervalId);
        return;
      }

      retryRender();
    }, 100);

    window.addEventListener("load", retryRender, { once: true });

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("load", retryRender);
    };
  }, [html, katexReady]);

  if (!html) {
    return (
      <span
        className={`math-text ${displayMode ? "math-display" : "math-inline"}${className ? ` ${className}` : ""}`}
        style={style}
      >
        {fallback ?? math}
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
