import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const pkg = JSON.parse(read('package.json'));
const patch = read('cordis.patch.yml');
const client = read('lib/client.js');
const host = read('lib/index.js');

test('manifest is installable as a dsh bundle', () => {
  assert.equal(pkg.name, 'dsh-local-file-share');
  assert.equal(pkg.private, undefined, 'a published package is not private');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.dsh.bundle, { patch: './cordis.patch.yml' });
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(pkg.files.includes('lib'), 'lib/ ships in the tarball');
  assert.ok(pkg.files.includes('locale'), 'locale/ ships in the tarball');
});

test('every file the manifest promises exists on disk', () => {
  for (const entry of pkg.files) {
    // files 里可以是目录或 glob（locale/*.json 由目录形式覆盖）
    assert.ok(existsSync(join(root, entry.split('/')[0])), `missing packaged path: ${entry}`);
  }
  for (const required of [
    'package.json',
    'cordis.patch.yml',
    'icon.svg',
    'locale/zh.json',
    'locale/en.json',
    'README.md',
    'README.en.md',
    'CHANGELOG.md',
    'LICENSE',
    'lib/index.js',
    'lib/client.js',
    'lib/highlight.mjs',
  ]) {
    assert.ok(existsSync(join(root, required)), `missing required file: ${required}`);
  }
});

test('bundle patch inserts this plugin row with the branded ws path', () => {
  assert.match(patch, /id: local-file-share/);
  assert.match(patch, /name: 'dsh-local-file-share'/);
  assert.match(patch, /wsPath: '\/local-file-share\/ws'/);
});

test('client artifact is a module-loader bundle whose id equals the package name', () => {
  assert.match(client, /window\.__ModuleLoader__\.load\(/);
  const id = /id:\s*"([^"]+)"/.exec(client) ?? /id:\s*'([^']+)'/.exec(client);
  assert.ok(id, 'the module id is declared');
  assert.equal(id[1], pkg.name, 'client module id must equal the package name');
});

test('client artifact ships the themed style layer and no legacy class prefix', () => {
  for (const marker of ['lfs-card', 'lfs-fab', 'lfs-preview', 'ensureStyles']) {
    assert.ok(client.includes(marker), `client bundle should contain ${marker}`);
  }
  assert.ok(!client.includes('dbfs-'), 'the legacy class prefix must be gone');
});

test('host artifact registers the three model tools over the private ws path', () => {
  for (const tool of ['local_file_list', 'local_file_read', 'local_file_write']) {
    assert.ok(host.includes(tool), `host bundle should register ${tool}`);
  }
  assert.ok(host.includes('/local-file-share/ws'), 'host bundle should serve the branded ws path');
  assert.ok(host.includes('requestRejection'), 'host bundle should keep the browser-session gate');
});

test('locale metadata is bilingual and complete', () => {
  const zh = JSON.parse(read('locale/zh.json'));
  const en = JSON.parse(read('locale/en.json'));
  for (const dict of [zh, en]) {
    assert.equal(typeof dict.meta, 'object');
    assert.ok(dict.meta.title.length > 0);
    assert.ok(dict.meta.description.length > 20);
  }
  assert.equal(zh.meta.title, '本地文件共享');
  assert.equal(en.meta.title, 'Local File Share');
});

test('no legacy brand name leaks into the shipped artifacts', () => {
  const legacy = ['browser_fs_', 'dbfs-', '/browser-fs/', 'dsh-browser-fs'];
  for (const relative of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'package.json']) {
    const text = read(relative);
    for (const token of legacy) {
      assert.ok(!text.includes(token), `${relative} must not contain the legacy token ${token}`);
    }
  }
});

/** 用 esbuild 现场编译一个纯模块并 import，供纯函数单测使用（与 smoke 同法）。 */
async function importCompiled(entry) {
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'lfs-unit-'));
  const outfile = join(dir, 'module.mjs');
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

test('share policy: normalization falls back to defaults and sanitizes the allowlist', async () => {
  const wire = await importCompiled('src/wire.ts');
  const D = wire.DEFAULT_SHARE_POLICY;
  assert.deepEqual({ ...D, sessions: [...D.sessions] }, { scope: 'global', sessions: [], access: 'readwrite' });

  for (const bad of [undefined, null, 42, 'x', [], { scope: 'nope', access: 'nope' }]) {
    const normalized = wire.normalizeSharePolicy(bad);
    assert.equal(normalized.scope, 'global');
    assert.equal(normalized.access, 'readwrite');
    assert.deepEqual([...normalized.sessions], []);
  }

  const cleaned = wire.normalizeSharePolicy({ scope: 'sessions', access: 'readonly', sessions: [' a ', 'a', '', 7, 'b', 'x'.repeat(200)] });
  assert.equal(cleaned.scope, 'sessions');
  assert.equal(cleaned.access, 'readonly');
  assert.deepEqual([...cleaned.sessions], ['a', 'b']);

  const many = wire.normalizeSharePolicy({ scope: 'sessions', sessions: Array.from({ length: 300 }, (_, i) => `s${String(i)}`) });
  assert.equal(many.sessions.length, wire.MAX_POLICY_SESSIONS);

  const global = wire.normalizeSharePolicy({ scope: 'global', sessions: ['ghost'] });
  assert.deepEqual([...global.sessions], []);
});

test('share policy: decision matrix covers scope, access and non-session callers', async () => {
  const { decidePolicy, normalizeSharePolicy } = await importCompiled('src/wire.ts');
  const globalRw = normalizeSharePolicy({ scope: 'global', access: 'readwrite' });
  const globalRo = normalizeSharePolicy({ scope: 'global', access: 'readonly' });
  const listedRw = normalizeSharePolicy({ scope: 'sessions', access: 'readwrite', sessions: ['session-a'] });
  const listedRo = normalizeSharePolicy({ scope: 'sessions', access: 'readonly', sessions: ['session-a'] });

  for (const op of ['list', 'read', 'write']) {
    assert.deepEqual(decidePolicy(globalRw, undefined, op), { allowed: true });
    if (op !== 'write') {
      assert.deepEqual(decidePolicy(globalRo, undefined, op), { allowed: true });
      assert.deepEqual(decidePolicy(listedRo, 'session-a', op), { allowed: true });
      assert.deepEqual(decidePolicy(listedRw, 'session-a', op), { allowed: true });
    }
  }
  assert.deepEqual(decidePolicy(globalRo, undefined, 'write'), { allowed: false, denial: 'readonly' });
  assert.deepEqual(decidePolicy(listedRo, 'session-a', 'write'), { allowed: false, denial: 'readonly' });
  assert.deepEqual(decidePolicy(listedRw, 'session-b', 'list'), { allowed: false, denial: 'out-of-scope' });
  assert.deepEqual(decidePolicy(listedRo, 'session-b', 'write'), { allowed: false, denial: 'out-of-scope' });
  assert.deepEqual(decidePolicy(listedRw, undefined, 'list'), { allowed: false, denial: 'no-session' });
  assert.deepEqual(decidePolicy(listedRw, '', 'read'), { allowed: false, denial: 'no-session' });
});

test('wire frames stay backward compatible with 1.0.0 clients', async () => {
  const { parseBrowserFrame, parseHostFrame, normalizeSharePolicy } = await importCompiled('src/wire.ts');
  const defaults = normalizeSharePolicy(undefined);

  const legacyState = parseBrowserFrame(JSON.stringify({ type: 'state', hasHandle: true, dirName: 'root', label: 'dev' }));
  assert.deepEqual({ ...legacyState.policy, sessions: [...legacyState.policy.sessions] }, { ...defaults, sessions: [...defaults.sessions] });

  const badPolicyState = parseBrowserFrame(JSON.stringify({ type: 'state', hasHandle: true, policy: { scope: 'nonsense', access: 'nonsense' } }));
  assert.equal(badPolicyState.policy.scope, 'global');
  assert.equal(badPolicyState.policy.access, 'readwrite');

  const listedState = parseBrowserFrame(JSON.stringify({ type: 'state', hasHandle: false, policy: { scope: 'sessions', access: 'readonly', sessions: ['s1'] } }));
  assert.equal(listedState.policy.scope, 'sessions');
  assert.deepEqual([...listedState.policy.sessions], ['s1']);

  const call = parseHostFrame(JSON.stringify({ type: 'call', rpcId: 'r1', op: 'write', args: {}, caller: 's1', policy: { access: 'readonly' } }));
  assert.equal(call.caller, 's1');
  assert.equal(call.policy.access, 'readonly');

  const plainCall = parseHostFrame(JSON.stringify({ type: 'call', rpcId: 'r2', op: 'list', args: {} }));
  assert.equal(plainCall.caller, undefined);
  assert.equal(plainCall.policy, undefined);

  const badAccessCall = parseHostFrame(JSON.stringify({ type: 'call', rpcId: 'r3', op: 'list', args: {}, policy: { access: 'root' } }));
  assert.equal(badAccessCall.policy, undefined);

  const roster = parseHostFrame(JSON.stringify({ type: 'roster', executors: [{ label: 'legacy', dirName: 'root' }] }));
  assert.equal(roster.executors[0].scope, 'global');
  assert.equal(roster.executors[0].access, 'readwrite');
  const scopedRoster = parseHostFrame(JSON.stringify({ type: 'roster', executors: [{ label: 'dev', dirName: null, scope: 'sessions', access: 'readonly' }] }));
  assert.equal(scopedRoster.executors[0].scope, 'sessions');
  assert.equal(scopedRoster.executors[0].access, 'readonly');
});

test('smoke suite passes (protocol round trip, guards, geometry, i18n parity)', () => {
  const output = execFileSync(process.execPath, ['scripts/smoke.mjs'], { cwd: root, encoding: 'utf8' });
  assert.match(output, /smoke: all ok/);
});
