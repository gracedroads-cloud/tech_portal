# Test Plan — final gate for the merged system

This is the test gate GitHub Copilot and Claude must clear before any merge
PR is marked ready. It is written so a reviewer can run it in ten minutes and
so the same checks run in CI. Nothing here is optional.

## Baseline recorded 2026-09-22

Before the guidance package, from the repository root on the local
`copilot/harden-backup-operations` branch:

| Command | Result |
|---|---|
| `npm run check` | pass |
| `node --test` | 28 tests, 28 pass, 0 fail (7 portal, 21 backup) |

The remote branch then arrived with 36 more commits (PR #1 merge and
follow-ups). Run against that code, unmodified:

| Command | Result |
|---|---|
| `npm run check` | pass |
| `node --test` | 35 tests, 30 pass, 5 fail |

The five failures were three Jest files under `frontend/` that Node's runner
cannot execute, and two field-API tests that hit routes missing from
`src/server.js` (regression E). Fixes applied the same day: `npm test` now
runs `scripts/run-tests.js`, which discovers `*.test.js` under `test/`,
`tests/`, and `isolated-ops-command/test/` only (works on Node 20 and 24),
and the two field tests are skipped with the reason printed in the output.

| Command (after fixes, local Node 24) | Result |
|---|---|
| `npm run check` | pass |
| `npm test` | 32 tests, 30 pass, 0 fail, 2 skipped (field API) |
| `npm audit --audit-level=high` | pass (one moderate advisory in `qs`, transitive) |

Skipped tests count as neither pass nor fail and must be listed in every PR
until they run.

After the merge the passing count must not go down. New behavior needs new
tests, so the count goes up.

## Gate 1: automated, every commit

Run from the repository root. All must exit 0. Paste the tail of each into
the PR.

```bash
npm ci
npm run check
npm test
npm audit --audit-level=high
```

`npm run check` must list every file under `src/` including `src/ops/`.
Update the `check` script in `package.json` when files are added.

## Gate 2: invariant tests that must exist and pass

Each row maps to `docs/SECURITY_BOUNDARIES.md`. Rows marked NEW do not exist
yet and must be added during the merge.

| Invariant | Test | Status |
|---|---|---|
| I-1 | mutating routes require token when operator token is configured | exists |
| I-2 | requires auth for mutating APIs; requires auth for operational state feeds | exists, re-point to `/ops` |
| I-2 | demo write mode on, no token, `/ops/api/admin/backup/restore` returns 401 | NEW |
| I-2 | demo write mode on, no token, `/ops/api/state` and `/ops/api/events` return 401 | NEW |
| I-4 | wrong token of same length returns 401 on portal and ops routes | NEW |
| I-5 | `createApp` with simulationMode false and default token rejects startup | NEW |
| I-7 | rejects towing requests at the API layer and records audit history | exists |
| I-7, I-12 | rejects Grace AI output that proposes towing | exists |
| I-9 | requires human approval by default and allows explicit approval | exists |
| I-9 | auto-dispatches only low-risk approved services when explicitly enabled | exists |
| I-9 | auto-dispatch disabled while automation is paused | NEW |
| I-10 | supports full work-order transitions through closeout with idempotency | exists |
| I-10 | invalid transition returns 409 | NEW |
| I-11 | supports automation pause and reports it in state | exists |
| I-13 | technician copilot authorized sources and legal escalation | exists |
| I-14 | `/readyz` body contains no key named `dataDir` and no string containing the temp data path | NEW |
| I-15 | recovers persisted state after restart | exists |
| I-16 | supports backup export and restore APIs; rejects malformed restore payloads | exists |
| I-16 | restore payload with `__proto__` key is stripped | NEW |
| I-20 | `/ops/` response CSP has `script-src 'self'` and no `unsafe-inline` | NEW |
| I-21 | `/` response CSP is the portal CSP | NEW |
| I-22 | OPTIONS preflight on `/ops/api/incidents` allows `x-ops-token` and `idempotency-key` | NEW |
| I-23 | validates media sources against allowlist; validates secure browser URLs | exists |
| I-24 | 61st request in a minute to an ops route returns 429 | NEW |
| I-25 | rejects malformed JSON payloads; rejects oversized payloads | exists |
| I-26 | streams monitor updates over SSE; expires SSE sessions at TTL | exists |
| I-27 | scanner and status report `simulated_demo_data` | exists |
| parity | frontend API calls have backend route parity, scanning `public/ops/app.js` too | exists, extend |

## Gate 3: Grace AI checks

All rows in `docs/GRACE_AI_INVENTORY.md` sections A and B. The automated
subset:

- stream override returns `human_operator_override` and `grace_ai_resumed`
  (NEW assertion on the existing override test).
- `/ops/api/config` returns `graceAvatarProfile` and `graceVoiceProfile`
  (NEW).
- `/readyz` ops block reports `graceAiMode: 'simulation'` when no endpoint is
  configured (NEW).
- Grace adapter failure falls back to `provider: 'fallback'` with flag
  `grace_ai_unavailable` and audits `grace_ai.error` (NEW; point
  `graceAiEndpoint` at a closed port).

The manual subset, done in a browser and recorded in the PR as "verified in
browser on <date>":

- Business dashboard: pick up line, return to Grace, dispatch closest. Badge
  changes, transcript appends, speech plays, terminal log says backend
  confirmed.
- Ops wall at `/ops/`: submit an incident, approve it, walk it to closed,
  watch the monitors update live without refresh.
- Ops wall: submit an incident containing the word "tow". Local pre-check
  blocks it. Remove the pre-check text and submit via curl; API returns 422
  and the rejection appears in the policy panel.

## Gate 4: startup, shutdown, recovery

Manual, once per merge PR, recorded in the PR.

1. Start with `.env` from `.env.example`. Server logs one listening line.
   `/healthz` 200, `/readyz` 200 with `writeMode` and `ops` block.
2. Start with `ISOLATED_OPS_SIMULATION_MODE=false` and no token. Process
   exits non-zero with the token message.
3. Start normally, create an incident, send SIGTERM (Ctrl+C). Audit shows
   `system.stopping`. Restart. `/ops/api/state` still has the incident.
4. `npm run backup:export -- --out <absolute path>`. Delete the data
   directory. `npm run backup:restore -- --from <same path>`. Restart. State
   and audit tail are back.
5. Launcher: run `Launch_Graced_Roads_Cockpit.bat`. One node process.
   Browser opens `/` and `/ops/`.

## Gate 5: regression from PR #2

`docs/GRACE_AI_INVENTORY.md` section D. Whichever option the owner picks,
add a test: either the scanner response includes `timestamp`, `sourceType`,
`alertType` and the page renders a real date, or the page no longer
references those fields.

## Gate 6: environment and hygiene

- `.nvmrc` says 20 and `package.json` engines say `>=20 <23`. CI uses 20.
  Local machines on Node 24 will see an engines warning from `npm ci`; that
  is acceptable locally but the PR must show CI green on Node 20.
- `git status` shows nothing under `data/`, no `.env`, no `*.log`.
- `grep -rn "change-me-isolated-ops" src/ test/` shows only the startup
  guard, never a default that reaches production.
- `grep -rn "home/runner/work/tech_portal" --include=*.md` is empty.

## What "done well" means for the company

The system this repo runs is the dispatch memory of a small roadside
business. The tests above protect four things: nobody can dispatch towing or
winching through it, nobody can dispatch anything without a human approving,
the audit trail survives restarts and restores, and nothing simulated is ever
shown as live. A PR that passes Gate 1 but skips Gates 2 through 5 has not
protected those four things and is not ready.
