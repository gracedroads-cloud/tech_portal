# Prompt for GitHub Copilot Chat or Copilot coding agent

Copilot reads `.github/copilot-instructions.md` automatically. Use this as
the task prompt or the issue body when assigning the coding agent.

```text
Merge the Isolated Operations Command (isolated-ops-command/, raw node:http
on port 4300) into the main Express portal (app.js, src/, public/, port
3000) so the repository runs as one server with one launcher and one auth
model.

Read first: .github/copilot-instructions.md, docs/MERGE_PLAN.md,
docs/SECURITY_BOUNDARIES.md, docs/GRACE_AI_INVENTORY.md,
docs/ACCEPTANCE_CRITERIA.md.

Implement docs/MERGE_PLAN.md section 4, steps 1 through N (state which
steps this PR covers). Keep each step a separate commit.

Requirements:
1. All invariants I-1 to I-29 in docs/SECURITY_BOUNDARIES.md hold. Cite the
   proving test or line for each in the PR description.
2. All Grace AI rows in docs/GRACE_AI_INVENTORY.md sections A and B are
   preserved. Check each one off in the PR description.
3. Ops routes live under /ops/api/*, ops UI under /ops/, ops state under
   DATA_DIR/isolated-ops/. Readiness is folded into /readyz without dataDir.
4. Single OPERATOR_TOKEN with constant-time comparison. Demo write mode never
   unlocks ops routes. Add a test for that.
5. policy.js, storage.js, grace-ai.js, teams.js move to src/ops/ unchanged.
6. Both test suites run from `npm test` at the root and pass. Extend the
   route parity test to scan public/ops/app.js.
7. No secrets, no filesystem paths in responses, atomic writes, append-only
   audit, repository-relative paths in docs.
8. Do not modify dvir_reports.json or radio_dispatch_logs.json.

For docs/GRACE_AI_INVENTORY.md section D (breakdown scanner regression),
do not pick an option. Describe it in the PR and leave a checkbox for the
owner.

Validation to run and paste into the PR:
  npm ci
  npm run check
  npm test
  npm audit --audit-level=high
  cd isolated-ops-command && node --test
```

## Suggested PR split

- PR A: steps 1 and 2 (move pure modules, build the router, keep old server
  running in parallel).
- PR B: steps 3 to 7 (auth, headers, static, mount, readiness).
- PR C: steps 8 and 9 (tests and CLI).
- PR D: steps 10 and 11 (docs, launcher, remove old tree).
