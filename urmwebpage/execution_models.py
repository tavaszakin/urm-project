from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class TraceStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: int = Field(ge=1)
    pc: int = Field(ge=0)
    instruction: List[Any]
    instruction_text: str
    registers_before: List[int]
    registers_after: List[int]
    changed_registers: List[int]
    jump_taken: bool
    jump_target: Optional[int] = Field(default=None, ge=0)
    halted: bool = False


class ExecutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    program: List[List[Any]]
    initial_registers: List[int]
    final_registers: List[int]
    steps: List[TraceStep]
    halted: bool
    halt_reason: Optional[str] = None
    output_register: Optional[int] = Field(default=0, ge=0)
    output_value: Optional[int] = None
    step_count: int = Field(ge=0)

    @property
    def trace(self) -> List[TraceStep]:
        return self.steps

    def __getitem__(self, key: str):
        compatibility_map = {
            "program": self.program,
            "initial_registers": self.initial_registers,
            "final_registers": self.final_registers,
            "trace": self.steps,
            "halted": self.halted,
            "reason": self.halt_reason,
            "output": self.output_value,
            "steps": self.step_count,
        }
        if key in compatibility_map:
            return compatibility_map[key]
        raise KeyError(key)


class TraceRow(BaseModel):
    step: int
    pc: int
    instruction: Optional[List[Any]] = None
    instructionIndex: Optional[int] = None
    instructionText: str
    registers: List[int]
    registersBefore: List[int]
    registersAfter: List[int]
    changedRegisters: List[int]
    jumpTaken: bool
    jumpTarget: Optional[int] = None
    halted: bool = False
    note: str = ""


class ExecutionResponse(ExecutionResult):
    trace: List[TraceRow]
    # Transitional compatibility alias for the current frontend shape.
    # Remove after the frontend is migrated to canonical `steps`.
    adapted_trace: List[TraceRow] = Field(default_factory=list)
    # Transitional compatibility aliases for older response readers.
    # Remove after all clients use `halt_reason` and `output_value`.
    reason: Optional[str] = None
    output: Optional[int] = None
