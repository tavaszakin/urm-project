import KatexMath from "./KatexMath.jsx";
import { chainToLatex } from "../utils/expressionToLatex.js";

export default function DefinitionMathLine({ expressions, tone = "default" }) {
  const latex = chainToLatex(expressions);

  return (
    <KatexMath
      expression={latex}
      style={{
        color: tone === "muted" ? "var(--surface-text-secondary)" : "var(--surface-text-primary)",
        lineHeight: 1.45,
      }}
    />
  );
}
