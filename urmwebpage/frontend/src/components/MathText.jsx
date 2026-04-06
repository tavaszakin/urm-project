import KatexMath from "./KatexMath.jsx";

export function InlineMath({
  value,
  style = undefined,
  className = "",
}) {
  return (
    <KatexMath expression={value} style={style} className={className} />
  );
}

export function MathEquals({ style = undefined, className = "" }) {
  return (
    <InlineMath
      value="="
      style={{
        display: "inline-flex",
        alignItems: "center",
        ...style,
      }}
      className={className}
    />
  );
}
