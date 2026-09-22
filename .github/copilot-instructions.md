# GitHub Copilot Instructions — tech_portal (EH Graced Roads)

## What this repository is

Two operational systems for EH Graced Roads Solutions LLC that are being
**merged into one server**:

- **Main** (portal / cockpit): `app.js`, `src/server.js`, `src/persistence.js`,
  `src/validation.js`, `public/*.html`, `index.html`,
  `no_tow_authorization.html`. Express 5 on port 3000.
- **Backup** (Isolated Operations Command): `isolated-ops-command/`. Raw
  `node:http` on port 4300, zero npm dependencies, SSE monitor wall, Grace AI
  adapter, Teams adapter, NO TOWING / NO WINCHING policy engine, backup
  export/restore.

When the user says "main and backup", they mean these two. The active task is
the merge. Read `docs/MERGE_PLAN.md` before changing structure and
`docs/SECURITY_BOUNDARIES.md` before touching auth, persistence, headers, or
policy. Read `docs/GRACE_AI_INVENTORY.md` before touching anything named
Grace.

## Highest priority rules

1. Every invariant in `docs/SECURITY_BOUNDARIES.md` must still hold after your
   change. If a merge step forces a trade-off, stop and describe it in the PR
   instead of picking silently.
2. Keep **all** Grace AI behavior from **both** sides. Nothing in
   `docs/GRACE_AI_INVENTORY.md` may be dropped, renamed without a compatibility
   path, or quietly stubbed.
3. NO TOWING and NO WINCHING stays enforced at intake and on AI output.
   `isolated-ops-command/src/policy.js` is the single source of truth. Do not
   weaken its regexes or lists.
4. Human approval before dispatch stays the default. Auto-dispatch stays off by
   default and limited to `LOW_RISK_AUTO_DISPATCH_SERVICES`.
5. Simulated data stays labeled simulated. Never claim live integrations,
   certified dispatch, production auth, or regulated finance.
6. No secrets, tokens, webhook URLs, tenant IDs, or AI keys in code, docs, or
   tests. Only `.env.example` names variables.
7. No raw filesystem paths in any API response.
8. Constant-time token comparison everywhere (`constantTimeMatch` in
   `src/server.js` is the reference).

## Code conventions

- Node 20, CommonJS `require`, no TypeScript, no build step, no new runtime
  dependencies without a reason stated in the PR. The backup deliberately has
  zero dependencies; keep its `src/policy.js`, `src/storage.js`,
  `src/grace-ai.js`, `src/teams.js` dependency-free so they can move as-is.
- Tests use `node:test` and `node:assert/strict`. Main tests use `supertest`
  against `createApp()`. Backup tests start a real server on port 0 and use
  `fetch`. Either style is acceptable in the merged tree; do not rewrite
  passing tests only to change style.
- Error responses on the main side use `{ ok: false, error: { code, message,
  requestId } }`. The backup uses `{ error: 'message' }`. During the merge keep
  each route's existing shape unless the plan says otherwise, because the two
  frontends parse them differently.
- Atomic writes: temp file then rename. Audit logs are append-only.
- Requests get an `x-request-id`; keep propagating it.
- Frontend to backend route parity is tested. If you add a `fetch(` or
  `apiRequest(` call to any HTML under root or `public/`, add the route to
  `frontendRouteInventory` in `src/server.js`. When the ops UI is served by the
  main app, extend the scanner to cover `isolated-ops-command/public/app.js`
  or its new location.
- Docs use repository-relative paths. Replace `/home/runner/work/...` paths
  when you see them. The developer runs Windows; do not assume bash-only
  commands in docs, or show both.

## Things you must not do

- Do not delete or rewrite `dvir_reports.json` or `radio_dispatch_logs.json`
  at the root. Legacy exports, not app inputs.
- Do not remove `no_tow_authorization.html` or its `/api/submit-job` flow.
- Do not add `'unsafe-inline'` to the CSP that governs the ops monitor UI. The
  ops UI uses an external `app.js` for a reason.
- Do not let demo write mode (`ALLOW_DEMO_WRITE_MODE`) unlock ops admin routes
  such as backup restore, automation pause, or work-order transitions.
- Do not make `/api/admin/backup/restore` reachable without a token, and do
  not remove its shape validation and `deepSanitize` step.
- Do not implement automated safety-critical decisions. Recording, reviewing,
  approving, and transitioning are fine. Auto-executing towing, routing,
  compliance, or money movement is not.

## Validation before opening or updating a PR

The full gate is `docs/TEST_PLAN.md`. Minimum on every commit:

```bash
npm ci
npm run check
npm test
npm audit --audit-level=high
```

The root `npm test` runs `scripts/run-tests.js` over `test/`, `tests/`, and
`isolated-ops-command/test/` (32 tests at baseline: 30 pass, 2 skipped
pending the field API). `frontend/` Jest tests are excluded and run inside
that folder. The passing count must never go down and skipped tests must be
listed in the PR. Report the real output. If something fails, say so in the
PR body. Fill in every section of `.github/PULL_REQUEST_TEMPLATE.md`;
reviewers reject PRs with empty sections.

## PR description expectations

- Which side(s) changed: main, backup, or merged.
- Which invariants you verified and how.
- Which Grace AI touchpoints you touched, if any, and how you preserved them.
- Any docs you updated. README, `docs/OPERATIONS.md`, and the
  `isolated-ops-command/*.md` runbooks must stay accurate.
