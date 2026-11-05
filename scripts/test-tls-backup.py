#!/usr/bin/env python3
"""Backup/restore local HTTPS contracts with Docker command stubs; no daemon or database."""
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LocalTlsBackup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "checkout"
        self.scripts = self.repo / "scripts"
        self.scripts.mkdir(parents=True)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.backups = self.root / "backups"
        self.log = self.root / "commands.jsonl"
        self.restored = self.root / "restored"
        for name in ["backup.sh", "restore.sh", "lib.sh"]:
            shutil.copyfile(ROOT / "scripts" / name, self.scripts / name)
        self.mode("local-https")
        self.fixture = self.root / "authority"
        authority = self.fixture / "data/caddy/pki/authorities/local"
        authority.mkdir(parents=True)
        (authority / "root.crt").write_text("test-only-public-authority\n")
        (authority / "root.key").write_text("test-only-private-authority\n")
        (authority / "root.key").chmod(0o600)
        (self.fixture / "config").mkdir()
        (self.fixture / "config/autosave.json").write_text('{"test":true}')
        stub = self.bin / "docker"
        stub.write_text(f"#!{sys.executable}\n" + r'''
import json, os, pathlib, subprocess, sys
args = sys.argv[1:]
with open(os.environ["TEST_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")
if args[0] == "compose":
    args = args[1:]
    while args and args[0] in ("--project-directory", "--env-file", "-f", "--file"):
        args = args[2:]
    if args[:2] == ["ps", "-aq"]:
        if args[2] != "caddy" or os.environ.get("MISSING_CADDY") != "1":
            print(args[2] + "-container")
    elif args[:4] == ["exec", "-T", "db", "pg_dump"]:
        sys.stdout.buffer.write(b"test-only-dump")
    elif args[:4] == ["exec", "-T", "db", "pg_restore"]:
        sys.stdin.buffer.read()
    elif args[:4] == ["exec", "-T", "db", "psql"]:
        sys.stdin.buffer.read()
elif args[0] == "run":
    mounts = [args[i+1] for i, value in enumerate(args) if value == "-v"]
    if "caddy:2.11.8-alpine" in args:
        if any(value.endswith(":/out") for value in mounts):
            work = next(value[:-5] for value in mounts if value.endswith(":/out"))
            subprocess.run(["tar", "-czf", work + "/local-tls.tar.gz", "-C", os.environ["TEST_FIXTURE"], "data", "config"], check=True)
        else:
            work = next(value[:-7] for value in mounts if value.endswith(":/in:ro"))
            destination = pathlib.Path(os.environ["TEST_RESTORED"])
            destination.mkdir()
            subprocess.run(["tar", "-xzpf", work + "/local-tls.tar.gz", "-C", str(destination)], check=True)
    elif any(value.endswith(":/out") for value in mounts):
        work = next(value[:-5] for value in mounts if value.endswith(":/out"))
        with open(work + "/storage.tar.gz", "wb") as handle:
            handle.write(b"storage-fixture")
''')
        stub.chmod(0o755)
        self.env = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"], "ALLUMI_DIR": str(self.repo), "ENV_FILE": str(self.repo / ".env"), "TEST_LOG": str(self.log), "TEST_FIXTURE": str(self.fixture), "TEST_RESTORED": str(self.restored)}

    def mode(self, network):
        (self.repo / ".env").write_text(f"ALLUMI_NETWORK_MODE={network}\nBACKUP_DIR={self.backups}\nAPP_URL=https://192.0.2.1:28443\n")

    def run_script(self, name, *arguments, **env):
        return subprocess.run(["bash", str(self.scripts / name), *map(str, arguments)], env={**self.env, **env}, input="oui\n", text=True, capture_output=True, timeout=15)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def backup(self):
        result = self.run_script("backup.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        return next(self.backups.glob("allumi-*.tar"))

    def archive(self, member=None, link=False):
        archive = self.root / "restore.tar"
        with tarfile.open(archive, "w") as outer:
            content = b"test-only-dump"
            info = tarfile.TarInfo("db.dump")
            info.size = len(content)
            outer.addfile(info, io.BytesIO(content))
            if member:
                tls = io.BytesIO()
                with tarfile.open(fileobj=tls, mode="w:gz") as inner:
                    info = tarfile.TarInfo(member)
                    if link:
                        info.type = tarfile.SYMTYPE
                        info.linkname = "/etc"
                        inner.addfile(info)
                    else:
                        info.size = 1
                        inner.addfile(info, io.BytesIO(b"x"))
                info = tarfile.TarInfo("local-tls.tar.gz")
                info.size = len(tls.getvalue())
                outer.addfile(info, io.BytesIO(tls.getvalue()))
        return archive

    def test_local_backup_is_private_and_round_trip_preserves_the_authority_before_start(self):
        archive = self.backup()
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        with tarfile.open(archive) as handle:
            self.assertIn("./local-tls.tar.gz", handle.getnames())
            self.assertNotIn("./.env", handle.getnames())
        calls = self.calls()
        helper = next(call for call in calls if "caddy:2.11.8-alpine" in call)
        self.assertEqual(helper[helper.index("--volumes-from") + 1], "caddy-container:ro")
        self.log.write_text("")
        result = self.run_script("restore.sh", archive)
        self.assertEqual(result.returncode, 0, result.stderr)
        authority = "data/caddy/pki/authorities/local/"
        self.assertEqual((self.fixture / authority / "root.key").read_bytes(), (self.restored / authority / "root.key").read_bytes())
        self.assertEqual((self.fixture / authority / "root.crt").read_bytes(), (self.restored / authority / "root.crt").read_bytes())
        self.assertEqual((self.fixture / "config/autosave.json").read_bytes(), (self.restored / "config/autosave.json").read_bytes())
        self.assertEqual((self.restored / authority / "root.key").stat().st_mode & 0o777, 0o600)
        commands = self.calls()
        stop = next(i for i, args in enumerate(commands) if args[-2:] == ["stop", "caddy"])
        database = next(i for i, args in enumerate(commands) if "psql" in args)
        create = next(i for i, args in enumerate(commands) if args[-3:] == ["create", "--no-deps", "caddy"])
        restore = next(i for i, args in enumerate(commands) if "caddy:2.11.8-alpine" in args)
        start = next(i for i, args in enumerate(commands) if args[-2:] == ["up", "-d"])
        self.assertLess(stop, database)
        self.assertLess(create, restore)
        self.assertLess(restore, start)
        self.assertNotIn("test-only-private-authority", result.stdout + result.stderr)

    def test_direct_mode_does_not_archive_or_touch_caddy_and_accepts_legacy_backup(self):
        self.mode("direct")
        archive = self.backup()
        with tarfile.open(archive) as handle:
            self.assertNotIn("./local-tls.tar.gz", handle.getnames())
        self.assertFalse(any("caddy" in json.dumps(call) for call in self.calls()))
        self.log.write_text("")
        result = self.run_script("restore.sh", self.archive())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any("caddy" in json.dumps(call) for call in self.calls()))

    def test_missing_caddy_does_not_produce_a_partial_successful_backup(self):
        result = self.run_script("backup.sh", MISSING_CADDY="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.backups.glob("allumi-*")), [])

    def test_local_restore_rejects_missing_invalid_or_unsafe_authority_before_any_docker_mutation(self):
        for name, link in [(None, False), ("../../escape", False), ("/data/root.key", False), ("storage/file", False), ("data/link", True), ("data/missing-authority", False)]:
            with self.subTest(name=name, link=link):
                self.log.write_text("")
                result = self.run_script("restore.sh", self.archive(name, link))
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main()
