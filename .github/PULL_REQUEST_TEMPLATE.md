<!-- Every PR fills this in. Reviewers reject PRs with empty sections. -->

## What changed

Which side: main / backup / merged. Which `docs/MERGE_PLAN.md` steps this
PR covers.

## Gate 1: automated (paste real output tails)

```
npm ci            ->
npm run check     ->
npm test          ->  tests N, pass N, fail 0
npm audit --audit-level=high ->
```

Test count before this PR: 32 (30 pass, 2 skipped). Test count after:
Skipped tests still present (list them or write "none"):

## Gate 2: invariants touched

List each `docs/SECURITY_BOUNDARIES.md` invariant this PR affects and the
test or line that proves it still holds. Write "none affected" only if the
diff touches no auth, persistence, header, policy, or route code.

- I-

## Gate 3: Grace AI rows touched

List each `docs/GRACE_AI_INVENTORY.md` row this PR touches and how it is
preserved. Write "none touched" if applicable.

- M- / B-

## Gates 4 and 5: manual checks (if this PR changes startup, shutdown,
## persistence, launcher, or the scanner)

- [ ] Start, health, ready verified
- [ ] Non-simulation with default token refuses to start
- [ ] SIGTERM then restart keeps state
- [ ] Export, delete, restore, restart keeps state and audit
- [ ] Launcher opens one process and both UIs
- [ ] Scanner regression decision recorded (inventory section D)

## Docs

- [ ] README, `docs/OPERATIONS.md`, `.env.example` updated where behavior changed
- [ ] No secrets, no filesystem paths in responses, no CI runner paths

## Owner decisions needed

Anything the assistant could not decide alone.
