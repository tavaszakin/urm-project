const OPCODE_OPTIONS = ["Z", "S", "T", "J"];

const OPCODE_FIELDS = {
  Z: ["register"],
  S: ["register"],
  T: ["from", "to"],
  J: ["left", "right", "target Iq"],
};

function getOpcodeFields(opcode) {
  return OPCODE_FIELDS[opcode] ?? OPCODE_FIELDS.Z;
}

export function createInstructionDraft(opcode = "Z") {
  return [opcode, ...getOpcodeFields(opcode).map(() => "")];
}

export function resizeInstructionDraft(parts, nextOpcode) {
  const fields = getOpcodeFields(nextOpcode);
  const existingArgs = Array.isArray(parts) ? parts.slice(1) : [];
  return [nextOpcode, ...fields.map((_, index) => existingArgs[index] ?? "")];
}

export default function ProgramInstructionEditor({
  instructions,
  onChange,
  disabled = false,
}) {
  function updateInstruction(index, nextInstruction) {
    onChange(instructions.map((instruction, instructionIndex) => (instructionIndex === index ? nextInstruction : instruction)));
  }

  function removeInstruction(index) {
    onChange(instructions.filter((_, instructionIndex) => instructionIndex !== index));
  }

  return (
    <div className="encoding-editor">
      <div className="encoding-editor-list">
        {instructions.map((instruction, index) => {
          const opcode = String(instruction?.[0] ?? "Z").toUpperCase();
          const fields = getOpcodeFields(opcode);

          return (
            <div key={index} className="encoding-editor-row">
              <div className="encoding-editor-index">I{index}</div>

              <select
                value={opcode}
                onChange={(event) => updateInstruction(index, resizeInstructionDraft(instruction, event.target.value))}
                disabled={disabled}
                className="dashboard-control runner-toolbar-select encoding-editor-opcode"
                aria-label={`Opcode for instruction ${index}`}
              >
                {OPCODE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <div className={`encoding-editor-fields encoding-editor-fields-${fields.length}`}>
                {fields.map((fieldLabel, fieldIndex) => (
                  <label key={fieldLabel} className="encoding-editor-field">
                    <span className="encoding-editor-field-label">{fieldLabel}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={instruction?.[fieldIndex + 1] ?? ""}
                      onChange={(event) => {
                        const nextInstruction = [...instruction];
                        nextInstruction[fieldIndex + 1] = event.target.value;
                        updateInstruction(index, nextInstruction);
                      }}
                      disabled={disabled}
                      className="runner-toolbar-number-input encoding-editor-input"
                      aria-label={`${fieldLabel} for instruction ${index}`}
                    />
                  </label>
                ))}
              </div>

              <button
                type="button"
                onClick={() => removeInstruction(index)}
                disabled={disabled || instructions.length === 1}
                className="runner-add-register-button encoding-editor-remove"
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
