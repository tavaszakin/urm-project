import { formatInstruction } from "./urmFormatting.js";

function ensureRegisters(registers, instruction) {
  if (!instruction) return;

  const [op, ...args] = instruction;
  const maxIndex =
    op === "J"
      ? Math.max(args[0] ?? 0, args[1] ?? 0)
      : Math.max(...args, 0);

  while (registers.length <= maxIndex) {
    registers.push(0);
  }
}

function stepInstruction(program, registers, pc) {
  const instruction = program[pc];
  ensureRegisters(registers, instruction);

  const [op, a, b, c] = instruction;

  if (op === "Z") {
    registers[a] = 0;
    return pc + 1;
  }

  if (op === "S") {
    registers[a] += 1;
    return pc + 1;
  }

  if (op === "T") {
    registers[b] = registers[a];
    return pc + 1;
  }

  if (op === "J") {
    return registers[a] === registers[b] ? c : pc + 1;
  }

  throw new Error(`Unknown instruction opcode: ${op}`);
}

function getChangedRegisters(before, after) {
  const changed = [];
  const maxLength = Math.max(before.length, after.length);

  for (let index = 0; index < maxLength; index += 1) {
    if ((before[index] ?? 0) !== (after[index] ?? 0)) {
      changed.push(index);
    }
  }

  return changed;
}

function buildInitialTraceRow(initialRegisters) {
  return {
    step: 0,
    globalStep: 0,
    pc: 0,
    instruction: null,
    instructionIndex: null,
    instructionText: "START",
    registers: initialRegisters.slice(),
    registersBefore: initialRegisters.slice(),
    registersAfter: initialRegisters.slice(),
    changedRegisters: [],
    jumpTaken: false,
    jumpTarget: null,
    halted: false,
    note: "initial state",
  };
}

export function buildLearnDemoTrace(program, initialRegisters, maxSteps = 24) {
  const registers = initialRegisters.slice();
  const trace = [buildInitialTraceRow(registers)];
  let pc = 0;
  let step = 0;

  while (pc >= 0 && pc < program.length && step < maxSteps) {
    const instruction = program[pc];
    const before = registers.slice();
    const nextPc = stepInstruction(program, registers, pc);
    const after = registers.slice();
    const jumpTarget = instruction[0] === "J" ? instruction[3] : null;
    const jumpTaken = instruction[0] === "J" && nextPc === jumpTarget;
    const halted = !(nextPc >= 0 && nextPc < program.length);

    step += 1;
    trace.push({
      step,
      globalStep: step,
      pc: nextPc,
      instruction,
      instructionIndex: pc,
      instructionText: formatInstruction(instruction),
      registers: after,
      registersBefore: before,
      registersAfter: after,
      changedRegisters: getChangedRegisters(before, after),
      jumpTaken,
      jumpTarget,
      halted,
      note: halted
        ? `executed ${formatInstruction(instruction)}; next instruction does not exist, so computation halts`
        : `executed ${formatInstruction(instruction)}`,
    });

    pc = nextPc;
  }

  return trace;
}

export function getLearnDemos() {
  return [
    {
      id: "zero",
      title: "Zero",
      meaning: "Sets a register to 0.",
      program: [["Z", 1]],
      initialRegisters: [0, 5],
      relevantRegisters: [1],
      usedFor: "Used in base-case setup.",
      note: "A reset step clears a register before a new value is built.",
    },
    {
      id: "successor",
      title: "Successor",
      meaning: "Adds 1 to a register.",
      program: [["S", 1]],
      initialRegisters: [0, 2],
      relevantRegisters: [1],
      usedFor: "Used in recursive update steps.",
      note: "This is the smallest possible state change: one quiet increment.",
    },
    {
      id: "copy",
      title: "Copy",
      meaning: "Copies one register value into another.",
      program: [["T", 1, 2]],
      initialRegisters: [0, 4, 0],
      relevantRegisters: [1, 2],
      usedFor: "Used to preserve a carried value.",
      note: "Copying lets a later step read a value without losing the original one.",
    },
    {
      id: "compare-and-jump",
      title: "Compare and Jump",
      meaning: "If two registers are equal, control jumps ahead to a later instruction.",
      program: [["J", 1, 2, 4], ["S", 3], ["S", 3], ["S", 3], ["T", 1, 3]],
      initialRegisters: [0, 2, 2, 0],
      relevantRegisters: [1, 2, 3],
      usedFor: "Used in loop and control flow.",
      note: "When the comparison succeeds, execution skips the middle update steps.",
      showPc: true,
    },
    {
      id: "build-constant",
      title: "Build Constant 2",
      meaning: "Builds a fixed value from zero using repeated successor.",
      program: [["Z", 1], ["S", 1], ["S", 1]],
      initialRegisters: [0, 9],
      relevantRegisters: [1],
      usedFor: "Used in base-case setup.",
      note: "A fixed output is often assembled by resetting and then counting upward.",
    },
    {
      id: "increment-until-equal",
      title: "Increment Until Equal",
      meaning: "Increment one register until it matches another, then copy the result out.",
      program: [["J", 1, 2, 3], ["S", 1], ["J", 0, 0, 0], ["T", 1, 3]],
      initialRegisters: [0, 0, 3, 0],
      relevantRegisters: [1, 2, 3],
      usedFor: "Used in loop/control structure.",
      note: "This kind of tiny loop is how larger recursive computations keep a running value moving forward.",
      showPc: true,
    },
  ].map((demo) => ({
    ...demo,
    trace: buildLearnDemoTrace(demo.program, demo.initialRegisters),
  }));
}
