#!/usr/bin/env python3
"""Opt-in host administration: fixed backup/retention operations, never client commands or paths."""
import datetime
import fcntl
import json
import os
import pathlib
import re
import stat
import subprocess
import tempfile

BACKUP_NAME = re.compile(r"allumi-[0-9-]+\.tar(?:\.age)?$")
UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def validate(data):
    if not isinstance(data, dict) or not UUID.fullmatch(str(data.get("actor", ""))):
        raise ValueError("Invalid actor")
    requested = datetime.datetime.fromisoformat(data["requestedAt"].replace("Z", "+00:00"))
    age = (datetime.datetime.now(datetime.timezone.utc) - requested).total_seconds()
    if not 0 <= age <= 300:
        raise ValueError("Expired request")
    operation = data.get("operation")
    if operation not in ("backup", "retention"):
        raise ValueError("Invalid operation")
    if operation == "retention" and (type(data.get("days")) is not int or not 1 <= data["days"] <= 3650):
        raise ValueError("Invalid retention")
    return operation


def config(repo):
    values = {}
    for line in (repo / ".env").read_text(encoding="utf8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key in ("BACKUP_DIR", "BACKUP_RETENTION_DAYS"):
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key] = value
    directory = pathlib.Path(values.get("BACKUP_DIR") or "/var/backups/allumi")
    if not directory.is_absolute():
        directory = repo / directory
    days = values.get("BACKUP_RETENTION_DAYS") or "30"
    retention = int(days) if days.isdigit() and 1 <= int(days) <= 3650 else 30
    return directory, retention


def snapshot(repo, directory, events):
    backup_dir, retention = config(repo)
    backups = []
    if backup_dir.is_dir():
        for path in sorted(backup_dir.iterdir(), reverse=True):
            if len(backups) == 100:
                break
            if not BACKUP_NAME.fullmatch(path.name) or path.is_symlink():
                continue
            try:
                info = path.stat()
                if stat.S_ISREG(info.st_mode):
                    backups.append({"name": path.name, "bytes": info.st_size, "at": datetime.datetime.fromtimestamp(info.st_mtime, datetime.timezone.utc).isoformat()})
            except FileNotFoundError:
                continue
    data = {"at": now(), "retentionDays": retention, "backups": backups, "events": events[-100:]}
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False, encoding="utf8") as handle:
        json.dump(data, handle)
        os.fchmod(handle.fileno(), 0o644)
        temporary = handle.name
    os.replace(temporary, directory / "snapshot.json")


def run_agent(repo, directory, lock_path="/run/lock/allumi-update.lock"):
    repo, directory = pathlib.Path(repo).resolve(), pathlib.Path(directory)
    with open(lock_path, "w", encoding="utf8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        events = []
        try:
            descriptor = os.open(directory / "snapshot.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "r", encoding="utf8") as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 100000:
                    raise ValueError("Invalid snapshot file")
                raw = handle.read(100001)
            if len(raw) <= 100000:
                for event in json.loads(raw).get("events", [])[-100:]:
                    if (isinstance(event, dict) and event.get("operation") in ("backup", "retention")
                            and event.get("state") in ("running", "success", "failed")
                            and isinstance(event.get("at"), str) and len(event["at"]) <= 40):
                        events.append({k: event[k] for k in ("at", "operation", "state")})
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        request = directory / "request.json"
        try:
            descriptor = os.open(request, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            snapshot(repo, directory, events)
            return
        except OSError:
            # Never follow a symlink or block on a FIFO supplied by the web process.
            request.unlink(missing_ok=True)
            return
        operation = None
        try:
            with os.fdopen(descriptor, "r", encoding="utf8") as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
                    raise ValueError("Invalid request file")
                data = json.loads(handle.read(8193))
            operation = validate(data)
            events.append({"at": now(), "operation": operation, "state": "running"})
            snapshot(repo, directory, events)
            if operation == "backup":
                args = [str(repo / "scripts/backup.sh")]
            else:
                args = [str(repo / "scripts/set-backup-retention.sh"), str(data["days"])]
            subprocess.run(args, cwd=repo, check=True, timeout=1800, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            events.append({"at": now(), "operation": operation, "state": "success"})
        except Exception:
            if operation:
                events.append({"at": now(), "operation": operation, "state": "failed"})
            # Do not publish command output, paths, credentials, exception text or request contents.
            print("Allumi server operation failed; inspect the host configuration.", flush=True)
        finally:
            request.unlink(missing_ok=True)
            snapshot(repo, directory, events)


if __name__ == "__main__":
    run_agent(os.environ.get("ALLUMI_DIR", "/opt/allumi"), os.environ["ALLUMI_SERVER_CONTROL_DIR"])
