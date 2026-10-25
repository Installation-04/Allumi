#!/usr/bin/env python3
"""get.sh detection and hand-off contract: fake kernels, CPUs and distributions, stub installers (no network, no Docker)."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

UNAME = '#!/bin/sh\ncase "$1" in -s) echo "${FAKE_KERNEL:-Linux}";; -m) echo "${FAKE_ARCH:-x86_64}";; esac\n'
ID = '#!/bin/sh\necho "${FAKE_UID:-0}"\n'
SUDO = '#!/bin/sh\nprintf "sudo %s\\n" "$*" >> "$STUB_LOG"\nexec "$@"\n'
VIRT = '#!/bin/sh\n[ -n "$FAKE_VIRT" ] && echo "$FAKE_VIRT" || { echo none; exit 1; }\n'
# Present only when a test wants Docker; `docker info` fails when FAKE_DOCKER_DOWN is set.
DOCKER = '''#!/bin/sh
case "$1" in
  info) [ -z "$FAKE_DOCKER_DOWN" ] || exit 1 ;;
  compose) [ -z "$FAKE_NO_COMPOSE" ] || exit 1 ;;
  ps) [ -z "$FAKE_CADDY" ] || echo "allumi-caddy-1 caddy:2-alpine 0.0.0.0:28443->443/tcp" ;;
esac
'''
STUB_INSTALLER = '#!/bin/bash\nprintf "%s ALLUMI_DIR=%s args=%s\\n" "$(basename "$0")" "$ALLUMI_DIR" "$*" >> "$STUB_LOG"\n'

OS_RELEASES = {
    "ubuntu": 'NAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n',
    "debian": 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nVERSION_ID="12"\nID=debian\n',
    "mint": 'NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"\nPRETTY_NAME="Linux Mint 22"\nVERSION_ID="22"\n',
    "alpine": 'ID=alpine\nVERSION_ID=3.20.0\nPRETTY_NAME="Alpine Linux v3.20"\n',
    "fedora": 'ID=fedora\nVERSION_ID=40\nPRETTY_NAME="Fedora Linux 40"\n',
}


class Harness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.tmp = Path(self.temp.name)
        self.repo = self.tmp / "allumi"
        (self.repo / "scripts").mkdir(parents=True)
        (self.tmp / "bin").mkdir()
        shutil.copyfile(ROOT / "scripts/get.sh", self.repo / "scripts/get.sh")
        (self.repo / "docker-compose.yml").write_text("services: {}\n")
        for name in ["install.sh", "install-docker.sh"]:
            self.script(self.repo / "scripts" / name, STUB_INSTALLER)
        for name, body in [("uname", UNAME), ("id", ID), ("sudo", SUDO), ("systemd-detect-virt", VIRT)]:
            self.script(self.tmp / "bin" / name, body)
        self.log = self.tmp / "stub.log"
        self.meminfo = self.tmp / "meminfo"
        self.meminfo.write_text("MemTotal:        8000000 kB\n")
        self.cpuinfo = self.tmp / "cpuinfo"
        self.cpuinfo.write_text("model name\t: Test CPU 9000\n")
        self.osr = self.tmp / "os-release"
        self.set_os("ubuntu")
        # Only the stubs and the basic tools: the host's own docker, git or sudo must not leak in.
        safe = self.tmp / "tools"
        safe.mkdir()
        for tool in ["sh", "dash", "bash", "env", "sed", "awk", "grep", "tr", "head", "tail", "cat", "df", "dirname", "ls", "mkdir", "nproc", "printf", "cut", "basename", "git"]:
            found = shutil.which(tool)
            if found and not (safe / tool).exists():
                (safe / tool).symlink_to(found)
        self.env = {
            "PATH": f"{self.tmp / 'bin'}{os.pathsep}{safe}",
            "HOME": str(self.tmp / "home"),
            "STUB_LOG": str(self.log),
            "ALLUMI_OS_RELEASE": str(self.osr),
            "ALLUMI_MEMINFO": str(self.meminfo),
            "ALLUMI_CPUINFO": str(self.cpuinfo),
            "ALLUMI_PROC_VERSION": str(self.tmp / "no-proc-version"),
        }

    def script(self, path, body):
        path.write_text(body)
        path.chmod(0o755)

    def with_docker(self):
        self.script(self.tmp / "bin" / "docker", DOCKER)

    def set_os(self, name):
        self.osr.write_text(OS_RELEASES[name])

    def get(self, *args, **env):
        # A new session has no controlling terminal: /dev/tty cannot be opened, as in a CI job or a cron run.
        return subprocess.run(
            ["sh", str(self.repo / "scripts/get.sh"), *args],
            env={**self.env, **env}, text=True, capture_output=True, timeout=20, start_new_session=True,
        )

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []


class Get(Harness):
    # --- detection --------------------------------------------------------------------------------------

    def test_report_names_system_cpu_memory_and_choice(self):
        result = self.get("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        for expected in ["Ubuntu 24.04.1 LTS", "amd64", "Test CPU 9000", "7812 Mo", "scripts/install.sh"]:
            self.assertIn(expected, result.stdout)
        self.assertIn("aucune détectée", result.stdout)
        self.assertEqual(self.calls(), [], "--check must not run anything")

    def test_arm64_spellings_are_normalised(self):
        for raw, shown in [("aarch64", "aarch64 → arm64"), ("arm64", "Processeur     : arm64"), ("x86_64", "x86_64 → amd64"), ("amd64", "Processeur     : amd64")]:
            result = self.get("--check", FAKE_ARCH=raw)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(shown, result.stdout)

    def test_unsupported_processors_are_refused_with_the_reason(self):
        for raw in ["armv7l", "i686", "riscv64", "ppc64le"]:
            result = self.get("--check", FAKE_ARCH=raw)
            self.assertEqual(result.returncode, 2, raw)
            self.assertIn("AMD64", result.stderr)

    def test_windows_shells_and_bsd_are_pointed_elsewhere(self):
        for kernel, hint in [("MINGW64_NT-10.0", "WSL 2"), ("MSYS_NT-10.0", "WSL 2"), ("CYGWIN_NT-10.0", "WSL 2"), ("FreeBSD", "Linux")]:
            result = self.get("--check", FAKE_KERNEL=kernel)
            self.assertEqual(result.returncode, 2, kernel)
            self.assertIn(hint, result.stderr)

    def test_debian_family_includes_derivatives(self):
        for name in ["debian", "mint"]:
            self.set_os(name)
            result = self.get("--check")
            self.assertEqual(result.returncode, 0, f"{name}: {result.stderr}")
            self.assertIn("scripts/install.sh", result.stdout)

    def test_other_distributions_need_docker_and_force(self):
        self.set_os("alpine")
        no_docker = self.get("--check")
        self.assertEqual(no_docker.returncode, 2)
        self.assertIn("docs.docker.com", no_docker.stderr)
        self.with_docker()
        untested = self.get("--check")
        self.assertEqual(untested.returncode, 2)
        self.assertIn("--force", untested.stderr)
        forced = self.get("--check", "--force")
        self.assertEqual(forced.returncode, 0, forced.stderr)
        self.assertIn("install-docker.sh", forced.stdout)

    def test_macos_is_trial_only(self):
        self.with_docker()
        refused = self.get("--check", FAKE_KERNEL="Darwin", FAKE_ARCH="arm64")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("--force", refused.stderr)
        allowed = self.get("--check", "--force", FAKE_KERNEL="Darwin", FAKE_ARCH="arm64")
        self.assertEqual(allowed.returncode, 0, allowed.stderr)
        self.assertIn("install-docker.sh", allowed.stdout)

    def test_docker_only_needs_docker_and_compose(self):
        missing = self.get("--check", "--docker-only")
        self.assertEqual(missing.returncode, 2)
        self.with_docker()
        no_compose = self.get("--check", "--docker-only", FAKE_NO_COMPOSE="1")
        self.assertEqual(no_compose.returncode, 2)
        self.assertIn("compose", no_compose.stderr.lower())
        ok = self.get("--check", "--docker-only")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertIn("install-docker.sh", ok.stdout)

    def test_warnings_for_small_machines_lxc_and_an_old_caddy(self):
        self.meminfo.write_text("MemTotal:        1000000 kB\n")
        self.with_docker()
        result = self.get("--check", FAKE_VIRT="lxc", FAKE_CADDY="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Mémoire faible", result.stdout)
        self.assertIn("LXC", result.stdout)
        self.assertIn("allumi-caddy-1", result.stdout)
        self.assertIn("docker rm -f", result.stdout)

    def test_docker_that_does_not_answer_is_explained(self):
        self.with_docker()
        result = self.get("--check", FAKE_DOCKER_DOWN="1")
        self.assertIn("ne répond pas", result.stdout)

    def test_a_simple_user_without_sudo_cannot_use_the_full_installer(self):
        (self.tmp / "bin" / "sudo").unlink()
        result = self.get("--check", FAKE_UID="1000")
        self.assertEqual(result.returncode, 2)
        self.assertIn("administrateur", result.stderr)

    def test_the_os_release_file_is_read_not_executed(self):
        marker = self.tmp / "executed"
        self.osr.write_text(f'ID=ubuntu\nPRETTY_NAME="Ubuntu $(touch {marker})"\n')
        result = self.get("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists())

    # --- options ------------------------------------------------------------------------------------------

    def test_bad_options_are_refused_before_anything_happens(self):
        self.assertEqual(self.get("--nope").returncode, 1)
        self.assertEqual(self.get("--check", "--version", "main").returncode, 1)
        self.assertEqual(self.get("--check", "--version", "v0.4.0", "--branch", "main").returncode, 1)
        self.assertEqual(self.get("--version").returncode, 1)
        self.assertEqual(self.calls(), [])

    # --- hand-off -----------------------------------------------------------------------------------------

    def test_without_a_terminal_it_refuses_to_act_unless_told_to(self):
        result = self.get()
        self.assertEqual(result.returncode, 1)
        self.assertIn("--yes", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_yes_hands_over_to_the_full_installer_with_the_arguments_after_double_dash(self):
        result = self.get("--yes", "--", "--app-url", "http://192.168.1.20:28080", "--prepare-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [f"install.sh ALLUMI_DIR={self.repo} args=--app-url http://192.168.1.20:28080 --prepare-only"])

    def test_docker_only_runs_the_docker_installer_without_sudo_for_root(self):
        self.with_docker()
        result = self.get("--yes", "--docker-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [f"install-docker.sh ALLUMI_DIR={self.repo} args="])

    def test_a_non_root_user_goes_through_sudo_for_the_full_installer(self):
        result = self.get("--yes", FAKE_UID="1000")
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertTrue(calls[0].startswith("sudo env ALLUMI_DIR="), calls)
        self.assertTrue(calls[1].startswith("install.sh "), calls)

    def test_run_from_a_clone_ignores_version_and_dir(self):
        result = self.get("--yes", "--version", "v9.9.9", "--dir", str(self.tmp / "elsewhere"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ignoré", result.stderr)
        self.assertEqual(self.calls(), [f"install.sh ALLUMI_DIR={self.repo} args="])


class GetFromTheNetwork(Harness):
    """Not run from a clone: the script resolves a tag in a (local, bare) remote, clones it and hands over."""

    def make_remote(self, tags):
        work = self.tmp / "work"
        (work / "scripts").mkdir(parents=True)
        git = lambda *a, cwd=work: subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True, env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})
        git("init", "-q", "-b", "main")
        (work / "docker-compose.yml").write_text("services: {}\n")
        for name in ["install.sh", "install-docker.sh"]:
            self.script(work / "scripts" / name, STUB_INSTALLER)
        for tag in tags:
            (work / "VERSION").write_text(tag)
            git("add", "-A")
            git("commit", "-q", "-m", tag)
            git("tag", "-a", tag, "-m", tag)
        self.remote = self.tmp / "remote.git"
        git("clone", "-q", "--bare", str(work), str(self.remote), cwd=self.tmp)
        self.env["ALLUMI_REPO_URL"] = str(self.remote)

    def run_outside(self, *args):
        standalone = self.tmp / "standalone"
        standalone.mkdir(exist_ok=True)
        shutil.copyfile(ROOT / "scripts/get.sh", standalone / "get.sh")
        self.target = self.tmp / "installed" / "allumi"
        return subprocess.run(
            ["sh", str(standalone / "get.sh"), "--yes", "--dir", str(self.target), *args],
            env=self.env, text=True, capture_output=True, timeout=60, start_new_session=True,
        )

    def installed_tag(self):
        return subprocess.run(["git", "-C", str(self.target), "describe", "--tags"], capture_output=True, text=True).stdout.strip()

    def test_the_newest_tag_wins_numerically_and_a_final_release_beats_its_alphas(self):
        self.make_remote(["v0.4.0-alpha.9", "v0.4.0-alpha.10"])
        self.assertEqual(self.run_outside().returncode, 0)
        self.assertEqual(self.installed_tag(), "v0.4.0-alpha.10")
        self.assertEqual(self.calls(), [f"install.sh ALLUMI_DIR={self.target} args="])

    def test_a_final_release_is_newer_than_its_prereleases(self):
        self.make_remote(["v0.4.0-alpha.9", "v0.4.0", "v0.4.0-alpha.10", "v0.3.9"])
        self.assertEqual(self.run_outside().returncode, 0)
        self.assertEqual(self.installed_tag(), "v0.4.0")

    def test_an_explicit_version_is_checked_out_and_an_existing_clone_is_updated_in_place(self):
        self.make_remote(["v0.4.0-alpha.9", "v0.4.0-alpha.10"])
        self.assertEqual(self.run_outside("--version", "v0.4.0-alpha.9").returncode, 0)
        self.assertEqual(self.installed_tag(), "v0.4.0-alpha.9")
        self.assertEqual(self.run_outside().returncode, 0)
        self.assertEqual(self.installed_tag(), "v0.4.0-alpha.10")

    def test_local_changes_in_an_existing_clone_are_never_overwritten(self):
        self.make_remote(["v0.4.0-alpha.9"])
        self.assertEqual(self.run_outside().returncode, 0)
        (self.target / "docker-compose.yml").write_text("local edit\n")
        result = self.run_outside()
        self.assertEqual(result.returncode, 1)
        self.assertIn("modifications locales", result.stderr)
        self.assertEqual((self.target / "docker-compose.yml").read_text(), "local edit\n")

    def test_a_directory_that_is_not_an_allumi_clone_is_refused(self):
        self.make_remote(["v0.4.0-alpha.9"])
        (self.tmp / "installed" / "allumi").mkdir(parents=True)
        (self.tmp / "installed" / "allumi" / "notes.txt").write_text("mine")
        result = self.run_outside()
        self.assertEqual(result.returncode, 1)
        self.assertIn("n'est pas un dépôt Allumi", result.stderr)

    def test_an_unknown_version_fails_cleanly(self):
        self.make_remote(["v0.4.0-alpha.9"])
        result = self.run_outside("--version", "v9.9.9")
        self.assertEqual(result.returncode, 1)
        self.assertIn("introuvable", result.stderr)
        self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main()
