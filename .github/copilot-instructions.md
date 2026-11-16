# Repository instructions

Keep `CLAUDE.md` and `.github/copilot-instructions.md` identical.

- `main` is a Git superproject. `backend` (Bun), `frontend` (Angular 19), `cli`
  (Node CommonJS), and `bundle` are branches of this same repository, mounted as
  commit-pinned submodules. Component source belongs at its branch root.
- Clone with `--branch main --recurse-submodules`. Inspect status and origin before
  changing anything; preserve existing work. Only one writer owns a shared checkout.
- Edit, test, commit and push a source component first, then separately commit its
  gitlink update on main. Check branch identity before editing a detached submodule.
- API: POST `/api/links` creates `{code,url,shortUrl,hits,createdAt}` with 201 or
  `400 {error:string}`; GET lists records; GET `/:code` redirects with 302 and counts
  one hit, or returns 404. Change this contract consistently across all clients.
- Storage is intentionally in memory. Do not introduce persistence for this demo.
- Never hand-edit `bundle/`. Use `node scripts/build-bundle.mjs [--push]` from a clean
  main checkout. It selects source tips, records their SHAs, builds, and commits
  generated output and pointers; unchanged inputs produce no commits.
- Preserve `dist/snip-frontend/browser`, same-origin production `/api`, and CommonJS
  CLI compatibility: no package `type` field in the generated bundle.
- Use Node 22 for Angular; the orchestrator supports Node 24 with
  `SNIP_FRONTEND_NODE` selecting the supported Angular runtime.
- Run `node scripts/verify-pins.mjs`, `node scripts/smoke.mjs --bundle`, component
  tests, dependency scans and container checks before publishing.
- Bundle CI intentionally uses hourly schedule/manual dispatch. Docker CI watches
  the `bundle` gitlink, not `bundle/**`, and is explicitly dispatched after verified
  automated bundle pushes because GITHUB_TOKEN push events do not chain workflows.
- CI actions and the Bun base image are pinned. Publish the already-tested image
  only after HIGH/CRITICAL dependency and image gates pass. Do not suppress security
  findings or force major dependency upgrades to make checks green.
- Generated `.env` contains only `PUBLIC_DIR=./public`; supply secrets externally.
  Railway config is release material, not evidence that a deployment was performed.
