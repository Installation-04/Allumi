import importlib.util
import pathlib
import unittest
from unittest.mock import patch
import tempfile
import json
import datetime
import io
import subprocess
spec = importlib.util.spec_from_file_location("agent", pathlib.Path(__file__).with_name("update-agent.py"))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class AgentPolicy(unittest.TestCase):
    def test_rejects_commands_and_paths(self):
        for value in ["v1.0.0; id", "../../main", "main", "v1.0.0\n", "v1.0.0-beta"]:
            with self.assertRaises(ValueError):
                agent.version_key(value)

    def test_version_order(self):
        self.assertGreater(agent.version_key("v0.2.0"), agent.version_key("v0.2.0-rc.1"))
        self.assertGreater(agent.version_key("v0.2.0-alpha.10"), agent.version_key("v0.2.0-alpha.2"))


class AgentExecution(unittest.TestCase):
    def run_request(self, version="v0.2.0", current="0.1.0", backup_fails=False):
        with tempfile.TemporaryDirectory() as root:
            directory = pathlib.Path(root)
            request = {"version": version, "requestedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "actor": "test-admin"}
            (directory / "request.json").write_text(json.dumps(request))
            def execute(args, **kwargs):
                if backup_fails and args[0].endswith("backup.sh"):
                    raise subprocess.CalledProcessError(1, args)
            with tempfile.TemporaryFile(mode="w+") as lock, patch("builtins.open", return_value=lock), patch.object(agent.subprocess, "check_output", side_effect=[json.dumps({"version": current}), "https://github.com/Installation-04/Allumi.git", b""]), patch.object(agent.subprocess, "run", side_effect=execute) as run, patch.object(agent.urllib.request, "urlopen", return_value=io.StringIO(json.dumps({"tag_name": version, "published_at": "2026-10-20", "draft": False}))):
                agent.run_agent(root, root)
                calls = [call.args[0] for call in run.call_args_list]
            self.assertFalse((directory / "request.json").exists())
            return json.loads((directory / "status.json").read_text())["state"], calls

    def test_downgrade_never_executes(self):
        state, calls = self.run_request(current="0.3.0")
        self.assertEqual(state, "failed")
        self.assertEqual(calls, [])

    def test_invalid_tag_never_executes(self):
        state, calls = self.run_request(version="v0.2.0; id")
        self.assertEqual(state, "failed")
        self.assertEqual(calls, [])

    def test_backup_failure_resumes_without_update(self):
        state, calls = self.run_request(backup_fails=True)
        self.assertEqual(state, "failed")
        self.assertEqual(calls[-1], ("docker", "compose", "start", "app"))
        self.assertFalse(any(args[0].endswith("update.sh") for args in calls))

    def test_backup_precedes_update(self):
        state, calls = self.run_request()
        self.assertEqual(state, "success")
        self.assertTrue(calls[-2][0].endswith("backup.sh"))
        self.assertTrue(calls[-1][0].endswith("update.sh"))
        self.assertEqual(calls[-1][1:], ("--no-backup", "v0.2.0"))


if __name__ == "__main__":
    unittest.main()
