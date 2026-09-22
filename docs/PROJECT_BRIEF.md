# Project Brief — tech_portal

## Purpose

Internal operations tooling for EH Graced Roads Solutions LLC, a mobile
mechanic roadside service based in Easton, PA. The company does not tow or
winch. The software records, reviews, triages, and approves roadside work;
humans decide.

## The two systems

**Main portal (cockpit).** Express app on port 3000. Legacy dashboard pages:
master suite, business dashboard with the Grace stream monitor, breakdown
scanner, Grace dispatch console, client onboarding, owner's draw vault, DVIR
intake, and the towing exclusion waiver page. Validated JSON persistence with
append-only audit indexes. Shared operator token or explicit demo mode.

**Backup (Isolated Operations Command).** Zero-dependency Node server on port
4300. Reactive monitor wall over SSE, incident intake with NO TOWING and NO
WINCHING policy, Grace AI advisory adapter with policy post-filter, human
approval gate, work-order lifecycle, Teams adapter, media and secure-browser
allowlists, technician copilot, backup export and restore, emergency
automation pause.

## Current objective

Merge the backup into the main so there is one process, one launcher, one
auth model, one test run, and one set of runbooks, while keeping every safety
control from both sides and every Grace behavior from both sides.

Plan: `docs/MERGE_PLAN.md`. Guardrails: `docs/SECURITY_BOUNDARIES.md`. Grace
checklist: `docs/GRACE_AI_INVENTORY.md`. Done definition:
`docs/ACCEPTANCE_CRITERIA.md`.

## Decisions already made

- One server, Express, mounting the ops routes as a router under `/ops`.
- `policy.js`, `storage.js`, `grace-ai.js`, `teams.js` move without edits.
- Portal and ops keep separate CSPs because portal pages use inline scripts
  and the ops UI must not.
- `OPERATOR_TOKEN` is the canonical token. Old variable names are honored
  for one release with a startup warning.
- Simulation mode stays on by default for local development. Production
  turns it off and therefore must set a real token.
- Legacy root JSON exports stay untouched.

## Who works on it

The owner (Elijah) directs the work from VS Code on Windows. GitHub Copilot
and Claude implement on `copilot/**` branches. CI on GitHub Actions gates
PRs to `main`.

## Production blockers, unchanged by the merge

Managed transactional storage with encrypted backups, real identity with
roles and MFA, validated live integrations, tamper-evident audit storage,
regulated financial controls, monitoring and incident response automation.
