from urm import execute
from visualize import plot_trace_comparison


# Shared initial state for both programs.
# R0 = x, R1 = y, others start at 0.
initial_registers = [4, 9, 0, 0, 0, 0, 0]


# Program A:
# Computes x -> x + y directly with one counting loop.
# Active registers: R0, R1, R2, R3, R4
program_a = [
    ("Z", 2),         # R2 = 0 (loop counter)
    ("J", 2, 1, 5),   # if R2 == R1, exit loop
    ("S", 0),         # R0 += 1
    ("S", 2),         # R2 += 1
    ("J", 0, 0, 1),   # unconditional jump to loop test
    ("T", 0, 3),      # copy final result to R3
    ("S", 4),         # mark completion in R4
]


# Program B:
# Same idea (x -> x + y), but with extra structure:
# 1) build y in temp register R5, 2) replay R5 into R0 via R6.
# Active registers: R0, R1, R2, R3, R4, R5, R6
program_b = [
    ("Z", 2),         # R2 = 0 (phase 1 counter)
    ("Z", 5),         # R5 = 0 (temp accumulator for y)
    ("J", 2, 1, 6),   # if R2 == R1, move to phase 2
    ("S", 5),         # R5 += 1
    ("S", 2),         # R2 += 1
    ("J", 0, 0, 2),   # unconditional jump to phase 1 test
    ("Z", 6),         # R6 = 0 (phase 2 counter)
    ("J", 6, 5, 11),  # if R6 == R5, finish
    ("S", 0),         # R0 += 1
    ("S", 6),         # R6 += 1
    ("J", 0, 0, 7),   # unconditional jump to phase 2 test
    ("T", 0, 3),      # copy final result to R3
    ("S", 4),         # mark completion in R4
    ("S", 4),         # extra structural difference vs Program A
]


result_a = execute(program_a, initial_registers)
result_b = execute(program_b, initial_registers)

print(f"Program A steps: {result_a['steps']}, halted: {result_a['halted']}")
print(f"Program B steps: {result_b['steps']}, halted: {result_b['halted']}")

plot_trace_comparison(
    result_a["trace"],
    result_b["trace"],
    title1="Program A: Direct x + y with one loop",
    title2="Program B: x + y via temp/replay (extra structure)",
    annotate=True,
    highlight_changes=False,
)
