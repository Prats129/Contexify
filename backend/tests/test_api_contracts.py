"""Offline contract generation checks; imports schemas, never the application."""

import runpy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
before_schema_imports = set(sys.modules)
generator = runpy.run_path(str(ROOT / "scripts/generate_api_contracts.py"))
schema_imports = set(sys.modules) - before_schema_imports


class ApiContractTests(unittest.TestCase):
    def test_clients_match_backend_schemas(self):
        expected = generator["render"]()
        for platform in ("frontend", "mobile"):
            with self.subTest(platform=platform):
                actual = (ROOT / platform / "src/types/api-contracts.ts").read_text(
                    encoding="utf-8"
                )
                self.assertEqual(actual, expected, "Regenerate the API contracts")

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
