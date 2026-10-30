function tupleLatex(values) {
  return `\\langle ${values.join(",")}\\rangle`;
}

function makeStateRow(index, stateIndex, nextInstructionLatex, instructionCodeLatex, registers, options = {}) {
  const registersLatex = tupleLatex(registers);
  const isHalting = options.isHalting === true;

  return {
    id: `u${index}`,
    symbolLatex: `u_${index}`,
    stateIndex,
    nextInstructionLatex,
    instructionCodeLatex,
    instructionIndex: options.instructionIndex ?? null,
    registers,
    registersLatex,
    ...(isHalting ? { isHalting: true, note: "halting state" } : {}),
    latex: `u_${index}=\\langle ${stateIndex},${instructionCodeLatex},${registersLatex}\\rangle`,
  };
}

function makeHaltingStateRow(index, stateIndex, registers, options = {}) {
  return makeStateRow(index, stateIndex, "\\mathrm{halt}", "0", registers, {
    ...options,
    isHalting: true,
  });
}

export const STATE_CODE_PRESETS = [
  {
    id: "template",
    type: "template",
    label: "State-code template",
    exampleLatex: "u_i=\\left\\langle t,\\#I_t,\\left\\langle r_0,\\dots,r_m\\right\\rangle\\right\\rangle",
    programLatex: "P=(I_0,I_1,\\dots,I_{s-1})",
    inputLatex: "\\text{Choose an example to instantiate the template.}",
    program: [],
    stateRows: [],
  },
  {
    id: "successor-2",
    label: "Successor on input 2",
    exampleLatex: "f(x)=x+1",
    programLatex: "P=(S(0))",
    program: [["S", 0]],
    inputLatex: "\\vec{x}=(2)",
    computationLatex: "\\langle 2\\rangle \\xrightarrow{S(0)} \\langle 3\\rangle",
    stateRows: [
      makeStateRow(0, 0, "S(0)", "\\#S(0)", [2]),
      makeHaltingStateRow(1, 1, [3], { instructionIndex: 0 }),
    ],
  },
  {
    id: "zero-4",
    label: "Zero on input 4",
    exampleLatex: "f(x)=0",
    programLatex: "P=(Z(0))",
    program: [["Z", 0]],
    inputLatex: "\\vec{x}=(4)",
    computationLatex: "\\langle 4\\rangle \\xrightarrow{Z(0)} \\langle 0\\rangle",
    stateRows: [
      makeStateRow(0, 0, "Z(0)", "\\#Z(0)", [4]),
      makeHaltingStateRow(1, 1, [0], { instructionIndex: 0 }),
    ],
  },
  {
    id: "constant-2-0",
    label: "Constant 2 on input 0",
    exampleLatex: "f(x)=2",
    programLatex: "P=(Z(0),S(0),S(0))",
    program: [["Z", 0], ["S", 0], ["S", 0]],
    inputLatex: "\\vec{x}=(0)",
    computationLatex:
      "\\langle 0\\rangle \\xrightarrow{Z(0)} \\langle 0\\rangle \\xrightarrow{S(0)} \\langle 1\\rangle \\xrightarrow{S(0)} \\langle 2\\rangle",
    stateRows: [
      makeStateRow(0, 0, "Z(0)", "\\#Z(0)", [0]),
      makeStateRow(1, 1, "S(0)", "\\#S(0)", [0], { instructionIndex: 0 }),
      makeStateRow(2, 2, "S(0)", "\\#S(0)", [1], { instructionIndex: 1 }),
      makeHaltingStateRow(3, 3, [2], { instructionIndex: 2 }),
    ],
  },
  {
    id: "projection-second-3-5",
    label: "Projection of second input",
    exampleLatex: "f(x,y)=y",
    programLatex: "P=(T(1,0))",
    program: [["T", 1, 0]],
    inputLatex: "\\vec{x}=(3,5)",
    computationLatex: "\\langle 3,5\\rangle \\xrightarrow{T(1,0)} \\langle 5,5\\rangle",
    stateRows: [
      makeStateRow(0, 0, "T(1,0)", "\\#T(1,0)", [3, 5]),
      makeHaltingStateRow(1, 1, [5, 5], { instructionIndex: 0 }),
    ],
  },
  {
    id: "addition-2-1",
    label: "Addition on 2 and 1",
    exampleLatex: "f(x,y)=x+y",
    programLatex: "P=(Z(2),J(2,1,5),S(0),S(2),J(0,0,1))",
    program: [
      ["Z", 2],
      ["J", 2, 1, 5],
      ["S", 0],
      ["S", 2],
      ["J", 0, 0, 1],
    ],
    inputLatex: "\\vec{x}=(2,1,0)",
    computationLatex:
      "\\langle 2,1,0\\rangle \\xrightarrow{Z(2)} \\langle 2,1,0\\rangle \\xrightarrow{J(2,1,5)} \\cdots \\xrightarrow{J(2,1,5)} \\langle 3,1,1\\rangle",
    stateRows: [
      makeStateRow(0, 0, "Z(2)", "\\#Z(2)", [2, 1, 0]),
      makeStateRow(1, 1, "J(2,1,5)", "\\#J(2,1,5)", [2, 1, 0], { instructionIndex: 0 }),
      makeStateRow(2, 2, "S(0)", "\\#S(0)", [2, 1, 0], { instructionIndex: 1 }),
      makeStateRow(3, 3, "S(2)", "\\#S(2)", [3, 1, 0], { instructionIndex: 2 }),
      makeStateRow(4, 4, "J(0,0,1)", "\\#J(0,0,1)", [3, 1, 1], { instructionIndex: 3 }),
      makeStateRow(5, 1, "J(2,1,5)", "\\#J(2,1,5)", [3, 1, 1], { instructionIndex: 4 }),
      makeHaltingStateRow(6, 5, [3, 1, 1], { instructionIndex: 1 }),
    ],
  },
  {
    id: "increment-until-equal",
    label: "Loop until equal",
    exampleLatex: "P_{\\mathrm{loop}}:\\ R_1\\nearrow R_2,\\ R_3\\leftarrow R_1",
    programLatex: "P=(J(1,2,3),S(1),J(0,0,0),T(1,3))",
    program: [
      ["J", 1, 2, 3],
      ["S", 1],
      ["J", 0, 0, 0],
      ["T", 1, 3],
    ],
    inputLatex: "\\vec{x}=(0,0,3,0)",
    computationLatex:
      "\\langle 0,0,3,0\\rangle \\xrightarrow{J(1,2,3)} \\cdots \\xrightarrow{T(1,3)} \\langle 0,3,3,3\\rangle",
    stateRows: [
      makeStateRow(0, 0, "J(1,2,3)", "\\#J(1,2,3)", [0, 0, 3, 0]),
      makeStateRow(1, 1, "S(1)", "\\#S(1)", [0, 0, 3, 0], { instructionIndex: 0 }),
      makeStateRow(2, 2, "J(0,0,0)", "\\#J(0,0,0)", [0, 1, 3, 0], { instructionIndex: 1 }),
      makeStateRow(3, 0, "J(1,2,3)", "\\#J(1,2,3)", [0, 1, 3, 0], { instructionIndex: 2 }),
      makeStateRow(4, 1, "S(1)", "\\#S(1)", [0, 1, 3, 0], { instructionIndex: 0 }),
      makeStateRow(5, 2, "J(0,0,0)", "\\#J(0,0,0)", [0, 2, 3, 0], { instructionIndex: 1 }),
      makeStateRow(6, 0, "J(1,2,3)", "\\#J(1,2,3)", [0, 2, 3, 0], { instructionIndex: 2 }),
      makeStateRow(7, 1, "S(1)", "\\#S(1)", [0, 2, 3, 0], { instructionIndex: 0 }),
      makeStateRow(8, 2, "J(0,0,0)", "\\#J(0,0,0)", [0, 3, 3, 0], { instructionIndex: 1 }),
      makeStateRow(9, 0, "J(1,2,3)", "\\#J(1,2,3)", [0, 3, 3, 0], { instructionIndex: 2 }),
      makeStateRow(10, 3, "T(1,3)", "\\#T(1,3)", [0, 3, 3, 0], { instructionIndex: 0 }),
      makeHaltingStateRow(11, 4, [0, 3, 3, 3], { instructionIndex: 3 }),
    ],
  },
  {
    id: "jump-to-halt-equal",
    label: "Jump to halt when equal",
    exampleLatex: "f(x,y)=\\begin{cases}x,&x=y\\\\x+1,&x\\ne y\\end{cases}",
    programLatex: "P=(J(0,1,2),S(0))",
    program: [["J", 0, 1, 2], ["S", 0]],
    inputLatex: "\\vec{x}=(4,4)",
    computationLatex: "\\langle 4,4\\rangle \\xrightarrow{J(0,1,2)} \\langle 4,4\\rangle",
    stateRows: [
      makeStateRow(0, 0, "J(0,1,2)", "\\#J(0,1,2)", [4, 4]),
      makeHaltingStateRow(1, 2, [4, 4], { instructionIndex: 0 }),
    ],
  },
];

export function getStateCodePresetById(id) {
  return STATE_CODE_PRESETS.find((preset) => preset.id === id) ?? STATE_CODE_PRESETS[0];
}
