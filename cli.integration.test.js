'use strict';

// Optional live check: requires Git, Bun (or BUN_BIN), and origin/backend.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const net = require('node:net');
const { EventEmitter, once } = require('node:events');
const { main } = require('./cli.js');

function runCli(args, base) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, 'cli.js'), ...args], {
      env: { ...process.env, SNIP_API: base }, windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

test('live Bun backend: CLI create/list/open, API-client visibility, redirects and failures', { timeout: 15_000 }, async t => {
  const fixture = mkdtempSync(join(tmpdir(), 'snip-cli-live-'));
  let backend;
  let backendClosed;
  let logs = '';
  t.after(async () => {
    if (backend && backend.exitCode === null && backend.signalCode === null) backend.kill();
    if (backendClosed) await backendClosed;
    assert.equal(dirname(fixture), tmpdir());
    rmSync(fixture, { recursive: true, force: true });
  });
  const source = execFileSync('git', ['show', 'origin/backend:server.js'], { cwd: __dirname });
  const backendSha = execFileSync('git', ['rev-parse', 'origin/backend'], { cwd: __dirname, encoding: 'utf8' }).trim();
  writeFileSync(join(fixture, 'server.js'), source);
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), BASE_URL: base };
  delete env.PUBLIC_DIR;
  delete env.RAILWAY_PUBLIC_DOMAIN;
  backend = spawn(process.env.BUN_BIN || 'bun', ['server.js'], {
    cwd: fixture, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendClosed = new Promise(resolve => backend.once('close', resolve));
  backend.stdout.on('data', data => { logs += data; });
  backend.stderr.on('data', data => { logs += data; });
  await once(backend, 'spawn');
  let ready = false;
  for (let attempts = 0; attempts < 50; attempts++) {
    try {
      const response = await fetch(`${base}/api/links`, { signal: AbortSignal.timeout(200) });
      if (response.status === 200) { await response.text(); ready = true; break; }
    } catch {}
    if (backend.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, `Backend did not become ready: ${logs}`);
  assert.deepEqual(await runCli(['ls'], base), { code: 0, stdout: 'No links yet.\n', stderr: '' });

  const url = 'https://example.com/cli?source=terminal&x=1';
  const added = await runCli(['add', url], base);
  assert.equal(added.code, 0, added.stderr);
  assert.equal(added.stderr, '');
  const code = new URL(added.stdout.trim()).pathname.slice(1);
  assert.match(code, /^[A-Za-z0-9]{6}$/);
  let response = await fetch(`${base}/api/links`);
  assert.equal(response.status, 200);
  let links = await response.json();
  assert.equal(links.length, 1);
  assert.equal(links[0].code, code);
  assert.equal(links[0].url, url);
  assert.equal(links[0].hits, 0);
  assert.equal(added.stdout, `${base}/${code}\n`);

  // Model a second API client (the frontend uses the identical request).
  response = await fetch(`${base}/api/links`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.org/other-client' }),
  });
  assert.equal(response.status, 201);
  const other = await response.json();
  const listed = await runCli(['ls'], base);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, new RegExp(`${code}\\s+0\\s+`));
  assert.ok(listed.stdout.includes(other.code));
  assert.ok(listed.stdout.includes(other.url));

  const launched = [];
  const open = async (exitCode = 0) => {
    let stdout = '';
    let stderr = '';
    const result = await main(['open', code], {
      env: { SNIP_API: base }, platform: 'linux',
      stdout: { write: text => { stdout += text; } },
      stderr: { write: text => { stderr += text; } },
      spawnFn: (command, args) => {
        launched.push({ command, args });
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', exitCode, null));
        return child;
      },
    });
    return { code: result, stdout, stderr };
  };
  assert.deepEqual(await open(), { code: 0, stdout: '', stderr: '' });
  assert.deepEqual(launched[0], { command: 'xdg-open', args: [url] });
  links = await (await fetch(`${base}/api/links`)).json();
  assert.equal(links.find(link => link.code === code).hits, 1);
  const failedLaunch = await open(3);
  assert.equal(failedLaunch.code, 1);
  assert.match(failedLaunch.stderr, /Browser launcher .* failed/);
  links = await (await fetch(`${base}/api/links`)).json();
  assert.equal(links.find(link => link.code === code).hits, 2);
  assert.match((await runCli(['ls'], base)).stdout, new RegExp(`${code}\\s+2\\s+`));

  response = await fetch(`${base}/${other.code}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), other.url);
  await response.text();
  links = await (await fetch(`${base}/api/links`)).json();
  assert.equal(links.find(link => link.code === other.code).hits, 1);
  let missing = '000000';
  while (links.some(link => link.code === missing)) missing = String(Number(missing) + 1).padStart(6, '0');
  const unknown = await runCli(['open', missing], base);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /API error \(404\): Short link not found/);

  const invalid = await runCli(['add', 'file:///tmp/nope'], base);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /HTTP or HTTPS/);
  assert.equal((await (await fetch(`${base}/api/links`)).json()).length, 2);
  console.log(`Backend ${backendSha}: POST 201 / GET 200 / redirect 302; CLI ${code} hits 0 -> 1 -> 2 (failed launcher still counted); API-client ${other.code} visible in CLI; unknown code 404.`);
});
