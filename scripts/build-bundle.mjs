import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'bundle');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--push')) throw new Error('Usage: node scripts/build-bundle.mjs [--push]');
const push = args.includes('--push');
const trailer = 'Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>';
// Update deliberately after scanning the replacement base image, not on every build.
const baseImage = 'oven/bun:1-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a';

function run(command, parameters, cwd = root, capture = false) {
  const result = spawnSync(command, parameters, {
    cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${parameters.join(' ')} failed (${result.status})${capture ? `: ${result.stderr}` : ''}`);
  return result.stdout?.trim() || '';
}
const git = (parameters, cwd = root, capture = false) => run('git', parameters, cwd, capture);

function ensureClean(cwd) {
  const state = git(['status', '--porcelain', '--untracked-files=all'], cwd, true);
  if (state) throw new Error(`Refusing to overwrite uncommitted work in ${cwd}:\n${state}`);
}

function commitIfChanged(cwd, message, paths) {
  git(['add', '--all', '--', ...paths], cwd);
  const diff = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd, windowsHide: true });
  if (diff.error) throw diff.error;
  if (diff.status === 0) { console.log(`unchanged: ${cwd}`); return false; }
  if (diff.status !== 1) throw new Error(`Cannot inspect staged changes in ${cwd}`);
  git(['commit', '-m', message, '-m', trailer], cwd);
  return true;
}

function npmCi() {
  // Fixed command only: no user-supplied text is interpolated into a Windows shell.
  if (process.platform === 'win32') {
    run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'], join(root, 'frontend'));
  } else {
    run('npm', ['ci', '--no-audit', '--no-fund'], join(root, 'frontend'));
  }
}

const branch = git(['branch', '--show-current'], root, true);
if (branch !== 'main') throw new Error('Run this script from a main checkout, not a component branch or detached HEAD');
ensureClean(root);
const lockFile = resolve(root, git(['rev-parse', '--git-path', 'snip-bundle.lock'], root, true));
let lock;
try {
  lock = openSync(lockFile, 'wx');
} catch { throw new Error('Another bundle build owns this checkout (snip-bundle.lock exists)'); }

try {
  git(['submodule', 'update', '--init', 'backend', 'frontend', 'cli', 'bundle']);
  for (const name of ['backend', 'frontend', 'cli', 'bundle']) ensureClean(join(root, name));
  // Tutorial behavior: select branch tips once, then record/test these exact revisions.
  // Docker publication never advances them: it consumes only main's pinned bundle.
  git(['submodule', 'update', '--init', '--remote', 'backend', 'frontend', 'cli']);
  const revisions = Object.fromEntries(['backend', 'frontend', 'cli'].map(name => [name, git(['rev-parse', 'HEAD'], join(root, name), true)]));
  console.log('Selected source commits:', JSON.stringify(revisions));
  npmCi();
  run(process.env.SNIP_FRONTEND_NODE || process.execPath,
    [join(root, 'frontend/node_modules/@angular/cli/bin/ng.js'), 'build'], join(root, 'frontend'));
  const publicOutput = join(root, 'frontend/dist/snip-frontend/browser');
  if (!existsSync(join(publicOutput, 'index.html'))) throw new Error('Missing frontend/dist/snip-frontend/browser/index.html');
  for (const name of ['backend', 'frontend', 'cli']) ensureClean(join(root, name));

  // bundle/ is generated; clear old assets while preserving its Git control entry.
  if (!existsSync(join(bundle, '.git'))) throw new Error('bundle/ must be a populated Git submodule');
  for (const entry of await readdir(bundle)) {
    if (entry !== '.git') await rm(join(bundle, entry), { recursive: true, force: true });
  }
  await mkdir(join(bundle, 'public'), { recursive: true });
  await cp(join(root, 'backend/server.js'), join(bundle, 'server.js'));
  await cp(join(root, 'cli/cli.js'), join(bundle, 'cli.js'));
  await cp(publicOutput, join(bundle, 'public'), { recursive: true });
  const files = {
    '.env': 'PUBLIC_DIR=./public\n',
    '.gitattributes': '* text=auto eol=lf\n',
    'package.json': JSON.stringify({ name: 'snip-bundle', private: true, scripts: { start: 'bun server.js' } }, null, 2) + '\n',
    'source-revisions.json': JSON.stringify(revisions, null, 2) + '\n',
    'Dockerfile': `FROM ${baseImage}\nWORKDIR /app\nCOPY --chown=bun:bun . .\nENV PORT=3000\nEXPOSE 3000\nUSER bun\nCMD ["bun", "server.js"]\n`,
    '.dockerignore': '.git\nnode_modules\n*.log\n.env.*\n',
    'railway.json': JSON.stringify({ build: { builder: 'DOCKERFILE' }, deploy: { healthcheckPath: '/api/links', healthcheckTimeout: 100, restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 } }, null, 2) + '\n',
    'README.md': '# Generated Snip release\n\nDo not hand-edit this branch. Run `node scripts/build-bundle.mjs` on main.\n\n`bun start` serves UI, API and redirects from one process. `node cli.js ls` uses the same API.\n`PUBLIC_DIR=./public` is a public build setting, not a secret. Configure PORT and BASE_URL or RAILWAY_PUBLIC_DOMAIN at runtime.\nStorage is in memory and restarts clear it. See source-revisions.json for exact inputs.\n\nImage publication is separately gated by tests and security scans on main. A generated branch push alone is not security approval or deployment approval.\n',
  };
  for (const [name, contents] of Object.entries(files)) await writeFile(join(bundle, name), contents, 'utf8');
  commitIfChanged(bundle, 'Generate Snip bundle', ['.']);
  commitIfChanged(root, 'Pin generated Snip bundle and source revisions', ['backend', 'frontend', 'cli', 'bundle']);
  if (push) {
    // Explicit refspec works when submodule HEAD is detached. No force pushes.
    git(['push', 'origin', 'HEAD:bundle'], bundle);
    git(['push', 'origin', 'HEAD:main']);
  } else { console.log('Local commits only; use --push to publish the bundle and main pins.'); }
} finally {
  closeSync(lock);
  unlinkSync(lockFile);
}
