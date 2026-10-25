"""Offline contract generation checks; imports schemas, never the application."""

import io
import runpy
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
before_schema_imports = set(sys.modules)
generator = runpy.run_path(str(ROOT / "scripts/generate_api_contracts.py"))
schema_imports = set(sys.modules) - before_schema_imports


class ApiContractTests(unittest.TestCase):
    def test_clients_match_backend_schemas(self):
        expected = generator["render"]()
        sources = {
            platform: (ROOT / platform / "src/types/api-contracts.ts").read_text(
                encoding="utf-8"
            )
            for platform in ("frontend", "mobile")
        }
        self.assertEqual(generator["verify_contracts"](expected, sources), [])

    CONTRACT = """
export type Mode = "AUTO" | "WEB_SEARCH";
export type Payload = {
  "id": string;
  "note"?: string | null;
  "label": "read me";
  "mode": Mode;
  "items": Array<string>;
  "data": Record<string, unknown>;
};
"""

    def test_formatting_quotes_order_and_equivalent_arrays_are_accepted(self):
        reformatted = """
// Different quotes, parentheses, declaration/field order and trailing commas.
export type Payload = {
 data: Record<string, unknown>, items: string[], mode: Mode,
 label: 'read me', note?: (null | (string | null)), id: string,
}
export type Mode = (
 | 'WEB_SEARCH' // a comment inside the union
 | 'AUTO'
);
"""
        sources = {
            "formatted.ts": reformatted,
            "windows.ts": reformatted.replace("\n", "\r\n"),
            "bom.ts": "\ufeff" + reformatted,
            "original.ts": self.CONTRACT,
        }
        self.assertEqual(generator["verify_contracts"](self.CONTRACT, sources), [])

    def test_real_contract_changes_are_rejected(self):
        mutations = {
            "field-type.ts": self.CONTRACT.replace('"id": string', '"id": number'),
            "required.ts": self.CONTRACT.replace('"note"?:', '"note":'),
            "optional.ts": self.CONTRACT.replace('"id":', '"id"?:'),
            "nullable.ts": self.CONTRACT.replace("string | null", "string"),
            "literal-space.ts": self.CONTRACT.replace("read me", "readme"),
            "mode.ts": self.CONTRACT.replace('"WEB_SEARCH"', '"MULTIMODAL"'),
            "array.ts": self.CONTRACT.replace("Array<string>", "Array<number>"),
            "any.ts": self.CONTRACT.replace("unknown", "any"),
            "missing-field.ts": self.CONTRACT.replace('  "id": string;\n', ""),
            "extra-field.ts": self.CONTRACT.replace(
                '  "id":', '  extra: boolean;\n  "id":'
            ),
            "readonly.ts": self.CONTRACT.replace('  "id":', '  readonly "id":'),
            "reference.ts": self.CONTRACT.replace('"mode": Mode', '"mode": string'),
            "missing-model.ts": self.CONTRACT[
                self.CONTRACT.index("export type Payload") :
            ],
            "extra-model.ts": self.CONTRACT + "export type Extra = string;",
        }
        errors = generator["verify_contracts"](self.CONTRACT, mutations)
        for filename in mutations:
            with self.subTest(filename=filename):
                self.assertTrue(
                    any(error.startswith(filename + ":") for error in errors)
                )

    def test_invalid_ambiguous_and_executable_sources_are_rejected_without_running(
        self,
    ):
        sources = {
            "invalid.ts": self.CONTRACT + "export type Broken = {",
            "duplicate-model.ts": self.CONTRACT + "export type Mode = string;",
            "duplicate-field.ts": self.CONTRACT.replace(
                '"id": string;', '"id": string; "id": number;'
            ),
            "executable.ts": self.CONTRACT
            + "throw new Error('Do not execute contract source');",
            "generic.ts": self.CONTRACT.replace("type Payload", "type Payload<T>"),
            "import.ts": "import './do-not-load';\n" + self.CONTRACT,
        }
        errors = generator["verify_contracts"](self.CONTRACT, sources)
        self.assertEqual(len(errors), len(sources))
        for filename in sources:
            self.assertTrue(any(error.startswith(filename + ":") for error in errors))

    def test_check_cli_is_read_only_and_reports_missing_or_changed_files(self):
        scratch = ROOT / "backend/.pytest_cache"
        self.assertTrue(scratch.resolve().is_relative_to(ROOT))
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="contract-check-", dir=scratch) as name:
            project = Path(name)
            files = [
                project / platform / "src/types/api-contracts.ts"
                for platform in ("frontend", "mobile")
            ]
            for path in files:
                path.parent.mkdir(parents=True)
                path.write_bytes(
                    self.CONTRACT.replace('"id"', "id").replace("\n", "\r\n").encode()
                )
            before = [path.read_bytes() for path in files]
            main = generator["main"]
            with (
                patch.dict(
                    main.__globals__, {"ROOT": project, "render": lambda: self.CONTRACT}
                ),
                patch.object(sys, "argv", ["generate_api_contracts.py", "--check"]),
                redirect_stdout(io.StringIO()),
                redirect_stderr(io.StringIO()) as errors,
            ):
                self.assertEqual(main(), 0)
                self.assertEqual([path.read_bytes() for path in files], before)
                files[0].write_text(
                    self.CONTRACT.replace('"id": string', '"id": number'),
                    encoding="utf-8",
                )
                changed = files[0].read_bytes()
                self.assertEqual(main(), 1)
                self.assertIn("changed Payload", errors.getvalue())
                self.assertEqual(files[0].read_bytes(), changed)
                files[1].unlink()
                self.assertEqual(main(), 1)
                self.assertIn("missing file", errors.getvalue())
                self.assertFalse(files[1].exists())

    def test_parser_failure_and_timeout_cannot_report_success(self):
        for failure in (
            FileNotFoundError(),
            subprocess.TimeoutExpired("node", 30),
        ):
            with (
                self.subTest(failure=type(failure).__name__),
                patch("subprocess.run", side_effect=failure),
            ):
                with self.assertRaises(RuntimeError):
                    generator["verify_contracts"](
                        self.CONTRACT, {"actual.ts": self.CONTRACT}
                    )

        for result in (
            subprocess.CompletedProcess([], 2, "", "Install frontend dependencies"),
            subprocess.CompletedProcess([], 0, "not json", ""),
            subprocess.CompletedProcess([], 1, "[]", ""),
        ):
            with (
                self.subTest(result=result),
                patch("subprocess.run", return_value=result),
            ):
                with self.assertRaises(RuntimeError):
                    generator["verify_contracts"](
                        self.CONTRACT, {"actual.ts": self.CONTRACT}
                    )

    def test_generation_remains_python_only(self):
        scratch = ROOT / "backend/.pytest_cache"
        self.assertTrue(scratch.resolve().is_relative_to(ROOT))
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix="contract-generate-", dir=scratch
        ) as name:
            project = Path(name)
            files = [
                project / platform / "src/types/api-contracts.ts"
                for platform in ("frontend", "mobile")
            ]
            for path in files:
                path.parent.mkdir(parents=True)
            main = generator["main"]
            with (
                patch.dict(
                    main.__globals__, {"ROOT": project, "render": lambda: self.CONTRACT}
                ),
                patch.object(sys, "argv", ["generate_api_contracts.py"]),
                patch(
                    "subprocess.run",
                    side_effect=AssertionError("Generation must not launch Node"),
                ),
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(main(), 0)
            for path in files:
                self.assertEqual(path.read_text(encoding="utf-8"), self.CONTRACT)

    def test_generation_does_not_initialize_services(self):
        self.assertNotIn("app.main", schema_imports)
        self.assertNotIn("app.core.config", schema_imports)
        self.assertNotIn("app.db.database", schema_imports)
        self.assertNotIn("app.services.orchestrator", schema_imports)

    def test_nullable_optional_and_required_are_distinct(self):
        result = generator["typescript"](
            {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string"},
                    "description": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                },
            }
        )
        self.assertIn('"id": string;', result)
        self.assertIn('"description"?: string | null;', result)

    def test_unknown_schema_is_rejected(self):
        with self.assertRaises(ValueError):
            generator["typescript"]({"oneOf": [{"type": "string"}]})


if __name__ == "__main__":
    unittest.main()
