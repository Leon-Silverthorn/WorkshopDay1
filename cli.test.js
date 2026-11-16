'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { existsSync } = require('node:fs');
const { main, browserCommand } = require('./cli.js');

const cli = join(__dirname, 'cli.js');
const record = {
  code: 'Ab12Cd', url: 'https://example.com/path?a=1&b=2',
  shortUrl: 'http://localhost:3000/Ab12Cd', hits: 0,
  createdAt: '2026-11-16T00:00:00.000Z',
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Test process stalled')); }, 15_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function runCli(args, base = 'http://127.0.0.1:1') {
  return run(process.execPath, [cli, ...args], { env: { ...process.env, SNIP_API: base } });
}

async function capture(args, dependencies = {}) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, {
    env: {}, stdout: { write: text => { stdout += text; } },
    stderr: { write: text => { stderr += text; } }, ...dependencies,
  });
  return { code, stdout, stderr };
}

async function api(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

function launcher(result = 0) {
  const calls = [];
  const spawnFn = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    queueMicrotask(() => {
      if (result instanceof Error) child.emit('error', result);
      else child.emit('close', result, null);
    });
    return child;
  };
  return { calls, spawnFn };
}

test('no args and help aliases print usage without requiring a working API', async t => {
  for (const args of [[], ['help'], ['-h'], ['--help']]) {
    await t.test(JSON.stringify(args), async () => {
      const result = await runCli(args, 'not-a-url');
      assert.equal(result.code, 0);
      assert.match(result.stdout, /^Usage: snip/);
      for (const name of ['add <url>', 'ls', 'open <code>', 'SNIP_API']) assert.ok(result.stdout.includes(name));
      assert.equal(result.stderr, '');
    });
  }
});

test('invalid arguments fail before any request or launch', async t => {
  const cases = [
    ['missing'], ['add'], ['add', 'https://example.com', 'extra'],
    ['add', 'file:///tmp/x'], ['add', 'javascript:alert(1)'], ['add', 'invalid'],
    ['ls', 'extra'], ['open'], ['open', '../abc'], ['open', 'abc'],
    ['open', 'Ab12Cd', 'extra'], ['help', 'extra'],
  ];
  for (const args of cases) {
    await t.test(JSON.stringify(args), async () => {
      let requests = 0;
      const result = await capture(args, { fetchFn: () => { requests++; }, spawnFn: () => assert.fail('launched') });
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^snip: /);
      assert.equal(requests, 0);
    });
  }
  const child = await runCli(['open', 'bad']);
  assert.equal(child.code, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /six letters or digits/);
});

test('invalid SNIP_API values fail locally', async t => {
  for (const base of ['', 'broken', 'ftp://example.com', 'https://x/?q=x', 'https://x/#x', 'https://u:p@x']) {
    await t.test(base || 'empty', async () => {
      const result = await capture(['ls'], { env: { SNIP_API: base }, fetchFn: () => assert.fail('requested') });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /SNIP_API/);
      assert.equal(result.stdout, '');
    });
  }
});

test('default API address is localhost:3000', async () => {
  let address;
  const result = await capture(['ls'], { fetchFn: async url => { address = url; return Response.json([]); } });
  assert.equal(address, 'http://localhost:3000/api/links');
  assert.deepEqual(result, { code: 0, stdout: 'No links yet.\n', stderr: '' });
});

test('add sends JSON to configured path-prefix API and prints only returned shortUrl', async t => {
  let calls = 0;
  const base = await api(t, (req, res) => {
    calls++;
    assert.equal(req.url, '/prefix/api/links');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/json');
    let body = '';
    req.on('data', data => { body += data; });
    req.on('end', () => {
      assert.deepEqual(JSON.parse(body), { url: record.url });
      json(res, 201, record);
    });
  });
  const result = await runCli(['add', record.url], `${base}/prefix/`);
  assert.deepEqual(result, { code: 0, stdout: `${record.shortUrl}\n`, stderr: '' });
  assert.equal(calls, 1);
});

test('ls handles empty results and aligns headers/rows including large hit counts', async t => {
  let records = [];
  const base = await api(t, (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/links');
    json(res, 200, records);
  });
  assert.deepEqual(await runCli(['ls'], base), { code: 0, stdout: 'No links yet.\n', stderr: '' });
  records = [record, { ...record, code: 'Xy98Zz', hits: 123456, url: 'https://example.org/' }];
  const result = await runCli(['ls'], base);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^Ab12Cd\s+0\s+https:/);
  assert.match(lines[2], /^Xy98Zz\s+123456\s+https:/);
  assert.equal(lines[0].indexOf('URL'), lines[1].indexOf('https:'));
  assert.equal(lines[1].indexOf('https:'), lines[2].indexOf('https:'));
});

test('API 400/404/500 errors reach stderr with real process exit 1', async t => {
  for (const [status, args] of [[400, ['add', record.url]], [404, ['open', 'Ab12Cd']], [500, ['ls']]]) {
    await t.test(String(status), async t => {
      const base = await api(t, (_req, res) => json(res, status, { error: 'Test API failure' }));
      const result = await runCli(args, base);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, new RegExp(`API error \\(${status}\\): Test API failure`));
    });
  }
});

test('unexpected statuses, invalid JSON and malformed records fail cleanly', async t => {
  const cases = [
    [200, '<html>bad</html>', ['ls'], /invalid JSON/],
    [200, '{}', ['ls'], /invalid links list/],
    [200, '[{}]', ['ls'], /invalid link record/],
    [201, JSON.stringify({ ...record, code: 123456 }), ['add', record.url], /invalid link record/],
    [201, JSON.stringify({ ...record, shortUrl: 'javascript:alert(1)' }), ['add', record.url], /HTTP or HTTPS/],
    [200, JSON.stringify(record), ['add', record.url], /API error \(200\)/],
    [502, '<html>proxy down</html>', ['ls'], /API error \(502\)/],
  ];
  for (const [status, body, args, error] of cases) {
    await t.test(`${status}: ${body}`, async t => {
      const base = await api(t, (_req, res) => { res.writeHead(status); res.end(body); });
      const result = await runCli(args, base);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, error);
    });
  }
});

test('an unavailable backend produces stderr and process exit 1', async () => {
  const result = await runCli(['ls']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Cannot reach backend/);
  assert.doesNotMatch(result.stderr, /at main|UnhandledPromiseRejection/);
});

test('timeout aborts both stalled headers and stalled response bodies', async t => {
  for (const headersSent of [false, true]) {
    await t.test(headersSent ? 'body' : 'headers', async t => {
      let seen = false;
      const base = await api(t, (_req, res) => {
        seen = true;
        if (headersSent) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('['); }
      });
      const result = await capture(['ls'], { env: { SNIP_API: base }, timeoutMs: 100 });
      assert.equal(seen, true);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /timed out/);
    });
  }
});

test('open does not follow redirect; launches once and increments the API hit once', async t => {
  let hits = 0;
  let targetRequests = 0;
  const base = await api(t, (req, res) => {
    if (req.url === '/Ab12Cd') {
      hits++;
      res.writeHead(302, { Location: `${base}/destination?a=1&b=2` });
      res.end();
    } else { targetRequests++; res.end('unexpected follow'); }
  });
  const fake = launcher();
  const result = await capture(['open', 'Ab12Cd'], { env: { SNIP_API: base }, platform: 'linux', spawnFn: fake.spawnFn });
  assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
  assert.equal(hits, 1);
  assert.equal(targetRequests, 0);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0][0], 'xdg-open');
  assert.deepEqual(fake.calls[0][1], [`${base}/destination?a=1&b=2`]);
});

test('open rejects missing/unsafe Location and wrong redirect statuses without launching', async t => {
  for (const [status, location] of [[302, undefined], [302, 'javascript:alert(1)'], [301, record.url], [200, undefined]]) {
    await t.test(`${status} ${location}`, async t => {
      const base = await api(t, (_req, res) => { res.writeHead(status, location ? { Location: location } : {}); res.end(); });
      const result = await capture(['open', 'Ab12Cd'], {
        env: { SNIP_API: base }, spawnFn: () => assert.fail('launched'),
      });
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Location|HTTP or HTTPS|API error/);
    });
  }
});

test('launcher commands keep URL arguments intact for Windows/macOS/Linux', async t => {
  const target = 'https://example.com/a?q="quoted"&x=%PATH%&y=!VALUE!&z=hello%20world';
  for (const platform of ['win32', 'darwin', 'linux']) {
    await t.test(platform, async () => {
      const fake = launcher();
      const result = await capture(['open', record.code], {
        platform, spawnFn: fake.spawnFn,
        fetchFn: async () => new Response(null, { status: 302, headers: { Location: target } }),
      });
      assert.equal(result.code, 0);
      const [command, args, options] = fake.calls[0];
      assert.equal(options.shell, false);
      if (platform === 'win32') {
        assert.equal(command, 'cmd.exe');
        assert.ok(args.includes('/v:off'));
        assert.equal(args.at(-1), 'start "" "%SNIP_BROWSER_TARGET%"');
        assert.equal(options.env.SNIP_BROWSER_TARGET, new URL(target).href);
        assert.equal(options.windowsVerbatimArguments, true);
        assert.ok(!args.join(' ').includes(target));
      } else {
        assert.equal(command, platform === 'darwin' ? 'open' : 'xdg-open');
        assert.deepEqual(args, [new URL(target).href]);
      }
    });
  }
  assert.throws(() => browserCommand(record.url, 'unknown', {}), /unsupported/);
});

test('browser launch errors and nonzero exit are reported as failure', async t => {
  for (const failure of [new Error('ENOENT'), 3, null]) {
    await t.test(String(failure), async () => {
      const fake = launcher(failure);
      const result = await capture(['open', record.code], {
        spawnFn: fake.spawnFn, platform: 'linux',
        fetchFn: async () => new Response(null, { status: 302, headers: { Location: record.url } }),
      });
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Cannot launch browser|Browser launcher .* failed/);
    });
  }
});

test('platform wrappers forward arguments and process exit status from another directory', async t => {
  const wrappers = process.platform === 'win32' ? [
    ['cmd', 'cmd.exe', args => ['/d', '/s', '/c', `""${join(__dirname, 'snip.cmd')}" ${args.map(arg => `"${arg}"`).join(' ')}"`], { windowsVerbatimArguments: true }],
    ['powershell', 'powershell.exe', args => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, 'snip.ps1'), ...args], {}],
  ] : [['sh', 'sh', args => [join(__dirname, 'snip'), ...args], {}]];
  if (process.platform === 'win32') {
    const bash = join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe');
    if (existsSync(bash)) wrappers.push(['Git Bash', bash, args => [join(__dirname, 'snip').replace(/\\/g, '/'), ...args], {}]);
  }
  for (const [name, command, args, options] of wrappers) {
    await t.test(name, async t => {
      const result = await run(command, args(['help']), { cwd: tmpdir(), ...options });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Usage: snip/);
      assert.equal(result.stderr, '');
      const invalid = await run(command, args(['open', 'invalid']), { cwd: tmpdir(), ...options });
      assert.equal(invalid.code, 1);
      assert.equal(invalid.stdout, '');
      assert.match(invalid.stderr, /six letters or digits/);
      const spacedUrl = 'https://example.com/a path?x=1&y=2';
      const base = await api(t, (req, res) => {
        let body = '';
        req.on('data', data => { body += data; });
        req.on('end', () => {
          assert.deepEqual(JSON.parse(body), { url: spacedUrl });
          json(res, 201, { ...record, url: spacedUrl });
        });
      });
      const added = await run(command, args(['add', spacedUrl]), {
        cwd: tmpdir(), env: { ...process.env, SNIP_API: base }, ...options,
      });
      assert.deepEqual(added, { code: 0, stdout: `${record.shortUrl}\n`, stderr: '' });
    });
  }
});
