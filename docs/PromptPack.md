# Prompt Pack — copy-paste prompts for Claude and GitHub Copilot

All prompts assume the assistant reads `docs/CopilotMasterContext.md` first.
Longer versions for the merge live in `prompts/CLAUDE_PROMPT.md` and
`prompts/COPILOT_PROMPT.md`.

## Session start (Claude or Copilot)

```text
You are assisting with the EH Graced Roads Solutions LLC operations system.
Read docs/CopilotMasterContext.md, then the files it lists in reading
order. The docs folder is the single source of truth. Follow
docs/SystemRules.md, docs/NoTowPolicy.md, and docs/EmergencyProtocol.md
without exception. Help me build, test, and complete this project. Before
finishing any change, run npm ci, npm run check, npm test, and
npm audit --audit-level=high, and report the real output.
```

## Continue the merge

```text
Continue with the next unfinished step in docs/MERGE_PLAN.md section 4.
One step per commit. Every invariant in docs/SECURITY_BOUNDARIES.md must
still hold; cite the proving test. Every row in docs/GRACE_AI_INVENTORY.md
sections A and B stays intact. Report which step you did, test output,
and the next step.
```

## Review a diff without changing code

```text
Review the current diff against docs/SECURITY_BOUNDARIES.md,
docs/NoTowPolicy.md, and docs/GRACE_AI_INVENTORY.md. List every invariant
or Grace row that is weakened, missing a test, or unclear. Do not modify
files. Rank findings by severity.
```

## Add a test

```text
Add a node:test for <behavior> in <test file>. Follow the existing style in
that file. The test must fail before the fix and pass after. Do not lower
the total test count. Show the test output.
```

## Fix the breakdown scanner regression (owner picks option first)

```text
Implement option <1 or 2> from docs/GRACE_AI_INVENTORY.md section D. If
option 1: add the routes to src/server.js behind requireMutatingAccess,
validation in src/validation.js, atomic persistence to a breakdown_alerts
collection, no filesystem paths in responses, routes added to
frontendRouteInventory, and tests. If option 2: revert the scanner page
fields to what the current API returns and document the dropped flow.
Either way add a test that the scanner page renders a real timestamp or
no longer references one.
```

## Docs update

```text
Update README.md, docs/OPERATIONS.md, and .env.example to match the current
behavior of the code. Repository-relative paths only. Do not describe
planned behavior as current. Do not add claims that conflict with
docs/Marketing.md claims guardrails.
```

## Release check

```text
Walk docs/TEST_PLAN.md Gates 1 through 6. For each item, state pass, fail,
or not applicable with evidence. Do not mark anything pass without output
or a browser observation you actually made. Summarize blockers at the top.
```

## Mobile app (in the grace-roads-mobile repo, not here)

```text
Read CLAUDE.md, .github/copilot-instructions.md, and docs/ in this repo.
Continue building the Grace Roads Operations Expo React Native TypeScript
app as one role-based app: admin has full administrative access, manager
and dispatcher have limited operational access, driver has employee-only
access. Demo/local auth labeled non-production, AsyncStorage persistence,
service abstraction for a future backend, confirmation dialogs on
high-impact actions. Run typecheck and tests before finishing. The backend
it will eventually call is gracedroads-cloud/tech_portal; do not duplicate
its business rules, and never add towing or winching as a service.
```

## When the assistant stops early

```text
You stopped before the task was complete. Re-read the last instruction,
list what remains, and finish it. Run the validation commands and report
real output.
```
