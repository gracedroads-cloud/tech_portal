# Copilot Master Context — EH Graced Roads Solutions LLC

This file is the entry point for GitHub Copilot, Claude, and any human
joining the project. Everything under `docs/` is the single source of truth.
When code and docs disagree, fix one of them in the same PR and say which.

## Company

EH Graced Roads Solutions LLC is a mobile mechanic roadside service for
commercial fleets, based in Easton, Pennsylvania, serving the I-78 and US-22
corridor and surrounding Lehigh Valley. The company sends a technician and a
service van to the vehicle. **The company does not tow and does not winch.**
Towing and winching requests are referred to an approved external provider.

Support hotline shown in the product: 215-821-8046.

## Products in this repository

| Product | Location | Status |
|---|---|---|
| Main portal (cockpit) | `app.js`, `src/`, `public/` | Working, port 3000 |
| Isolated Operations Command (backup) | `isolated-ops-command/` | Working, port 4300 |
| Merged system | in progress | see `docs/MERGE_PLAN.md` |

A separate mobile app lives in `gracedroads-cloud/grace-roads-mobile`. It is
not part of this repository.

## Reading order

1. `CLAUDE.md` and `.github/copilot-instructions.md` — how to work here.
2. `docs/SystemRules.md` — rules that never bend.
3. `docs/NoTowPolicy.md` — the one business rule enforced in code.
4. `docs/EmergencyProtocol.md` — what the system does and does not do in an
   emergency.
5. `docs/Architecture.md` and `docs/Diagram.txt` — how the pieces fit.
6. `docs/MERGE_PLAN.md`, `docs/SECURITY_BOUNDARIES.md`,
   `docs/GRACE_AI_INVENTORY.md`, `docs/TEST_PLAN.md`,
   `docs/ACCEPTANCE_CRITERIA.md` — the active engineering work.
7. `docs/Branding.md`, `docs/Marketing.md`, `docs/Mockups.md` — presentation
   layer. Owner review required before external use.
8. `docs/PromptPack.md` — copy-paste prompts for Claude and Copilot.

## Roles

- **Owner / operator:** Elijah Wright. Final say on scope, policy, branding,
  and anything customer-facing.
- **GitHub Copilot:** code generation, PRs on `copilot/**` branches, fills in
  `.github/PULL_REQUEST_TEMPLATE.md` fully.
- **Claude:** reasoning, multi-file edits, reviews against the invariants,
  docs.
- **CI (GitHub Actions):** `npm ci`, `npm run check`, `npm test`,
  `npm audit --audit-level=high` on `main`, `copilot/**`, and PRs.

## Non-negotiables in one paragraph

No towing, no winching, ever, at intake or from AI output. A human approves
every dispatch unless the owner has explicitly enabled low-risk
auto-dispatch, which still excludes towing and winching. Simulated data is
labeled simulated. The system is not certified emergency dispatch, not legal
waiver execution, not regulated payments. No secrets in the repo. No
filesystem paths in API responses. Constant-time token comparison. Atomic
writes and append-only audit logs.

## How to ask for work

Open `docs/PromptPack.md`, pick the prompt that matches the task, paste it.
Every PR cites the invariants it touched and the tests that prove them.
