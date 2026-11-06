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
        # Model the read-only merged-config check, without Docker or a real local authority.
        (self.scripts / "enable-local-https.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
printf '["tls-preflight","%s"]\\n' "$1" >> "$TEST_LOG"
[ "$1" = --check ]
[ "${TEST_INVALID_TLS:-0}" = 0 ]
""")
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
            assert pathlib.Path(work).stat().st_mode & 0o077 == 0
            assert (pathlib.Path(work) / "local-tls.tar.gz").stat().st_mode & 0o077 == 0
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
        check = next(i for i, args in enumerate(commands) if args == ["tls-preflight", "--check"])
        self.assertLess(check, stop)
        self.assertLess(stop, database)
        self.assertLess(create, restore)
        self.assertLess(restore, start)
        storage = next(args for args in commands if "alpine:3" in args and args[0] == "run")
        self.assertTrue(any(value.endswith(":/in:ro") for value in storage))
        self.assertNotIn("test-only-private-authority", result.stdout + result.stderr)

    def test_unknown_network_mode_is_rejected_before_stopping_or_replacing_data(self):
        self.mode("local-https-typo")
        result = self.run_script("restore.sh", self.archive())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Mode réseau inconnu", result.stderr)
        self.assertEqual(self.calls(), [])

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

    def test_permissive_outer_modes_cannot_expose_the_private_restore_workspace(self):
        original = self.backup()
        archive = self.root / "permissive.tar"
        with tarfile.open(original) as source, tarfile.open(archive, "w") as target:
            for member in source:
                member.mode = 0o777
                target.addfile(member, source.extractfile(member) if member.isfile() else None)
        result = self.run_script("restore.sh", archive)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.restored / "data/caddy/pki/authorities/local/root.key").stat().st_mode & 0o777, 0o600)

    def test_invalid_tls_configuration_stops_before_services_or_database_are_touched(self):
        archive = self.backup()
        self.log.write_text("")
        result = self.run_script("restore.sh", archive, TEST_INVALID_TLS="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [["tls-preflight", "--check"]])
        self.assertFalse(self.restored.exists())

    def test_outer_archive_rejects_traversal_links_special_files_and_duplicate_payloads(self):
        self.mode("direct")
        for name, kind in [("../escape", tarfile.REGTYPE), (str(self.root / "escape"), tarfile.REGTYPE), (".env", tarfile.REGTYPE), ("db.dump", tarfile.SYMTYPE), ("storage.tar.gz", tarfile.LNKTYPE), ("local-tls.tar.gz", tarfile.FIFOTYPE), ("db.dump", tarfile.DIRTYPE), ("./db.dump", tarfile.REGTYPE), ("nested/db.dump", tarfile.REGTYPE)]:
            with self.subTest(name=name, kind=kind):
                archive = self.archive()
                with tarfile.open(archive, "a") as outer:
                    info = tarfile.TarInfo(name)
                    info.type = kind
                    if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                        info.linkname = str(self.root)
                    if kind == tarfile.REGTYPE:
                        info.size = 1
                        outer.addfile(info, io.BytesIO(b"x"))
                    else:
                        outer.addfile(info)
                self.log.write_text("")
                result = self.run_script("restore.sh", archive)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])
                self.assertFalse((self.root / "escape").exists())

    def test_encrypted_backup_uses_existing_age_contract_before_validation(self):
        self.mode("direct")
        archive = self.archive()
        encrypted = self.root / "restore.tar.age"
        shutil.copyfile(archive, encrypted)
        key = self.root / "test-age-key"
        key.write_text("test-only-key")
        age = self.bin / "age"
        age.write_text(f"#!{sys.executable}\n" + """import json, os, shutil, sys
args = sys.argv[1:]
with open(os.environ["TEST_LOG"], "a") as log: log.write(json.dumps(["age", *args]) + "\\n")
assert args[:2] == ["-d", "-i"]
shutil.copyfile(args[-1], args[args.index("-o") + 1])
""")
        age.chmod(0o755)
        result = self.run_script("restore.sh", encrypted, key)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls()[0][:4], ["age", "-d", "-i", str(key)])

    def test_local_restore_rejects_missing_invalid_or_unsafe_authority_before_any_docker_mutation(self):
        for name, link in [(None, False), ("../../escape", False), ("/data/root.key", False), ("storage/file", False), ("data/link", True), ("data/missing-authority", False)]:
            with self.subTest(name=name, link=link):
                self.log.write_text("")
                result = self.run_script("restore.sh", self.archive(name, link))
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main()
