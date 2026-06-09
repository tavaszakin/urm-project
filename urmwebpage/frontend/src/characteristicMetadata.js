export const CHARACTERISTIC_RELATIONS = [
  {
    value: "leq",
    label: "x \u2264 y",
    operator: "\u2264",
    latex: "x\\le y",
    negatedLatex: "x\\nleq y",
  },
  {
    value: "lt",
    label: "x < y",
    operator: "<",
    latex: "x<y",
    negatedLatex: "x\\nless y",
  },
  {
    value: "eq",
    label: "x = y",
    operator: "=",
    latex: "x=y",
    negatedLatex: "x\\ne y",
  },
  {
    value: "divides",
    label: "x \u2223 y",
    operator: "\u2223",
    latex: "x\\mid y",
    negatedLatex: "x\\nmid y",
  },
];

const CHARACTERISTIC_RELATION_MAP = CHARACTERISTIC_RELATIONS.reduce((acc, relation) => {
  acc[relation.value] = relation;
  return acc;
}, {});

export function normalizeCharacteristicRelation(relation) {
  const normalized = String(relation ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");

  return CHARACTERISTIC_RELATION_MAP[normalized] ? normalized : "leq";
}

export function getCharacteristicRelationMetadata(relation) {
  const normalized = normalizeCharacteristicRelation(relation);
  return CHARACTERISTIC_RELATION_MAP[normalized];
}

export function evaluateCharacteristicRelation(relation, x, y) {
  const normalized = normalizeCharacteristicRelation(relation);

  if (normalized === "leq") {
    return x <= y;
  }

  if (normalized === "lt") {
    return x < y;
  }

  if (normalized === "eq") {
    return x === y;
  }

  if (x === 0) {
    return y === 0;
  }

  return y % x === 0;
}
