# Snip backend

A zero-dependency Bun URL shortener API. Links are stored in memory and are cleared when the server restarts.

## Run

```sh
bun start
```

The server listens on port `3000` by default. Set `PORT` to change it, `BASE_URL` to control generated short URLs, or `RAILWAY_PUBLIC_DOMAIN` to use `https://<domain>` when `BASE_URL` is unset. `BASE_URL` takes precedence.

Set `PUBLIC_DIR` to serve static files alongside the API; `/` serves `index.html`, and existing files take precedence over matching short codes.

## API

- `POST /api/links` with `{"url":"https://example.com"}` creates a link and returns `201` with `{code, url, shortUrl, hits, createdAt}`. Invalid JSON or non-HTTP(S) URLs return `400` with an `error`.
- `GET /api/links` returns all links.
- `GET /:code` redirects to the original URL with `302` and increments its hit count; unknown codes return `404`.
- `OPTIONS` supports browser CORS preflight.
