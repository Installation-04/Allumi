import datetime
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
import uuid
from unittest.mock import patch

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
    def run_request(self, *, changes=None, current="0.1.0", failure=None, raw=None,
                    file_kind="regular", release_changes=None, remote=None,
                    dirty=False, lock_busy=False, legacy=False):
        with tempfile.TemporaryDirectory() as root:
            directory = pathlib.Path(root)
            request = {
                "version": "v0.2.0",
                "requestedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "requestId": str(uuid.uuid4()),
                "actor": "test-admin",
            }
            if legacy:
                del request["requestId"]
            request.update(changes or {})
            content = json.dumps(request) if raw is None else raw
            path = directory / "request.json"
            if file_kind == "symlink":
                target = directory / "protected.json"
                target.write_text(content)
                path.symlink_to(target)
            elif file_kind == "fifo":
                os.mkfifo(path)
            else:
                path.write_text(content)
            history = []
            actual_replace = os.replace

            def replace(source, destination):
                payload = json.loads(pathlib.Path(source).read_text())
                history.append(payload)
                actual_replace(source, destination)

            def execute(args, **kwargs):
                if args[0].endswith("backup.sh") or args == ("docker", "compose", "stop", "app"):
                    live = json.loads((directory / "status.json").read_text())
                    self.assertEqual((live["state"], live["stage"]), ("running", "backup"))
                if args[0].endswith("update.sh"):
                    live = json.loads((directory / "status.json").read_text())
                    self.assertEqual((live["state"], live["stage"]), ("running", "installing"))
                if (failure == "backup" and args[0].endswith("backup.sh")) or (failure == "installation" and args[0].endswith("update.sh")) or (failure == "ancestor" and args[:2] == ("git", "merge-base")):
                    raise subprocess.CalledProcessError(1, args, stderr="secret command diagnostic")

            release = {"tag_name": request["version"], "published_at": "2026-10-20", "draft": False}
            release.update(release_changes or {})
            with tempfile.TemporaryFile(mode="w+") as lock, \
                    patch("builtins.open", return_value=lock), \
                    patch.object(agent.fcntl, "flock", side_effect=BlockingIOError if lock_busy else None), \
                    patch.object(agent.os, "replace", side_effect=replace), \
                    patch.object(agent.subprocess, "check_output", side_effect=[json.dumps({"version": current}), remote or "https://github.com/Installation-04/Allumi.git", b"modified" if dirty else b""]) as read, \
                    patch.object(agent.subprocess, "run", side_effect=execute) as run, \
                    patch.object(agent.urllib.request, "urlopen", return_value=io.StringIO(json.dumps(release))), \
                    patch("builtins.print") as logged:
                agent.run_agent(root, root)
                calls = [call.args[0] for call in run.call_args_list]
                reads = read.call_count
                self.last_logs = [" ".join(str(value) for value in call.args) for call in logged.call_args_list]
            if lock_busy:
                self.assertTrue(path.exists())
                self.assertFalse((directory / "status.json").exists())
                return None, calls, history, request, reads
            self.assertFalse(path.exists())
            if file_kind == "symlink":
                self.assertEqual(target.read_text(), content)
            state = json.loads((directory / "status.json").read_text())
            self.assertEqual(history[-1], state)
            for item in history:
                self.assertEqual(set(item) - {"state", "at", "stage", "target", "fromVersion", "requestedAt", "requestId", "failureCode"}, set())
                self.assertIsNotNone(datetime.datetime.fromisoformat(item["at"]).tzinfo)
                self.assertNotIn("secret", json.dumps(item))
                self.assertNotIn("actor", item)
            return state, calls, history, request, reads

    def test_happy_path_stages_and_correlation(self):
        state, calls, history, request, _ = self.run_request()
        self.assertEqual(state, {"state": "success", "at": state["at"], "stage": "complete", "target": "v0.2.0", "fromVersion": "0.1.0", "requestedAt": request["requestedAt"], "requestId": request["requestId"]})
        self.assertEqual([item["stage"] for item in history], ["validating", "validating", "backup", "installing", "complete"])
        self.assertTrue(all(item["state"] == "running" for item in history[:-1]))
        self.assertTrue(all(item.get("requestId") == request["requestId"] for item in history[1:]))
        self.assertTrue(calls[-2][0].endswith("backup.sh"))
        self.assertTrue(calls[-1][0].endswith("update.sh"))
        self.assertEqual(calls[-1][1:], ("--no-backup", "v0.2.0"))

    def test_downgrade_and_reinstall_never_execute(self):
        for current in ["0.3.0", "0.2.0"]:
            with self.subTest(current=current):
                state, calls, _, _, _ = self.run_request(current=current)
                self.assertEqual((state["state"], state["stage"], state["failureCode"]), ("failed", "validating", "validation"))
                self.assertEqual(calls, [])

    def test_invalid_requests_never_execute(self):
        invalid = [
            {"version": "v0.2.0; id"}, {"version": []}, {"version": None},
            {"requestId": "../../bad"}, {"requestId": None}, {"requestId": 42},
            {"requestedAt": []}, {"requestedAt": "2026-11-05"},
            {"requestedAt": "2026-99-99T00:00:00Z"},
            {"requestedAt": "2999-01-01T00:00:00Z"},
            {"requestedAt": (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)).isoformat()},
        ]
        for changes in invalid:
            with self.subTest(changes=changes):
                state, calls, _, _, reads = self.run_request(changes=changes)
                self.assertEqual((state["state"], state["failureCode"]), ("failed", "validation"))
                self.assertEqual(calls, [])
                self.assertEqual(reads, 0)

    def test_invalid_file_shapes_and_symlinks(self):
        for options in [{"raw": "[]"}, {"raw": "not JSON"}, {"raw": " " * 8193}, {"file_kind": "symlink"}, {"file_kind": "fifo"}]:
            with self.subTest(options=options):
                state, calls, _, _, reads = self.run_request(**options)
                self.assertEqual((state["state"], state["stage"], state["failureCode"]), ("failed", "validating", "validation"))
                self.assertEqual(calls, [])
                self.assertEqual(reads, 0)

    def test_release_origin_and_ancestry_refusals_never_stop_app(self):
        for options in [{"release_changes": {"draft": True}}, {"release_changes": {"tag_name": "v9.0.0"}}, {"release_changes": {"published_at": None}}, {"remote": "https://example.org/other.git"}, {"dirty": True}, {"failure": "ancestor"}]:
            with self.subTest(options=options):
                state, calls, _, _, _ = self.run_request(**options)
                self.assertEqual((state["stage"], state["failureCode"]), ("validating", "validation"))
                self.assertFalse(any(call[0] == "docker" or call[0].endswith("update.sh") for call in calls))

    def test_backup_failure_resumes_without_update(self):
        state, calls, history, _, _ = self.run_request(failure="backup")
        self.assertEqual((state["state"], state["stage"], state["failureCode"]), ("failed", "backup", "backup"))
        self.assertEqual(calls[-1], ("docker", "compose", "start", "app"))
        self.assertFalse(any(args[0].endswith("update.sh") for args in calls))
        self.assertNotIn("installing", [item["stage"] for item in history])

    def test_installation_failure_never_rolls_back_or_reports_success(self):
        state, calls, history, _, _ = self.run_request(failure="installation")
        self.assertEqual((state["state"], state["stage"], state["failureCode"]), ("failed", "installing", "installation"))
        self.assertFalse(any(args == ("docker", "compose", "start", "app") for args in calls))
        self.assertNotIn("success", [item["state"] for item in history])

    def test_legacy_request_without_identifier(self):
        state, _, _, _, _ = self.run_request(legacy=True)
        self.assertEqual(state["state"], "success")
        self.assertNotIn("requestId", state)

    def test_host_audit_actor_is_a_uuid_or_unknown_without_log_or_command_injection(self):
        actor = str(uuid.uuid4())
        state, _, _, _, _ = self.run_request(changes={"actor": actor})
        self.assertEqual(state["state"], "success")
        self.assertIn("Allumi update requested: v0.2.0 actor: " + actor, self.last_logs)
        intrusion = "admin\nforged audit $(touch /tmp/forged)"
        state, calls, _, _, _ = self.run_request(changes={"actor": intrusion})
        self.assertEqual(state["state"], "success")
        self.assertIn("Allumi update requested: v0.2.0 actor: unknown", self.last_logs)
        self.assertFalse(any(intrusion in message for message in self.last_logs))
        self.assertFalse(any(intrusion in str(args) or "touch" in str(args) for args in calls))

    def test_busy_lock_leaves_request_for_the_active_agent(self):
        state, calls, history, _, reads = self.run_request(lock_busy=True)
        self.assertIsNone(state)
        self.assertEqual((calls, history, reads), ([], [], 0))


if __name__ == "__main__":
    unittest.main()
