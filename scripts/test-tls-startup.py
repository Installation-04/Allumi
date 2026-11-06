#!/usr/bin/env python3
"""Deployment lifecycle guards with real shell helpers and a fake Docker command."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('tls_helper_contract', ROOT/'scripts/test-local-https.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class Startup(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root/'scripts').mkdir()
        (self.root/'deploy').mkdir()
        (self.root/'bin').mkdir()
        for name in ['scripts/lib.sh','scripts/up.sh','scripts/update.sh','scripts/enable-local-https.sh','compose.https.yaml','deploy/Caddyfile.local','docker-compose.yml']:
            shutil.copyfile(ROOT/name,self.root/name)
        self.dotenv = self.root/'.env'
        self.dotenv.write_text('ALLUMI_NETWORK_MODE=local-https\nALLUMI_TLS_HOST=127.0.0.1\nAPP_URL=https://127.0.0.1:28080\nALLUMI_HTTP_PORT=28080\nALLUMI_BIND_ADDRESS=127.0.0.1\nTRUSTED_PROXY_HOPS=1\nAUTH_SECRET=private-sentinel\nALLUMI_APP_IMAGE=example:installed\n')
        docker = self.root/'bin/docker'
        docker.write_text(helper.DOCKER.replace('args=sys.argv[1:]', 'args=sys.argv[1:]\nif any(os.environ.get(k) for k in ["APP_URL","TRUSTED_PROXY_HOPS","ALLUMI_NETWORK_MODE","ALLUMI_TLS_HOST","ALLUMI_BIND_ADDRESS","COMPOSE_FILE","DATABASE_URL","AUTH_SECRET"]): sys.exit(97)'))
        docker.chmod(0o755)
        git = self.root/'bin/git'
        git.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$ALLUMI_DIR/git.log"\n')
        git.chmod(0o755)
        self.log = self.root/'docker.log'
        self.env = {**os.environ, 'PATH':str(self.root/'bin')+os.pathsep+os.environ['PATH'], 'ALLUMI_DIR':str(self.root), 'ENV_FILE':str(self.dotenv), 'TLS_TEST_LOG':str(self.log)}

    def run_shell(self, body, *args, **environment):
        return subprocess.run(['bash','-c','set -eu; . "$ALLUMI_DIR/scripts/lib.sh"; '+body,'bash',*args],env={**self.env,**environment},text=True,capture_output=True,timeout=15)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_unsafe_https_blocks_all_start_operations_even_when_failure_is_caught(self):
        before = self.dotenv.read_bytes()
        for operation in ['up','start','restart','create']:
            with self.subTest(operation=operation):
                self.log.unlink(missing_ok=True)
                result = self.run_shell('if compose "$@"; then exit 0; else exit 7; fi',operation,'app',TLS_TEST_BAD_RENDER='app')
                self.assertEqual(result.returncode,7,result.stderr)
                self.assertFalse(any(operation in call for call in self.commands()))
                self.assertEqual(self.dotenv.read_bytes(),before)
                self.assertNotIn('private-sentinel',result.stdout+result.stderr)

    def test_up_and_update_refuse_before_image_or_git_changes(self):
        before = self.dotenv.read_bytes()
        for script,args in [('up.sh',['--build']),('update.sh',['--no-backup'])]:
            with self.subTest(script=script):
                self.log.unlink(missing_ok=True)
                result = subprocess.run(['bash',str(self.root/'scripts'/script),*args],env={**self.env,'TLS_TEST_BAD_RENDER':'db'},capture_output=True,text=True,timeout=15)
                self.assertNotEqual(result.returncode,0)
                self.assertFalse((self.root/'git.log').exists())
                self.assertFalse(any(any(verb in call for verb in ['up','pull','stop']) for call in self.commands()))
                self.assertEqual(self.dotenv.read_bytes(),before)

    def test_validation_and_start_use_the_same_file_despite_shell_overrides(self):
        result = self.run_shell('compose up -d app',APP_URL='http://evil.test',TRUSTED_PROXY_HOPS='5',ALLUMI_NETWORK_MODE='direct',ALLUMI_TLS_HOST='evil.test',ALLUMI_BIND_ADDRESS='0.0.0.0',COMPOSE_FILE='untrusted.yaml',DATABASE_URL='postgresql://wrong',AUTH_SECRET='exported-private')
        self.assertEqual(result.returncode,0,result.stderr)
        commands = self.commands()
        self.assertTrue(any('config' in call for call in commands))
        self.assertTrue(any('up' in call for call in commands))
        for call in commands:
            if '--env-file' in call:
                self.assertEqual(call[call.index('--env-file')+1],str(self.dotenv))
                self.assertIn(str(self.root/'compose.https.yaml'),call)

    def test_stop_is_available_to_recover_an_unsafe_configuration(self):
        result = self.run_shell('compose stop app',TLS_TEST_BAD_RENDER='app')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(any('stop' in call for call in self.commands()))
        self.assertFalse(any('config' in call for call in self.commands()))

    def test_http_legacy_does_not_require_the_tls_helper(self):
        self.dotenv.write_text('ALLUMI_NETWORK_MODE=direct\nAPP_URL=http://127.0.0.1:28080\n')
        (self.root/'scripts/enable-local-https.sh').unlink()
        result = self.run_shell('compose up -d app')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(any('up' in call for call in self.commands()))
        self.assertFalse(any('config' in call for call in self.commands()))

    def test_unknown_network_mode_cannot_fall_back_to_public_http(self):
        self.dotenv.write_text(self.dotenv.read_text().replace('local-https','local-https-typo'))
        result = self.run_shell('if compose up -d; then exit 0; else exit 7; fi')
        self.assertEqual(result.returncode,7,result.stderr)
        self.assertEqual(self.commands(),[])

    def test_ambiguous_network_modes_are_rejected_before_docker(self):
        for declaration in ['export ALLUMI_NETWORK_MODE=local-https', ' ALLUMI_NETWORK_MODE=local-https', 'ALLUMI_NETWORK_MODE = local-https', 'ALLUMI_NETWORK_MODE=local-https\nALLUMI_NETWORK_MODE=direct', '\ufeffALLUMI_NETWORK_MODE=local-https', 'export ALLUMI_TLS_HOST=127.0.0.1', 'export COMPOSE_FILE=docker-compose.yml:compose.https.yaml', 'ALLUMI_TLS_HOST=127.0.0.1\nALLUMI_TLS_HOST=', 'COMPOSE_FILE=docker-compose.yml:compose.https.yaml\nCOMPOSE_FILE=docker-compose.yml']:
            with self.subTest(declaration=declaration):
                self.dotenv.write_text(declaration+'\nAPP_URL=https://127.0.0.1:28080\n')
                result = self.run_shell('if compose up -d; then exit 0; else exit 7; fi')
                self.assertEqual(result.returncode,7,result.stderr)
                self.assertEqual(self.commands(),[])

    def test_stale_tls_metadata_cannot_silently_reopen_http(self):
        for mode in ['', 'ALLUMI_NETWORK_MODE=direct\n']:
            for metadata in ['ALLUMI_TLS_HOST=127.0.0.1\n', 'COMPOSE_FILE=docker-compose.yml:compose.https.yaml\n']:
                with self.subTest(mode=mode,metadata=metadata):
                    self.dotenv.write_text(mode+metadata+'APP_URL=https://127.0.0.1:28080\n')
                    result = self.run_shell('if compose up -d; then exit 0; else exit 7; fi')
                    self.assertEqual(result.returncode,7,result.stderr)
                    self.assertEqual(self.commands(),[])


if __name__ == '__main__':
    unittest.main()
