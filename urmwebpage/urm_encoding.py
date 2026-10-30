from __future__ import annotations

from math import floor, isqrt, log10
from typing import Any, Dict, List, Sequence, Tuple, cast

from urm import Instruction, validate_instruction, validate_program

Natural = int
Program = List[Instruction]

INSTRUCTION_TAGS: Dict[str, int] = {
    "Z": 0,
    "S": 1,
    "T": 2,
    "J": 3,
}

TAG_TO_OPCODE: Dict[int, str] = {value: key for key, value in INSTRUCTION_TAGS.items()}

_PRIMES: List[int] = [2]
MAX_ENCODED_DECIMAL_DIGITS = 48


def is_prime(n: int) -> bool:
    """Return True iff n is prime."""
    if n < 2:
        return False
    if n in (2, 3):
        return True
    if n % 2 == 0:
        return False

    limit = isqrt(n)
    divisor = 3
    while divisor <= limit:
        if n % divisor == 0:
            return False
        divisor += 2
    return True


def first_n_primes(count: int) -> List[int]:
    """Return the first `count` prime numbers."""
    if count < 0:
        raise ValueError("count must be nonnegative")
    return [nth_prime(index) for index in range(count)]


def nth_prime(index: int) -> int:
    """Return the prime with 0-based index `index`."""
    if index < 0:
        raise ValueError("index must be nonnegative")

    candidate = _PRIMES[-1] + 1
    while len(_PRIMES) <= index:
        if is_prime(candidate):
            _PRIMES.append(candidate)
        candidate += 1

    return _PRIMES[index]


def encode_tuple(values: Sequence[int]) -> int:
    """
    Encode a finite tuple of natural numbers as a single natural number.

    Uses:
        <a_0, ..., a_{k-1}> = Π_i p_i^(a_i + 1)

    The empty tuple is encoded as 1.
    """
    for value in values:
        if not isinstance(value, int) or value < 0:
            raise ValueError("encode_tuple expects a sequence of natural numbers")

    result = 1
    for i, value in enumerate(values):
        result *= nth_prime(i) ** (value + 1)
    return result


def estimate_tuple_decimal_digits(values: Sequence[int], cap: int | None = None) -> int:
    """
    Estimate the decimal digit count of a tuple code without multiplying it out.

    If `cap` is provided, returns as soon as the estimate is known to exceed
    that cap. This keeps display-oriented encoding endpoints from being forced
    to materialize enormous decimal integers.
    """
    if not values:
        return 1

    log_sum = 0.0
    for i, value in enumerate(values):
        if not isinstance(value, int) or value < 0:
            raise ValueError("estimate_tuple_decimal_digits expects natural numbers")

        term = (value + 1) * log10(nth_prime(i))
        log_sum += term
        if cap is not None and log_sum >= cap:
            return cap + 1

    return floor(log_sum) + 1


def decode_tuple(code: int) -> List[int]:
    """
    Decode a tuple code produced by `encode_tuple`.

    If code = 1, this returns the empty tuple [].
    """
    if not isinstance(code, int) or code <= 0:
        raise ValueError("tuple code must be a positive integer")

    if code == 1:
        return []

    values: List[int] = []
    remaining = code
    prime_index = 0

    while remaining > 1:
        p = nth_prime(prime_index)
        exponent = 0
        while remaining % p == 0:
            remaining //= p
            exponent += 1

        if exponent == 0:
            raise ValueError(f"{code} is not a valid consecutive-prime tuple code")

        values.append(exponent - 1)
        prime_index += 1

    return values


def tuple_prime_factorization(values: Sequence[int]) -> List[Tuple[int, int]]:
    """
    Return the prime-power factorization data for a tuple encoding, as
    [(prime_0, exponent_0), ..., (prime_{k-1}, exponent_{k-1})],
    where exponent_i = values[i] + 1.
    """
    for value in values:
        if not isinstance(value, int) or value < 0:
            raise ValueError("tuple_prime_factorization expects natural numbers")

    return [(nth_prime(i), value + 1) for i, value in enumerate(values)]


def format_prime_factorization_from_values(values: Sequence[int]) -> str:
    """Pretty-print the prime-power form used to encode a tuple."""
    factors = tuple_prime_factorization(values)
    if not factors:
        return "1"
    return " * ".join(f"{prime}^{exponent}" for prime, exponent in factors)


def instruction_type_code(opcode: str) -> int:
    """Return the numeric code of an opcode."""
    if opcode not in INSTRUCTION_TAGS:
        raise ValueError(f"Unknown opcode: {opcode}")
    return INSTRUCTION_TAGS[opcode]


def instruction_to_tuple(instr: Instruction) -> List[int]:
    """
    Convert a canonical URM instruction tuple into the tuple used for encoding.
    """
    validate_instruction(instr)

    op = instr[0]
    tag = instruction_type_code(op)

    if op in {"Z", "S"}:
        _, n = cast(Tuple[str, int], instr)
        return [tag, n]

    if op == "T":
        _, m, n = cast(Tuple[str, int, int], instr)
        return [tag, m, n]

    if op == "J":
        _, m, n, q = cast(Tuple[str, int, int, int], instr)
        return [tag, m, n, q]

    raise ValueError(f"Unsupported instruction: {instr}")


def tuple_to_instruction(values: Sequence[int]) -> Instruction:
    """
    Convert an instruction tuple-code payload back to the canonical URM
    instruction representation.
    """
    if not values:
        raise ValueError("Instruction tuple must be nonempty")

    tag = values[0]
    if tag not in TAG_TO_OPCODE:
        raise ValueError(f"Unknown instruction tag: {tag}")

    opcode = TAG_TO_OPCODE[tag]

    if opcode in {"Z", "S"}:
        if len(values) != 2:
            raise ValueError(f"{opcode}-instruction tuple must have length 2")
        instr: Instruction = (opcode, values[1])
        validate_instruction(instr)
        return instr

    if opcode == "T":
        if len(values) != 3:
            raise ValueError("T-instruction tuple must have length 3")
        instr: Instruction = ("T", values[1], values[2])
        validate_instruction(instr)
        return instr

    if opcode == "J":
        if len(values) != 4:
            raise ValueError("J-instruction tuple must have length 4")
        instr = ("J", values[1], values[2], values[3])
        validate_instruction(instr)
        return instr

    raise ValueError(f"Unsupported instruction tag: {tag}")


def encode_instruction(instr: Instruction) -> int:
    """Encode a canonical URM instruction as a natural number."""
    return encode_tuple(instruction_to_tuple(instr))


def decode_instruction(code: int) -> Instruction:
    """Decode an encoded instruction back to canonical URM tuple form."""
    return tuple_to_instruction(decode_tuple(code))


def is_instruction_code(code: int) -> bool:
    """Return True iff `code` decodes to a valid URM instruction."""
    try:
        decode_instruction(code)
        return True
    except ValueError:
        return False


def encode_program(program: Sequence[Instruction]) -> int:
    """
    Encode a canonical URM program as a natural number.

    The program code is the tuple code of the instruction codes.
    """
    program_list = list(program)
    validate_program(program_list)
    instruction_codes = [encode_instruction(instr) for instr in program_list]
    return encode_tuple(instruction_codes)


def decode_program(code: int) -> Program:
    """Decode an encoded program back to canonical URM tuple form."""
    instruction_codes = decode_tuple(code)
    program = [decode_instruction(instr_code) for instr_code in instruction_codes]
    validate_program(program)
    return program


def is_program_code(code: int) -> bool:
    """Return True iff `code` decodes to a valid URM program."""
    try:
        decode_program(code)
        return True
    except ValueError:
        return False


def decode_program_with_details(code: int) -> Dict[str, Any]:
    """
    Return a structured decoding breakdown for a program, suitable for API use.

    Decoded naturals are returned here as Python ints; convert to strings at the
    JSON boundary for frontend safety.
    """
    instruction_codes = decode_tuple(code)
    instruction_details: List[Dict[str, Any]] = []
    program: List[Instruction] = []
    opcode_counts: Dict[str, int] = {}

    for instr_code in instruction_codes:
        instr = decode_instruction(instr_code)
        instr_tuple = instruction_to_tuple(instr)
        program.append(instr)
        opcode_counts[instr[0]] = opcode_counts.get(instr[0], 0) + 1

        instruction_details.append(
            {
                "instruction": list(instr),
                "tuple": instr_tuple,
                "code": instr_code,
                "prime_factor_form": format_prime_factorization_from_values(instr_tuple),
            }
        )

    validate_program(program)

    return {
        "program": [list(instr) for instr in program],
        "instruction_tuples": [item["tuple"] for item in instruction_details],
        "instruction_details": instruction_details,
        "program_tuple": instruction_codes,
        "program_code": code,
        "program_prime_factor_form": format_prime_factorization_from_values(instruction_codes),
        "instruction_count": len(program),
        "opcode_sequence": [instr[0] for instr in program],
        "opcode_counts": opcode_counts,
        "is_empty_program": len(program) == 0,
    }


def encode_program_with_details(program: Sequence[Instruction]) -> Dict[str, Any]:
    """
    Return a structured encoding breakdown for a program, suitable for API use.

    Encoded naturals are returned here as Python ints; convert to strings at the
    JSON boundary for frontend safety.
    """
    program_list = list(program)
    validate_program(program_list)

    instruction_details: List[Dict[str, Any]] = []
    instruction_codes: List[int] = []

    for instr in program_list:
        instr_tuple = instruction_to_tuple(instr)
        instr_code = encode_tuple(instr_tuple)
        instruction_codes.append(instr_code)

        instruction_details.append(
            {
                "instruction": list(instr),
                "tuple": instr_tuple,
                "code": instr_code,
                "prime_factor_form": format_prime_factorization_from_values(instr_tuple),
            }
        )

    program_code_digits = estimate_tuple_decimal_digits(
        instruction_codes,
        cap=MAX_ENCODED_DECIMAL_DIGITS,
    )
    program_code = (
        encode_tuple(instruction_codes)
        if program_code_digits <= MAX_ENCODED_DECIMAL_DIGITS
        else None
    )

    return {
        "program": [list(instr) for instr in program_list],
        "instruction_details": instruction_details,
        "instruction_codes": instruction_codes,
        "program_tuple": instruction_codes,
        "program_code": program_code,
        "program_code_decimal_digits": program_code_digits if program_code is not None else None,
        "program_code_decimal_omitted": program_code is None,
        "program_prime_factor_form": format_prime_factorization_from_values(instruction_codes),
    }


def encode_instruction_with_details(instr: Instruction) -> Dict[str, Any]:
    """Return a structured encoding breakdown for a single instruction."""
    validate_instruction(instr)
    values = instruction_to_tuple(instr)
    code = encode_tuple(values)

    return {
        "instruction": list(instr),
        "tuple": values,
        "code": code,
        "prime_factor_form": format_prime_factorization_from_values(values),
    }
