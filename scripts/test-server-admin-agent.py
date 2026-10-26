import datetime
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("server_admin", pathlib.Path(__file__).with_name("server-admin-agent.py"))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class ServerAgent(unittest.TestCase):
    def request(self, **overrides):
        return {"operation": "backup", "actor": "00000000-0000-7000-8000-000000000001", "requestedAt": agent.now(), **overrides}

    def test_only_fixed_operations_and_bounded_retention(self):
        for operation in ["exec", "restore", "backup; id", "../../backup.sh"]:
            with self.assertRaises(ValueError):
                agent.validate(self.request(operation=operation))
        for days in [0, -1, 3651, True, "30; id", 1.5]:
            with self.assertRaises(ValueError):
                agent.validate(self.request(operation="retention", days=days))
        self.assertEqual(agent.validate(self.request(operation="retention", days=30)), "retention")

    def test_expired_request(self):
        old = (datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=6)).isoformat()
        with self.assertRaises(ValueError):
            agent.validate(self.request(requestedAt=old))

    def execute(self, data, failure=False, symlink=False):
        with tempfile.TemporaryDirectory() as root:
            repo = pathlib.Path(root)
            (repo / ".env").write_text(f'BACKUP_DIR="{root}/backups"\nBACKUP_RETENTION_DAYS=30\nAUTH_SECRET=never-publish-this\n')
            backups = repo / "backups"
            backups.mkdir()
            (backups / "allumi-20261025-120000.tar").write_bytes(b"backup")
            (backups / "allumi-20261025-120001.tar").symlink_to(repo / ".env")
            control = repo / "control"
            control.mkdir()
            request = control / "request.json"
            if symlink:
                request.symlink_to(repo / ".env")
            else:
                request.write_text(json.dumps(data))
            with patch.object(agent.subprocess, "run", side_effect=RuntimeError("secret-db-password") if failure else None) as run:
                agent.run_agent(repo, control, repo / "lock")
                calls = run.call_args_list
            self.assertFalse(request.exists())
            self.assertIn("AUTH_SECRET", (repo / ".env").read_text())
            result = (control / "snapshot.json").read_text() if (control / "snapshot.json").exists() else "{}"
            self.assertNotIn("never-publish", result)
            self.assertNotIn("secret-db-password", result)
            return json.loads(result), calls

    def test_backup_uses_only_fixed_script_and_private_output(self):
        result, calls = self.execute(self.request(command="rm -rf /", path="/etc/shadow"))
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0].args[0][0].endswith("/scripts/backup.sh"))
        self.assertEqual(calls[0].kwargs["stdout"], agent.subprocess.DEVNULL)
        self.assertEqual(result["events"][-1]["state"], "success")
        self.assertEqual(len(result["backups"]), 1)

    def test_retention_never_becomes_shell_code(self):
        result, calls = self.execute(self.request(operation="retention", days=60))
        self.assertEqual(calls[0].args[0][-1], "60")
        self.assertTrue(calls[0].args[0][0].endswith("/scripts/set-backup-retention.sh"))
        self.assertEqual(result["events"][-1]["state"], "success")

    def test_failure_is_sanitized(self):
        result, _ = self.execute(self.request(), failure=True)
        self.assertEqual(result["events"][-1]["state"], "failed")

    def test_symlink_never_executes(self):
        _, calls = self.execute(self.request(), symlink=True)
        self.assertEqual(calls, [])

    def test_invalid_requests_never_execute(self):
        _, calls = self.execute(self.request(operation="shell"))
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
