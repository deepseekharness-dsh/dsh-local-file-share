import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('smoke suite passes (protocol round trip, guards, geometry, i18n parity)', () => {
  const output = execFileSync(process.execPath, ['scripts/smoke.mjs'], { cwd: root, encoding: 'utf8' });
  assert.match(output, /smoke: all ok/);
});
