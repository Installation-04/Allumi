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
    lock = open("/run/lock/allumi-update.lock", "w", encoding="utf8")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    request = directory / "request.json"
    try:
        descriptor = os.open(request, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return

    def status(state):
        with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False, encoding="utf8") as handle:
            json.dump({"state": state, "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}, handle)
            os.fchmod(handle.fileno(), 0o644)
            temporary = handle.name
        os.replace(temporary, directory / "status.json")

    stopped = False
    update_started = False
    def command(*args):
        subprocess.run(args, cwd=repo, check=True, timeout=1800)

    try:
        with os.fdopen(descriptor, "r", encoding="utf8") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
                raise ValueError("Invalid request file")
            data = json.loads(handle.read(8193))
        tag = data["version"]
        target = version_key(tag)
        requested = datetime.datetime.fromisoformat(data["requestedAt"].replace("Z", "+00:00"))
        age = (datetime.datetime.now(datetime.timezone.utc) - requested).total_seconds()
        if not 0 <= age <= 3600:
            raise ValueError("Expired request")
        current = json.loads(subprocess.check_output(["git", "show", "HEAD:package.json"], cwd=repo))["version"]
        if target <= version_key("v" + current):
            raise ValueError("Downgrades and reinstalls are forbidden")
        remote = subprocess.check_output(["git", "remote", "get-url", "origin"], cwd=repo, text=True).strip()
        if remote not in ("https://github.com/Installation-04/Allumi.git", "https://github.com/Installation-04/Allumi"):
            raise ValueError("Unexpected repository")
        if subprocess.check_output(["git", "status", "--porcelain"], cwd=repo).strip():
            raise ValueError("Working tree must be clean")
        req = urllib.request.Request("https://api.github.com/repos/Installation-04/Allumi/releases/tags/" + tag, headers={"Accept": "application/vnd.github+json", "User-Agent": "Allumi-update-agent"})
        with urllib.request.urlopen(req, timeout=15) as response:
            release = json.load(response)
        if release.get("draft") or release.get("tag_name") != tag or not release.get("published_at"):
            raise ValueError("Release is not published")
        command("git", "fetch", "origin", "tag", tag)
        command("git", "merge-base", "--is-ancestor", "HEAD", tag)
        status("running")
        print("Allumi update requested:", tag, "actor:", data.get("actor", "unknown"), flush=True)
        command("docker", "compose", "stop", "app")
        stopped = True
        command(str(repo / "scripts/backup.sh"))
        update_started = True
        command(str(repo / "scripts/update.sh"), "--no-backup", tag)
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
