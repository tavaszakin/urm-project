import { getEncodingPresetById } from "./encodingPresets.js";

function toEditableInstruction(instruction) {
  const [type, ...args] = instruction;
  return { type, args };
}

function toEditableProgram(program) {
  return program.map(toEditableInstruction);
}

const additionLoopPreset = getEncodingPresetById("addition-loop");

export const PLAYGROUND_STARTER_PROGRAMS = [
  {
    id: "blank",
    label: "Blank program",
    program: [],
  },
  {
    id: "increment-r0",
    label: "Increment R0",
    program: [["S", 0]],
  },
  {
    id: "zero-r0",
    label: "Zero R0",
    program: [["Z", 0]],
  },
  {
    id: "copy-r0-r1",
    label: "Copy R0 to R1",
    program: [["T", 0, 1]],
  },
  {
    id: "addition-loop",
    label: "Addition-style loop",
    program: additionLoopPreset.program,
  },
].filter((preset) => Array.isArray(preset.program));

export function getPlaygroundStarterProgramById(id) {
  return (
    PLAYGROUND_STARTER_PROGRAMS.find((preset) => preset.id === id) ??
    PLAYGROUND_STARTER_PROGRAMS[0]
  );
}

export function createEditableStarterProgram(id) {
  const preset = getPlaygroundStarterProgramById(id);
  return toEditableProgram(preset.program);
}
