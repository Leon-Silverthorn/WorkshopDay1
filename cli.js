#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const TIMEOUT_MS = 10_000;
const USAGE = `Usage: snip <command>

  add <url>    Create a short link for an HTTP(S) URL
  ls           List code, hits and original URL
  open <code>  Open a six-character short code in your default browser
  help         Show this help (also -h or --help)

Environment:
  SNIP_API     API base URL (default: http://localhost:3000)

Requests time out after 10 seconds. Errors go to stderr and exit 1.
`;

function httpUrl(value, label) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url;
  } catch {}
  throw new Error(`${label} must be a valid HTTP or HTTPS URL.`);
}

function parseArgs(args) {
  const [command, value] = args;
  if (args.length === 0) return { command: 'help' };
  if (['help', '-h', '--help'].includes(command) && args.length === 1) {
    return { command: 'help' };
  }
  if (command === 'ls' && args.length === 1) return { command };
  if (command === 'add' && args.length === 2) {
    httpUrl(value, 'URL');
    return { command, value: value.trim() };
  }
  if (command === 'open' && args.length === 2) {
    if (!/^[A-Za-z0-9]{6}$/.test(value)) {
      throw new Error('Code must contain exactly six letters or digits.');
    }
    return { command, value };
  }
  throw new Error('Invalid command or arguments. Run "snip help" for usage.');
}

function apiBase(env) {
  const url = httpUrl(env.SNIP_API ?? 'http://localhost:3000', 'SNIP_API');
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('SNIP_API must not contain credentials, a query or a fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

// The same bounded client handles every command, including response-body reads.
async function request(base, path, expectedStatus, options, fetchFn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    let body;
    try {
      response = await fetchFn(`${base}${path}`, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
      });
      body = await response.text();
    } catch {
      if (controller.signal.aborted) {
        throw new Error(`Request timed out after ${timeoutMs / 1000} seconds.`);
      }
      throw new Error(`Cannot reach backend at ${base}. Check SNIP_API and that the server is running.`);
    }
    if (response.status !== expectedStatus) {
      let detail = '';
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.error === 'string') detail = `: ${parsed.error}`;
      } catch {}
      throw new Error(`API error (${response.status})${detail}`);
    }
    if (expectedStatus === 302) return response.headers.get('location');
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('Backend returned invalid JSON.');
    }
  } finally {
    clearTimeout(timer);
  }
}

function validateRecord(link) {
  if (!link || typeof link !== 'object' ||
      typeof link.code !== 'string' || !/^[A-Za-z0-9]{6}$/.test(link.code) ||
      !Number.isSafeInteger(link.hits) || link.hits < 0 ||
      typeof link.url !== 'string' || typeof link.shortUrl !== 'string' ||
      typeof link.createdAt !== 'string' || !Number.isFinite(Date.parse(link.createdAt))) {
    throw new Error('Backend returned an invalid link record.');
  }
  httpUrl(link.url, 'Backend original URL');
  httpUrl(link.shortUrl, 'Backend short URL');
  return link;
}

function formatLinks(links) {
  if (!Array.isArray(links)) throw new Error('Backend returned an invalid links list.');
  links.forEach(validateRecord);
  if (links.length === 0) return 'No links yet.';
  const codeWidth = Math.max(4, ...links.map(link => link.code.length));
  const hitsWidth = Math.max(4, ...links.map(link => String(link.hits).length));
  const row = (code, hits, url) => `${code.padEnd(codeWidth)}  ${String(hits).padStart(hitsWidth)}  ${url}`;
  return [row('CODE', 'HITS', 'URL'), ...links.map(link => row(link.code, link.hits, link.url))].join('\n');
}

function browserCommand(target, platform, env) {
  const url = httpUrl(target, 'Redirect target').href;
  const options = { stdio: 'ignore', windowsHide: true, shell: false };
  if (platform === 'win32') {
    // Keep URL data outside cmd source; disable delayed expansion for literal '!'.
    // URL serialization escapes embedded quotes and control characters.
    return {
      command: 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', 'start "" "%SNIP_BROWSER_TARGET%"'],
      options: { ...options, windowsVerbatimArguments: true, env: { ...env, SNIP_BROWSER_TARGET: url } },
    };
  }
  if (platform === 'darwin') return { command: 'open', args: [url], options };
  if (platform === 'linux') return { command: 'xdg-open', args: [url], options };
  throw new Error(`Browser opening is unsupported on ${platform}.`);
}

async function launchBrowser(target, platform, env, spawnFn) {
  const { command, args, options } = browserCommand(target, platform, env);
  await new Promise((resolve, reject) => {
    const child = spawnFn(command, args, options);
    child.once('error', () => reject(new Error(`Cannot launch browser using ${command}.`)));
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Browser launcher ${command} failed (${signal || code}).`));
    });
  });
}

async function main(args = process.argv.slice(2), dependencies = {}) {
  const {
    env = process.env, stdout = process.stdout, stderr = process.stderr,
    fetchFn = globalThis.fetch, spawnFn = spawn, platform = process.platform,
    timeoutMs = TIMEOUT_MS,
  } = dependencies;
  try {
    const { command, value } = parseArgs(args);
    if (command === 'help') {
      stdout.write(USAGE);
      return 0;
    }
    const base = apiBase(env);
    const call = (path, status, options = {}) => request(base, path, status, options, fetchFn, timeoutMs);
    if (command === 'add') {
      const link = validateRecord(await call('/api/links', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      }));
      stdout.write(`${link.shortUrl}\n`);
    } else if (command === 'ls') {
      stdout.write(`${formatLinks(await call('/api/links', 200))}\n`);
    } else {
      const target = await call(`/${value}`, 302);
      if (!target) throw new Error('Backend redirect is missing Location.');
      await launchBrowser(target, platform, env, spawnFn);
    }
    return 0;
  } catch (error) {
    stderr.write(`snip: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}

module.exports = { main, browserCommand, launchBrowser };
