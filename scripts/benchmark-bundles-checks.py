#!/usr/bin/env python3
"""Focused local checks for archive traversal, provenance and inert Skill repacking."""
import hashlib
import importlib.util
import json
import stat
import sys
import unittest
import uuid
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("benchmark_bundles", Path(__file__).with_name("benchmark-bundles.py"))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
SCRATCH = bundle.controlled_path(bundle.DEFAULT_OUTPUT, "checks/" + str(uuid.uuid4()))
SCRATCH.mkdir(parents=True)


class ArchiveSafetyChecks(unittest.TestCase):
    def test_unsafe_paths(self):
        for name in ("../outside", "/absolute", "C:/escape", "safe/../../escape", "safe\\..\\escape", "CON.txt", "safe/file:stream", "safe/name.", "safe/name ", "safe//empty", "control\x01"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                bundle.safe_member_name(name)

    def test_central_directory_refuses_symlinks_and_collisions(self):
        archive = SCRATCH / "unsafe.zip"
        with zipfile.ZipFile(archive, "w") as output:
            link = zipfile.ZipInfo("linked")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            output.writestr(link, "../outside")
            output.writestr("safe/A.txt", b"a")
            output.writestr("safe/a.txt", b"b")
        result = bundle.inspect_central(archive)
        self.assertFalse(result["safe"])
        self.assertEqual(len(result["issues"]), 2)

    def test_json_rejects_duplicate_keys_and_nonfinite_numbers(self):
        for data in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
            with self.assertRaises(ValueError):
                bundle.strict_json(data)

    def test_provenance_does_not_overwrite_and_id_mapping_is_explicit(self):
        archive = {"archive": "fixture.zip", "sha256": "0" * 64}
        original = {"uid": "fixture-1", "ground_truth": {"result": "fixture", "reason": "preserved"}, "nested": [None, True, {"value": 2}]}
        normalized = bundle.normalized_row(original, archive, "source.jsonl", 1, True)
        restored = dict(normalized)
        del restored["id"], restored[bundle.PROVENANCE]
        self.assertEqual(restored, original)
        self.assertEqual(normalized["id"], original["uid"])
        with self.assertRaises(ValueError):
            bundle.normalized_row({"id": "1", "uid": "2"}, archive, "source.jsonl", 1, True)
        with self.assertRaises(ValueError):
            bundle.normalized_row({"id": "1", bundle.PROVENANCE: {}}, archive, "source.jsonl", 1, False)

    def test_nested_zip_and_script_bytes_remain_inert(self):
        archive_path = SCRATCH / "skills.zip"
        source_files = {"SKILL.md": b"fixture only", "_expected.json": b'{"result":"fixture","reason":"preserved"}', "scripts/never-run.py": b'raise RuntimeError("must never execute")\n', "nested.zip": b"opaque nested fixture, deliberately not a valid ZIP"}
        with zipfile.ZipFile(archive_path, "w") as output:
            for relative, data in source_files.items():
                output.writestr("packages/skill-000001/" + relative, data)
        report = bundle.inspect_central(archive_path)
        self.assertTrue(report["safe"])
        root = SCRATCH / "repacked"
        root.mkdir()
        with zipfile.ZipFile(archive_path) as incoming:
            row, metadata = bundle.skill_package(incoming, report, "skill-000001", report["entries"], root)
        self.assertEqual(row["ground_truth"], {"result": "fixture", "reason": "preserved"})
        self.assertEqual(row["file_count"], 4)
        with zipfile.ZipFile(root / row["package_path"]) as repacked:
            self.assertEqual(set(repacked.namelist()), set(source_files))
            for relative, data in source_files.items():
                self.assertEqual(repacked.read(relative), data)
        self.assertEqual(row["package_sha256"], hashlib.sha256((root / row["package_path"]).read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main(verbosity=2)
