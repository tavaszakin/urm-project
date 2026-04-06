from urm_macros import add, successor, constant
from trace_compare import compare_traces

compare_traces(
    successor(),
    constant(3),
    [5],
    left_name="successor",
    right_name="constant(3)",
    max_steps=50,
)