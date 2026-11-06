#!/usr/bin/env python3
"""Local HTTPS helper tests with disposable files and Docker/curl mocks only."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOCKER = r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['TLS_TEST_LOG'],'a') as handle: handle.write(json.dumps(args)+'\n')
if args==['compose','version','--short']:
 print(os.environ.get('TLS_TEST_COMPOSE_VERSION','2.24.4'))
elif 'config' in args:
 if os.environ.get('TLS_TEST_BAD_CONFIG'): sys.exit(1)
 if '--format' in args:
  if '--env-file' not in args: sys.exit(95)
  source=Path(args[args.index('--env-file')+1])
  values=dict(line.split('=',1) for line in source.read_text().splitlines() if line and not line.startswith('#'))
  if not any(v.endswith('compose.https.yaml') for v in args): sys.exit(96)
  services={'app':{'environment':{'APP_URL':values.get('APP_URL'),'TRUSTED_PROXY_HOPS':values.get('TRUSTED_PROXY_HOPS')}},'db':{},'caddy':{'image':'caddy:2.11.8-alpine','environment':{'ALLUMI_TLS_HOST':values.get('ALLUMI_TLS_HOST')},'ports':[{'target':8443,'published':values.get('ALLUMI_HTTP_PORT','28080'),'protocol':'tcp','host_ip':values.get('ALLUMI_BIND_ADDRESS','0.0.0.0')}]}}
  bad=os.environ.get('TLS_TEST_BAD_RENDER')
  if bad=='app': services['app']['ports']=[{'target':3000,'published':'3000'}]
  if bad=='db': services['db']['ports']=[{'target':5432,'published':'5432'}]
  if bad=='other': services['other']={'ports':[{'target':80,'published':'80'}]}
  if bad=='host': services['app']['network_mode']='host'
  if bad=='port': services['caddy']['ports'][0]['published']='443'
  if bad=='bind': services['caddy']['ports'][0]['host_ip']='127.0.0.2'
  if bad=='tls_host': services['caddy']['environment']['ALLUMI_TLS_HOST']='192.168.50.50'
  if bad=='udp': services['caddy']['ports'][0]['protocol']='udp'
  if bad=='extra': services['caddy']['ports'].append({'target':80,'published':'80'})
  if bad=='image': services['caddy']['image']='custom:latest'
  if bad=='url': services['app']['environment']['APP_URL']='http://127.0.0.1:28080'
  if bad=='trust': services['app']['environment']['TRUSTED_PROXY_HOPS']='0'
  print(json.dumps({'services':services}))
elif args and args[0]=='inspect': print(os.environ.get('TLS_TEST_HEALTH','healthy'))
elif 'exec' in args:
 if args[-2:]!=['cat','/data/caddy/pki/authorities/local/root.crt']: sys.exit(91)
 print(Path(os.environ['TLS_TEST_CERT']).read_text(),end='')
elif 'ps' in args: print('app-container')
'''


class LocalHttps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ca_temp = tempfile.TemporaryDirectory()
        cls.ca_root = Path(cls.ca_temp.name)
        cls.cert = cls.ca_root / 'root.crt'
        subprocess.run(['openssl','req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',str(cls.ca_root/'root.key'),'-out',str(cls.cert),'-subj','/CN=Allumi test CA','-days','1'],check=True,capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.ca_temp.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'scripts').mkdir()
        (self.root/'deploy').mkdir()
        (self.root/'bin').mkdir()
        for name in ['scripts/enable-local-https.sh','scripts/lib.sh','compose.https.yaml','deploy/Caddyfile.local','docker-compose.yml']:
            shutil.copyfile(ROOT/name,self.root/name)
        self.dotenv = self.root/'.env'
        self.original = 'APP_URL=http://127.0.0.1:28080\nALLUMI_HTTP_PORT=28080\nALLUMI_NETWORK_MODE=direct\nTRUSTED_PROXY_HOPS=0\nAUTH_SECRET=unchanged-value\n'
        self.dotenv.write_text(self.original)
        self.dotenv.chmod(0o600)
        self.log = self.root/'docker.log'
        docker = self.root/'bin/docker'
        docker.write_text(DOCKER)
        docker.chmod(0o755)
        curl = self.root/'bin/curl'
        curl.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TLS_TEST_CURL_LOG"\n[ "${TLS_TEST_BAD_CURL:-0}" = 0 ]\n')
        curl.chmod(0o755)
        sleep = self.root/'bin/sleep'
        sleep.write_text('#!/bin/sh\nexit 0\n')
        sleep.chmod(0o755)
        self.env = {**os.environ,'PATH':str(self.root/'bin')+os.pathsep+os.environ['PATH'],'ALLUMI_DIR':str(self.root),'ENV_FILE':str(self.dotenv),'TLS_TEST_LOG':str(self.log),'TLS_TEST_CERT':str(self.cert),'TLS_TEST_CURL_LOG':str(self.root/'curl.log')}
        for name in ['COMPOSE_FILE','APP_URL','ALLUMI_HTTP_PORT','ALLUMI_TLS_HOST','ALLUMI_NETWORK_MODE']:
            self.env.pop(name,None)

    def run_helper(self,*args,**env):
        return subprocess.run(['bash',str(self.root/'scripts/enable-local-https.sh'),*args],env={**self.env,**env},text=True,capture_output=True,timeout=15)

    def values(self):
        return dict(line.split('=',1) for line in self.dotenv.read_text().splitlines() if line and not line.startswith('#'))

    def calls(self):
        import json
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_prepare_is_atomic_preserves_secrets_and_never_calls_docker(self):
        result = self.run_helper('--host','192.168.1.20','--prepare-only')
        self.assertEqual(result.returncode,0,result.stderr)
        values=self.values()
        self.assertEqual(values['APP_URL'],'https://192.168.1.20:28080')
        self.assertEqual(values['TRUSTED_PROXY_HOPS'],'1')
        self.assertEqual(values['ALLUMI_NETWORK_MODE'],'local-https')
        self.assertEqual(values['ALLUMI_TLS_HOST'],'192.168.1.20')
        self.assertEqual(values['AUTH_SECRET'],'unchanged-value')
        self.assertEqual(values['COMPOSE_FILE'],'docker-compose.yml:compose.https.yaml')
        self.assertEqual(self.dotenv.stat().st_mode & 0o777,0o600)
        self.assertEqual(self.calls(),[])
        self.assertEqual(list(self.root.glob('.env.local-https.*')),[])

    def test_override_is_included_and_private_port_selection_is_explicit(self):
        (self.root/'compose.override.yaml').write_text('services:\n  app:\n    environment:\n      CUSTOM: ok\n')
        result=self.run_helper('--host','172.16.5.2','--port','28443','--prepare-only')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.values()['COMPOSE_FILE'],'docker-compose.yml:compose.https.yaml:compose.override.yaml')
        self.assertEqual(self.values()['APP_URL'],'https://172.16.5.2:28443')

    def test_invalid_inputs_do_not_change_the_configuration(self):
        for args in [[],['--host','8.8.8.8'],['--host','0.0.0.0'],['--host','192.168.001.2'],['--host','192.168.1.256'],['--host','$(id)'],['--host','::1'],['--host','127.0.0.1','--port','0'],['--host','127.0.0.1','--port','65536'],['--host','127.0.0.1','--prepare-only','--check']]:
            with self.subTest(args=args):
                self.assertNotEqual(self.run_helper(*args).returncode,0)
                self.assertEqual(self.dotenv.read_text(),self.original)
                self.assertEqual(self.calls(),[])

    def test_old_compose_or_bad_config_does_not_commit_the_prepared_env(self):
        for env in [{'TLS_TEST_COMPOSE_VERSION':'2.24.3'},{'TLS_TEST_BAD_CONFIG':'1'}]:
            with self.subTest(env=env):
                result=self.run_helper('--host','127.0.0.1',**env)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(self.dotenv.read_text(),self.original)
                self.assertFalse(any('up' in args for args in self.calls()))
                self.assertEqual(list(self.root.glob('.env.local-https.*')),[])

    def test_merged_overrides_cannot_reexpose_http_or_disable_proxy_safety(self):
        for bad in ['app','db','other','host','port','bind','tls_host','udp','extra','image','url','trust']:
            with self.subTest(bad=bad):
                result=self.run_helper('--host','127.0.0.1',TLS_TEST_BAD_RENDER=bad)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(self.dotenv.read_text(),self.original)
                self.assertFalse(any('up' in args for args in self.calls()))
                self.assertNotIn('unchanged-value',result.stderr+result.stdout)

    def test_normal_start_exports_only_the_public_ca_then_verifies_tls_without_insecure(self):
        # Even if container output contains extra material, openssl exports the certificate alone.
        source=self.root/'container-root-output.pem'
        source.write_text(self.cert.read_text()+(self.ca_root/'root.key').read_text())
        result=self.run_helper('--host','127.0.0.1',TLS_TEST_CERT=str(source))
        self.assertEqual(result.returncode,0,result.stderr)
        public=self.root/'local-https-root.crt'
        self.assertTrue(public.exists())
        self.assertNotIn('PRIVATE KEY',public.read_text())
        self.assertEqual(public.stat().st_mode & 0o777,0o644)
        self.assertIn('SHA256',result.stdout.upper())
        self.assertTrue(any('up' in args for args in self.calls()))
        self.assertTrue(any(args[-2:]==['cat','/data/caddy/pki/authorities/local/root.crt'] for args in self.calls()))
        curl=(self.root/'curl.log').read_text()
        self.assertIn('--cacert '+str(public),curl)
        self.assertNotIn('--insecure',curl)
        self.assertIn('https://127.0.0.1:28080/api/health',curl)
        self.assertEqual(list(self.root.glob('.local-https-ca.*')),[])

    def test_check_and_reexport_do_not_rewrite_env_or_start_containers(self):
        self.assertEqual(self.run_helper('--host','127.0.0.1','--prepare-only').returncode,0)
        content=self.dotenv.read_text()
        self.assertEqual(self.run_helper('--check').returncode,0)
        self.assertEqual(self.run_helper('--export-ca').returncode,0)
        self.assertEqual(self.dotenv.read_text(),content)
        self.assertFalse(any('up' in args for args in self.calls()))
        self.assertTrue((self.root/'local-https-root.crt').exists())

    def test_env_or_override_symlink_is_refused_without_following_it(self):
        target=self.root/'private.env'
        self.dotenv.rename(target)
        self.dotenv.symlink_to(target)
        self.assertNotEqual(self.run_helper('--host','127.0.0.1','--prepare-only').returncode,0)
        self.assertEqual(target.read_text(),self.original)
        self.dotenv.unlink()
        target.rename(self.dotenv)
        (self.root/'compose.override.yaml').symlink_to(self.root/'missing.yaml')
        self.assertNotEqual(self.run_helper('--host','127.0.0.1','--prepare-only').returncode,0)
        self.assertEqual(self.dotenv.read_text(),self.original)
        self.assertEqual(self.calls(),[])

    def test_ca_symlink_to_directory_is_replaced_without_writing_inside_target(self):
        self.assertEqual(self.run_helper('--host','127.0.0.1','--prepare-only').returncode,0)
        target=self.root/'existing-directory'
        target.mkdir()
        (target/'sentinel').write_text('unchanged')
        public=self.root/'local-https-root.crt'
        public.symlink_to(target, target_is_directory=True)
        result=self.run_helper('--export-ca')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse(public.is_symlink())
        self.assertTrue(public.is_file())
        self.assertNotIn('PRIVATE KEY',public.read_text())
        self.assertEqual(sorted(path.name for path in target.iterdir()),['sentinel'])
        self.assertEqual((target/'sentinel').read_text(),'unchanged')
        self.assertEqual(list(self.root.glob('.local-https-ca.*')),[])

    def test_ca_directory_destination_is_refused_without_publishing_inside_it(self):
        self.assertEqual(self.run_helper('--host','127.0.0.1','--prepare-only').returncode,0)
        public=self.root/'local-https-root.crt'
        public.mkdir()
        (public/'sentinel').write_text('unchanged')
        result=self.run_helper('--export-ca')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(sorted(path.name for path in public.iterdir()),['sentinel'])
        self.assertEqual(list(self.root.glob('.local-https-ca.*')),[])
        self.assertNotIn('Certificat racine public :',result.stdout)

    def test_env_directory_is_refused_and_atomic_publish_never_follows_a_raced_link(self):
        self.dotenv.unlink()
        self.dotenv.mkdir()
        (self.dotenv/'sentinel').write_text('unchanged')
        self.assertNotEqual(self.run_helper('--host','127.0.0.1','--prepare-only').returncode,0)
        self.assertEqual(sorted(path.name for path in self.dotenv.iterdir()),['sentinel'])
        (self.dotenv/'sentinel').unlink()
        self.dotenv.rmdir()
        self.dotenv.write_text(self.original)
        target=self.root/'replacement-directory'
        target.mkdir()
        (target/'sentinel').write_text('unchanged')
        actual_mv=shutil.which('mv')
        wrapper=self.root/'bin/mv'
        wrapper.write_text('#!/usr/bin/env python3\nimport os,pathlib,subprocess,sys\np=pathlib.Path(sys.argv[-1])\nif p.name==".env":\n p.unlink()\n p.symlink_to(os.environ["TLS_TEST_ENV_DIRECTORY"],target_is_directory=True)\nsys.exit(subprocess.call(['+repr(actual_mv)+']+sys.argv[1:]))\n')
        wrapper.chmod(0o755)
        result=self.run_helper('--host','127.0.0.1','--prepare-only',TLS_TEST_ENV_DIRECTORY=str(target))
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse(self.dotenv.is_symlink())
        self.assertEqual(self.values()['APP_URL'],'https://127.0.0.1:28080')
        self.assertEqual(sorted(path.name for path in target.iterdir()),['sentinel'])
        self.assertEqual((target/'sentinel').read_text(),'unchanged')
        self.dotenv.write_text(self.original)
        wrapper.write_text('#!/usr/bin/env python3\nimport pathlib,subprocess,sys\np=pathlib.Path(sys.argv[-1])\nif p.name==".env":\n p.unlink()\n p.mkdir()\n (p/"sentinel").write_text("unchanged")\nsys.exit(subprocess.call(['+repr(actual_mv)+']+sys.argv[1:]))\n')
        result=self.run_helper('--host','127.0.0.1','--prepare-only')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(sorted(path.name for path in self.dotenv.iterdir()),['sentinel'])
        self.assertEqual(list(self.root.glob('.env.local-https.*')),[])

    def test_tls_or_health_failure_never_reports_success(self):
        for env in [{'TLS_TEST_HEALTH':'unhealthy'},{'TLS_TEST_BAD_CURL':'1'}]:
            with self.subTest(env=env):
                result=self.run_helper('--host','127.0.0.1',**env)
                self.assertNotEqual(result.returncode,0)
                self.assertNotIn('HTTPS local actif',result.stdout)

    def test_overlay_and_proxy_contract_keep_http_private_and_ca_off_the_app(self):
        overlay=(ROOT/'compose.https.yaml').read_text()
        caddy=(ROOT/'deploy/Caddyfile.local').read_text()
        self.assertIn('ports: !reset []',overlay)
        self.assertIn('caddy:2.11.8-alpine',overlay)
        self.assertIn(':8443"',overlay)
        self.assertNotIn('/var/run/docker.sock',overlay)
        self.assertIn('admin off',caddy)
        self.assertIn('auto_https disable_redirects',caddy)
        self.assertIn('skip_install_trust',caddy)
        self.assertIn('tls internal',caddy)
        self.assertIn('header_up X-Forwarded-For {http.request.remote.host}',caddy)
        self.assertIn('header_up X-Forwarded-Proto https',caddy)
        app=overlay.split('  caddy:')[0]
        self.assertNotIn('/data',app)
        self.assertNotIn('/config',app)


if __name__=='__main__':
    unittest.main()
