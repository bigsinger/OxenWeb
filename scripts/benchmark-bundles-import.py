#!/usr/bin/env python3
"""Import the four validated benchmark bundles using the pinned official Oxen CLI.

Only loopback services are accepted. Source members remain inert data. Writes are
restricted to four newly created, private repositories recorded in durable state.
Re-run the same command to resume; never discard an unknown clone or remote head.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("benchmark_bundles", Path(__file__).with_name("benchmark-bundles.py"))
bundle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bundle)
ROOT = bundle.PROJECT
OUTPUT = bundle.DEFAULT_OUTPUT
ANSI = re.compile(r"\x1b\[[0-9;]*m")
MAX_API_BYTES = 70 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError("local benchmark requests must not redirect or transmit data elsewhere")


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


class Importer:
    def __init__(self, args):
        self.bff = self.loopback(args.bff)
        self.upstream = self.loopback(args.upstream)
        self.binary = args.cli.resolve(strict=True)
        self.environment = dict(os.environ, OXEN_CONFIG_DIR=str(args.config.resolve(strict=True)))
        self.token = os.environ.get("BFF_TOKEN", "")
        self.http = urllib.request.build_opener(NoRedirect())
        self.staging = bundle.strict_json((OUTPUT / "staging.json").read_text(encoding="utf-8"))
        if self.staging["status"] != "validated" or len(self.staging["repositories"]) != 4:
            raise ValueError("four approved bundles must be staged and validated first")
        self.state_path = OUTPUT / "import-state.json"
        if self.state_path.exists():
            self.state = bundle.strict_json(self.state_path.read_text(encoding="utf-8"))
            if self.state.get("plan_sha256") != self.staging["plan_sha256"] or self.state.get("bff") != self.bff or self.state.get("upstream") != self.upstream:
                raise ValueError("existing import state does not match this plan/service")
        else:
            self.state = {"version": 1, "plan_sha256": self.staging["plan_sha256"], "operation_id": str(uuid.uuid4()), "bff": self.bff, "upstream": self.upstream, "repositories": {}, "status": "preparing"}
            self.save()
        self.marker = "Benchmark bundle import " + self.state["operation_id"]

    @staticmethod
    def loopback(url: str) -> str:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("benchmark imports require an explicit credential-free loopback HTTP service")
        return url.rstrip("/")

    def save(self):
        bundle.write_json_atomic(self.state_path, self.state)

    def api(self, path: str, *, body: dict | None = None, maximum: int = MAX_API_BYTES, raw: bool = False):
        headers = {"X-Oxen-Request": "web", "Accept": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.bff + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method="POST" if body is not None else "GET")
        try:
            with self.http.open(request, timeout=300) as response:
                data = response.read(maximum + 1)
                if len(data) > maximum:
                    raise ValueError("local API response exceeds bounded read limit")
                return data if raw else bundle.strict_json(data.decode("utf-8"))
        except urllib.error.HTTPError as error:
            # Never echo sample text or bearer credentials from a response.
            data = error.read(4096)
            try:
                code = json.loads(data).get("error", {}).get("code", "HTTP_ERROR")
            except (ValueError, AttributeError):
                code = "HTTP_ERROR"
            raise RuntimeError(f"local API {error.code} {code}: {urllib.parse.urlsplit(path).path}") from None

    def cli(self, args: list[str], cwd: Path, timeout: int = 300) -> str:
        # Argument arrays, shell=False, bounded diagnostics: sample names/text are never commands.
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen([str(self.binary), *args], cwd=cwd, env=self.environment, shell=False, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT)
            started = time.monotonic()
            while process.poll() is None:
                if time.monotonic() - started > timeout or output.tell() > 2 * 1024 * 1024:
                    process.kill()
                    process.wait()
                    raise RuntimeError(f"Oxen {args[0]} exceeded time/output limit")
                time.sleep(0.1)
            output.seek(0)
            data = output.read(2 * 1024 * 1024 + 1)
        if len(data) > 2 * 1024 * 1024:
            raise RuntimeError(f"Oxen {args[0]} exceeded output limit")
        text = ANSI.sub("", data.decode("utf-8", errors="replace"))
        if process.returncode:
            diagnostic = OUTPUT / "logs" / f"{cwd.name}-{args[0]}-failure.txt"
            bundle.controlled_path(OUTPUT, str(diagnostic.relative_to(OUTPUT)))
            diagnostic.parent.mkdir(parents=True, exist_ok=True)
            diagnostic.write_text(text, encoding="utf-8")
            raise RuntimeError(f"Oxen {args[0]} exited {process.returncode}; local diagnostics: {diagnostic}")
        return text

    def head(self, clone: Path) -> str:
        text = self.cli(["log", "--revision", "main", "-n", "1"], clone).lstrip().splitlines()[0]
        match = re.fullmatch(r"commit ([a-f0-9]{1,32})\s*", text)
        if not match:
            raise ValueError("official CLI did not identify the local main head")
        return match[1]

    def remote_head(self, name: str) -> str:
        branches = self.api(f"/api/repos/local/{name}/branches")
        main = next((entry for entry in branches if entry["name"] == "main"), None)
        if not main or not re.fullmatch(r"[a-f0-9]{1,32}", main["commitId"]):
            raise ValueError("remote main head is missing or invalid")
        return main["commitId"]

    def assert_origin(self, clone: Path, name: str):
        text = self.cli(["remote", "-v"], clone)
        origin = next((line.split()[1] for line in text.splitlines() if len(line.split()) >= 2 and line.split()[0] == "origin"), None)
        if origin != f"{self.upstream}/local/{name}":
            raise ValueError("clone origin does not match the approved local repository")

    def assert_clean(self, clone: Path):
        if not re.search(r"^nothing to commit, working tree clean\s*$", self.cli(["status"], clone), re.M):
            raise ValueError("clone is not clean; no unknown changes will be discarded")

    def raw_digest(self, name: str, revision: str, relative: str, expected: dict):
        query = urllib.parse.urlencode({"ref": revision, "path": relative})
        data = self.api(f"/api/repos/local/{name}/raw?{query}", maximum=max(expected["bytes"], 4096), raw=True)
        if len(data) != expected["bytes"] or hashlib.sha256(data).hexdigest() != expected["sha256"]:
            raise ValueError(f"remote immutable readback digest differs: {name}/{relative}")

    def run_repository(self, planned: dict):
        name = planned["name"]
        if name not in {value["repo"] for value in bundle.SPECS.values()}:
            raise ValueError("repository is outside the four approved new names")
        stage = bundle.controlled_path(OUTPUT, str(Path(planned["path"]).absolute().relative_to(OUTPUT.absolute())))
        manifest_path = stage / "bundle-manifest.json"
        if bundle.sha256_file(manifest_path) != planned["manifest_sha256"]:
            raise ValueError("staged manifest changed")
        manifest = bundle.strict_json(manifest_path.read_text(encoding="utf-8"))
        bundle.verify_staged_repo(stage, manifest)
        record = self.state["repositories"].get(name)
        if not record:
            existing = self.api("/api/repos?namespace=local")
            if any(item["name"] == name for item in existing):
                raise ValueError("target repository already exists without this import's ownership state")
            record = {"status": "creating", "manifest_sha256": planned["manifest_sha256"], "rows": planned["rows"], "source_archive_sha256": manifest["source_archive"]["sha256"]}
            self.state["repositories"][name] = record
            self.save()
        if record["manifest_sha256"] != planned["manifest_sha256"]:
            raise ValueError("resumed repository belongs to a different staging manifest")
        if record["status"] == "complete":
            # Later template commits may advance main. Verify our immutable import revision.
            self.raw_digest(name, record["pushed_commit"], "bundle-manifest.json", {"bytes": manifest_path.stat().st_size, "sha256": planned["manifest_sha256"]})
            emit({"repository": f"local/{name}", "status": "already-complete", "commit": record["pushed_commit"], "rows": planned["rows"]})
            return
        if record["status"] == "creating":
            existing = self.api("/api/repos?namespace=local")
            remote = next((item for item in existing if item["name"] == name), None)
            if remote is None:
                remote = self.api("/api/repos", body={"namespace": "local", "name": name, "description": self.marker, "visibility": "private"})
            if remote.get("description") != self.marker or remote.get("visibility") != "private":
                raise ValueError("repository creation/ownership/private policy could not be verified")
            record.update({"status": "created", "base_commit": self.remote_head(name)})
            self.save()
        clone_parent = bundle.controlled_path(OUTPUT, "clones")
        clone_parent.mkdir(parents=True, exist_ok=True)
        clone = bundle.controlled_path(clone_parent, name)
        if not clone.exists():
            if record["status"] != "created":
                raise ValueError("owned clone missing after staging began; manual recovery required")
            self.cli(["clone", f"{self.upstream}/local/{name}", name, "--branch", "main"], clone_parent)
        self.assert_origin(clone, name)
        if record["status"] == "created":
            self.assert_clean(clone)
            if self.head(clone) != record["base_commit"] or self.remote_head(name) != record["base_commit"]:
                raise ValueError("new repository head changed before staging")
            record["status"] = "copying"
            self.save()
        files = manifest["files"] + [{"path": "bundle-manifest.json", "bytes": manifest_path.stat().st_size, "sha256": planned["manifest_sha256"]}]
        if record["status"] in {"copying", "copied"}:
            if self.head(clone) != record["base_commit"] or self.remote_head(name) != record["base_commit"]:
                raise ValueError("repository head changed while copying import data")
            # Unknown files under import-owned roots stop a resume. Never erase them.
            allowed = {item["path"] for item in files}
            actual = set()
            for top in ("source", "data", "packages", "bundle-manifest.json"):
                entry = bundle.controlled_path(clone, top)
                if entry.is_file():
                    actual.add(top)
                elif entry.is_dir():
                    actual.update(item.relative_to(clone).as_posix() for item in entry.rglob("*") if item.is_file())
            if not actual <= allowed:
                raise ValueError("clone contains unexpected files in import-owned directories")
            for item in files:
                destination = bundle.controlled_path(clone, item["path"])
                if destination.exists() and bundle.sha256_file(destination) != item["sha256"]:
                    raise ValueError("clone contains a modified import file; refusing overwrite")
                bundle.copy_verified(stage / item["path"], destination, item["sha256"])
            record["status"] = "copied"
            self.save()
            self.cli(["add", "."], clone)
            self.cli(["commit", "-m", f"Import benchmark bundle {manifest['source_archive']['sha256'][:12]} ({planned['rows']} samples)"], clone)
            record.update({"status": "committed", "local_commit": self.head(clone)})
            self.save()
        if record["status"] == "committed":
            self.assert_clean(clone)
            if self.head(clone) != record["local_commit"]:
                raise ValueError("local import commit changed before push")
            remote_head = self.remote_head(name)
            if remote_head not in {record["base_commit"], record["local_commit"]}:
                raise ValueError("remote main changed; compare-and-swap precondition failed")
            if remote_head == record["base_commit"]:
                self.cli(["push", "origin", "main"], clone, timeout=600)
            if self.remote_head(name) != record["local_commit"]:
                raise ValueError("remote main does not equal the official CLI import commit")
            record.update({"status": "pushed", "pushed_commit": record["local_commit"]})
            self.save()
        if record["status"] == "pushed":
            commit = record["pushed_commit"]
            self.raw_digest(name, commit, "bundle-manifest.json", {"bytes": manifest_path.stat().st_size, "sha256": planned["manifest_sha256"]})
            canonical = next(item for item in files if item["path"] == "data/samples.jsonl")
            self.raw_digest(name, commit, canonical["path"], canonical)
            source_zip = next(item for item in files if item["path"].startswith("source/archives/"))
            self.raw_digest(name, commit, source_zip["path"], source_zip)
            # A table view verifies server-side JSONL interpretation; records are never printed.
            query = urllib.parse.urlencode({"ref": commit, "path": "data/samples.jsonl", "page": 1, "pageSize": 1})
            view = self.api(f"/api/repos/local/{name}/file?{query}")
            if view.get("kind") != "table" or view.get("totalRows") != planned["rows"]:
                raise ValueError("server-side JSONL preview count differs from the validated source")
            record.update({"status": "complete", "canonical_sha256": canonical["sha256"], "canonical_bytes": canonical["bytes"], "file_count": len(files), "readback": {"canonical_sha256": True, "original_archive_sha256": True, "manifest_sha256": True, "file_kind": view.get("kind"), "file_total_rows": view.get("totalRows")}})
            self.save()
            emit({"repository": f"local/{name}", "status": "complete", "commit": commit, "rows": planned["rows"], "files": len(files), "canonical_sha256": canonical["sha256"]})

    def run(self):
        health = self.api("/api/health", maximum=4096)
        if health.get("mode") != "live" or not health.get("ready"):
            raise ValueError("a ready live local Oxen service is required")
        for repo in self.staging["repositories"]:
            self.run_repository(repo)
        self.state["status"] = "complete"
        self.save()
        emit({"status": "complete", "repositories": len(self.staging["repositories"]), "rows": sum(item["rows"] for item in self.staging["repositories"]), "state": str(self.state_path)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bff", default="http://127.0.0.1:3001")
    parser.add_argument("--upstream", default="http://127.0.0.1:3002")
    parser.add_argument("--cli", type=Path, default=ROOT / "infra/oxen/bin/oxen.exe")
    parser.add_argument("--config", type=Path, default=ROOT / "infra/oxen/config/client")
    Importer(parser.parse_args()).run()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
