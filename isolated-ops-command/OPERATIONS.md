# OPERATIONS — Isolated Operations Command

## Deployment

- Entry point: `/home/runner/work/tech_portal/tech_portal/isolated-ops-command/server.js`
- Port: `ISOLATED_OPS_PORT` (default `4300`)
- Data path: `ISOLATED_OPS_DATA_DIR` (isolated from legacy app data)
- Health checks:
  - `GET /health/live`
  - `GET /health/ready`

## Startup validation

- Startup validates writable persistence.
- Non-simulation deployments must set a non-default `ISOLATED_OPS_TOKEN`.
- Readiness reports dependency modes and degraded state.

## Process manager / container guidance

- PM2/systemd: run `node server.js` with restart policy and env file.
- Kubernetes/container:
  - liveness probe: `/health/live`
  - readiness probe: `/health/ready`
  - mount persistent volume for `ISOLATED_OPS_DATA_DIR`

## Operational controls

- Mutating/admin APIs require operator token (`x-ops-token` or bearer token).
- Emergency pause: `POST /api/automation/pause`
- Work-order transitions: `POST /api/work-orders/:id/transition`
- Authenticated backup export/restore APIs and CLI available.
