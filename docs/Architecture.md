# Architecture — EH Graced Roads operations software

## Today: two processes

```
Browser ──► Main portal (Express 5, :3000)
             ├─ static: index.html, no_tow_authorization.html, public/*.html
             ├─ GET  /healthz /readyz /api/status /api/routes
             ├─ GET  /api/breakdowns/scanner   (simulated feed)
             ├─ GET  /api/dvir
             └─ POST /api/dvir /api/stream/override /api/submit-job
                     /api/onboarding /api/owner-draws /api/dispatch/quotes
                     └─ requireMutatingAccess ─► validation.js ─► persistence.js
                                                                  ├─ DATA_DIR/<collection>/<id>.json (atomic)
                                                                  └─ DATA_DIR/audit/<collection>.ndjson (append)

Browser ──► Isolated Operations Command (node:http, :4300)
             ├─ static: public/index.html app.js styles.css
             ├─ GET  /health/live /health/ready
             ├─ GET  /api/config /api/state /api/audit /api/events (SSE)
             └─ POST /api/incidents ─► validateIncident ─► evaluatePolicy (NO TOW / NO WINCH)
                                        └─► grace-ai.js ─► applyPolicyToAiOutput ─► queue (awaiting_human_approval)
                     /api/dispatch/:id/approve, /api/work-orders/:id/transition
                     /api/automation/pause, /api/technician/copilot
                     /api/teams/notify, /api/teams/events
                     /api/media/sources, /api/secure-browser/launch|clear
                     /api/admin/backup/export|restore, /api/simulate/tick
                     └─ storage.js ─► ISOLATED_OPS_DATA_DIR/ops-state.json (atomic)
                                      ISOLATED_OPS_DATA_DIR/audit.log.jsonl (append)
```

## Target: one process

See `docs/MERGE_PLAN.md` section 2. The ops server becomes an Express router
mounted at `/ops`, sharing request IDs, logging, JSON parsing, and the
operator token, while keeping its own stricter CSP, body limit, rate limit,
and always-on auth. `policy.js`, `storage.js`, `grace-ai.js`, and `teams.js`
move unchanged to `src/ops/`.

## Layers

| Layer | Main | Backup | After merge |
|---|---|---|---|
| Transport | Express, helmet, cors | raw http, manual headers | Express for both, two CSPs |
| Auth | `x-operator-token`, 3 modes | `x-ops-token` or Bearer, always | one token, all headers accepted, ops always required |
| Validation | `src/validation.js` normalizers | inline validators in server.js | both kept as-is |
| Business rules | none beyond validation | `policy.js`, `TRANSITIONS`, approval gate | `src/ops/policy.js` unchanged |
| AI | stream override state only | `grace-ai.js` adapter + policy filter | both kept |
| Persistence | per-record JSON + NDJSON audit | snapshot JSON + JSONL audit | both kept, ops under `DATA_DIR/isolated-ops/` |
| Realtime | none | SSE with TTL | SSE at `/ops/api/events` |
| Integrations | none live | Teams webhook (optional), Grace endpoint (optional), media allowlists | unchanged, simulation by default |

## Data flow for an incident (backup, unchanged by merge)

1. Operator submits description and service type. UI pre-checks for towing
   words and blocks locally.
2. API validates, checks idempotency key, checks queue capacity.
3. `evaluatePolicy` scans serviceType, requestedService, description. Match
   returns 422, records a policy rejection, audits, notifies Teams
   (simulated by default).
4. Grace adapter classifies (simulation unless endpoint configured).
   `applyPolicyToAiOutput` re-checks for towing, sanitizes the recommended
   service to the supported list, forces human approval unless explicitly
   false, filters allowed actions.
5. Queue item created as `awaiting_human_approval`. Auto-dispatch only if the
   flag is on, automation not paused, service is low-risk, and AI said no
   approval needed.
6. Operator approves, assigns technician, marks in progress, completes with
   notes, closes with a customer-safe summary. Each step audited, idempotent.
7. Every state change persists atomically and is pushed to all SSE clients.

## Environments

- Local dev: `.env` from `.env.example`, simulation on, demo write mode on
  for the portal, default ops token accepted only because simulation is on.
- Production-like: `OPERATOR_TOKEN` set, `ALLOW_DEMO_WRITE_MODE=false`,
  `ISOLATED_OPS_SIMULATION_MODE=false`, `ALLOWED_ORIGINS` and
  `ISOLATED_OPS_ALLOWED_ORIGINS` set, data directory on persistent storage
  with restricted permissions.

## Known production blockers

Listed in `README.md`. Unchanged by the merge: managed database, real
identity with roles and MFA, live integrations, tamper-evident audit,
regulated financial controls, monitoring.
