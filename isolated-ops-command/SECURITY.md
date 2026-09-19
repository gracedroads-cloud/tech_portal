# SECURITY — Isolated Operations Command

## Implemented controls

- Token auth required for mutating and admin endpoints.
- Rate limiting, JSON size limits, malformed-payload handling.
- Secure headers: CSP, frame policy, no-sniff, referrer policy, permissions policy.
- Restricted CORS from configured origin allowlist only.
- URL allowlisting for secure-browser launches and media sources.
- Redacted structured logs and append-only audit trail.
- Strict policy enforcement for **NO TOWING / NO WINCHING** at intake and AI-output validation layers.

## Privacy and data handling

- Isolated state and audit files only under `ISOLATED_OPS_DATA_DIR`.
- No bank account numbers, tax IDs, credentials, or verification codes are hard-coded here.
- Technician copilot accepts only authorized configured knowledge sources.
- Legal/accounting/tax/business responses are informational drafting assistance only and force professional-review escalation.

## Production blockers to resolve outside this repository

- Managed secret storage and rotation for AI/Teams credentials.
- Enterprise browser/device hardening for secure-browser sessions.
- Licensed connectors for OEM/Mitchell/third-party proprietary data (not bundled here).
- Final external threat model and penetration testing in target environment.
