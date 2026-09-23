# tech_portal (Backup Operations Command Prototype)

This repository contains a dispatch-oriented backup operations command prototype for EH Graced Roads.

## Critical safety statement

This system is **not** a substitute for certified emergency dispatch, regulated payment processing, or regulated financial controls. It uses simulated/offline integrations unless explicitly configured and validated.

## Requirements

- Node.js 20+ (`.nvmrc` included)
- npm 10+

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Default URL: `http://localhost:3000`

## Environment variables

See `.env.example`.

- `PORT` - HTTP port (default `3000`)
- `NODE_ENV` - environment label (`development`/`production`)
- `REQUEST_SIZE_LIMIT` - request body limit (default `100kb`)
- `DATA_DIR` - directory for prototype persistence (default `./data`)
- `ALLOWED_ORIGINS` - comma-separated allowed CORS origins
- `OPERATOR_TOKEN` - token required for mutating API routes when set
- `ALLOW_DEMO_WRITE_MODE` - dev-only fallback for mutating routes without token

## Auth and mode behavior

Mutating routes (POST endpoints) behave as follows:

1. `OPERATOR_TOKEN` set: caller must send `x-operator-token`
2. Else if `ALLOW_DEMO_WRITE_MODE=true`: writes allowed in explicit demo mode
3. Else: writes disabled (HTTP 503)

Do **not** run production with demo mode enabled.

## API endpoints

- `GET /healthz` - liveness
- `GET /readyz` - readiness and write-mode status
- `GET /api/status` - system/integration status (`simulated_demo_data` when live integrations are unavailable)
- `GET /api/breakdowns/scanner?radius=150` - scanner feed shape with explicit offline/simulated labels
- `GET /api/dvir` - DVIR endpoint usage metadata
- `POST /api/dvir` - validated DVIR submission
- `POST /api/stream/override` - validated stream override action
- `POST /api/submit-job` - towing waiver submission
- `POST /api/onboarding` - onboarding request intake
- `POST /api/owner-draws` - owner draw request intake
- `POST /api/dispatch/quotes` - dispatch quote intake
- `GET /api/routes` - frontend route inventory for parity checks

## Data persistence policy

Prototype records are written under `DATA_DIR` as JSON files with generated IDs and timestamps, plus append-only audit indexes in `DATA_DIR/audit/*.ndjson`.

- No raw filesystem paths are returned in API responses.
- Inputs are validated server-side before persistence.
- Writes are atomic (temp file + rename) per record.

See `docs/OPERATIONS.md` for retention/backup/recovery details.

## Test and checks

```bash
npm run check
npm test
```

CI (`.github/workflows/ci.yml`) runs install, syntax checks, tests, and dependency audit.

## Production blockers (priority order)

1. Replace local file persistence with managed transactional storage and encrypted backups.
2. Add real identity/authN/authZ (users, roles, MFA) beyond shared operator token.
3. Integrate validated live dispatch/telematics/mapping providers and remove simulation reliance.
4. Add immutable audit trails with tamper-evident storage and retention enforcement.
5. Add regulated financial controls and external payment processor controls before any real fund movement.
6. Add runbook-driven monitoring/alerting and incident response automation.
