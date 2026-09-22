# RUNBOOK — Isolated Operations Command

## Incident lifecycle

1. Intake: `POST /api/incidents` (idempotency key supported)
2. Approval: `POST /api/dispatch/:id/approve`
3. Work-order transitions:
   - `technician_assigned`
   - `in_progress`
   - `completed` (requires completion notes)
   - `closed` (requires customer-safe summary)
4. Audit review: `GET /api/audit`

All transitions are persisted with status history and audit events.

## Degraded-mode behavior

- If Grace AI is unavailable, system falls back to safe simulated triage and records audit error.
- Teams unavailable/error states are visible in monitor state and readiness output.
- Media and secure-browser monitor states remain explicit (`live`, `simulated`, `offline`, `stale`, `error`).

## Backup / restore and disaster recovery

### Export backup

```bash
cd /home/runner/work/tech_portal/tech_portal/isolated-ops-command
npm run backup:export -- --out /absolute/path/ops-backup.json
```

### Restore backup

```bash
cd /home/runner/work/tech_portal/tech_portal/isolated-ops-command
npm run backup:restore -- --from /absolute/path/ops-backup.json
```

### Restart recovery procedure

1. Pause automation.
2. Stop server.
3. Back up `ISOLATED_OPS_DATA_DIR`.
4. Restore snapshot if needed.
5. Start server and verify `/health/live`, `/health/ready`, `/api/state`.
6. Confirm last audit events and queue continuity.
