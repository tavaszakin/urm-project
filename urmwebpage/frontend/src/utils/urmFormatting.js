export function formatInstruction(inst) {
  if (!inst) return "—";
  const [op, ...args] = inst;
  return `${op}(${args.join(", ")})`;
}

function normalizeInstructionParts(inst) {
  if (Array.isArray(inst)) {
    if (inst.length === 0) return null;
    const [op, ...args] = inst;
    return {
      op: String(op ?? "").trim(),
      args: args.map((arg) => String(arg ?? "").trim()),
    };
  }

  const text = String(inst ?? "").trim();
  const match = text.match(/^([A-Za-z]+)\((.*)\)$/);
  if (!match) return null;

  return {
    op: match[1],
    args: match[2].trim() ? match[2].split(/\s*,\s*/).map((arg) => String(arg)) : [],
  };
}

export function formatInstructionLatex(inst) {
  const parts = normalizeInstructionParts(inst);
  if (!parts || !parts.op) return String(inst ?? "—");

  return `\\mathrm{${parts.op}}\\left(${parts.args.join(",")}\\right)`;
}
