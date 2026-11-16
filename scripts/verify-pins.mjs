import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (args, cwd = root, encoding = 'utf8') => execFileSync('git', args, { cwd, encoding, windowsHide: true });
const manifest = JSON.parse(readFileSync(join(root, 'bundle/source-revisions.json'), 'utf8'));
for (const name of ['backend', 'frontend', 'cli', 'bundle']) {
  const entry = git(['ls-tree', 'HEAD', '--', name]).trim();
  const match = /^160000 commit ([a-f0-9]{40})\t/.exec(entry);
  assert.ok(match, `${name} must be a commit-pinned Git submodule`);
  const actual = git(['rev-parse', 'HEAD'], join(root, name)).trim();
  assert.equal(actual, match[1], `${name} checkout must equal its main pin`);
  assert.equal(git(['config', '-f', '.gitmodules', '--get', `submodule.${name}.url`]).trim(), 'https://github.com/Leon-Silverthorn/WorkshopDay1.git');
  assert.equal(git(['config', '-f', '.gitmodules', '--get', `submodule.${name}.branch`]).trim(), name);
  assert.equal(git(['status', '--porcelain'], join(root, name)).trim(), '', `${name} must have no source modifications`);
  if (name !== 'bundle') assert.equal(manifest[name], actual, `bundle input pin for ${name}`);
  console.log(`${name}: ${actual}`);
}
for (const [component, file] of [['backend', 'server.js'], ['cli', 'cli.js']]) {
  assert.deepEqual(git(['show', `HEAD:${file}`], join(root, component), null), git(['show', `HEAD:${file}`], join(root, 'bundle'), null), `Bundled ${file} must equal the source Git blob`);
}
const pkg = JSON.parse(readFileSync(join(root, 'bundle/package.json'), 'utf8'));
assert.ok(!Object.hasOwn(pkg, 'type'), 'Bundled CLI must retain CommonJS defaults');
assert.equal(readFileSync(join(root, 'bundle/.env'), 'utf8').trim(), 'PUBLIC_DIR=./public');
assert.match(readFileSync(join(root, 'bundle/Dockerfile'), 'utf8'), /^FROM oven\/bun:1-alpine@sha256:[a-f0-9]{64}\r?$/m);
assert.equal(JSON.parse(readFileSync(join(root, 'bundle/railway.json'), 'utf8')).deploy.healthcheckPath, '/api/links');
console.log('PASS exact gitlinks, source manifest, unchanged server/CLI, module format and release configuration');
