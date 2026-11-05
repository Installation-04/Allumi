#!/usr/bin/env python3
"""Host helper contract using an isolated checkout and command stubs; no root or Docker."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = """services:
  app:
    environment:
      ALLUMI_UPDATE_DIR: /app/storage/update-control
    volumes:
      - /var/lib/allumi-update:/app/storage/update-control
"""


class EnableWebUpdates(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.checkout = self.root / "checkout"
        self.bin = self.root / "bin"
        self.host = self.root / "host"
        (self.checkout / "scripts").mkdir(parents=True)
        self.bin.mkdir()
        (self.host / "etc/systemd/system").mkdir(parents=True)
        (self.host / "usr/local/sbin").mkdir(parents=True)
        self.log = self.root / "commands.log"
        self.override = self.checkout / "compose.override.yaml"
        self.control = self.host / "var/lib/allumi-update"
        self.agent = self.host / "usr/local/sbin/allumi-update-agent"
        # Remap privileged absolute destinations only in the disposable script copy.
        # The production helper has no environment switch for arbitrary host paths.
        script = (ROOT / "scripts/enable-web-updates.sh").read_text()
        for prefix in ["/var/lib/allumi-update", "/usr/local/sbin/allumi-update-agent", "/etc/systemd/system"]:
            script = script.replace(prefix, str(self.host) + prefix)
        (self.checkout / "scripts/enable-web-updates.sh").write_text(script)
        shutil.copyfile(ROOT / "scripts/lib.sh", self.checkout / "scripts/lib.sh")
        (self.checkout / "scripts/update-agent.py").write_text("reviewed agent version one\n")
        (self.checkout / ".env").write_text("APP_URL=http://localhost:28080\n")
        for utility in ["dirname", "cat", "cmp", "mktemp", "chmod", "ln", "rm"]:
            (self.bin / utility).symlink_to(shutil.which(utility))
        (self.bin / "python3").symlink_to(sys.executable)
        self.stub("id", "#!/bin/sh\nprintf '%s\\n' \"${TEST_UID:-0}\"\n")
        self.stub("systemctl", """#!/bin/sh
printf 'systemctl %s\n' "$*" >> "$TEST_COMMAND_LOG"
if [ "$1" = show ]; then
  [ "${TEST_SYSTEMD_DOWN:-0}" = 0 ] || exit 1
  printf '%s\n' 255
fi
""")
        self.stub("docker", """#!/bin/sh
printf 'docker %s\n' "$*" >> "$TEST_COMMAND_LOG"
[ "${TEST_DOCKER_FAIL:-0}" = 0 ]
""")
        self.stub("chown", "#!/bin/sh\nprintf 'chown %s\\n' \"$*\" >> \"$TEST_COMMAND_LOG\"\n")
        self.stub("install", f"#!{sys.executable}\n" + """import os,pathlib,shutil,sys
args=sys.argv[1:]
with open(os.environ['TEST_COMMAND_LOG'],'a') as handle: handle.write('install '+' '.join(args)+'\\n')
if args[0]=='-d':
    pathlib.Path(args[-1]).mkdir(parents=True,exist_ok=True)
    os.chmod(args[-1],int(args[2],8))
else:
    shutil.copyfile(args[-2],args[-1])
    os.chmod(args[-1],int(args[1],8))
""")
        self.env = {**os.environ, "PATH": str(self.bin), "ALLUMI_DIR": str(self.checkout), "ENV_FILE": str(self.checkout / ".env"), "TEST_COMMAND_LOG": str(self.log)}

    def stub(self, name, content):
        path = self.bin / name
        if path.is_symlink():
            path.unlink()
        path.write_text(content)
        path.chmod(0o755)

    def run_helper(self, *args, **env):
        return subprocess.run(["/bin/bash", str(self.checkout / "scripts/enable-web-updates.sh"), *args], env={**self.env, **env}, text=True, capture_output=True, timeout=10)

    def mutations(self):
        lines = self.log.read_text().splitlines() if self.log.exists() else []
        return [line for line in lines if not line.startswith("systemctl show ")]

    def assert_no_mutations(self):
        self.assertEqual(self.mutations(), [])
        self.assertFalse(self.control.exists())
        self.assertFalse(self.agent.exists())
        self.assertEqual(list((self.host / "etc/systemd/system").iterdir()), [])

    def test_first_activation_and_repeat_refresh_only_the_generated_configuration(self):
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = EXPECTED.replace("/var/lib/allumi-update", str(self.control))
        self.assertEqual(self.override.read_text(), expected)
        first_inode = self.override.stat().st_ino
        self.assertEqual(self.agent.read_text(), "reviewed agent version one\n")
        self.assertEqual(self.agent.stat().st_mode & 0o777, 0o755)
        (self.checkout / "scripts/update-agent.py").write_text("reviewed agent version two\n")
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.override.stat().st_ino, first_inode)
        self.assertEqual(self.agent.read_text(), "reviewed agent version two\n")
        self.assertIn("systemctl enable --now allumi-update.timer", self.mutations())
        self.assertTrue(any(line.startswith("docker compose ") and line.endswith("up -d app") for line in self.mutations()))
        service = (self.host / "etc/systemd/system/allumi-update.service").read_text()
        self.assertIn("Environment=ALLUMI_DIR=" + str(self.checkout), service)
        self.assertIn("ExecStart=/usr/bin/python3 " + str(self.agent), service)

    def test_exact_legacy_override_is_preserved_without_a_new_marker(self):
        content = EXPECTED.replace("/var/lib/allumi-update", str(self.control))
        self.override.write_text(content)
        inode = self.override.stat().st_ino
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.override.read_text(), content)
        self.assertEqual(self.override.stat().st_ino, inode)

    def test_custom_or_nonregular_override_is_never_overwritten(self):
        self.override.write_text("services:\n  custom: {}\n")
        result = self.run_helper()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.override.read_text(), "services:\n  custom: {}\n")
        self.assert_no_mutations()
        self.override.unlink()
        self.override.mkdir()
        self.assertNotEqual(self.run_helper().returncode, 0)
        self.assertTrue(self.override.is_dir())
        self.assert_no_mutations()

    def test_an_override_created_during_activation_is_not_overwritten(self):
        self.stub("ln", "#!/bin/sh\nprintf '%s\\n' 'concurrent custom override' > \"$2\"\nexec " + shutil.which("ln") + " \"$@\"\n")
        result = self.run_helper()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.override.read_text(), "concurrent custom override\n")
        self.assertEqual(list(self.checkout.glob(".compose.override.*")), [])
        self.assert_no_mutations()

    def test_matching_and_dangling_symlinks_are_refused(self):
        target = self.root / "custom.yaml"
        content = EXPECTED.replace("/var/lib/allumi-update", str(self.control))
        target.write_text(content)
        self.override.symlink_to(target)
        self.assertNotEqual(self.run_helper().returncode, 0)
        self.assertEqual(target.read_text(), content)
        self.assertTrue(self.override.is_symlink())
        self.assert_no_mutations()
        target.unlink()
        self.assertNotEqual(self.run_helper().returncode, 0)
        self.assertTrue(self.override.is_symlink())
        self.assert_no_mutations()

    def test_inactive_systemd_or_missing_python_prevents_every_mutation(self):
        self.assertNotEqual(self.run_helper(TEST_SYSTEMD_DOWN="1").returncode, 0)
        self.assertFalse(self.override.exists())
        self.assert_no_mutations()
        (self.bin / "python3").unlink()
        self.assertNotEqual(self.run_helper().returncode, 0)
        self.assertFalse(self.override.exists())
        self.assert_no_mutations()

    def test_nonroot_or_missing_env_cannot_activate(self):
        self.assertNotEqual(self.run_helper(TEST_UID="1000").returncode, 0)
        self.assert_no_mutations()
        (self.checkout / ".env").unlink()
        self.assertNotEqual(self.run_helper().returncode, 0)
        self.assertFalse(self.override.exists())
        self.assert_no_mutations()

    def test_help_is_read_only_and_unknown_options_are_rejected(self):
        result = self.run_helper("--help", TEST_UID="1000")
        self.assertEqual(result.returncode, 0)
        self.assertIn("Usage:", result.stdout)
        self.assertFalse(self.override.exists())
        self.assert_no_mutations()
        self.assertNotEqual(self.run_helper("--unknown").returncode, 0)
        self.assert_no_mutations()

    def test_docker_failure_is_reported_without_printing_activation_success(self):
        result = self.run_helper(TEST_DOCKER_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Agent activé", result.stdout)


if __name__ == "__main__":
    unittest.main()
