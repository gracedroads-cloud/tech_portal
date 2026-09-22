# Merge Plan — Main Portal + Isolated Operations Command

Goal: one Node process, one launcher, one auth model, one CI run, serving both
the legacy portal pages and the operations monitor wall, with every safety
control from both sides intact.

Branch context: work happens on `copilot/**` branches (currently
`copilot/harden-backup-operations`), merged to `main` by PR. CI runs
`npm ci`, `npm run check`, `npm test`, and `npm audit --audit-level=high`.

## 1. What exists today

| Concern | Main (`src/server.js`) | Backup (`isolated-ops-command/src/server.js`) |
|---|---|---|
| HTTP layer | Express 5, helmet, cors, `express.json` | Raw `node:http`, hand-rolled headers, `parseBody` |
| Port | `PORT` default 3000 | `ISOLATED_OPS_PORT` default 4300 |
| Auth header | `x-operator-token` | `x-ops-token` or `Authorization: Bearer` |
| Auth scope | POST routes only, via `requireMutatingAccess` | Every `/api/*` route including GET state, audit, SSE; except `/api/teams/events` which has its own bearer |
| Write modes | `token_required`, `demo_no_auth`, `disabled` | Token always; default token allowed only when `simulationMode` is true |
| Token compare | constant-time (`constantTimeMatch`) | plain `===` |
| Body limit | `REQUEST_SIZE_LIMIT` default 100kb | `ISOLATED_OPS_MAX_BODY_BYTES` default 16384 |
| Rate limit | none | 60 requests per minute per IP, in memory |
| CSP | `script-src 'self' 'unsafe-inline'` (pages have inline scripts) | `script-src 'self'`, plus configurable `frame-src` and `media-src` allowlists |
| Persistence | one JSON file per record under `DATA_DIR/<collection>/`, plus `DATA_DIR/audit/<collection>.ndjson` | single `ops-state.json` snapshot plus `audit.log.jsonl` under `ISOLATED_OPS_DATA_DIR` |
| Startup gate | waits for `ensureDir(dataDir)` | `validateStartupConfig`: non-default token when not simulating, write probe |
| Realtime | none | SSE at `/api/events` with TTL and cleanup on stop |
| Grace AI | stream override state (`human_operator_override` / `grace_ai_resumed`), browser speech in dashboard | `grace-ai.js` adapter (simulation or external endpoint), policy post-filter, `lastGraceAiDecision`, `graceAiActivity` monitor, avatar and voice profiles, technician copilot |
| Tests | `test/api.test.js` with supertest, includes frontend route parity scan | `test/isolated-ops.test.js`, real server on port 0, `fetch` |
| Static | `public/`, `index.html`, `no_tow_authorization.html` | `public/index.html`, `app.js`, `styles.css` |
| Launcher | `Launch_Graced_Roads_Cockpit.bat` and `auto_launch_cockpit.ps1` (hardcoded `C:\GracedRoadsSystem\backend-api`) | `node server.js` |

## 2. Target shape

```text
app.js                      single entry point, starts Express on PORT
src/server.js               createApp(): middleware, portal routes, mounts ops router
src/persistence.js          unchanged
src/validation.js           unchanged
src/ops/                    moved from isolated-ops-command/src/
  policy.js                 unchanged
  storage.js                unchanged
  grace-ai.js               unchanged
  teams.js                  unchanged
  backup-cli.js             reads DATA_DIR/isolated-ops by default
  router.js                 NEW: Express router built from the old raw handler
public/ops/                 moved from isolated-ops-command/public/
  index.html, app.js, styles.css
test/api.test.js            unchanged plus parity scan extended to public/ops/app.js
test/ops.test.js            moved from isolated-ops-command/test/, pointed at createApp()
docs/                       merged runbooks
```

URL layout after merge:

- Portal pages stay where they are: `/`, `/index.html`, `/public/*.html`
  served from `public/`, `/no_tow_authorization.html`.
- Ops monitor UI at `/ops/` serving `public/ops/index.html`, `app.js`,
  `styles.css`.
- Ops API under `/ops/api/*`, keeping the same suffixes: `/ops/api/state`,
  `/ops/api/events`, `/ops/api/incidents`, `/ops/api/dispatch/:id/approve`,
  `/ops/api/work-orders/:id/transition`, `/ops/api/automation/pause`,
  `/ops/api/technician/copilot`, `/ops/api/teams/notify`,
  `/ops/api/teams/events`, `/ops/api/media/sources`,
  `/ops/api/secure-browser/launch`, `/ops/api/secure-browser/clear`,
  `/ops/api/admin/backup/export`, `/ops/api/admin/backup/restore`,
  `/ops/api/simulate/tick`, `/ops/api/config`, `/ops/api/audit`.
- Ops health folded into main: `/healthz` stays liveness; `/readyz` gains an
  `ops` block with `simulationMode`, `graceAiMode`, `teamsMode`,
  `dependencies`, `degraded`. Do not include `dataDir`.

Data layout: `DATA_DIR/isolated-ops/ops-state.json` and
`DATA_DIR/isolated-ops/audit.log.jsonl`. `ISOLATED_OPS_DATA_DIR` remains
honored as an override for one release so existing deployments can migrate.

## 3. Why an Express router and not a raw sub-app

Mounting the raw `http` handler inside Express looks tempting, since Express
strips the mount path from `req.url`, but it breaks in two ways:

- `express.json` consumes the request stream before the raw `parseBody`
  attaches its `data` listeners, so every ops POST hangs.
- The raw handler writes its own CSP, CORS, and cache headers, which fight
  helmet and produce duplicate or contradictory headers.

An Express router lets the ops routes reuse request IDs, logging, JSON
parsing, and error handling, while still applying stricter per-router
settings (body size, rate limit, CSP, auth). The four pure modules
(`policy.js`, `storage.js`, `grace-ai.js`, `teams.js`) move without edits.

If a single-PR rewrite is too large, an acceptable stepping stone is to keep
two processes but ship a single launcher that starts both and a single README.
That is not the end state and the PR must say so.

## 4. Step order

Each step is one PR or one reviewable commit. Run the full validation list
after each.

1. **Move the pure modules.** `git mv isolated-ops-command/src/{policy,storage,grace-ai,teams}.js src/ops/`. Update requires. Run backup tests from their old location with updated paths. No behavior change.
2. **Build `src/ops/router.js`.** Port `createServer` into `createOpsRouter(config, deps)` returning `{ router, start, stop, getPublicState, audit }`. Keep every handler body as-is; replace `toJson(res, code, body)` with `res.status(code).json(body)`, replace `parseBody` with `req.body` (an `express.json({ limit: config.maxBodyBytes })` instance scoped to the router), keep `deepSanitize` and all validators. Keep SSE by writing directly to `res` as before. Keep the rate limiter as router-level middleware. Keep `TRANSITIONS`, idempotency maps, `refreshMonitors`, `MONITOR_KEYS` untouched.
3. **Auth unification.** One middleware accepts `x-operator-token`, `x-ops-token`, and `Authorization: Bearer`. Compare with `constantTimeMatch`. Rules:
   - Portal POST routes: existing three-mode behavior unchanged.
   - Ops routes: token always required for every `/ops/api/*` route except `/ops/api/teams/events`, which keeps its own `TEAMS_INBOUND_TOKEN` bearer check. `demo_no_auth` never applies to ops routes.
   - Single token value. `OPERATOR_TOKEN` is canonical; `ISOLATED_OPS_TOKEN` is read as a fallback for one release and a startup warning is logged if both are set and differ.
   - Startup gate: when `ISOLATED_OPS_SIMULATION_MODE` is false, the token must be set and must not equal `change-me-isolated-ops`. This joins the existing persistence-readiness gate in `app.js`.
4. **Headers.** Apply helmet globally with the portal CSP. On the `/ops` router, override with a second helmet instance: `script-src 'self'`, `frame-src` and `media-src` from the `ISOLATED_OPS_CSP_*` variables, `connect-src` from the allowlists, `frame-ancestors 'self'`, `cache-control: no-store`, `permissions-policy` as before. Ensure CORS on `/ops` uses `ISOLATED_OPS_ALLOWED_ORIGINS` and allows the `idempotency-key` and `x-ops-token` headers.
5. **Static.** Move `isolated-ops-command/public/*` to `public/ops/`. Update `app.js` in that folder so its `api()` helper prefixes `/ops`. Keep the token input field; do not persist the token to `localStorage` on the ops UI.
6. **Mount and wire.** In `createApp()`, build the ops router, mount at `/ops`, expose `start`/`stop` so `app.js` calls them on listen and on SIGTERM. `stop` must still clear the simulation interval, end SSE clients, and audit `system.stopping`.
7. **Readiness.** Extend `/readyz` per section 2. Remove the standalone `/health/live` and `/health/ready` or alias them to the merged endpoints; do not return `dataDir`.
8. **Tests.** Move `isolated-ops.test.js` to `test/ops.test.js`. Start the app with `createApp({ dataDir, operatorToken: 'test-token', ops: { simulationMode: true, ... } })` and `app.listen(0)`, or switch to supertest. Every existing assertion must still pass with `/ops` prefixes. Extend the parity test to scan `public/ops/app.js` and add the ops routes to the inventory. Add one test proving `ALLOW_DEMO_WRITE_MODE=true` with no token still returns 401 on `/ops/api/admin/backup/restore`.
9. **CLI.** `src/ops/backup-cli.js` defaults to `DATA_DIR/isolated-ops`. Add root scripts `backup:export` and `backup:restore`. Keep absolute-path requirement for `--out` and `--from`.
10. **Docs and launcher.** Merge `isolated-ops-command/README.md`, `RUNBOOK.md`, `SECURITY.md`, `OPERATIONS.md` into root `README.md` and `docs/OPERATIONS.md`. Replace `/home/runner/work/...` paths. Update `auto_launch_cockpit.ps1` to open `/` and `/ops/` after the port check, and make the install directory a variable at the top of the script instead of a hardcoded path. Update `.env.example` with the ops variables.
11. **Remove the old tree.** Delete `isolated-ops-command/` only after steps 1 through 10 are merged and the root test run shows both suites executing.

## 5. Known friction points, decide explicitly

- **Body limit for restore.** Ops body limit is 16 KB. A real snapshot with audit history exceeds that. Decision: keep 16 KB for all ops routes except `/ops/api/admin/backup/restore`, which gets its own `express.json({ limit })` using a new `ISOLATED_OPS_RESTORE_MAX_BYTES` (suggest 5mb). Document that the CLI is the preferred restore path for large snapshots.
- **Error body shapes differ.** Portal frontends read `payload.error.message`; the ops UI reads `payload.error` as a string. Keep both shapes on their own routes for now. Do not unify in the merge PR.
- **Rate limiter is per process, in memory.** Fine for one process. Note in docs that a multi-instance deployment needs a shared store.
- **`/api/routes` parity inventory** must list ops routes with the `/ops` prefix or the parity test fails once `public/ops/app.js` is scanned.
- **Two data-dir env vars.** Honor both for one release, log which one is used at startup, never log the resolved path in an API response.
- **`simulationMode` default is true.** Keep that default for local dev, but the README must state that production sets it to false and therefore requires a real token.

## 6. Pre-existing regression to resolve alongside the merge

Pull request #2 added `POST /api/breakdowns/ingest`, `GET
/api/breakdowns/live`, `GET /api/breakdowns/schema`, and DVIR-triggered
breakdown alerts to the old monolithic `app.js`. The refactor to
`src/server.js` did not carry them over, but the merge kept the rewritten
`public/breakdown_scanner.html` that expects `sourceType`, `alertType`,
`timestamp`, and `coordinates` on scanner items. The page currently renders
"Invalid Date" for every card. See `docs/GRACE_AI_INVENTORY.md` section D for
the two options. The owner picks; the PR records the choice.

## 7. Out of scope for the merge

Real Teams, external Grace AI endpoint, live media or TV sources, managed
database, MFA, per-user roles, and the production blockers listed in
`README.md`. Do not fold these in under the merge banner.
