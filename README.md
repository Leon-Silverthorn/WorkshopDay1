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

## Generate a release

From a clean `main` checkout:

```sh
node scripts/build-bundle.mjs
node scripts/smoke.mjs --bundle
node scripts/build-bundle.mjs
node scripts/build-bundle.mjs --push
```

The builder selects source branch tips once, records their exact SHAs in
`bundle/source-revisions.json`, installs the locked frontend dependencies with
`npm ci`, and builds Angular. It copies backend and CLI bytes unchanged. Repeated
runs with unchanged inputs create no commits. Default execution creates local
bundle and pointer commits; `--push` publishes bundle first, then main, using an
explicit refspec that supports detached submodule HEADs. A dirty checkout or a
second concurrent builder is rejected. No force pushes are used.

Use Node 22 for Angular. A Node 24 orchestrator can set `SNIP_FRONTEND_NODE` to an
absolute Node 22 executable. `BUN_BIN` may point smoke tests at a Bun executable
when `bun` is not on PATH. Smoke checks stop their own server and clear test data.

```sh
node scripts/smoke.mjs --ui
cd bundle
docker build -t snip .
docker run --rm -p 3000:3000 snip
```

In another terminal, run `node scripts/smoke.mjs --bundle --base-url
http://localhost:3000` from main. This creates two in-memory test links. Use an
otherwise disposable server for tests.

## Security and deployment status

The workshop explicitly uses Angular 19. Its committed production dependencies
currently have high-severity advisories with no compatible Angular 19 fix offered
by npm audit. A major framework upgrade requires a scope decision; do not run
`npm audit fix --force` or suppress advisories to make a release pass. Generated
output may be inspected/tested, but image publication must wait for the dependency
and container gates to pass. See CI output for current counts; advisories change.

Railway configuration is generated, including an `/api/links` health check. Set
PORT to match the domain target port and set BASE_URL or RAILWAY_PUBLIC_DOMAIN.
The tutorial's Railway source is the bundle branch; publishing to that branch
would auto-deploy if a service were connected. This repository setup does not
create a Railway service. Deploy only a verified release; pin its image digest
when deploying from GHCR, and retain the previous verified digest for rollback.

## CI and container publication

- **Build bundle** runs hourly (17 minutes past the hour, UTC) or manually. It uses
  Node 24 for orchestration and Node 22 for Angular, builds/tests a local release,
  and only pushes those exact commits after the production dependency gate passes,
  without fetching or rebuilding newer inputs after testing. It explicitly
  dispatches Docker CI because pushes made with GITHUB_TOKEN do not trigger a
  second push workflow.
- **Build and push image** runs on main pushes changing the exact `bundle` gitlink
  or its workflow file, and on manual dispatch. An optional `release_sha` pins an
  exact main commit; it must belong to main's history. Source pins are verified
  without advancing branch tips. It runs component/API/bundle tests, builds and
  smoke-tests the container, and scans production dependencies and the image.
- HIGH/CRITICAL findings fail publication. Login and pushing happen only after all
  checks pass. The same tested local image is pushed (no intervening rebuild), then
  pulled by digest and smoke-tested again. Expected tags after a passing release:
  `ghcr.io/leon-silverthorn/workshopday1:latest` and `:sha-<12-character-main-sha>`.
  A tag name in this README is not a claim that an image has been published.
- Job permissions are explicit: bundle has contents write and actions write;
  Docker has contents read and packages write. Actions use commit SHAs, the Bun
  base uses a digest, CI builds are serialized, and no personal token is stored in
  repository files. GHCR packages may initially be private; review visibility if
  unauthenticated pulls are required.

Workflows: [Actions](https://github.com/Leon-Silverthorn/WorkshopDay1/actions).
The root agent rules are mirrored byte-for-byte to Copilot instructions.
