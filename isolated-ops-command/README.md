# Isolated Operations Command (Prototype)

This module is **self-contained** under `isolated-ops-command/` so it does not modify legacy/root behavior.

- Start: `node isolated-ops-command/src/index.js`
- Auth: `Authorization: Token <OPS_COMMAND_TOKEN>`
- Role header: `x-ops-role` (`operator`, `reviewer`, `admin`)
- Idempotency header (mutations): `idempotency-key`

See `/isolated-ops-command/LEARNING_AND_GOVERNANCE.md` for governance, learning controls, safety policy enforcement, and integration notes.
