# Security Boundaries — Main Portal + Isolated Operations Command

This document lists what each side enforces today and which of those controls
must survive the merge unchanged. It is the checklist reviewers use on every
merge PR. `docs/MERGE_PLAN.md` says how to get there; this file says what
"there" must still guarantee.

## What this system is not

Copy and code must never claim any of the following. They are documented in
`README.md` and the ops runbooks and stay documented after the merge.

- Certified emergency dispatch or a substitute for 911.
- Legal waiver execution. `no_tow_authorization.html` records a submission;
  it does not execute a contract.
- Regulated payment processing or regulated finance. Owner draws and pricing
  tiers are internal prototype records.
- Production identity. Both sides use a shared operator token, not users,
  roles, or MFA.
- Live telematics, live Teams, live Grace AI, or live media unless
  customer-owned endpoints are configured. Defaults are simulation.

## Invariants that must survive the merge

Numbered so PRs can cite them.

### Authentication and authorization

- **I-1** Portal mutating routes (`POST /api/dvir`, `/api/stream/override`,
  `/api/submit-job`, `/api/onboarding`, `/api/owner-draws`,
  `/api/dispatch/quotes`) keep the three-mode behavior: token required when
  `OPERATOR_TOKEN` is set, demo when `ALLOW_DEMO_WRITE_MODE=true` and no
  token, otherwise 503 `writes_disabled`.
- **I-2** Every ops API route (state, audit, config, SSE events, and all POST
  routes) requires a token on every request. There is no demo mode for ops
  routes. `ALLOW_DEMO_WRITE_MODE` must never unlock them.
- **I-3** Inbound Teams events (`/api/teams/events`) use their own bearer
  token (`TEAMS_INBOUND_TOKEN`) and return 503 when it is not configured.
- **I-4** Token comparison is constant-time. The main's `constantTimeMatch`
  is the reference implementation. The backup's `===` comparison in
  `validateAuth` and the Teams bearer check must be replaced during the merge.
- **I-5** Startup refuses to run in non-simulation mode with a missing or
  default token (`change-me-isolated-ops`). This check joins the existing
  persistence-readiness gate in `app.js`.
- **I-6** Tokens are never logged, never returned in responses, and never
  written to persisted state or audit entries. The ops `redact()` helper
  masks keys matching token, secret, authorization, password, apiKey.

### Policy and dispatch safety

- **I-7** NO TOWING and NO WINCHING is evaluated at intake
  (`evaluatePolicy` on serviceType, requestedService, description, summary)
  and again on Grace AI output (`applyPolicyToAiOutput`). A rejection returns
  422, records a `policyRejections` entry, audits `policy.rejected` or
  `policy.rejected_ai_output`, and routes to an external referral provider.
- **I-8** `SUPPORTED_SERVICES`, `LOW_RISK_AUTO_DISPATCH_SERVICES`, and
  `POLICY_PATTERNS` in `policy.js` are not loosened. Adding a pattern is
  acceptable; removing one is not.
- **I-9** New queue items start as `awaiting_human_approval` with
  `requiresHumanApproval: true`. Auto-dispatch happens only when
  `ISOLATED_OPS_ENABLE_AUTO_DISPATCH` is true, automation is not paused, the
  recommended service is in the low-risk list, and the AI decision explicitly
  set `requiresHumanApproval: false`.
- **I-10** Work-order transitions follow the `TRANSITIONS` map only.
  `completed` requires `completionNotes`; `closed` requires
  `customerSafeSummary` with angle brackets stripped. Every transition records
  `statusHistory` and an audit event. Idempotency keys replay the original
  response.
- **I-11** Emergency automation pause (`/api/automation/pause`) remains
  available, authenticated, audited, and visible in state and monitors.
- **I-12** AI `allowedActions` are filtered to `draft_dispatch` and
  `notify_teams`. No AI output can trigger a transition, a restore, or an
  external call by itself.
- **I-13** Technician copilot accepts only sources listed in
  `ISOLATED_OPS_TECH_KNOWLEDGE_SOURCES`. Legal, accounting, tax, and business
  domains force `professional_review_required` with informational-only
  advisory text.

### Data handling

- **I-14** No raw filesystem paths in any API response. The backup's
  `/health/ready` currently returns `dataDir`; the merged readiness endpoint
  must not. The old monolithic `app.js` also returned `file: filePath` from
  DVIR saves; do not reintroduce that.
- **I-15** Atomic writes (temp file then rename) for portal records and the
  ops state snapshot. Audit logs are append-only NDJSON or JSONL. Portal
  audit appends are serialized per file through `auditWriteQueues`.
- **I-16** Backup restore validates snapshot shape (`state` object with
  `dispatchQueue`, `incidents`, `policyRejections` arrays; `audit` array of
  objects), runs `deepSanitize` to drop `__proto__`, `constructor`, and
  `prototype` keys, then reloads state and emits a `snapshot` event.
- **I-17** Backup CLI requires absolute paths for `--out` and `--from`.
- **I-18** `data/`, `.env`, and any file under `ISOLATED_OPS_DATA_DIR` are
  never committed. `.gitignore` already covers `data/` and `.env*` except
  `.env.example`.
- **I-19** Portal validation stays server-side (`src/validation.js`). Owner
  draw authorization text is stored masked; waiver and onboarding store
  presence flags and masked references, not raw identifiers.

### Transport and browser hardening

- **I-20** Ops UI is served with `script-src 'self'` (no inline scripts) and
  `frame-src` and `media-src` limited to the configured allowlists.
  `frame-ancestors 'self'`, `x-frame-options SAMEORIGIN`,
  `referrer-policy no-referrer`, `permissions-policy` denying camera,
  microphone, geolocation, and `cache-control: no-store` on ops responses.
- **I-21** Portal pages keep helmet with their current CSP. The portal CSP
  allows inline scripts because the legacy pages use them; that allowance
  must not leak onto the ops routes.
- **I-22** CORS on ops routes uses `ISOLATED_OPS_ALLOWED_ORIGINS` only and
  exposes `content-type, authorization, x-ops-token, idempotency-key`.
  Portal CORS keeps `ALLOWED_ORIGINS` and returns 403 `cors_denied`.
- **I-23** Media sources and secure-browser targets accept only `http:` and
  `https:`, and only origins on their allowlists unless the source is marked
  simulated. Iframes stay sandboxed. Launch URLs are held in browser memory
  only and are not returned in `getPublicState()`.
- **I-24** Ops routes are rate limited (60 per minute per client) and honor
  `x-forwarded-for` only when `ISOLATED_OPS_TRUST_PROXY=true`.
- **I-25** Ops JSON bodies are capped by `ISOLATED_OPS_MAX_BODY_BYTES`
  (default 16 KB). Portal bodies are capped by `REQUEST_SIZE_LIMIT`. The
  restore route may have its own larger cap per the merge plan.
- **I-26** SSE sessions expire at `ISOLATED_OPS_SSE_SESSION_TTL_MS`, send a
  `session_expiring` event, and are cleaned up on client close and on server
  stop.

### Honesty of state

- **I-27** Simulated data is labeled simulated everywhere it appears:
  `source: 'simulated_demo_data'` on the portal scanner and status,
  `simulationMode` and `simulated: true` in ops state, `provider:
  'simulation'` on AI decisions, `mode: 'simulation'` on Teams results, and
  the simulation banner in the ops UI.
- **I-28** Monitor statuses use only `online`, `simulated`, `offline`,
  `stale`, `error`. A source without a live URL never shows `online`.
- **I-29** Readiness reports degraded dependencies honestly: `degraded: true`
  when persistence, Grace AI, or Teams report `error`.

## Controls the main lacks and gains from the merge

Rate limiting, body-size guard per router, startup token validation,
append-only single audit stream with redaction, SSE with TTL, idempotency on
intake and transitions.

## Controls the backup lacks and gains from the merge

Constant-time token compare, request IDs with structured request logging,
helmet-managed headers, `express.json` malformed-JSON handling, supertest
coverage, CI on push.

## Review procedure for a merge PR

1. For each invariant above, name the test or the code line that proves it
   still holds. Add a test where none exists.
2. Run `npm ci`, `npm run check`, `npm test`, `npm audit --audit-level=high`,
   and `cd isolated-ops-command && node --test` while that directory still
   exists. Paste real output.
3. Confirm `.env.example` lists every variable the merged server reads and
   contains no real values.
4. Confirm no doc contains a `/home/runner/work/...` path or a hardcoded
   `C:\` path outside the launcher's single configurable variable.
