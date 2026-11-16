import { randomInt } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const port = Number(Bun.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const baseUrl = (
  Bun.env.BASE_URL?.trim() ||
  (Bun.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${Bun.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`)
).replace(/\/+$/, "");
const publicDir = Bun.env.PUBLIC_DIR ? resolve(Bun.env.PUBLIC_DIR) : null;
const realPublicDir = publicDir ? await realpath(publicDir) : null;
const links = new Map();
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: corsHeaders,
  });
}

function createCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
  } while (links.has(code));
  return code;
}

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function safeStaticPath(pathname) {
  if (!publicDir) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = resolve(publicDir, `.${requestedPath}`);
  const relativePath = relative(publicDir, filePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return filePath;
}

async function serveStatic(pathname) {
  const filePath = safeStaticPath(pathname);
  if (!filePath) return null;

  let actualPath;
  try {
    actualPath = await realpath(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
  const actualRelativePath = relative(realPublicDir, actualPath);
  if (
    actualRelativePath === ".." ||
    actualRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(actualRelativePath) ||
    !(await stat(actualPath)).isFile()
  ) {
    return null;
  }

  const file = Bun.file(actualPath);
  const headers = { ...corsHeaders };
  if (extname(actualPath) === ".html") headers["Content-Type"] = "text/html; charset=utf-8";
  return new Response(file, { headers });
}

Bun.serve({
  port,
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const { pathname } = new URL(request.url);

    if (pathname === "/api/links" && request.method === "POST") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Request body must be valid JSON" }, 400);
      }

      if (!payload || !isHttpUrl(payload.url)) {
        return json({ error: "url must be a valid HTTP or HTTPS URL" }, 400);
      }

      const code = createCode();
      const link = {
        code,
        url: payload.url,
        shortUrl: `${baseUrl}/${code}`,
        hits: 0,
        createdAt: new Date().toISOString(),
      };
      links.set(code, link);
      return json(link, 201);
    }

    if (pathname === "/api/links" && request.method === "GET") {
      return json(Array.from(links.values()));
    }

    if (request.method === "GET" && publicDir) {
      const staticResponse = await serveStatic(pathname);
      if (staticResponse) return staticResponse;
    }

    if (request.method === "GET" && /^\/[A-Za-z0-9]{6}$/.test(pathname)) {
      const code = pathname.slice(1);
      const link = links.get(code);
      if (!link) return json({ error: "Short link not found" }, 404);
      link.hits += 1;
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: link.url },
      });
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`Snip API listening on http://localhost:${port}`);
