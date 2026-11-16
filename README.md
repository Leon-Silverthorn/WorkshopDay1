# Snip frontend

Angular 19 client for the Snip Bun API. One standalone component, a typed HttpClient service, reactive forms, and signals. This independent `frontend` branch keeps source at its root; `main` mounts it as a submodule.

## Run

Use Node 22 (supported by Angular 19) and npm. Start the backend on port 3000 from its checkout, then:

```sh
npm ci
npx ng serve
```

Open http://localhost:4200. The development proxy in `src/proxy.conf.json` forwards `/api/**` to http://localhost:3000. Production uses the same relative `/api/links` endpoint, so the generated bundle can serve UI, API and redirects from one origin. Short links always use the backend's returned `shortUrl`.

## Contract and behavior

- POST `/api/links` with `{url}` → `201 {code,url,shortUrl,hits,createdAt}`; invalid input → `400 {error:string}`.
- GET `/api/links` → array of those records.
- GET `/:code` on the backend → `302` redirect, incrementing hits; unknown code → `404`.

HTTP(S) URLs are trimmed and validated before submission. Pending submissions are locked against duplicates. Validation errors appear beside the input; server/network errors allow retry without losing the entered URL. Successful creation shows the short URL and reloads the table. Refresh manually or return focus to the window to update hits. Links disappear on backend restart.

The UI includes loading, empty and failure states, preserves existing rows on refresh failure, labeled controls and screen-reader status feedback, visible keyboard focus, and a horizontally scrollable table on narrow screens.

## Verify

```sh
npx ng build
npm test -- --watch=false --browsers=ChromeHeadless
```

The required release output is **`dist/snip-frontend/browser/index.html`**; preserve the project name and output path. Component tests use Angular's HTTP testing backend for validation, initial list states, create/refresh success, duplicate protection, concurrent list cancellation, and API/network failures.

For integration, create a link through the UI, confirm its row and CLI visibility, open its short URL, then refresh and verify hits. Verify the same UI at port 3000 after bundling.
