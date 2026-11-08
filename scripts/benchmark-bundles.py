#!/usr/bin/env python3
"""Inspect and stage untrusted benchmark archives without executing sample files.

Only this script runs. Archive members are data, including SKILL.md and scripts.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath

PROJECT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path(os.environ["OXEN_BENCHMARK_SOURCE"]) if os.environ.get("OXEN_BENCHMARK_SOURCE") else None
DEFAULT_OUTPUT = PROJECT / ".data" / "benchmark-import"
MAX_ENTRIES = 100_000
MAX_ARCHIVE_UNCOMPRESSED = 1024 * 1024 * 1024
MAX_MEMBER_BYTES = 128 * 1024 * 1024
MAX_RATIO = 1000
MAX_RECORD_BYTES = 16 * 1024 * 1024
MAX_ROWS = 1_000_000
SUPPORTED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA}
RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", re.I)
CATEGORY_KEYS = {"result", "label", "label_name", "class", "category", "severity", "split", "case_group", "benchmark_group", "benchmark_group_zh", "scenario_type", "review_status", "evidence_level"}
PROVENANCE = "__bundle_provenance"
SPECS = {
    "Enterprise Sensitive Data benchmark.zip": {"repo": "benchmark-sensitive-data", "rows": 2000, "sha256": "61b766e9879222e5308374bbf468d243764838b90f68f0bcb445fdfb5279e79d"},
    "intent-deviation-v1.0.0.zip": {"repo": "benchmark-behavior-drift", "rows": 1719, "sha256": "1ec543a14743f12a390e84e9f10f44ed839555d7d624c08495d1fd9e0a9c7c9b"},
    "prompt_injection_bench.zip": {"repo": "benchmark-prompt-injection", "rows": 2000, "sha256": "4521d2e5555e63789326d2f8c882595228790afad408e07cf4857478d4da620d"},
    "Skill\u6837\u672c_V1.1.zip": {"repo": "benchmark-skills", "rows": 1000, "sha256": "56756f84a5c1ebbdadc4cde4f2fe6d4355cd2b14a794b47f3ec4840b52b0cefc"},
}


def sha256_file(filename: Path) -> str:
    digest = hashlib.sha256()
    with filename.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_member_name(name: str) -> str:
    if "\x00" in name or any(ord(char) < 32 for char in name):
        raise ValueError("control character in member path")
    name = unicodedata.normalize("NFC", name.replace("\\", "/"))
    if name.startswith("/") or re.match(r"^[a-zA-Z]:", name):
        raise ValueError("absolute or drive-qualified member path")
    parts = name.rstrip("/").split("/")
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("empty, dot, or traversal path component")
    for part in parts:
        if any(char in part for char in '<>:"|?*') or part.endswith((".", " ")) or RESERVED.match(part):
            raise ValueError("unsafe Windows member name")
        if len(part.encode("utf-8")) > 255:
            raise ValueError("member path component exceeds 255 UTF-8 bytes")
    return "/".join(parts)


def inspect_central(archive: Path) -> dict:
    issues: list[dict] = []
    entries: list[dict] = []
    seen: dict[str, str] = {}
    with zipfile.ZipFile(archive) as bundle:
        infos = bundle.infolist()
        if len(infos) > MAX_ENTRIES:
            issues.append({"kind": "entry-limit", "count": len(infos)})
        total = sum(info.file_size for info in infos)
        if total > MAX_ARCHIVE_UNCOMPRESSED:
            issues.append({"kind": "total-size-limit", "bytes": total})
        for info in infos:
            try:
                normalized = safe_member_name(info.filename)
                collision_key = normalized.casefold()
                if collision_key in seen:
                    raise ValueError(f"duplicate/case-colliding member path: {seen[collision_key]}")
                seen[collision_key] = normalized
                mode = info.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise ValueError("symlink member")
                if stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}:
                    raise ValueError("non-regular member")
                if info.flag_bits & 1:
                    raise ValueError("encrypted member")
                if info.compress_type not in SUPPORTED_COMPRESSION:
                    raise ValueError("unsupported ZIP compression")
                if info.file_size > MAX_MEMBER_BYTES:
                    raise ValueError("member size exceeds limit")
                if info.file_size and info.file_size / max(1, info.compress_size) > MAX_RATIO:
                    raise ValueError("suspicious compression ratio")
                entries.append({"name": info.filename, "normalized": normalized, "directory": info.is_dir(), "bytes": info.file_size, "compressedBytes": info.compress_size, "crc32": f"{info.CRC:08x}", "utf8Name": bool(info.flag_bits & 0x800)})
            except ValueError as exc:
                issues.append({"kind": "unsafe-member", "member": info.filename, "reason": str(exc)})
    files = [entry for entry in entries if not entry["directory"]]
    return {
        "archive": archive.name, "source": str(archive), "bytes": archive.stat().st_size,
        "sha256": sha256_file(archive), "centralEntries": len(infos), "files": len(files),
        "uncompressedBytes": total, "safe": not issues, "issues": issues,
        "extensions": dict(collections.Counter(PurePosixPath(entry["normalized"]).suffix.lower() or "[no extension]" for entry in files)),
        "topDirectories": dict(collections.Counter(PurePosixPath(entry["normalized"]).parts[0] for entry in files)),
        "entries": entries,
    }


def inventory(source: Path, output: Path) -> dict:
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise ValueError("source must be a directory")
    archives = sorted(source.glob("*.zip"), key=lambda item: item.name.casefold())
    if not archives:
        raise ValueError("no ZIP archives found")
    report = {
        "version": 1, "source": str(source), "phase": "central-directory-only",
        "limits": {"entriesPerArchive": MAX_ENTRIES, "uncompressedBytesPerArchive": MAX_ARCHIVE_UNCOMPRESSED, "bytesPerMember": MAX_MEMBER_BYTES, "compressionRatio": MAX_RATIO},
        "archives": [inspect_central(archive) for archive in archives],
    }
    destination = controlled_path(DEFAULT_OUTPUT, str(output.absolute().relative_to(DEFAULT_OUTPUT.absolute())))
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "inventory.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def json_type(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def strict_json(data: str) -> object:
    def pairs(values: list[tuple[str, object]]) -> dict:
        result: dict = {}
        for key, value in values:
            if key in result:
                raise ValueError(f"duplicate JSON object key: {key}")
            result[key] = value
        return result
    def invalid_constant(value: str) -> None:
        raise ValueError(f"non-JSON numeric constant: {value}")
    return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid_constant)


def profile_records(bundle: zipfile.ZipFile, member: str) -> dict:
    fields: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    identifiers: collections.Counter = collections.Counter()
    identifier_fields: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    nested_fields: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    labels: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    rows, physical_lines, blank_lines, maximum = 0, 0, 0, 0
    digest = hashlib.sha256()
    with bundle.open(member) as stream:
        while True:
            raw = stream.readline(MAX_RECORD_BYTES + 1)
            if not raw:
                break
            if len(raw) > MAX_RECORD_BYTES:
                raise ValueError(f"JSONL record exceeds {MAX_RECORD_BYTES} bytes: {member}")
            digest.update(raw)
            physical_lines += 1
            if physical_lines == 1:
                raw = raw.removeprefix(b"\xef\xbb\xbf")
            if not raw.strip():
                blank_lines += 1
                continue
            record = strict_json(raw.decode("utf-8"))
            if not isinstance(record, dict):
                raise ValueError(f"JSONL row is not an object: {member}, line {physical_lines}")
            rows += 1
            if rows > MAX_ROWS:
                raise ValueError("JSONL row count exceeds inspection limit")
            maximum = max(maximum, len(raw))
            for key, value in record.items():
                fields[key][json_type(value)] += 1
                if key in CATEGORY_KEYS:
                    scalar = str(value)
                    if value is not None and not isinstance(value, (dict, list)) and len(scalar) <= 120 and not any(ord(char) < 32 for char in scalar):
                        labels[key][scalar] += 1
                if key in {"id", "uid", "case_id", "benchmark_id"} and isinstance(value, (str, int)) and not isinstance(value, bool):
                    identifier_fields[key][json.dumps(value, sort_keys=True)] += 1
                if key in {"ground_truth", "verification"} and isinstance(value, dict):
                    for child, child_value in value.items():
                        nested_fields[f"{key}.{child}"][json_type(child_value)] += 1
            if isinstance(record.get("id"), (str, int)) and not isinstance(record.get("id"), bool):
                identifiers[json.dumps(record["id"], sort_keys=True)] += 1
    return {
        "member": member, "sha256": digest.hexdigest(), "rows": rows, "physicalLines": physical_lines,
        "blankLines": blank_lines, "largestRecordBytes": maximum,
        "schema": {name: dict(types) for name, types in fields.items()},
        "idCount": sum(identifiers.values()), "uniqueIds": len(identifiers),
        "identifierFields": {key: {"count": sum(values.values()), "unique": len(values)} for key, values in identifier_fields.items()},
        "nestedMetadataSchema": {key: dict(values) for key, values in nested_fields.items()},
        "categoricalMetadata": {key: dict(counts) for key, counts in labels.items() if len(counts) <= 20},
    }


def inspect_profiles(report: dict, output: Path) -> dict:
    if any(not item["safe"] for item in report["archives"]):
        raise ValueError("profiles are refused until every central directory passes")
    profiles = []
    for item in report["archives"]:
        archive = Path(item["source"])
        with zipfile.ZipFile(archive) as bundle:
            datasets = [profile_records(bundle, entry["name"]) for entry in item["entries"] if not entry["directory"] and entry["normalized"].lower().endswith(".jsonl")]
            groups: dict[str, list[dict]] = collections.defaultdict(list)
            for entry in item["entries"]:
                parts = PurePosixPath(entry["normalized"]).parts
                if not entry["directory"] and len(parts) >= 3 and parts[0] == "packages":
                    groups[parts[1]].append(entry)
            skill_profile = None
            if groups:
                expected_schema: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
                expected_enums: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
                root_expected = root_skill_md = nested_zip = 0
                for group, entries in groups.items():
                    prefix = f"packages/{group}/"
                    root_skill_md += any(entry["normalized"] == prefix + "SKILL.md" for entry in entries)
                    nested_zip += sum(entry["normalized"].lower().endswith(".zip") for entry in entries)
                    expected = next((entry for entry in entries if entry["normalized"] == prefix + "_expected.json"), None)
                    if expected:
                        root_expected += 1
                        if expected["bytes"] > MAX_RECORD_BYTES:
                            raise ValueError("skill expected metadata exceeds inspection limit")
                        value = strict_json(bundle.read(expected["name"]).decode("utf-8-sig"))
                        if not isinstance(value, dict):
                            raise ValueError("skill expected metadata must be an object")
                        for key, entry in value.items():
                            expected_schema[key][json_type(entry)] += 1
                            if key in CATEGORY_KEYS and not isinstance(entry, (dict, list)) and len(str(entry)) <= 120 and not any(ord(char) < 32 for char in str(entry)):
                                expected_enums[key][str(entry)] += 1
                skill_profile = {
                    "sampleFolders": len(groups), "sourcePrefix": "packages/<sample-folder>/",
                    "foldersWithRootSkillMd": root_skill_md, "foldersWithRootExpectedJson": root_expected,
                    "nestedZipMembersPreservedOpaque": nested_zip, "smallestFileCount": min(map(len, groups.values())),
                    "largestFileCount": max(map(len, groups.values())),
                    "expectedSchema": {key: dict(types) for key, types in expected_schema.items()},
                    "expectedCategoricalMetadata": {key: dict(values) for key, values in expected_enums.items() if len(values) <= 20},
                    "sampleFolderNaming": "skill-NNNNNN" if all(re.fullmatch(r"skill-\d{6}", key) for key in groups) else "mixed",
                }
            profiles.append({"archive": item["archive"], "archiveSha256": item["sha256"], "datasets": datasets, "skills": skill_profile})
    result = {"version": 1, "phase": "bounded-data-profile-no-execution", "archives": profiles}
    (output / "profiles.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def controlled_path(root: Path, relative: str = "") -> Path:
    """Reject reparse points/symlinks before following any controlled output path."""
    root = root.absolute()
    candidate = root / relative
    candidate.absolute().relative_to(root)
    current = Path(candidate.anchor)
    for part in candidate.parts[1:]:
        current /= part
        if current.exists() or current.is_symlink():
            mode = current.lstat()
            if stat.S_ISLNK(mode.st_mode) or getattr(mode, "st_file_attributes", 0) & 0x400:
                raise ValueError(f"symlink/reparse point in output path: {current}")
    candidate.resolve().relative_to(root.resolve())
    return candidate


def write_json_atomic(filename: Path, value: object) -> None:
    controlled_path(DEFAULT_OUTPUT, str(filename.absolute().relative_to(DEFAULT_OUTPUT.absolute())))
    filename.parent.mkdir(parents=True, exist_ok=True)
    temporary = filename.with_suffix(filename.suffix + ".partial")
    controlled_path(DEFAULT_OUTPUT, str(temporary.absolute().relative_to(DEFAULT_OUTPUT.absolute())))
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, filename)


def copy_verified(source: Path, destination: Path, expected_sha: str) -> None:
    controlled_path(DEFAULT_OUTPUT, str(destination.absolute().relative_to(DEFAULT_OUTPUT.absolute())))
    if destination.exists():
        if sha256_file(destination) != expected_sha:
            raise ValueError(f"existing source copy has unexpected digest: {destination.name}")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    controlled_path(DEFAULT_OUTPUT, str(temporary.absolute().relative_to(DEFAULT_OUTPUT.absolute())))
    with source.open("rb") as incoming, temporary.open("wb") as outgoing:
        shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
    if sha256_file(temporary) != expected_sha:
        raise ValueError("source changed while making immutable archive copy")
    os.replace(temporary, destination)


def records(stream):
    for line in range(1, MAX_ROWS + 2):
        raw = stream.readline(MAX_RECORD_BYTES + 1)
        if not raw:
            return
        if line > MAX_ROWS or len(raw) > MAX_RECORD_BYTES:
            raise ValueError("JSONL staging row/record limit exceeded")
        if line == 1:
            raw = raw.removeprefix(b"\xef\xbb\xbf")
        if raw.strip():
            value = strict_json(raw.decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("JSONL staging requires object records")
            yield line, value


def normalized_row(original: dict, archive: dict, member: str, line: int, derive_id: bool) -> dict:
    if PROVENANCE in original:
        raise ValueError("reserved provenance key collides with original source field")
    value = dict(original)
    source_field = "uid" if derive_id else "id"
    identity = original.get(source_field)
    if not isinstance(identity, str) or not identity:
        raise ValueError("source identifier must be a nonempty string")
    if derive_id:
        if "id" in original:
            raise ValueError("derived id would overwrite an original field")
        value["id"] = identity
    value[PROVENANCE] = {"archive": archive["archive"], "archive_sha256": archive["sha256"], "member": member, "line": line, "source_id_field": source_field, "source_id": identity}
    return value


def file_metadata(root: Path, filename: Path) -> dict:
    return {"path": filename.relative_to(root).as_posix(), "bytes": filename.stat().st_size, "sha256": sha256_file(filename)}


def dump_line(stream, value: dict) -> None:
    stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")


def extract_member(bundle: zipfile.ZipFile, entry: dict, root: Path) -> dict:
    destination = controlled_path(root, "source/files/" + entry["normalized"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    controlled_path(root, str(temporary.relative_to(root)))
    digest, size = hashlib.sha256(), 0
    with bundle.open(entry["name"]) as incoming, temporary.open("wb") as outgoing:
        for block in iter(lambda: incoming.read(1024 * 1024), b""):
            size += len(block)
            if size > entry["bytes"]:
                raise ValueError("member exceeds declared central directory size")
            digest.update(block)
            outgoing.write(block)
    if size != entry["bytes"]:
        raise ValueError("member size differs from central directory")
    os.replace(temporary, destination)
    return {"member": entry["normalized"], "bytes": size, "sha256": digest.hexdigest(), "path": destination.relative_to(root).as_posix()}


def skill_package(bundle: zipfile.ZipFile, archive: dict, sample: str, entries: list[dict], root: Path) -> tuple[dict, dict]:
    prefix = "packages/" + sample + "/"
    root_expected = next((entry for entry in entries if entry["normalized"] == prefix + "_expected.json" and not entry["directory"]), None)
    root_skill = next((entry for entry in entries if entry["normalized"] == prefix + "SKILL.md" and not entry["directory"]), None)
    if not root_expected or not root_skill:
        raise ValueError("every Skill package requires root SKILL.md and _expected.json")
    expected = strict_json(bundle.read(root_expected["name"]).decode("utf-8-sig"))
    if not isinstance(expected, dict) or set(expected) != {"result", "reason"} or not all(isinstance(value, str) for value in expected.values()):
        raise ValueError("Skill ground truth must exactly match the inspected result/reason schema")
    destination = controlled_path(root, f"packages/{sample}.zip")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".zip.partial")
    controlled_path(root, str(temporary.relative_to(root)))
    members = []
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for entry in sorted(entries, key=lambda item: item["normalized"]):
            relative = entry["normalized"][len(prefix):]
            if not relative:
                continue
            relative = safe_member_name(relative)
            info = zipfile.ZipInfo(relative + ("/" if entry["directory"] else ""), date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = ((stat.S_IFDIR | 0o755) if entry["directory"] else (stat.S_IFREG | 0o644)) << 16
            if entry["directory"]:
                output.writestr(info, b"")
                continue
            digest, size = hashlib.sha256(), 0
            with bundle.open(entry["name"]) as incoming, output.open(info, "w") as outgoing:
                for block in iter(lambda: incoming.read(1024 * 1024), b""):
                    size += len(block)
                    if size > entry["bytes"]:
                        raise ValueError("Skill member exceeds central directory size")
                    digest.update(block)
                    outgoing.write(block)
            if size != entry["bytes"]:
                raise ValueError("Skill member size mismatch")
            members.append({"path": relative, "source_member": entry["normalized"], "bytes": size, "sha256": digest.hexdigest()})
    os.replace(temporary, destination)
    # Verify each repacked file, including opaque nested ZIPs, against its original bytes.
    with zipfile.ZipFile(destination) as checked:
        package_files = [info for info in checked.infolist() if not info.is_dir()]
        if len(package_files) != len(members):
            raise ValueError("repacked Skill file count differs")
        for member in members:
            digest = hashlib.sha256()
            with checked.open(member["path"]) as incoming:
                for block in iter(lambda: incoming.read(1024 * 1024), b""):
                    digest.update(block)
            if digest.hexdigest() != member["sha256"]:
                raise ValueError("repacked Skill member digest differs")
    metadata = file_metadata(root, destination)
    row = {"id": sample, "package_path": metadata["path"], "package_sha256": metadata["sha256"], "package_bytes": metadata["bytes"], "file_count": len(members), "uncompressed_bytes": sum(item["bytes"] for item in members), "ground_truth": expected, PROVENANCE: {"archive": archive["archive"], "archive_sha256": archive["sha256"], "member_prefix": prefix, "source_id_field": "sample_folder", "source_id": sample}}
    return row, {**metadata, "source_prefix": prefix, "members": members}


def verify_staged_repo(root: Path, manifest: dict) -> None:
    expected = {item["path"]: item for item in manifest["files"]}
    actual = {item.relative_to(root).as_posix() for item in root.rglob("*") if item.is_file() and item != root / "bundle-manifest.json"}
    if actual != set(expected):
        raise ValueError(f"staging file inventory differs: {root.name}")
    for relative, item in expected.items():
        filename = controlled_path(root, relative)
        if filename.stat().st_size != item["bytes"] or sha256_file(filename) != item["sha256"]:
            raise ValueError(f"staged file digest mismatch: {relative}")
    data = root / "data/samples.jsonl"
    identities = set()
    with data.open("rb") as stream:
        for _, row in records(stream):
            if row["id"] in identities or row[PROVENANCE]["archive_sha256"] != manifest["source_archive"]["sha256"]:
                raise ValueError("normalized identity/provenance validation failed")
            identities.add(row["id"])
    if len(identities) != manifest["rows"]:
        raise ValueError("normalized staged count differs")


def stage_archives(report: dict, output: Path) -> dict:
    if any(not item["safe"] for item in report["archives"]):
        raise ValueError("unsafe archive: staging refused")
    if {item["archive"] for item in report["archives"]} != set(SPECS):
        raise ValueError("source archives differ from the four approved bundles")
    plan = {"version": 1, "normalization": "canonical-jsonl-provenance-v1", "specs": SPECS}
    plan_hash = hashlib.sha256(json.dumps(plan, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    stage = controlled_path(output, "staged/" + plan_hash[:16])
    stage.mkdir(parents=True, exist_ok=True)
    plan_path = stage / "stage-state.json"
    if plan_path.exists():
        state = strict_json(plan_path.read_text(encoding="utf-8"))
        if state.get("plan_sha256") != plan_hash:
            raise ValueError("existing staging plan is not owned by this import")
    else:
        if any(stage.iterdir()):
            raise ValueError("nonempty staging directory lacks ownership manifest")
        state = {"version": 1, "plan_sha256": plan_hash, "status": "preparing", "repositories": []}
        write_json_atomic(plan_path, state)
    for archive in report["archives"]:
        spec = SPECS[archive["archive"]]
        if archive["sha256"] != spec["sha256"]:
            raise ValueError("source ZIP changed after the approved profile")
        root = controlled_path(stage, spec["repo"])
        root.mkdir(parents=True, exist_ok=True)
        manifest_path = root / "bundle-manifest.json"
        if manifest_path.exists():
            manifest = strict_json(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("plan_sha256") != plan_hash:
                raise ValueError("existing repository staging is not owned by this plan")
            verify_staged_repo(root, manifest)
            if not any(item["name"] == spec["repo"] for item in state["repositories"]):
                state["repositories"].append({"name": spec["repo"], "path": str(root), "rows": manifest["rows"], "manifest_sha256": sha256_file(manifest_path)})
                write_json_atomic(plan_path, state)
            continue
        archive_copy = controlled_path(root, "source/archives/" + safe_member_name(archive["archive"]))
        copy_verified(Path(archive["source"]), archive_copy, archive["sha256"])
        data = controlled_path(root, "data/samples.jsonl")
        data.parent.mkdir(parents=True, exist_ok=True)
        data_temporary = data.with_suffix(".jsonl.partial")
        controlled_path(root, str(data_temporary.relative_to(root)))
        raw_files, packages, rows, identities = [], [], 0, set()
        derive_id = spec["repo"] == "benchmark-behavior-drift"
        with zipfile.ZipFile(archive_copy) as bundle, data_temporary.open("w", encoding="utf-8", newline="\n") as normalized:
            if spec["repo"] == "benchmark-skills":
                groups: dict[str, list[dict]] = collections.defaultdict(list)
                for entry in archive["entries"]:
                    parts = PurePosixPath(entry["normalized"]).parts
                    if len(parts) >= 2 and parts[0] == "packages":
                        groups[parts[1]].append(entry)
                    elif not entry["directory"]:
                        raise ValueError("unexpected Skill file outside a sample folder")
                for sample, entries in sorted(groups.items()):
                    if not re.fullmatch(r"skill-\d{6}", sample):
                        raise ValueError("unexpected Skill sample folder id")
                    row, package = skill_package(bundle, archive, sample, entries, root)
                    dump_line(normalized, row)
                    packages.append(package)
                    rows += 1
            else:
                members = [entry for entry in archive["entries"] if not entry["directory"]]
                jsonl = [entry for entry in members if entry["normalized"].lower().endswith(".jsonl")]
                if len(jsonl) != 1:
                    raise ValueError("each plain bundle must contain exactly one JSONL dataset")
                for entry in members:
                    raw_files.append(extract_member(bundle, entry, root))
                with bundle.open(jsonl[0]["name"]) as stream:
                    for line, original in records(stream):
                        row = normalized_row(original, archive, jsonl[0]["normalized"], line, derive_id)
                        if row["id"] in identities:
                            raise ValueError("source dataset contains duplicate canonical IDs")
                        identities.add(row["id"])
                        dump_line(normalized, row)
                        rows += 1
        if rows != spec["rows"]:
            raise ValueError("staged row count differs from approved source profile")
        os.replace(data_temporary, data)
        if sha256_file(Path(archive["source"])) != archive["sha256"]:
            raise ValueError("original source archive changed during staging")
        # Verify source records semantically identical after removing only our additions.
        if spec["repo"] != "benchmark-skills":
            with zipfile.ZipFile(archive_copy) as bundle, bundle.open(jsonl[0]["name"]) as source_stream, data.open("rb") as normalized_stream:
                source_iterator, normalized_iterator = iter(records(source_stream)), iter(records(normalized_stream))
                for source_line, original in source_iterator:
                    normalized_line, imported = next(normalized_iterator)
                    if imported != normalized_row(original, archive, jsonl[0]["normalized"], source_line, derive_id):
                        raise ValueError("normalized content differs from original source")
                if next(normalized_iterator, None) is not None:
                    raise ValueError("normalized dataset has unexpected extra rows")
        manifest = {"version": 1, "plan_sha256": plan_hash, "namespace": "local", "repository": spec["repo"], "visibility": "private", "canonical_data": "data/samples.jsonl", "rows": rows,
                    "source_archive": {key: archive[key] for key in ("archive", "sha256", "bytes", "files", "uncompressedBytes")},
                    "normalization": {"reserved_provenance_field": PROVENANCE, "id_mapping": "uid -> id; original uid preserved; uniqueness verified" if derive_id else ("sample folder -> id" if packages else "original id preserved"), "original_record_fields": "preserved without overwrite", "skill_zip_policy": "each folder becomes a ZIP with original relative file bytes, opaque nested ZIPs, fixed 1980 timestamp and regular 0644 file permissions" if packages else None},
                    "raw_files": raw_files, "packages": packages,
                    "files": [file_metadata(root, item) for item in sorted(root.rglob("*")) if item.is_file()]}
        write_json_atomic(manifest_path, manifest)
        verify_staged_repo(root, manifest)
        state["repositories"].append({"name": spec["repo"], "path": str(root), "rows": rows, "manifest_sha256": sha256_file(manifest_path)})
        write_json_atomic(plan_path, state)
    state["status"] = "validated"
    write_json_atomic(plan_path, state)
    write_json_atomic(output / "staging.json", {"stage": str(stage), **state})
    return {"stage": str(stage), **state}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, required=DEFAULT_SOURCE is None,
                        help="Local benchmark directory (or set OXEN_BENCHMARK_SOURCE). Never included in the source release.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--profile", action="store_true", help="After central checks, count JSONL/schema and Skill-folder metadata; never execute members.")
    parser.add_argument("--stage", action="store_true", help="Safely stage the four approved bundles and verify exact source/repacked bytes; no Oxen writes.")
    args = parser.parse_args()
    report = inventory(args.source, args.output)
    if args.stage:
        print(json.dumps(stage_archives(report, args.output.resolve()), ensure_ascii=False, indent=2))
        return 0
    if args.profile:
        print(json.dumps(inspect_profiles(report, args.output), ensure_ascii=False, indent=2))
        return 0
    summary = [{key: value for key, value in item.items() if key != "entries"} | {"firstPaths": [entry["normalized"] for entry in item["entries"][:25]]} for item in report["archives"]]
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if all(item["safe"] for item in report["archives"]) else 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
