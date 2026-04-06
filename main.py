from urm import execute
from visualize import plot_trace_comparison

# Small, readable input choice for the demo.
y_input = 5
x_fixed = 2

# Generic program for f(x, y) = y + x.
# Convention here: R0 = y, R1 = x, and R2 is scratch space used as a loop counter.
# The trace visibly depends on R1 because the loop halts exactly when R2 reaches R1.
program_generic = [
    ("Z", 2),        # R2 = 0
    ("J", 2, 1, 5),  # If R2 == R1, halt.
    ("S", 0),        # R0 += 1
    ("S", 2),        # R2 += 1
    ("J", 0, 0, 1),  # Unconditional jump back to the loop test.
]

# Specialized program for g(y) = f(2, y) = y + 2.
# Here the effect of x = 2 is baked into the instruction sequence itself,
# so R1 is no longer an input register at all.
# This is the core s-m-n style idea: one argument is fixed and absorbed into the program.
program_specialized = [
    ("S", 0),  # R0 += 1
    ("S", 0),  # R0 += 1
]

initial_registers_generic = [y_input, x_fixed]
initial_registers_specialized = [y_input]

result_generic = execute(program_generic, initial_registers_generic)
result_specialized = execute(program_specialized, initial_registers_specialized)

final_r0_generic = result_generic["final_registers"][0]
final_r0_specialized = result_specialized["final_registers"][0]
agree = final_r0_generic == final_r0_specialized

print("s-m-n style specialization demo")
print(f"  Generic final R0:      {final_r0_generic}")
print(f"  Specialized final R0:  {final_r0_specialized}")
print(f"  Outputs agree:         {agree}")

plot_trace_comparison(
    result_generic["trace"],
    result_specialized["trace"],
    title1="Generic program: computes y + x using input register R1",
    title2="Specialized program: computes y + 2 with x hardcoded into the program",
    highlight_changes=False,
)
