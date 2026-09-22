# Emergency Protocol — what the software does and does not do

## First rule

**This software is not emergency dispatch and is not a 911 substitute.**
If a caller reports injury, fire, hazardous material release, a vehicle in
a live traffic lane, or any threat to life, the operator tells them to call
911 first. The software records what happened afterward.

Nothing in this repository may contain copy or code suggesting otherwise.
The README's critical safety statement stays at the top of the README.

## What the software does during an incident

1. **Records intake.** Operator enters description, service type, customer,
   origin. Idempotency keys prevent duplicate records on retries.
2. **Applies policy.** Towing and winching are rejected and referred. See
   `docs/NoTowPolicy.md`.
3. **Produces an advisory triage.** Grace (simulation by default) suggests a
   supported service and a priority. Brake, hazmat, and fire keywords raise
   priority to high in simulation. The suggestion is filtered and requires
   human approval.
4. **Waits for a human.** The queue item sits at awaiting_human_approval
   until an operator with the token approves it and names themselves.
5. **Tracks the work order.** Technician assigned, in progress, completed
   with notes, closed with a customer-safe summary. Every step is audited
   and visible live on the monitor wall.
6. **Notifies the team.** Teams summaries are posted if a customer-owned
   webhook is configured; otherwise the notification is simulated and
   labeled as such.

## Emergency controls available to operators

| Control | How | Effect |
|---|---|---|
| Pause automation | Pause form on the wall, or `POST /api/automation/pause` with `{ paused: true, reason }` | Stops auto-dispatch immediately. Wall shows Paused with the reason. Readiness reflects it. Audited. |
| Resume automation | Same route with `paused: false` | Audited as `automation.resumed` |
| Human override on the Grace line | Business dashboard, Pick Up / Override Line | Records `human_operator_override`, mutes the Grace badge, speaks confirmation |
| Return to Grace | Business dashboard, Return to Grace AI | Records `grace_ai_resumed` |
| Clear secure browser sessions | Clear button or `POST /api/secure-browser/clear` | Ends all embedded sessions |
| Export backup | `GET /api/admin/backup/export` or `npm run backup:export -- --out <abs path>` | Snapshot of state and full audit |

## Degraded-mode behavior

- Grace endpoint unreachable: fallback decision, provider `fallback`, flag
  `grace_ai_unavailable`, audit `grace_ai.error`. Human approval required.
- Teams webhook failing: retries with backoff, then `error` on the wall and
  in readiness. Incident processing continues.
- Persistence unwritable: startup refuses to begin. At runtime, portal
  writes return 503 `persistence_unavailable`.
- Queue at capacity (`ISOLATED_OPS_MAX_QUEUE_ITEMS`, default 250 active):
  intake returns 503 with instructions to pause intake and close work
  orders. Audited.
- SSE session expires: client receives `session_expiring` and reconnects
  automatically.

## Recovery procedure

1. Pause automation.
2. Stop the server with SIGTERM. Confirm `system.stopping` in the audit log.
3. Back up the data directory (both the portal collections and the ops
   state and audit files together).
4. Restore a snapshot if needed with the CLI, using absolute paths.
5. Start the server. Verify `/healthz`, `/readyz`, and the ops state
   endpoint. Confirm the last audit events and queue continuity.
6. Resume automation only after the queue has been reviewed by a human.

## Incident logging for the company (not the software)

For any operational incident involving the software, record: UTC timestamp,
request ID from the `x-request-id` header, endpoint and status code,
observed impact, mitigation, owner. Never log tokens, credentials, or full
financial identifiers. Keep the record with the audit export for that day.

## Review

The owner reviews this protocol whenever the state machine, the policy
module, the pause control, or the readiness endpoint changes. The PR that
changes them updates this file.
