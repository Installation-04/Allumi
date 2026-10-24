#!/usr/bin/env python3
"""Installer contract tests with an isolated filesystem and Docker command stub (no daemon)."""
import os
import pty
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOCKER = r'''#!/usr/bin/env python3
import os,sys
from pathlib import Path
args=sys.argv[1:]
if any(os.environ.get(k) for k in ['DATABASE_URL','APP_DATABASE_URL','ALLUMI_HTTP_PORT','ALLUMI_HTTPS_PORT','ALLUMI_BIND_ADDRESS','DEFAULT_LOCALE']): sys.exit(97)
with open(os.environ['DOCKER_TEST_LOG'],'a') as f: f.write(' '.join(args)+'\n')
if args==['info'] and os.environ.get('DOCKER_TEST_DENY'): sys.exit(1)
if args[:2]==['ps','-aq'] or args[:2]==['volume','ls']:
 if os.environ.get('DOCKER_TEST_EXISTING'): print('existing-resource')
elif args and args[0]=='inspect': print(os.environ.get('DOCKER_TEST_HEALTH','healthy'))
elif 'config' in args:
 if os.environ.get('DOCKER_TEST_BAD_CONFIG'): sys.exit(1)
elif 'up' in args:
 if os.environ.get('DOCKER_TEST_BAD_UP'): sys.exit(1)
elif 'ps' in args: print('app-container')
'''

class Installer(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'scripts').mkdir()
        (self.root/'bin').mkdir()
        for path in ['scripts/install-docker.sh','scripts/installer-options.sh','scripts/lib.sh','.env.example','docker-compose.yml']:
            shutil.copyfile(ROOT/path,self.root/path)
        docker=self.root/'bin/docker';docker.write_text(DOCKER);docker.chmod(0o755)
        self.log=self.root/'docker.log'
        self.env={**os.environ,'PATH':str(self.root/'bin')+os.pathsep+os.environ['PATH'],'ALLUMI_DIR':str(self.root),'ENV_FILE':str(self.root/'.env'),'DOCKER_TEST_LOG':str(self.log)}
        for key in ['COMPOSE_PROJECT_NAME','COMPOSE_FILE']:
            self.env.pop(key,None)
    def run_install(self,*extra,valid=True,input_text=None,**env):
        args=['bash',str(self.root/'scripts/install-docker.sh')]
        if valid: args+=['--app-url','http://allumi.example.test:28080']
        return subprocess.run(args+list(extra),env={**self.env,**env},text=True,capture_output=True,timeout=15,input=input_text)
    def config(self):
        return dict(line.split('=',1) for line in (self.root/'.env').read_text().splitlines() if line and not line.startswith('#'))
    def test_new_install_and_repeat_preserve_secrets(self):
        first=self.run_install();self.assertEqual(first.returncode,0,first.stderr)
        original=self.config()
        for key in ['POSTGRES_PASSWORD','APP_DB_PASSWORD','AUTH_SECRET','ENCRYPTION_KEY','SETUP_TOKEN']:
            self.assertTrue(original[key]);self.assertNotIn('CHANGE_ME',original[key]);self.assertNotIn(original[key],first.stdout+first.stderr)
        self.assertIn(original['POSTGRES_PASSWORD'],original['DATABASE_URL'])
        self.assertIn(original['APP_DB_PASSWORD'],original['APP_DATABASE_URL'])
        self.assertEqual(stat.S_IMODE((self.root/'.env').stat().st_mode),0o600)
        self.assertEqual(self.run_install().returncode,0)
        self.assertEqual(original,self.config())
        log=self.log.read_text();self.assertIn('up -d --build',log);self.assertIn('config --quiet',log)
        self.assertNotIn('down',log)
    def test_existing_https_url_is_not_silently_downgraded(self):
        self.assertEqual(self.run_install('--app-url','https://allumi.example.test','--prepare-only').returncode,0)
        result=self.run_install('--prepare-only',valid=False)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.config()['APP_URL'],'https://allumi.example.test')

    def test_legacy_proxy_trust_is_reset_once_without_changing_secrets(self):
        self.assertEqual(self.run_install('--prepare-only').returncode,0)
        original=self.config()
        path=self.root/'.env'
        path.write_text(path.read_text().replace('ALLUMI_NETWORK_MODE=direct','ALLUMI_NETWORK_MODE=caddy').replace('TRUSTED_PROXY_HOPS=0','TRUSTED_PROXY_HOPS=1'))
        self.assertEqual(self.run_install('--prepare-only').returncode,0)
        self.assertEqual(self.config()['TRUSTED_PROXY_HOPS'],'0')
        self.assertEqual(self.config()['AUTH_SECRET'],original['AUTH_SECRET'])
        path.write_text(path.read_text().replace('TRUSTED_PROXY_HOPS=0','TRUSTED_PROXY_HOPS=1'))
        self.assertEqual(self.run_install('--prepare-only').returncode,0)
        self.assertEqual(self.config()['TRUSTED_PROXY_HOPS'],'1')

    def test_prepare_only_does_not_call_docker(self):
        result=self.run_install('--prepare-only');self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse(self.log.exists());self.assertTrue((self.root/'.env').exists())
    def test_invalid_arguments_leave_no_config(self):
        for args in [[],['--app-url'],['--app-url','ftp://example.test'],['--app-url','http://example.test/path'],['--app-url','http://user:pass@example.test'],['--app-url','http://example.test:0'],['--app-url','http://example.test','--timeout','0'],['--app-url','http://$(touch nope)']]:
            self.assertNotEqual(self.run_install(*args,valid=False).returncode,0,args)
            self.assertFalse((self.root/'.env').exists())
    def test_daemon_failure_leaves_no_config(self):
        self.assertNotEqual(self.run_install(DOCKER_TEST_DENY='1').returncode,0)
        self.assertFalse((self.root/'.env').exists())
    def test_existing_volumes_without_config_are_refused(self):
        self.assertNotEqual(self.run_install(DOCKER_TEST_EXISTING='1').returncode,0)
        self.assertFalse((self.root/'.env').exists())
    def test_invalid_existing_config_is_not_replaced(self):
        shutil.copyfile(self.root/'.env.example',self.root/'.env');before=(self.root/'.env').read_bytes()
        self.assertNotEqual(self.run_install().returncode,0)
        self.assertEqual(before,(self.root/'.env').read_bytes())
    def test_development_database_is_refused(self):
        self.assertEqual(self.run_install('--prepare-only').returncode,0)
        path=self.root/'.env';path.write_text(path.read_text().replace('@db:5432/','@localhost:5432/'));before=path.read_bytes()
        self.assertNotEqual(self.run_install().returncode,0);self.assertEqual(path.read_bytes(),before)
    def test_config_failure_does_not_publish_partial_changes(self):
        self.assertNotEqual(self.run_install(DOCKER_TEST_BAD_CONFIG='1').returncode,0)
        self.assertFalse((self.root/'.env').exists());self.assertFalse((self.root/'.env.install-lock').exists())
    def test_start_failure_and_health_timeout_are_errors(self):
        for settings in [{'DOCKER_TEST_BAD_UP':'1'},{'DOCKER_TEST_HEALTH':'unhealthy'}]:
            result=self.run_install('--timeout','1',**settings)
            self.assertNotEqual(result.returncode,0);self.assertNotIn('est démarré',result.stdout)
            self.assertTrue((self.root/'.env').exists())
    def test_development_environment_cannot_override_deployment_credentials(self):
        result=self.run_install(DATABASE_URL='postgresql://user:pass@remote:5432/db',APP_DATABASE_URL='postgresql://user:pass@remote:5432/db')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('@db:5432/',self.config()['DATABASE_URL'])
    def test_symlink_configuration_is_refused(self):
        target=self.root/'other';target.write_text('keep')
        (self.root/'.env').symlink_to(target)
        self.assertNotEqual(self.run_install('--prepare-only').returncode,0)
        self.assertEqual(target.read_text(),'keep')
    def test_lock_prevents_concurrent_installers(self):
        (self.root/'.env.install-lock').mkdir()
        self.assertNotEqual(self.run_install('--prepare-only').returncode,0)
        self.assertFalse((self.root/'.env').exists())

    def test_custom_ports_locale_and_bind_are_preserved_on_repeat(self):
        result=self.run_install('--app-url','http://allumi.example.test:8080','--http-port','8080','--bind','127.0.0.1','--locale','en')
        self.assertEqual(result.returncode,0,result.stderr)
        cfg=self.config()
        self.assertEqual(cfg['APP_URL'],'http://allumi.example.test:8080')
        self.assertEqual(cfg['ALLUMI_BIND_ADDRESS'],'127.0.0.1')
        self.assertEqual(cfg['ALLUMI_HTTP_PORT'],'8080')
        self.assertEqual(cfg['DEFAULT_LOCALE'],'en')
        self.assertEqual(self.run_install('--prepare-only',valid=False).returncode,0)
        self.assertEqual(self.config(),cfg)
    def test_invalid_network_options_are_refused_without_writes(self):
        for args in [('--http-port','0'),('--http-port','65536'),('--http-port','080'),('--bind','999.0.0.1'),('--bind','127.0.0.01'),('--bind','$(touch nope)'),('--locale','de'),('--http-port',)]:
            self.assertNotEqual(self.run_install(*args).returncode,0,args)
            self.assertFalse((self.root/'.env').exists())
    def test_wizard_advanced_validates_and_prepares(self):
        answers='2\nhttp://allumi.example.test:8080\nen\n127.0.0.1\n0\n8080\n600\n2\no\n'
        result=self.run_install('--interactive',input_text=answers)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('Valeur invalide',result.stderr)
        self.assertIn('Résumé',result.stderr)
        self.assertEqual(self.config()['APP_URL'],'http://allumi.example.test:8080')
        self.assertEqual(self.config()['DEFAULT_LOCALE'],'en')
        self.assertFalse(self.log.exists())
    def test_wizard_cancel_and_eof_do_not_change_existing_config(self):
        self.assertEqual(self.run_install('--prepare-only').returncode,0)
        before=(self.root/'.env').read_bytes()
        for answers in ['1\n\n\n2\nn\n','1\n']:
            result=self.run_install('--interactive',input_text=answers)
            self.assertEqual((self.root/'.env').read_bytes(),before)
            self.assertFalse(self.log.exists())
        self.assertNotEqual(result.returncode,0)
    def test_terminal_without_arguments_starts_wizard(self):
        master,slave=pty.openpty()
        try:
            os.write(master,b'1\nhttp://192.168.1.20:28080\n\n2\no\n')
            result=subprocess.run(['bash',str(self.root/'scripts/install-docker.sh')],stdin=slave,env=self.env,text=True,capture_output=True,timeout=15)
        finally:
            os.close(master);os.close(slave)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('Assistant',result.stderr)
        self.assertEqual(self.config()['APP_URL'],'http://192.168.1.20:28080')
        self.assertFalse(self.log.exists())
    def test_shell_network_variables_cannot_override_selected_settings(self):
        result=self.run_install(ALLUMI_HTTP_PORT='9876',ALLUMI_HTTPS_PORT='9877',ALLUMI_BIND_ADDRESS='127.0.0.9',DEFAULT_LOCALE='en')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.config()['ALLUMI_HTTP_PORT'],'28080')
        self.assertEqual(self.config()['DEFAULT_LOCALE'],'fr-CA')

if __name__=='__main__': unittest.main()
