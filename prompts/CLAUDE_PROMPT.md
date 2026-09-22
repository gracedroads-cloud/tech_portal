# Prompt for Claude in VS Code

Paste this into Claude when starting a merge work session.

```text
Read CLAUDE.md, docs/MERGE_PLAN.md, docs/SECURITY_BOUNDARIES.md,
docs/GRACE_AI_INVENTORY.md, and docs/ACCEPTANCE_CRITERIA.md.

We are merging the backup (isolated-ops-command/, port 4300) into the main
portal (app.js, src/, public/, port 3000) so there is one server, one
launcher, one auth model, and one test run.

Work the steps in docs/MERGE_PLAN.md section 4 in order. Do one step per
commit on the current copilot/** branch. After each step run:

  npm ci && npm run check && npm test && npm audit --audit-level=high
  cd isolated-ops-command && node --test   (while that directory exists)

Rules:
- Every invariant in docs/SECURITY_BOUNDARIES.md must still hold. If a step
  would weaken one, stop and explain instead of proceeding.
- Every Grace AI touchpoint in docs/GRACE_AI_INVENTORY.md sections A and B
  is preserved. Report section D (the breakdown scanner regression) and ask
  me which option to take before implementing it.
- No secrets, no raw filesystem paths in responses, constant-time token
  compare, atomic writes, append-only audit.
- Do not touch dvir_reports.json or radio_dispatch_logs.json.
- Docs use repository-relative paths.

When you finish a step, tell me: which step, which invariants you verified
and how, real test output, and what the next step is.
```

## Shorter follow-up prompts

Continue: `Continue with the next step in docs/MERGE_PLAN.md section 4. Same rules.`

Review only: `Review the current diff against docs/SECURITY_BOUNDARIES.md and docs/GRACE_AI_INVENTORY.md. List any invariant or Grace row that is weakened or missing. Do not change code.`

Docs only: `Do step 10 of docs/MERGE_PLAN.md: merge the runbooks into README.md and docs/OPERATIONS.md, fix the launcher, update .env.example. No code changes.`
