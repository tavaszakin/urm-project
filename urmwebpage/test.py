from urm_macros import add, successor, multiply, run
from visualize import pretty_trace

# Test 1: successor
res = run(successor(), [5])
print("SUCCESSOR final registers:", res["final_registers"])
pretty_trace(res["trace"])

print("\n" + "=" * 60 + "\n")

# Test 2: addition
res = run(add(), [4, 3])
print("ADD final registers:", res["final_registers"])
pretty_trace(res["trace"])

print("\n" + "=" * 60 + "\n")

# Test 3: multiplication
res = run(multiply(), [3, 2], max_steps=200)
print("MULTIPLY final registers:", res["final_registers"])
pretty_trace(res["trace"])
