# Snip CLI

Zero-dependency CommonJS client for the Snip API. Requires Node 20 or newer;
there is no dependency-install step. Files live at this independent `cli` branch's
root. The `main` superproject mounts this branch as a submodule.

## Run

```sh
node cli.js help
node cli.js add https://example.com
node cli.js ls
node cli.js open Ab12Cd
```

Use the returned six-character code in place of `Ab12Cd`. `add` prints only the
returned short URL. `ls` prints an aligned code/hits/original-URL table, or
`No links yet.`. `open` reads the API's `302 Location` without following it in
Node, then opens that original HTTP(S) URL in the default OS browser. It is silent
on success. A redirect increments hits **before** browser launch; a failed launch
does not undo that hit. Links disappear when the in-memory backend restarts.

The API defaults to `http://localhost:3000`; set `SNIP_API` to change it:

```sh
SNIP_API=https://snip.example.com node cli.js ls
```

```powershell
$env:SNIP_API = 'https://snip.example.com'
.\snip.ps1 ls
```

The base URL must use HTTP(S), without credentials, query or fragment. A path
prefix and trailing slash are supported. Requests, including response-body reads,
have a 10-second timeout. Bad arguments are rejected before a request. Errors
(including API `400`/`404` messages, malformed responses, timeouts, unreachable
backend and launcher failures) go to stderr with exit status **1**; success/help
exit **0**. API requests use manual redirects to detect unexpected responses.

Wrappers work from another current directory and forward arguments/exit status:
`./snip` on POSIX, `snip.cmd` in Command Prompt, `./snip.ps1` in PowerShell.
Optionally run `npm link` to install the package's `snip` bin on your PATH.
Browser launch uses Windows `start`, macOS `open`, or Linux `xdg-open`.

## Verify

```sh
npm test
node cli.js help
```

With no server at the selected address, `node cli.js ls` must print an error to
stderr and exit 1. Against a running backend, create a link, list the same code
with zero hits, open it, and list again to see one hit. Tests use a local mock API
and child processes to check real output/exit codes, validation, errors, redirects,
timeouts and wrappers. OS launcher commands and failure handling are tested with
mock processes; those tests do not open a graphical browser.

For an automated live check, with Git and Bun installed and `origin/backend`
available, run `npm run test:integration`. It extracts that committed server into a
temporary directory, starts it on an unused local port, verifies CLI/API-client
visibility, redirects and hits, then stops it and removes the directory. No source
branch is changed. Set `BUN_BIN` to the Bun executable path if it is not on PATH.

The release builder copies `cli.js` unchanged beside the Bun server. Keep this file
CommonJS and omit `"type":"module"` from any package containing it. Source changes
belong on `cli`; commit/push here, then update the pinned submodule on `main`.
Never edit the generated `bundle` copy by hand.
