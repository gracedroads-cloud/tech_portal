# Acceptance Criteria — merged tech_portal

The merge is done when every item below is true and the PR shows evidence.

## One process

- [ ] `npm start` from the repository root starts one Node process on `PORT`.
- [ ] `isolated-ops-command/server.js` no longer exists, or is a thin shim
      that prints a deprecation message and exits non-zero.
- [ ] `auto_launch_cockpit.ps1` and `Launch_Graced_Roads_Cockpit.bat` start
      that one process, wait for the port, and open `/` and `/ops/`. The
      install directory is a single variable at the top of the script.

## Both UIs served

- [ ] `/`, `/index.html`, `/no_tow_authorization.html`, and every page under
      `public/` load with the portal CSP and work as before.
- [ ] `/ops/` loads the monitor wall with `script-src 'self'`, connects to
      `/ops/api/events`, and renders monitors, queue, incidents, policy
      rejections, audit, media, and secure-browser panels.
- [ ] The ops UI token field still gates all API calls and the token is not
      persisted to `localStorage`.

## One auth model

- [ ] A single `OPERATOR_TOKEN` authenticates portal mutating routes and all
      ops routes. `x-operator-token`, `x-ops-token`, and `Authorization:
      Bearer` are all accepted. Comparison is constant-time.
- [ ] `ALLOW_DEMO_WRITE_MODE=true` with no token allows portal POSTs and
      returns 401 on every `/ops/api/*` route. A test proves it.
- [ ] Startup fails with a clear message when simulation mode is off and the
      token is missing or the default value.

## Invariants

- [ ] Every invariant I-1 through I-29 in `docs/SECURITY_BOUNDARIES.md` is
      cited in the PR with the test or code line that proves it.
- [ ] `/readyz` includes the ops block and does not include `dataDir` or any
      other filesystem path.

## Grace AI

- [ ] Every row in `docs/GRACE_AI_INVENTORY.md` sections A and B is checked
      off in the PR.
- [ ] The section D regression (breakdown scanner) has a recorded decision
      and is no longer in a half-state.
- [ ] The section E regression (field apps) has a recorded decision; either
      the `/api/field` routes exist and `tests/app-dvir.test.js` runs
      unskipped, or the field files and the test are removed.
- [ ] The `frontend/` app (section F) has a recorded decision: kept as a
      standalone prototype with its missing backend documented, or scheduled
      as scoped work, or removed.

## Repository hygiene

- [ ] No files under `node_modules/` or `data/` are tracked
      (`git ls-files node_modules data` is empty).
- [ ] `BLUEPRINT.md` is labeled aspirational or moved under `docs/` with
      that label.

## Tests and CI

- [ ] `npm test` from the root runs both the portal suite and the ops suite
      and the output lists both files.
- [ ] The frontend route parity test scans `public/ops/app.js` and passes
      with `/ops`-prefixed routes in the inventory.
- [ ] `npm run check` covers every new file under `src/ops/`.
- [ ] `npm audit --audit-level=high` passes.
- [ ] CI workflow needs no change other than possibly removing a separate
      backup step.

## Docs

- [ ] Root `README.md` describes the merged system: ports, URLs, env vars,
      auth modes, simulation defaults, backup and restore, production
      blockers.
- [ ] `docs/OPERATIONS.md` absorbs the ops RUNBOOK, SECURITY, and OPERATIONS
      content. Paths are repository-relative.
- [ ] `.env.example` lists every variable the merged server reads, with
      empty or obviously fake values.
- [ ] No doc contains a CI runner checkout path
      (`grep -rn "home/runner/work/tech_portal" --include=*.md` is empty).

## Non-goals for this merge

Real Teams, external Grace AI, live media, managed database, MFA, per-user
roles, mobile app, and the production blockers listed in `README.md`.
