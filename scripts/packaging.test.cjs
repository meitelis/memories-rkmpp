const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const shell = process.env.TEST_SH || '/bin/sh';
const canRunShell = spawnSync(shell, ['-c', 'exit 0']).status === 0;
const version = fs.readFileSync(path.join(root, 'memories_rkmpp_player/appinfo/info.xml'), 'utf8').match(/<version>([^<]+)<\/version>/)[1];

// Exercise the real host scripts against a filesystem-backed Docker substitute.
// No Docker daemon, network, real Nextcloud installation or personal media is used.
const mockDocker = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const base = process.env.MOCK_ROOT;
const remote = value => path.join(base, 'nextcloud', value.replace(/^\/+/, ''));
fs.appendFileSync(path.join(base, 'calls.jsonl'), JSON.stringify(args) + '\n');
function fail(message) { console.error(message); process.exit(17); }
function copyContents(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from)) fs.cpSync(path.join(from, item), path.join(to, item), { recursive: true });
}
if (args[0] === 'create') console.log('extract123');
else if (args[0] === 'rm' || args[0] === 'image' || args[0] === 'build') {}
else if (args[0] === 'compose') {
  if (args.includes('up') && process.env.MOCK_FAIL === 'compose') fail('healthcheck failed');
  if (args.includes('ps')) console.log('candidate');
} else if (args[0] === 'cp') {
  const [from, to] = args.slice(1);
  if (from.includes(':/')) {
    const [container, ...pieces] = from.split(':');
    const source = pieces.join(':');
    if (source === '/usr/share/memories-rkmpp/nextcloud-app/.') copyContents(path.join(base, 'bundle'), to);
    else fs.cpSync(remote(source), to, { recursive: true });
  } else {
    const destination = to.slice(to.indexOf(':') + 1);
    copyContents(from.replace(/\/\.$/, ''), remote(destination));
  }
} else if (args[0] === 'exec') {
  const php = args.indexOf('php');
  const sh = args.indexOf('sh');
  if (php !== -1) {
    const tail = args.slice(args.indexOf('--', php) + 1);
    const mode = tail[1];
    if (mode === process.env.MOCK_FAIL) fail('injected ' + mode + ' failure');
    if (mode === 'inspect') {
      console.log('/config/apps/memories_rkmpp_player');
      console.log(process.env.MOCK_NEW === '1' ? '' : '0.3.0');
      console.log(process.env.MOCK_NEW === '1' ? '0' : '1');
    } else if (mode === 'activate') console.log('Playback helper ' + tail[2] + ' enabled');
  } else if (sh !== -1) {
    const label = args[sh + 3];
    const values = args.slice(sh + 4);
    if (label === 'lock') {
      try { fs.mkdirSync(remote(values[0])); } catch { fail('lock already exists'); }
      fs.mkdirSync(remote(values[0] + '/new'));
    } else if (label === 'swap') {
      const [target, lock, exists] = values.map((value, i) => i < 2 ? remote(value) : value);
      if (exists === '1') fs.renameSync(target, lock + '/old');
      assertAbsent(target);
      fs.renameSync(lock + '/new', target);
    } else if (label === 'restore') {
      const [target, lock] = values.map(remote);
      fs.renameSync(target, lock + '/failed');
      if (fs.existsSync(lock + '/old')) fs.renameSync(lock + '/old', target);
    } else if (label === 'cleanup') {
      const lock = remote(values[0]);
      if (values[1] !== '1' && fs.existsSync(lock + '/old')) fail('old code retained');
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
} else fail('unsupported mock Docker command');
function assertAbsent(value) { if (fs.existsSync(value)) fail('unexpected target exists'); }
`;

function setup(t, extraEnv = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rkmpp-packaging-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  const bundle = path.join(directory, 'bundle');
  const target = path.join(directory, 'nextcloud/config/apps/memories_rkmpp_player');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(bundle, 'appinfo'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'appinfo/info.xml'), `<info><id>memories_rkmpp_player</id><version>${version}</version></info>\n`);
  fs.writeFileSync(path.join(bundle, 'new-file'), 'bundled');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (extraEnv.MOCK_NEW !== '1') {
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'old-file'), 'previous helper');
  }
  const mock = path.join(directory, 'docker.cjs');
  fs.writeFileSync(mock, mockDocker);
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(mock)} "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, MOCK_ROOT: directory, MSYS_NO_PATHCONV: '1', ...extraEnv };
  return {
    directory, bundle, target,
    run(script, args) {
      return spawnSync(shell, [path.join(__dirname, script), ...args], { cwd: directory, env, encoding: 'utf8', timeout: 15000 });
    },
    calls() {
      const file = path.join(directory, 'calls.jsonl');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    },
    update(args = []) {
      return this.run('update-nextcloud-player.sh', ['--engine', 'candidate', '--nextcloud', 'nextcloud', '--backup-dir', path.join(directory, 'backups with spaces'), ...args]);
    },
  };
}
function passed(result) { assert.equal(result.status, 0, result.stderr + result.stdout); }
function phpMode(call, mode) { return call[0] === 'exec' && call.includes('php') && call[call.indexOf('--') + 2] === mode; }
function shellMode(call, mode) { return call[0] === 'exec' && call.includes('sh') && call[call.indexOf('sh') + 3] === mode; }
const options = { skip: !canRunShell && 'POSIX shell required (run on the Docker host)' };

test('release builder preserves engine context and bundles the current helper version', options, t => {
  const fixture = setup(t);
  passed(fixture.run('build-release.sh', ['--image', 'local/release:r7']));
  const builds = fixture.calls().filter(call => call[0] === 'build');
  assert.equal(builds.length, 2);
  assert.equal(builds[0].at(-1), path.join(root, 'go-vod'));
  assert.equal(builds[1].at(-1), root);
  assert.ok(builds[1].includes('ENGINE_IMAGE=local/release:r7-engine'));
  assert.ok(builds[1].includes('PLAYER_VERSION=' + version));
});

test('release builder can reuse an already tested engine without rebuilding it', options, t => {
  const fixture = setup(t);
  passed(fixture.run('build-release.sh', ['--image', 'local/release:r7', '--engine-image', 'local/engine:r6']));
  const builds = fixture.calls().filter(call => call[0] === 'build');
  assert.equal(builds.length, 1);
  assert.ok(builds[0].includes('ENGINE_IMAGE=local/engine:r6'));
});

test('image dry run cleans up its extraction container and never writes Nextcloud', options, t => {
  const fixture = setup(t);
  passed(fixture.run('update-nextcloud-player.sh', ['--image', 'local/release:r7', '--nextcloud', 'nextcloud', '--dry-run']));
  const calls = fixture.calls();
  assert.ok(calls.some(call => call[0] === 'create'));
  assert.ok(calls.some(call => call[0] === 'rm' && call[1] === 'extract123'));
  assert.ok(!calls.some(call => shellMode(call, 'lock') || phpMode(call, 'activate')));
  assert.equal(fs.readFileSync(path.join(fixture.target, 'old-file'), 'utf8'), 'previous helper');
});

test('update retains a host backup before copying and activates only this app as the web user', options, t => {
  const fixture = setup(t);
  passed(fixture.update());
  const calls = fixture.calls();
  const backupCall = calls.findIndex(call => call[0] === 'cp' && call[1] === 'nextcloud:/config/apps/memories_rkmpp_player');
  const stageCall = calls.findIndex(call => call[0] === 'cp' && call[2]?.includes('nextcloud:/config/apps/.memories_rkmpp_player-update-lock/new/'));
  assert.ok(backupCall >= 0 && stageCall > backupCall);
  assert.equal(fs.readFileSync(path.join(calls[backupCall][2], 'old-file'), 'utf8'), 'previous helper');
  assert.ok(fs.existsSync(path.join(fixture.target, 'new-file')));
  assert.ok(!fs.existsSync(path.join(fixture.target, 'old-file')));
  const activation = calls.find(call => phpMode(call, 'activate'));
  assert.equal(activation[2], 'abc');
  assert.ok(activation[activation.indexOf('php') + 2].includes("$app = 'memories_rkmpp_player'"));
  assert.ok(!calls.some(call => call.includes('app:upgrade') || call.includes('/var/run/docker.sock')));
  assert.ok(!fs.existsSync(path.join(path.dirname(fixture.target), '.memories_rkmpp_player-update-lock')));
});

test('first install stages and activates the helper without inventing an old-app backup', options, t => {
  const fixture = setup(t, { MOCK_NEW: '1' });
  passed(fixture.update());
  assert.ok(fs.existsSync(path.join(fixture.target, 'new-file')));
  assert.ok(!fixture.calls().some(call => call[0] === 'cp' && call[1] === 'nextcloud:/config/apps/memories_rkmpp_player'));
  assert.ok(fixture.calls().some(call => phpMode(call, 'activate')));
});

test('wrong bundled app identity is rejected before any Nextcloud operation', options, t => {
  const fixture = setup(t);
  fs.writeFileSync(path.join(fixture.bundle, 'appinfo/info.xml'), '<info><id>another_app</id><version>1</version></info>');
  assert.notEqual(fixture.update().status, 0);
  assert.ok(!fixture.calls().some(call => call[0] === 'exec'));
});

test('failed candidate validation preserves the installed app and releases our lock', options, t => {
  const fixture = setup(t, { MOCK_FAIL: 'validate' });
  assert.notEqual(fixture.update().status, 0);
  assert.ok(fs.existsSync(path.join(fixture.target, 'old-file')));
  assert.ok(!fixture.calls().some(call => shellMode(call, 'swap') || phpMode(call, 'activate')));
  assert.ok(!fs.existsSync(path.join(path.dirname(fixture.target), '.memories_rkmpp_player-update-lock')));
});

test('activation failure restores the old directory and reports the retained backup', options, t => {
  const fixture = setup(t, { MOCK_FAIL: 'activate' });
  const result = fixture.update();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /previous code restored.*Backup:/);
  assert.ok(fs.existsSync(path.join(fixture.target, 'old-file')));
  assert.ok(!fs.existsSync(path.join(fixture.target, 'new-file')));
  assert.ok(fixture.calls().some(call => shellMode(call, 'restore')));
});

test('an existing lock is retained and prevents copying or activation', options, t => {
  const fixture = setup(t);
  const lock = path.join(path.dirname(fixture.target), '.memories_rkmpp_player-update-lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'other-update'), 'do not remove');
  assert.notEqual(fixture.update().status, 0);
  assert.ok(fs.existsSync(path.join(lock, 'other-update')));
  assert.ok(!fixture.calls().some(call => phpMode(call, 'activate') || shellMode(call, 'cleanup')));
});

test('invalid names, path traversal and ambiguous sources fail before Docker', options, t => {
  for (const args of [
    ['--engine', '-unsafe', '--nextcloud', 'nextcloud'],
    ['--engine', 'candidate', '--nextcloud', 'nextcloud', '--docroot', '/app/../other'],
    ['--engine', 'candidate', '--image', 'local/release:r7', '--nextcloud', 'nextcloud'],
  ]) {
    const fixture = setup(t);
    assert.notEqual(fixture.run('update-nextcloud-player.sh', args).status, 0);
    assert.deepEqual(fixture.calls(), []);
  }
});

test('deploy starts only the engine, waits for health and installs from its resolved container', options, t => {
  const fixture = setup(t);
  passed(fixture.run('deploy.sh', ['--compose-file', path.join(root, 'compose.yml'), '--project', 'existing_project', '--image', 'local/release:r7', '--nextcloud', 'nextcloud']));
  const calls = fixture.calls();
  const up = calls.find(call => call[0] === 'compose' && call.includes('up'));
  assert.ok(up.includes('--no-deps') && up.includes('--wait'));
  assert.equal(up.at(-1), 'memories-rkmpp');
  assert.equal(up[up.indexOf('-p') + 1], 'existing_project');
  assert.equal(up[up.indexOf('-f') + 1], path.join(root, 'compose.yml'));
  assert.ok(calls.some(call => call[0] === 'cp' && call[1] === 'candidate:/usr/share/memories-rkmpp/nextcloud-app/.'));
  assert.ok(calls.some(call => phpMode(call, 'activate')));
});

test('an unhealthy engine aborts deployment before touching the Nextcloud helper', options, t => {
  const fixture = setup(t, { MOCK_FAIL: 'compose' });
  assert.notEqual(fixture.run('deploy.sh', ['--nextcloud', 'nextcloud']).status, 0);
  assert.ok(!fixture.calls().some(call => call[0] === 'cp' || call[0] === 'exec'));
});
