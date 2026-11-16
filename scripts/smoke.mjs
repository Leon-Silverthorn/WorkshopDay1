import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const bundled = args.includes('--bundle');
const withUi = bundled || args.includes('--ui');
const externalIndex = args.indexOf('--base-url');
const serverDir = join(root, bundled ? 'bundle' : 'backend');
const cliFile = join(root, bundled ? 'bundle' : 'cli', 'cli.js');
let server;
let closed;
let logs = '';
let checks = 0;
let base;

function check(value, message) {
  assert.ok(value, message);
  checks++;
}

async function request(path, options = {}) {
  return fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
}

async function cli(command) {
  const child = spawn(process.execPath, [cliFile, ...command], {
    env: { ...process.env, SNIP_API: base }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const [status] = await once(child, 'close');
    assert.equal(status, 0, stderr);
    checks++;
    return stdout.trim();
  } finally { clearTimeout(timer); }
}

try {
  if (externalIndex !== -1) {
    base = args[externalIndex + 1];
    assert.ok(base && /^https?:\/\//.test(base), '--base-url requires an HTTP(S) origin');
    base = base.replace(/\/+$/, '');
  } else {
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    base = `http://127.0.0.1:${port}`;
    const env = { ...process.env, PORT: String(port), BASE_URL: base };
    delete env.PUBLIC_DIR;
    delete env.RAILWAY_PUBLIC_DOMAIN;
    if (withUi) env.PUBLIC_DIR = join(root, bundled ? 'bundle/public' : 'frontend/dist/snip-frontend/browser');
    server = spawn(process.env.BUN_BIN || 'bun', ['server.js'], {
      cwd: serverDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    closed = new Promise(resolve => server.once('close', resolve));
    server.stdout.on('data', data => { logs += data; });
    server.stderr.on('data', data => { logs += data; });
    await once(server, 'spawn');
  }

  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await request('/api/links');
      if (response.status === 200) { await response.text(); ready = true; break; }
    } catch {}
    if (server && server.exitCode !== null) break;
    await delay(100);
  }
  check(ready, `Server readiness failed: ${logs}`);

  if (withUi) {
    const page = await request('/');
    check(page.status === 200, 'UI index must be served');
    const html = await page.text();
    check(html.includes('<app-root'), 'UI must contain the Angular root');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
    check(scripts.length > 0, 'UI scripts must exist');
    for (const script of scripts) {
      const asset = await fetch(new URL(script, `${base}/`));
      check(asset.status === 200, `Missing UI script: ${script}`);
      const source = await asset.text();
      check(!source.includes('http://localhost:3000'), 'Production UI must not hardcode localhost');
    }
  }

  let response = await request('/api/links', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/snip-release?client=web&x=1' }),
  });
  check(response.status === 201, 'Create must return 201');
  const link = await response.json();
  assert.deepEqual(Object.keys(link).sort(), ['code', 'url', 'shortUrl', 'hits', 'createdAt'].sort());
  checks++;
  check(/^[A-Za-z0-9]{6}$/.test(link.code), 'Codes must be six base62 characters');
  check(link.hits === 0 && Number.isFinite(Date.parse(link.createdAt)), 'Initial hits/timestamp');
  check(new URL(link.shortUrl).pathname === `/${link.code}`, 'Short URL must include code');
  check((await cli(['ls'])).includes(link.code), 'API-created link must appear in CLI');

  response = await request(`/${link.code}`, { redirect: 'manual' });
  check(response.status === 302 && response.headers.get('location') === link.url, 'Redirect target/status');
  const links = await (await request('/api/links')).json();
  check(links.find(item => item.code === link.code)?.hits === 1, 'Redirect must increment hits once');
  const cliUrl = await cli(['add', 'https://example.org/snip-release?client=cli']);
  const cliCode = new URL(cliUrl).pathname.slice(1);
  check((await (await request('/api/links')).json()).some(item => item.code === cliCode), 'CLI-created link must appear in API');

  for (const body of ['{broken', JSON.stringify({ url: 'javascript:alert(1)' })]) {
    response = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    check(response.status === 400 && typeof (await response.json()).error === 'string', 'Invalid input must return 400 {error}');
  }
  let unknown = '000000';
  const known = new Set((await (await request('/api/links')).json()).map(item => item.code));
  while (known.has(unknown)) unknown = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  response = await request(`/${unknown}`, { redirect: 'manual' });
  check(response.status === 404, 'Unknown code must return 404');
  response = await request('/api/links', { method: 'OPTIONS' });
  check(response.status === 204 && response.headers.get('access-control-allow-origin') === '*', 'CORS preflight');

  if (bundled) {
    const manifest = JSON.parse(await readFile(join(root, 'bundle/source-revisions.json'), 'utf8'));
    check(['backend', 'frontend', 'cli'].every(name => /^[a-f0-9]{40}$/.test(manifest[name])), 'Bundle must record exact source commits');
  }
  console.log(`PASS ${checks} release checks (${bundled ? 'bundle' : 'source/API'} at ${base})`);
} finally {
  if (server && server.exitCode === null && server.signalCode === null) server.kill();
  if (closed) await closed;
}
