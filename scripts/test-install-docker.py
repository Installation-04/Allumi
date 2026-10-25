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
if any(os.environ.get(k) for k in ['DATABASE_URL','APP_DATABASE_URL','ALLUMI_HTTP_PORT','ALLUMI_HTTPS_PORT','ALLUMI_BIND_ADDRESS','DEFAULT_LOCALE','ALLUMI_APP_IMAGE','ALLUMI_MIGRATE_IMAGE']): sys.exit(97)
with open(os.environ['DOCKER_TEST_LOG'],'a') as f: f.write(' '.join(args)+'\n')
if args==['info'] and os.environ.get('DOCKER_TEST_DENY'): sys.exit(1)
if args[:2]==['ps','-aq'] or args[:2]==['volume','ls']:
 if os.environ.get('DOCKER_TEST_EXISTING'): print('existing-resource')
elif args and args[0]=='inspect': print(os.environ.get('DOCKER_TEST_HEALTH','healthy'))
elif 'config' in args:
 if os.environ.get('DOCKER_TEST_BAD_CONFIG'): sys.exit(1)
elif 'pull' in args:
 if os.environ.get('DOCKER_TEST_BAD_PULL'): sys.exit(1)
elif 'exec' in args:
 if os.environ.get('DOCKER_TEST_SETUP_CLOSED'): sys.exit(3)
 if os.environ.get('DOCKER_TEST_EXEC_FAIL'): sys.exit(2)
elif 'up' in args:
 if os.environ.get('DOCKER_TEST_BAD_UP'): sys.exit(1)
elif 'ps' in args: print('app-container')
'''

class Harness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'scripts').mkdir()
        (self.root/'bin').mkdir()
        for path in ['scripts/install-docker.sh','scripts/installer-options.sh','scripts/lib.sh','scripts/up.sh','scripts/update.sh','.env.example','docker-compose.yml']:
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

class Installer(Harness):
    def test_new_install_and_repeat_preserve_secrets(self):
        first=self.run_install();self.assertEqual(first.returncode,0,first.stderr)
        original=self.config()
        for key in ['POSTGRES_PASSWORD','APP_DB_PASSWORD','AUTH_SECRET','ENCRYPTION_KEY','SETUP_TOKEN']:
            self.assertTrue(original[key]);self.assertNotIn('CHANGE_ME',original[key])
            if key!='SETUP_TOKEN': self.assertNotIn(original[key],first.stdout+first.stderr)
        # The one-time /setup token is the only secret shown: the person installing needs it right away.
        self.assertEqual(first.stdout.count(original['SETUP_TOKEN']),1);self.assertNotIn(original['SETUP_TOKEN'],first.stderr)
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

    def test_bootstrap_distinguishes_preparation_from_startup(self):
        report=self.root/'result'
        for action,expected in [('2','prepared'),('1','started')]:
            result=subprocess.run(['bash','-c','exec 3>"$1"; shift; exec "$@"','bash',str(report),'bash',str(self.root/'scripts/install-docker.sh'),'--interactive'],env={**self.env,'ALLUMI_REPORT_RESULT':'1'},input='1\nhttp://192.168.1.20:28080\n\n'+action+'\no\n',text=True,capture_output=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(report.read_text().strip(),expected)

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

    # --- first-setup token: shown at the end of the install, only while /setup is open ---
    def token(self):
        return self.config()['SETUP_TOKEN']
    def test_a_new_install_shows_the_token_once_and_says_what_it_is_for(self):
        result=self.run_install();self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.count(self.token()),1)
        self.assertRegex(result.stdout,r'Jeton\s+: '+self.token()+r'\s+\(à saisir une seule fois sur la page /setup\)')
        self.assertLess(result.stdout.index('Début'),result.stdout.index(self.token()),'the token comes with the "open /setup" step')
        self.assertNotIn('SETUP_TOKEN dans .env',result.stdout)
    def test_the_token_is_the_only_secret_printed(self):
        result=self.run_install()
        for key in ['POSTGRES_PASSWORD','APP_DB_PASSWORD','AUTH_SECRET','ENCRYPTION_KEY']:
            self.assertNotIn(self.config()[key],result.stdout+result.stderr)
    def test_an_instance_that_is_already_configured_does_not_get_a_useless_secret_on_screen(self):
        self.assertEqual(self.run_install().returncode,0)
        again=self.run_install(DOCKER_TEST_SETUP_CLOSED='1');self.assertEqual(again.returncode,0,again.stderr)
        self.assertNotIn(self.token(),again.stdout+again.stderr)
        self.assertIn("inutile, l'instance est déjà configurée",again.stdout)
    def test_a_probe_that_cannot_answer_points_to_the_file_instead_of_guessing(self):
        result=self.run_install(DOCKER_TEST_EXEC_FAIL='1');self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn(self.token(),result.stdout+result.stderr)
        self.assertIn('SETUP_TOKEN',result.stdout);self.assertIn(str(self.root/'.env'),result.stdout)
    def test_the_probe_runs_in_the_app_container_against_the_real_page(self):
        self.assertEqual(self.run_install().returncode,0)
        probe=[line for line in self.log.read_text().splitlines() if ' exec -T app node -e ' in line]
        self.assertEqual(len(probe),1)
        self.assertIn('http://127.0.0.1:3000/setup',probe[0]);self.assertIn("redirect:'manual'",probe[0]);self.assertIn('setupToken',probe[0])
    def test_under_install_sh_the_wrapper_prints_the_summary_so_there_is_no_duplicate(self):
        # Like install.sh: the result goes to a private descriptor the wrapper reads.
        result=subprocess.run(['bash','-c','exec 3>"$1"; shift; exec "$@"','bash',str(self.root/'result'),'bash',str(self.root/'scripts/install-docker.sh'),'--app-url','http://allumi.example.test:28080'],env={**self.env,'ALLUMI_REPORT_RESULT':'1'},text=True,capture_output=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((self.root/'result').read_text().strip(),'started')
        self.assertNotIn(self.config()['SETUP_TOKEN'],result.stdout+result.stderr)
        self.assertFalse([line for line in self.log.read_text().splitlines() if ' exec -T app node -e ' in line],'the wrapper does the probe, once')
    def test_prepare_only_starts_nothing_so_there_is_no_token_to_show(self):
        result=self.run_install('--prepare-only');self.assertEqual(result.returncode,0)
        self.assertNotIn(self.token(),result.stdout+result.stderr);self.assertFalse(self.log.exists())
    def test_the_wrapper_uses_the_same_helper_and_not_its_own_unconditional_line(self):
        wrapper=(ROOT/'scripts/install.sh').read_text()
        self.assertIn('print_setup_token',wrapper);self.assertNotIn('SETUP_TOKEN_VALUE',wrapper)
        self.assertNotIn('env_get SETUP_TOKEN',wrapper)

class PublishedImages(Harness):
    """A copy sitting exactly on a release tag downloads the images the release published; anything else builds."""
    # A developer shell or a CI job exports these; the scripts must not let them override the deployment's .env.
    LEAKED={'DATABASE_URL':'postgresql://dev:dev@localhost/dev','APP_DATABASE_URL':'postgresql://dev:dev@localhost/dev','ALLUMI_HTTP_PORT':'9999','ALLUMI_APP_IMAGE':'evil/app:1','ALLUMI_MIGRATE_IMAGE':'evil/migrate:1'}
    def setUp(self):
        super().setUp();self.env.update(self.LEAKED)
    GIT_ENV={'GIT_AUTHOR_NAME':'t','GIT_AUTHOR_EMAIL':'t@t','GIT_COMMITTER_NAME':'t','GIT_COMMITTER_EMAIL':'t@t'}
    def git(self,*args):
        subprocess.run(['git',*args],cwd=self.root,check=True,capture_output=True,env={**os.environ,**self.GIT_ENV})
    def release(self,tag='v0.4.0-alpha.10'):
        if not (self.root/'.git').exists():
            self.git('init','-q');self.git('config','core.excludesFile','/dev/null')
            (self.root/'.gitignore').write_text('.env\ndocker.log\nbin/\n*.install*\nresult\n')
        self.git('add','-A');self.git('commit','-q','--allow-empty','-m',tag);self.git('tag','-a',tag,'-m',tag)
    def commands(self):
        return self.log.read_text().splitlines() if self.log.exists() else []
    def pulled(self):
        return [line for line in self.commands() if ' pull ' in f' {line} ']
    def started(self):
        return [line for line in self.commands() if ' up ' in f' {line} ']
    def test_a_release_tag_downloads_the_published_images_and_never_builds(self):
        self.release()
        result=self.run_install();self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(len(self.pulled()),1);self.assertIn('pull --quiet app migrate',self.pulled()[0])
        self.assertEqual(len(self.started()),1);self.assertIn('up -d --no-build --remove-orphans',self.started()[0])
        self.assertNotIn('--build',self.started()[0])
        config=self.config()
        self.assertEqual(config['ALLUMI_APP_IMAGE'],'ghcr.io/installation-04/allumi:0.4.0-alpha.10')
        self.assertEqual(config['ALLUMI_MIGRATE_IMAGE'],'ghcr.io/installation-04/allumi-migrate:0.4.0-alpha.10')
        self.assertIn('aucune compilation',result.stdout)
    def test_unavailable_published_images_fall_back_to_a_local_build_without_pinning_them(self):
        self.release()
        result=self.run_install(DOCKER_TEST_BAD_PULL='1');self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('up -d --build --remove-orphans',self.started()[0])
        self.assertNotIn('ALLUMI_APP_IMAGE',self.config());self.assertNotIn('ALLUMI_MIGRATE_IMAGE',self.config())
        self.assertIn('indisponibles',result.stderr)
    def test_an_untagged_commit_builds_locally(self):
        self.release();self.git('commit','-q','--allow-empty','-m','after the release')
        self.assertEqual(self.run_install().returncode,0)
        self.assertEqual(self.pulled(),[]);self.assertIn('up -d --build',self.started()[0])
        self.assertNotIn('ALLUMI_APP_IMAGE',self.config())
    def test_local_changes_to_tracked_files_build_locally_because_the_image_would_not_contain_them(self):
        self.release();(self.root/'docker-compose.yml').write_text((self.root/'docker-compose.yml').read_text()+'# local edit\n')
        self.assertEqual(self.run_install().returncode,0)
        self.assertEqual(self.pulled(),[]);self.assertIn('up -d --build',self.started()[0])
    def test_build_flag_forces_a_local_build_on_a_release(self):
        self.release()
        self.assertEqual(self.run_install('--build').returncode,0)
        self.assertEqual(self.pulled(),[]);self.assertIn('up -d --build',self.started()[0])
        self.assertNotIn('ALLUMI_APP_IMAGE',self.config())
    def test_a_prerelease_and_a_final_tag_map_to_their_own_images(self):
        self.release('v1.2.3')
        self.assertEqual(self.run_install().returncode,0)
        self.assertEqual(self.config()['ALLUMI_APP_IMAGE'],'ghcr.io/installation-04/allumi:1.2.3')
    def test_a_repeat_install_follows_the_checked_out_version_and_drops_the_pin_off_a_release(self):
        self.release();self.assertEqual(self.run_install().returncode,0)
        self.git('commit','-q','--allow-empty','-m','next');self.git('tag','-a','v0.4.0-alpha.11','-m','next')
        self.assertEqual(self.run_install().returncode,0)
        self.assertEqual(self.config()['ALLUMI_APP_IMAGE'],'ghcr.io/installation-04/allumi:0.4.0-alpha.11')
        self.assertEqual(self.config()['ALLUMI_MIGRATE_IMAGE'],'ghcr.io/installation-04/allumi-migrate:0.4.0-alpha.11')
        self.git('commit','-q','--allow-empty','-m','work in progress')
        self.assertEqual(self.run_install().returncode,0)
        self.assertNotIn('ALLUMI_APP_IMAGE',self.config());self.assertNotIn('ALLUMI_MIGRATE_IMAGE',self.config())
    def test_secrets_survive_switching_between_published_and_local_images(self):
        self.release();self.assertEqual(self.run_install().returncode,0)
        before={key:value for key,value in self.config().items() if key in ['POSTGRES_PASSWORD','APP_DB_PASSWORD','AUTH_SECRET','ENCRYPTION_KEY','SETUP_TOKEN']}
        self.assertEqual(self.run_install('--build').returncode,0)
        self.assertEqual(before,{key:self.config()[key] for key in before})
    def test_prepare_only_does_not_pull(self):
        self.release();self.assertEqual(self.run_install('--prepare-only').returncode,0)
        self.assertFalse(self.log.exists());self.assertNotIn('ALLUMI_APP_IMAGE',self.config())
    def test_a_parent_repository_is_not_mistaken_for_this_folder(self):
        self.release();nested=self.root/'nested';nested.mkdir()
        probe=lambda directory:subprocess.run(['bash','-c','. "$1/scripts/lib.sh"; release_tag','bash',str(self.root)],env={**self.env,'ALLUMI_DIR':str(directory)},text=True,capture_output=True,timeout=15).stdout.strip()
        self.assertEqual(probe(self.root),'v0.4.0-alpha.10')
        self.assertEqual(probe(nested),'')
    def test_up_script_selects_images_for_the_checkout_and_needs_a_configuration(self):
        self.release()
        missing=subprocess.run(['bash',str(self.root/'scripts/up.sh')],env=self.env,text=True,capture_output=True,timeout=15)
        self.assertNotEqual(missing.returncode,0)
        self.assertEqual(self.run_install('--prepare-only').returncode,0)
        result=subprocess.run(['bash',str(self.root/'scripts/up.sh')],env=self.env,text=True,capture_output=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('up -d --no-build',self.started()[0])
        self.assertEqual(subprocess.run(['bash',str(self.root/'scripts/up.sh'),'--nope'],env=self.env,capture_output=True,timeout=15).returncode,1)
    def remote_with_two_releases(self):
        """self.root is a clone sitting on v0.4.0-alpha.10; the (bare, local) origin also has v0.4.0-alpha.11."""
        self.release();self.git('commit','-q','--allow-empty','-m','next');self.git('tag','-a','v0.4.0-alpha.11','-m','next')
        remote=self.root.parent/(self.root.name+'-remote.git')
        subprocess.run(['git','clone','-q','--bare',str(self.root),str(remote)],check=True,capture_output=True)
        self.git('remote','add','origin',str(remote));self.git('fetch','-q','origin')
        self.git('checkout','-q','v0.4.0-alpha.10')
        self.assertEqual(self.run_install('--prepare-only').returncode,0)
    def update(self,*args,**env):
        return subprocess.run(['bash',str(self.root/'scripts/update.sh'),'--no-backup',*args],env={**self.env,**env},text=True,capture_output=True,timeout=60)
    def test_updating_to_a_release_downloads_its_images_instead_of_building(self):
        self.remote_with_two_releases()
        result=self.update('v0.4.0-alpha.11');self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(len(self.pulled()),1);self.assertIn('up -d --no-build',self.started()[0])
        self.assertEqual(self.config()['ALLUMI_APP_IMAGE'],'ghcr.io/installation-04/allumi:0.4.0-alpha.11')
        self.assertEqual(self.config()['ALLUMI_MIGRATE_IMAGE'],'ghcr.io/installation-04/allumi-migrate:0.4.0-alpha.11')
    def test_updating_with_the_build_flag_builds_locally(self):
        self.remote_with_two_releases()
        result=self.update('--build','v0.4.0-alpha.11');self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.pulled(),[]);self.assertIn('up -d --build',self.started()[0])
        self.assertNotIn('ALLUMI_APP_IMAGE',self.config())
    def test_updating_with_unavailable_images_falls_back_to_a_build(self):
        self.remote_with_two_releases()
        result=self.update('v0.4.0-alpha.11',DOCKER_TEST_BAD_PULL='1');self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('up -d --build',self.started()[-1]);self.assertNotIn('ALLUMI_APP_IMAGE',self.config())
    def test_a_rejected_update_argument_changes_nothing(self):
        self.remote_with_two_releases()
        self.assertNotEqual(self.update('--nope').returncode,0)
        self.assertEqual(self.commands(),[])
    def test_compose_file_keeps_local_names_as_the_default_for_development_and_ci(self):
        text=(ROOT/'docker-compose.yml').read_text()
        self.assertIn('${ALLUMI_APP_IMAGE:-allumi-app:local}',text);self.assertIn('${ALLUMI_MIGRATE_IMAGE:-allumi-migrate:local}',text)
        for service in ['app','migrate']:
            self.assertIn('build:',text.split(f'  {service}:')[1].split('\n\n')[0])


if __name__=='__main__': unittest.main()
