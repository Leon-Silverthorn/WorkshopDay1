# Generated Snip release

Do not hand-edit this branch. Run `node scripts/build-bundle.mjs` on main.

`bun start` serves UI, API and redirects from one process. `node cli.js ls` uses the same API.
`PUBLIC_DIR=./public` is a public build setting, not a secret. Configure PORT and BASE_URL or RAILWAY_PUBLIC_DOMAIN at runtime.
Storage is in memory and restarts clear it. See source-revisions.json for exact inputs.

Image publication is separately gated by tests and security scans on main. A generated branch push alone is not security approval or deployment approval.
