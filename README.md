# Snip: one backend, two clients

Snip is a small URL shortener: a zero-dependency Bun API, an Angular 19 web UI,
and a zero-dependency Node CLI. Links live in memory; restarting the server clears
them. This is an intentional workshop constraint.

## Branches and submodules

One GitHub repository contains independent histories. Component files live at each
branch's root. `main` is the superproject: its submodule entries pin exact commits,
while `.gitmodules` identifies their repository and update branches.

| Branch / path on main | Contents |
| --- | --- |
| `backend` / `backend/` | Bun `server.js`, API and optional static serving |
| `frontend` / `frontend/` | Angular project `snip-frontend` |
| `cli` / `cli/` | CommonJS `cli.js`, wrappers and tests |
| `bundle` / `bundle/` | Generated server, built UI, CLI, Dockerfile and Railway config |
| `main` | Submodule pins, documentation, build/verification scripts and CI |

Do not create ordinary component folders or merge their unrelated histories.
Never edit generated files in `bundle/`; edit the source component and rebuild.

## Clone and run

Install Git, Bun 1.x and Node 22 with npm (Angular 19's supported Node version).
The build orchestrator also runs on Node 24; CI uses Node 22 for Angular commands.
Docker is required for local container verification.

```sh
git clone --branch main --recurse-submodules https://github.com/Leon-Silverthorn/WorkshopDay1.git
cd WorkshopDay1
# For an existing plain clone:
git submodule update --init --recursive
```

Run these in separate terminals:

```sh
cd backend
bun start
```

```sh
cd frontend
npm ci
npm start
```

```sh
cd cli
node cli.js add https://example.com/
node cli.js ls
```

Open http://localhost:4200. The UI uses same-origin `/api/links`; Angular's
development proxy forwards API requests to port 3000. A production bundle serves
UI, API and redirects from one Bun process at http://localhost:3000.
Use `SNIP_API` to point the CLI at a different server. See component READMEs for
wrappers and tests. Stop foreground servers with Ctrl+C.

## Shared API contract

| Request | Result |
| --- | --- |
| `POST /api/links`, JSON `{ "url": "https://example.com/" }` | `201` record; malformed JSON/non-HTTP(S) URL: `400 {error:string}` |
| `GET /api/links` | `200` array of records |
| `GET /:code` | `302` and `Location`, incrementing hits once; unknown code: `404 {error:string}` |

Records contain `{code, url, shortUrl, hits, createdAt}`. Codes have six base62
characters, initial hits are zero, and timestamps use ISO format. CORS/preflight
is enabled. `PORT` defaults to 3000. Short URLs use `BASE_URL`, otherwise
`https://$RAILWAY_PUBLIC_DOMAIN`, otherwise localhost. `PUBLIC_DIR` enables static
files, with existing files taking precedence over short codes. Unknown paths
return 404. The `open` CLI command requests a redirect manually, counting a hit
before it attempts to launch the browser.

## Updating a component

Check that the submodule is on its named branch before editing (recursive clones
usually detach HEAD). Commit and push the component first, then commit its new
pointer on `main`:

```sh
git -C backend switch backend
# Edit backend files, test, commit, and push inside backend/.
git -C backend push origin backend
git submodule update --remote backend
git add backend
git commit -m "Bump backend submodule"
git push origin main
```

Only one person or agent may change branch/index state in the shared checkout at
a time. Backend, frontend, CLI, then superproject is the initial implementation
order. Do not reset, clean, or overwrite another contributor's uncommitted work.
