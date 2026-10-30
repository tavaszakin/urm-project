import unittest

from fastapi import HTTPException

from main import (
    DecodeProgramRequest,
    EncodeInstructionRequest,
    EncodeProgramRequest,
    decode_program_endpoint,
    encode_instruction_endpoint,
    encode_program_endpoint,
)
from urm_encoding import (
    decode_program_with_details,
    decode_instruction,
    decode_program,
    encode_instruction,
    encode_program,
    encode_program_with_details,
    is_instruction_code,
    is_program_code,
)
from urm import validate_program


class UrmEncodingTests(unittest.TestCase):
    def test_encode_decode_zero_instruction(self):
        instruction = ("Z", 2)
        self.assertEqual(decode_instruction(encode_instruction(instruction)), instruction)

    def test_encode_decode_successor_instruction(self):
        instruction = ("S", 5)
        self.assertEqual(decode_instruction(encode_instruction(instruction)), instruction)

    def test_encode_decode_transfer_instruction(self):
        instruction = ("T", 2, 1)
        self.assertEqual(decode_instruction(encode_instruction(instruction)), instruction)

    def test_encode_decode_jump_instruction(self):
        instruction = ("J", 0, 1, 5)
        self.assertEqual(decode_instruction(encode_instruction(instruction)), instruction)

    def test_encode_decode_program_round_trip(self):
        program = [("Z", 0), ("S", 0), ("J", 0, 0, 1)]
        self.assertEqual(decode_program(encode_program(program)), program)

    def test_invalid_instruction_code_is_rejected(self):
        self.assertFalse(is_instruction_code(1))

    def test_invalid_program_code_is_rejected(self):
        self.assertFalse(is_program_code(encode_instruction(("J", 0, 0, 7))))

    def test_encode_program_details_shape(self):
        program = [("Z", 0), ("S", 0)]
        details = encode_program_with_details(program)

        self.assertEqual(details["program"], [["Z", 0], ["S", 0]])
        self.assertEqual(len(details["instruction_details"]), 2)
        self.assertEqual(details["instruction_details"][0]["instruction"], ["Z", 0])
        self.assertIsInstance(details["program_code"], int)

    def test_decode_program_details_round_trip_shape(self):
        program = [("Z", 0), ("S", 0), ("J", 0, 0, 1)]
        details = decode_program_with_details(encode_program(program))

        self.assertEqual(details["program"], [["Z", 0], ["S", 0], ["J", 0, 0, 1]])
        self.assertEqual(details["instruction_tuples"], [[0, 0], [1, 0], [3, 0, 0, 1]])
        self.assertEqual(details["instruction_count"], 3)
        self.assertEqual(details["opcode_sequence"], ["Z", "S", "J"])
        self.assertEqual(details["opcode_counts"], {"Z": 1, "S": 1, "J": 1})
        self.assertFalse(details["is_empty_program"])

    def test_validate_program_allows_jump_to_halting_position(self):
        validate_program([("Z", 2), ("J", 0, 0, 2)])

    def test_validate_program_error_message_reports_full_allowed_jump_range(self):
        with self.assertRaises(ValueError) as exc_info:
            validate_program([("Z", 2), ("J", 0, 0, 3)])

        self.assertEqual(
            str(exc_info.exception),
            "Invalid instruction at I1: jump target must be within 0..2, got 3.",
        )


class UrmEncodingApiShapeTests(unittest.TestCase):
    def test_encode_instruction_endpoint_returns_code_as_string(self):
        response = encode_instruction_endpoint(EncodeInstructionRequest(instruction=["S", 0]))

        self.assertEqual(response.instruction, ["S", 0])
        self.assertEqual(response.tuple, [1, 0])
        self.assertIsInstance(response.code, str)

    def test_encode_program_endpoint_returns_codes_as_strings(self):
        response = encode_program_endpoint(
            EncodeProgramRequest(program=[["Z", 0], ["S", 0]])
        )

        self.assertEqual(response.program, [["Z", 0], ["S", 0]])
        self.assertEqual(len(response.instruction_codes), 2)
        self.assertTrue(all(isinstance(value, str) for value in response.instruction_codes))
        self.assertTrue(all(isinstance(item.code, str) for item in response.instruction_details))
        self.assertIsInstance(response.program_code, str)

    def test_encode_program_endpoint_allows_jump_to_halting_position(self):
        response = encode_program_endpoint(
            EncodeProgramRequest(program=[["J", 0, 0, 1]])
        )

        self.assertEqual(response.program, [["J", 0, 0, 1]])

    def test_decode_program_endpoint_round_trip_returns_inspector_fields(self):
        program = [("Z", 0)]
        program_code = str(encode_program(program))

        response = decode_program_endpoint(DecodeProgramRequest(code=program_code))

        self.assertEqual(response.code, program_code)
        self.assertEqual(response.program, [["Z", 0]])
        self.assertEqual(response.instruction_tuples, [[0, 0]])
        self.assertEqual(response.program_tuple, [str(encode_instruction(instr)) for instr in program])
        self.assertEqual(len(response.instruction_details), 1)
        self.assertTrue(all(isinstance(item.code, str) for item in response.instruction_details))
        self.assertEqual(response.instruction_count, 1)
        self.assertEqual(response.opcode_sequence, ["Z"])
        self.assertEqual(response.opcode_counts, {"Z": 1})
        self.assertFalse(response.is_empty_program)

    def test_decode_program_endpoint_rejects_malformed_code_string(self):
        with self.assertRaises(HTTPException) as exc_info:
            decode_program_endpoint(DecodeProgramRequest(code="12x"))

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertEqual(exc_info.exception.detail, "code must be a positive integer string")

    def test_decode_program_endpoint_rejects_non_program_code(self):
        invalid_program_code = "3"

        with self.assertRaises(HTTPException) as exc_info:
            decode_program_endpoint(DecodeProgramRequest(code=invalid_program_code))

        self.assertEqual(exc_info.exception.status_code, 400)
        self.assertIn("not a valid consecutive-prime tuple code", exc_info.exception.detail)

    def test_decode_program_endpoint_preserves_original_string_input(self):
        response = decode_program_endpoint(DecodeProgramRequest(code="001"))

        self.assertEqual(response.code, "001")
        self.assertEqual(response.program, [])
        self.assertEqual(response.instruction_tuples, [])
        self.assertEqual(response.program_tuple, [])
        self.assertEqual(response.instruction_count, 0)
        self.assertTrue(response.is_empty_program)


if __name__ == "__main__":
    unittest.main()
