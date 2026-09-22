# System Rules — never bend these

Short form of `docs/SECURITY_BOUNDARIES.md`. If a rule here and an
invariant there ever disagree, the invariant wins and this file gets fixed.

## Business rules enforced in code

1. **No towing. No winching.** Enforced at intake and on AI output by
   `isolated-ops-command/src/policy.js`. Rejections are recorded, audited,
   and referred to an approved external provider. Full detail:
   `docs/NoTowPolicy.md`.
2. **Humans dispatch.** Every queue item starts as awaiting human approval.
   Auto-dispatch is off by default, limited to battery/electrical help and
   tire service, and never applies to towing or winching.
3. **Work orders follow the state machine.** awaiting_human_approval →
   approved_dispatch → technician_assigned → in_progress → completed →
   closed. Completion needs notes. Closing needs a customer-safe summary.
4. **Emergency pause exists and works.** Any operator with the token can
   pause automation. Paused state is visible on the wall and in readiness.
5. **Grace is advisory.** AI output is filtered, cannot transition a work
   order, cannot restore a backup, cannot call outward on its own.

## Honesty rules

6. Simulated data is labeled simulated in every response and every panel.
7. The product never claims to be certified emergency dispatch, a 911
   substitute, legal waiver execution, regulated payments, or regulated
   finance.
8. Readiness reports degraded dependencies as degraded.
9. Demo authentication is labeled demo. Production auth does not exist yet
   and no copy says it does.

## Security rules

10. Ops routes require a token on every request. Demo write mode never
    unlocks them.
11. Token comparison is constant-time.
12. No secrets, tokens, webhook URLs, tenant IDs, or AI keys in the repo.
13. No filesystem paths in API responses.
14. Atomic writes. Append-only audit logs. Restore payloads are
    shape-checked and prototype-sanitized.
15. Media and browser targets are http/https only and allowlisted.
16. Ops UI has no inline scripts. Portal CSP and ops CSP stay separate.

## Repository rules

17. Work on `copilot/**` branches. Merge to `main` by PR with CI green.
18. Every PR fills in the template: invariants touched, Grace rows touched,
    real test output. Test count never goes down (baseline 28).
19. `dvir_reports.json` and `radio_dispatch_logs.json` at the root are not
    touched.
20. Docs use repository-relative paths and describe the system as it is,
    not as planned, unless the section is labeled as a plan.

## Change control

Any change to rules 1 through 5 requires the owner's explicit written
approval in the PR, a test proving the new behavior, and updates to
`docs/NoTowPolicy.md` or `docs/EmergencyProtocol.md` in the same PR.
