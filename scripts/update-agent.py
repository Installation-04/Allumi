#!/usr/bin/env python3
"""Opt-in host updater. Only published, newer Allumi tags may reach update.sh."""
import datetime
import fcntl
import json
import os
import pathlib
import re
import stat
import subprocess
import tempfile
import urllib.request
import uuid

TAG = re.compile(r"v(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-(alpha|beta|rc)\.(\d{1,6}))?$")


def version_key(tag):
    match = TAG.fullmatch(tag)
    if not match:
        raise ValueError("Invalid version")
    major, minor, patch, channel, sequence = match.groups()
    return (int(major), int(minor), int(patch), {"alpha": 0, "beta": 1, "rc": 2, None: 3}[channel], int(sequence or 0))


def run_agent(repo, directory):
    repo = pathlib.Path(repo).resolve()
    directory = pathlib.Path(directory)
    with open("/run/lock/allumi-update.lock", "w", encoding="utf8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        request = directory / "request.json"
        try:
            request.lstat()
        except FileNotFoundError:
            return
        details = {}
        stage = "validating"
        failure_code = "validation"

        def status(state):
            payload = {"state": state, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "stage": stage, **details}
            if state == "failed":
                payload["failureCode"] = failure_code
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False, encoding="utf8") as handle:
                    temporary = handle.name
                    json.dump(payload, handle)
                    os.fchmod(handle.fileno(), 0o644)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, directory / "status.json")
            finally:
                if temporary is not None:
                    pathlib.Path(temporary).unlink(missing_ok=True)

        stopped = False
        update_started = False

        def command(*args):
            subprocess.run(args, cwd=repo, check=True, timeout=1800)

        try:
            status("running")
            descriptor = os.open(request, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
                    raise ValueError("Invalid request file")
                raw = handle.read(8193)
                if len(raw) > 8192:
                    raise ValueError("Invalid request file")
                data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("Invalid request")
            tag = data.get("version")
            if not isinstance(tag, str):
                raise ValueError("Invalid version")
            target = version_key(tag)
            details["target"] = tag
            request_id = data.get("requestId")
            if "requestId" in data:
                if not isinstance(request_id, str) or len(request_id) != 36 or str(uuid.UUID(request_id)) != request_id.lower():
                    raise ValueError("Invalid request identifier")
                details["requestId"] = request_id
            requested_at = data.get("requestedAt")
            if not isinstance(requested_at, str) or len(requested_at) > 64:
                raise ValueError("Invalid request time")
            requested = datetime.datetime.fromisoformat(requested_at.replace("Z", "+00:00"))
            if requested.tzinfo is None:
                raise ValueError("Request time must include a timezone")
            age = (datetime.datetime.now(datetime.timezone.utc) - requested).total_seconds()
            if not 0 <= age <= 3600:
                raise ValueError("Expired request")
            details["requestedAt"] = requested_at
            # Host audit logs accept only a canonical UUID, never a free-form label.
            actor = "unknown"
            candidate = data.get("actor")
            if isinstance(candidate, str) and len(candidate) == 36:
                try:
                    parsed_actor = uuid.UUID(candidate)
                    if str(parsed_actor) == candidate.lower():
                        actor = str(parsed_actor)
                except ValueError:
                    pass
            # Publish correlation as soon as the untrusted request fields are validated.
            status("running")
            current = json.loads(subprocess.check_output(["git", "show", "HEAD:package.json"], cwd=repo))["version"]
            if not isinstance(current, str):
                raise ValueError("Invalid installed version")
            installed = version_key("v" + current)
            details["fromVersion"] = current
            if target <= installed:
                raise ValueError("Downgrades and reinstalls are forbidden")
            remote = subprocess.check_output(["git", "remote", "get-url", "origin"], cwd=repo, text=True).strip()
            if remote not in ("https://github.com/Installation-04/Allumi.git", "https://github.com/Installation-04/Allumi"):
                raise ValueError("Unexpected repository")
            if subprocess.check_output(["git", "status", "--porcelain"], cwd=repo).strip():
                raise ValueError("Working tree must be clean")
            req = urllib.request.Request("https://api.github.com/repos/Installation-04/Allumi/releases/tags/" + tag, headers={"Accept": "application/vnd.github+json", "User-Agent": "Allumi-update-agent"})
            with urllib.request.urlopen(req, timeout=15) as response:
                release = json.load(response)
            if not isinstance(release, dict) or release.get("draft") or release.get("tag_name") != tag or not release.get("published_at"):
                raise ValueError("Release is not published")
            command("git", "fetch", "origin", "tag", tag)
            command("git", "merge-base", "--is-ancestor", "HEAD", tag)
            stage = "backup"
            failure_code = "backup"
            status("running")
            print("Allumi update requested:", tag, "actor:", actor, flush=True)
            command("docker", "compose", "stop", "app")
            stopped = True
            command(str(repo / "scripts/backup.sh"))
            stage = "installing"
            failure_code = "installation"
            status("running")
            update_started = True
            command(str(repo / "scripts/update.sh"), "--no-backup", tag)
            stage = "complete"
            failure_code = "unknown"
            status("success")
        except Exception as error:
            status("failed")
            print("Allumi update failed:", str(error), flush=True)
            # Before migrations, it is safe to resume the unchanged app after a backup failure.
            if stopped and not update_started:
                command("docker", "compose", "start", "app")
            # Once update.sh starts, database rollback is deliberately manual.
        finally:
            request.unlink(missing_ok=True)


if __name__ == "__main__":
    run_agent(os.environ.get("ALLUMI_DIR", "/opt/allumi"), "/var/lib/allumi-update")
