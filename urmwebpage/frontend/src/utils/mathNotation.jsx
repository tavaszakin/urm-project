import { Fragment } from "react";

export function getProjectionDisplayIndex(spec) {
  const index = Number(spec?.index);
  return Number.isInteger(index) && index > 0 ? index : 1;
}

export function getProjectionArity(spec, fallbackArity = null) {
  const arity = Number(spec?.arity);
  if (Number.isInteger(arity) && arity > 0) {
    return arity;
  }

  return Number.isInteger(fallbackArity) && fallbackArity > 0 ? fallbackArity : null;
}

export function getProjectionArrayIndex(spec) {
  return getProjectionDisplayIndex(spec) - 1;
}

export function getProjectionVariableMeaning(spec, variables = [], fallbackArity = null) {
  const arrayIndex = getProjectionArrayIndex(spec);
  const arity = getProjectionArity(spec, fallbackArity ?? variables.length);

  if (arrayIndex >= 0 && arrayIndex < variables.length) {
    return variables[arrayIndex];
  }

  return `x${Math.min(arrayIndex + 1, arity ?? arrayIndex + 1)}`;
}

export function formatProjectionNotation(spec, fallbackArity = null) {
  const index = getProjectionDisplayIndex(spec);
  const arity = getProjectionArity(spec, fallbackArity);
  return arity ? `P_${index}^${arity}` : `P_${index}^n`;
}

export function ProjectionNotation({ spec, fallbackArity = null }) {
  const index = getProjectionDisplayIndex(spec);
  const arity = getProjectionArity(spec, fallbackArity);

  return (
    <span className="math-inline" style={{ display: "inline-flex", alignItems: "flex-start", gap: 0 }}>
      <span>P</span>
      <span style={{ display: "inline-flex", flexDirection: "column", marginLeft: 1, lineHeight: 0.8 }}>
        <sup style={{ fontSize: "0.7em", fontStyle: "normal" }}>{arity ?? "n"}</sup>
        <sub style={{ fontSize: "0.7em", fontStyle: "normal" }}>{index}</sub>
      </span>
    </span>
  );
}

export function buildProjectionMeaningElement({
  spec,
  args = [],
  meaning,
  renderArgs,
}) {
  return (
    <Fragment>
      <ProjectionNotation spec={spec} fallbackArity={args.length} />
      <span>(</span>
      {renderArgs}
      <span>)</span>
      <span>=</span>
      <span>{meaning}</span>
    </Fragment>
  );
}
