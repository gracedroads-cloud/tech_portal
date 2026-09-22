# AI Work Status Checklist — merge of main and backup

Use after each batch of work from Claude or Copilot. Tick only what you have
seen proven by test output or by opening the page.

## Structure

- [ ] `src/ops/policy.js`, `storage.js`, `grace-ai.js`, `teams.js` exist and
      match the originals (`git diff --no-index` shows no changes)
- [ ] `src/ops/router.js` exists and `createApp()` mounts it at `/ops`
- [ ] `public/ops/index.html`, `app.js`, `styles.css` exist
- [ ] `app.js` starts one process and calls ops `start` and `stop`
- [ ] `isolated-ops-command/` removed or reduced to a deprecation shim

## Auth

- [ ] Portal POST with no token and demo mode on returns 201
- [ ] Ops POST with no token and demo mode on returns 401
- [ ] Ops GET `/ops/api/state` with no token returns 401
- [ ] Wrong token returns 401 on both sides
- [ ] `constantTimeMatch` is the only token comparison in the tree
      (`grep -rn "=== config.opsToken"` returns nothing)
- [ ] Startup fails in non-simulation mode with default token

## Policy and dispatch

- [ ] Incident with "tow" in description returns 422 and appears in policy
      rejections and audit
- [ ] External AI response recommending towing returns 422
- [ ] New incident is `awaiting_human_approval`
- [ ] Auto-dispatch test still requires the explicit flag and low-risk service
- [ ] Transitions test through `closed` passes with idempotent replay
- [ ] Automation pause works and shows in `/ops/api/state`

## Grace AI

- [ ] `/api/stream/override` still returns `human_operator_override` and
      `grace_ai_resumed`
- [ ] Business dashboard pick up, return to Grace, dispatch closest buttons
      work and speak
- [ ] `/ops/api/config` returns `graceAvatarProfile` and `graceVoiceProfile`
- [ ] `/readyz` reports `graceAiMode`
- [ ] Technician copilot rejects unauthorized source and escalates legal
- [ ] Breakdown scanner regression (inventory section D) has a decision

## Data

- [ ] No response body contains a path (`grep -rn "dataDir\|filePath" src/`
      shows none in `res.json` calls)
- [ ] State written to `DATA_DIR/isolated-ops/ops-state.json` atomically
- [ ] Audit appended to `DATA_DIR/isolated-ops/audit.log.jsonl`
- [ ] Restore rejects malformed payloads and strips prototype keys
- [ ] CLI export and restore require absolute paths

## Headers

- [ ] `/ops/` response CSP has `script-src 'self'` with no `unsafe-inline`
- [ ] `/` response CSP is the portal CSP
- [ ] Ops responses have `cache-control: no-store`
- [ ] CORS preflight on `/ops/api/*` allows `x-ops-token` and
      `idempotency-key`

## Tests and CI

- [ ] `npm test` output lists both `test/api.test.js` and `test/ops.test.js`
- [ ] Parity test scans `public/ops/app.js`
- [ ] `npm run check` includes `src/ops/*.js`
- [ ] `npm audit --audit-level=high` passes
- [ ] CI green on the branch

## Docs and launcher

- [ ] README describes ports, URLs, env vars, auth, simulation, backup
- [ ] `docs/OPERATIONS.md` contains the ops runbook content
- [ ] `.env.example` complete, no real values
- [ ] No CI runner checkout path anywhere
      (`grep -rn "home/runner/work/tech_portal" --include=*.md` is empty)
- [ ] Launcher opens `/` and `/ops/`, install path is one variable
