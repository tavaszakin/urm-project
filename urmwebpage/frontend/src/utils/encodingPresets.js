export const DEFAULT_ENCODING_PRESET_ID = "template";

export const ENCODING_PRESETS = [
  {
    id: "template",
    kind: "template",
    label: "Template: instruction and program codes",
    functionLabel: "Instruction/program encoding template",
    functionLatex: "\\text{Instruction/program encoding template}",
    program: [],
  },
  {
    id: "zero",
    label: "Zero register",
    functionLabel: "z(x) = 0",
    functionLatex: "z(x)=0",
    description: "Reset the output register R0 to zero.",
    helperText: "The simplest URM program already has a natural-number code.",
    program: [["Z", 0]],
  },
  {
    id: "successor",
    label: "Successor program",
    functionLabel: "s(x) = x + 1",
    functionLatex: "s(x)=x+1",
    description: "Increment the value in R0 once.",
    helperText: "A one-instruction program can still be encoded as a natural number.",
    program: [["S", 0]],
  },
  {
    id: "identity",
    label: "Self-transfer",
    functionLabel: "id(x) = x",
    functionLatex: "\\mathrm{id}(x)=x",
    description: "Transfer R0 back into R0, leaving the output unchanged.",
    helperText: "Transfer instructions show how register references become part of the code.",
    program: [["T", 0, 0]],
  },
  {
    id: "constant-2",
    label: "Constant 2",
    functionLabel: "c_2(x) = 2",
    functionLatex: "c_2(x)=2",
    description: "Reset R0, then increment it twice.",
    helperText: "A short instruction list is encoded by first encoding each instruction, then the whole sequence.",
    program: [["Z", 0], ["S", 0], ["S", 0]],
  },
  {
    id: "projection-transfer",
    label: "Projection via transfer",
    functionLabel: "p(x, y) = y",
    functionLatex: "p(x,y)=y",
    description: "Copy the second input register R1 into the output register R0.",
    helperText: "A single transfer instruction can already produce a large program code.",
    program: [["T", 1, 0]],
  },
  {
    id: "addition-loop",
    label: "Addition loop with jump",
    functionLabel: "add(x, y) = x + y",
    functionLatex: "f(x,y)=x+y",
    description: "Use a counter and jumps to add R1 into R0.",
    helperText: "Jump instructions make loops part of the same encoding scheme.",
    program: [
      ["Z", 2],
      ["J", 2, 1, 5],
      ["S", 0],
      ["S", 2],
      ["J", 0, 0, 1],
    ],
  },
  {
    id: "increment-until-equal",
    label: "Increment until equal",
    functionLabel: "loop(x, y)",
    functionLatex: "\\mathrm{loop}(x,y)",
    description: "Increment R1 until it matches R2, then copy the matched value to R3.",
    helperText: "This compact loop shows both conditional and unconditional jumps.",
    program: [
      ["J", 1, 2, 3],
      ["S", 1],
      ["J", 0, 0, 0],
      ["T", 1, 3],
    ],
  },
  {
    id: "truncated-subtraction",
    label: "Truncated subtraction (large)",
    functionLabel: "sub(x, y) = max(x - y, 0)",
    functionLatex: "\\mathrm{sub}(x,y)=\\max(x-y,0)",
    description: "A larger loop program for repeated predecessor search.",
    helperText: "The exact factorization remains readable even when the decimal expansion is omitted.",
    program: [
      ["Z", 2],
      ["J", 2, 1, 12],
      ["Z", 3],
      ["J", 0, 3, 9],
      ["T", 3, 4],
      ["S", 4],
      ["J", 4, 0, 9],
      ["S", 3],
      ["J", 0, 0, 4],
      ["T", 3, 0],
      ["S", 2],
      ["J", 0, 0, 1],
    ],
  },
];

export function getEncodingPresetById(id) {
  return (
    ENCODING_PRESETS.find((preset) => preset.id === id) ??
    ENCODING_PRESETS.find((preset) => preset.id === DEFAULT_ENCODING_PRESET_ID) ??
    ENCODING_PRESETS[0]
  );
}
