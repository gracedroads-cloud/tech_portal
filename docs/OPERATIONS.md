# Operations & Security Notes

## Demo vs production boundaries

- Demo mode exists only for development continuity and must be explicit (`ALLOW_DEMO_WRITE_MODE=true` with no token).
- Production-like mode requires `OPERATOR_TOKEN` and a secure secret distribution path.
- This prototype does not provide certified dispatch, legal waiver execution, or regulated finance controls.

## Data directory policy

`DATA_DIR` stores operational prototypes:

- `dvir_reports/*.json`
- `stream_overrides/*.json`
- `waiver_submissions/*.json`
- `onboarding_requests/*.json`
- `owner_draw_requests/*.json`
- `dispatch_quotes/*.json`
- `audit/*.ndjson`

Rules:

- Never commit `DATA_DIR` contents.
- Keep permissions restricted to service account only.
- Do not place secrets or full banking/tax IDs in payload fields.

## Retention and backups

Recommended baseline for prototype environments:

- Retain operational JSON records for 30 days.
- Rotate/compress archive snapshots daily.
- Keep at least one off-host encrypted backup copy.
- Verify restore from backup weekly.

## Backup and recovery procedure (prototype)

1. Stop service (`SIGTERM` and confirm graceful shutdown).
2. Snapshot `DATA_DIR` to secure backup media.
3. Restore by replacing target `DATA_DIR` with the chosen snapshot.
4. Restart service and verify:
   - `GET /healthz` returns healthy
   - `GET /readyz` returns expected mode
   - A non-mutating endpoint (`/api/status`) responds normally

## Incident logging guidance

Log incidents with:

- UTC timestamp
- request ID (`x-request-id`)
- endpoint and status code
- summary of observed impact
- mitigation action and owner

Do not log raw credentials, tokens, or full financial identifiers.
