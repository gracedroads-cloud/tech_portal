# Claude Project Instructions — tech_portal (EH Graced Roads)

Read this first, then `docs/CopilotMasterContext.md` (the index of every
doc, with reading order), then `docs/MERGE_PLAN.md`,
`docs/SECURITY_BOUNDARIES.md`, and `docs/GRACE_AI_INVENTORY.md`. Every Grace
AI behavior on both sides must survive the merge; the inventory is the
checklist.

## Project identity

Repository: `gracedroads-cloud/tech_portal`
Owner/operator: EH Graced Roads Solutions LLC
Runtime: Node.js 20 (see `.nvmrc`), CommonJS, no build step, no TypeScript
Test runner: `node --test` (Node built-in), `supertest` for the main app

This repository holds two operational systems that are being merged into one:

| Name in conversation | Location | Port | Stack |
|---|---|---|---|
| **Main** (portal / cockpit) | `app.js`, `src/`, `public/`, `index.html`, `no_tow_authorization.html` | 3000 | Express 5, helmet, cors, dotenv |
| **Backup** (Isolated Operations Command) | `isolated-ops-command/` | 4300 | Raw `node:http`, zero dependencies |

"Main and backup" in user requests means these two systems. The current work is
merging the backup into the main so there is one server, one launcher, one auth
model, and one CI run, without losing any safety control from either side.

## Core requirement of the merge

One server process serves both the legacy portal pages and the operations
monitor wall. Every control listed in `docs/SECURITY_BOUNDARIES.md` under
"Invariants that must survive the merge" still holds after the merge. If a
step of the merge would weaken one of those invariants, stop and say so
instead of proceeding.

## Non-negotiable safety statements

- This system is **not** certified emergency dispatch, legal waiver execution,
  regulated payment processing, or regulated finance. Never write copy or code
  that claims otherwise.
- **NO TOWING and NO WINCHING** is enforced in the operations command at intake
  and on AI output. The policy module is `isolated-ops-command/src/policy.js`.
  Do not loosen its patterns, its supported-service list, or its low-risk
  auto-dispatch list.
- Human approval before dispatch is the default. Auto-dispatch is off by
  default and, when enabled, applies only to the low-risk list and never to
  towing or winching.
- Simulated data is always labeled simulated (`simulated_demo_data`,
  `simulationMode`, `provider: 'simulation'`). Never present it as live.
- Grace AI output is advisory. It is post-filtered by policy and cannot dispatch
  on its own.

## How to work in this repo

- Prefer small, reviewable commits on a `copilot/**` branch. CI runs on those
  branches and on PRs.
- Do not touch `dvir_reports.json` or `radio_dispatch_logs.json` at the repo
  root. They are legacy data exports, not application inputs.
- Do not commit anything under `data/`, any `.env`, tokens, webhook URLs,
  tenant IDs, or AI keys. `.env.example` files are the only place for
  variable names, with empty or obviously fake values.
- Do not return raw filesystem paths in API responses. The main app already
  follows this rule; the backup's `/health/ready` currently returns `dataDir`
  and must be fixed during the merge.
- Keep atomic writes (temp file then rename) and append-only audit logs.
- Use constant-time comparison for tokens. Main has `constantTimeMatch` in
  `src/server.js`. The backup uses `===` and must adopt the main's approach.
- Paths in docs must be repository-relative. Replace any
  `/home/runner/work/...` paths you encounter.

## Validation before you finish a change

Run from the repository root:

```bash
npm ci
npm run check
npm test
npm audit --audit-level=high
```

Confirmed on 2026-09-22: the root `node --test` discovers
`isolated-ops-command/test/isolated-ops.test.js` as well, so one root run
covers both suites (28 tests: 7 portal, 21 backup). Running the backup suite
from its own directory is optional. The full gate, including the invariant
tests that still need to be written and the manual startup, shutdown, and
recovery checks, is `docs/TEST_PLAN.md`.

## Definition of done for the merge

See `docs/ACCEPTANCE_CRITERIA.md`. Summary: one process, one launcher, both
UIs served, all invariants hold, both test suites pass from the root, README
and runbooks describe the merged system accurately.
