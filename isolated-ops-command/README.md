# EH Graced Roads Solutions LLC — Isolated Operations Command

This directory contains a **self-contained operations-monitoring subsystem** intended to be deployed separately from the main application. It does **not** modify the existing `app.js`, legacy operational pages, launchers, or root data files.

## What it does

- Reactive monitor wall over **Server-Sent Events** so every monitor visibly updates when state changes.
- Strict default policy enforcement: **NO TOWING and NO WINCHING** across UI, API, and Grace AI output handling.
- Grace AI adapter with a **simulation provider by default** and an optional external HTTP endpoint when customer-owned credentials are supplied.
- Microsoft Teams adapter with simulation mode, timeout, retry/backoff, redacted logging, and optional inbound-event normalization.
- Secure-browser session launcher with strict allowlisting, protocol validation, sandboxed iframe mode where possible, and honest protected-tab fallback guidance.
- Isolated local persistence with atomic state writes plus append-only audit events under its own data directory.
- Demo event generation so health, incidents, queue, Teams, policy rejections, media, and audit monitors can react during testing.

## Operational guardrails

- This subsystem is labeled **EH Graced Roads Solutions LLC — Isolated Operations Command**.
- It does **not** replace emergency services, legal review, financial approval, or certified dispatch.
- Unsupported towing/winching requests are rejected and routed to an external approved provider workflow.
- Human approval is required before dispatch by default. Optional auto-dispatch is limited to pre-approved low-risk classes and still never applies to towing or winching.
- Simulation mode is explicitly marked. Simulated media or AI output must never be presented as live production telemetry.

## Directory layout

```text
isolated-ops-command/
  package.json
  server.js
  .env.example
  README.md
  public/
    index.html
    app.js
    styles.css
  src/
    grace-ai.js
    policy.js
    server.js
    storage.js
    teams.js
  test/
    isolated-ops.test.js
```

## Environment variables

Copy `.env.example` and set the values you control:

- `ISOLATED_OPS_PORT` — default `4300`
- `ISOLATED_OPS_DATA_DIR` — isolated storage path for state and audit log
- `ISOLATED_OPS_TOKEN` — token required for mutating APIs (`x-ops-token` or bearer auth)
- `ISOLATED_OPS_SIMULATION_MODE` — `true` by default for local demo mode
- `ISOLATED_OPS_ENABLE_AUTO_DISPATCH` — optional low-risk auto-dispatch flag, default `false`
- `ISOLATED_OPS_ALLOWED_ORIGINS` — comma-separated CORS allowlist
- `ISOLATED_OPS_MEDIA_ALLOWLIST` — comma-separated `origin` allowlist for video/TV sources
- `ISOLATED_OPS_SECURE_BROWSER_ALLOWLIST` — comma-separated `origin` allowlist for secure-browser sessions
- `ISOLATED_OPS_CSP_FRAME_SRC` / `ISOLATED_OPS_CSP_MEDIA_SRC` — CSP source allowlists
- `GRACE_AI_ENDPOINT` / `GRACE_AI_API_KEY` — optional customer-owned AI endpoint and credential
- `TEAMS_WEBHOOK_URL` / `TEAMS_INBOUND_TOKEN` — optional customer-owned Teams workflow endpoint and inbound auth token

Do **not** commit real webhook URLs, tenant IDs, client secrets, access tokens, or AI keys.

## Run locally

From the repository root:

```bash
cd /home/runner/work/tech_portal/tech_portal/isolated-ops-command
node server.js
```

Open:

```text
http://localhost:4300/
```

Use the configured token in the UI before submitting mutating actions.

## Test locally

```bash
cd /home/runner/work/tech_portal/tech_portal/isolated-ops-command
node --test
```

## API summary

- `GET /health/live`
- `GET /health/ready`
- `GET /api/config`
- `GET /api/state`
- `GET /api/audit`
- `GET /api/events` — SSE monitor stream
- `POST /api/incidents` — authenticated intake
- `POST /api/dispatch/:id/approve` — authenticated human approval gate
- `POST /api/automation/pause` — authenticated emergency automation pause
- `POST /api/teams/notify` — authenticated outbound Teams message
- `POST /api/teams/events` — inbound Teams event normalization when configured
- `POST /api/media/sources` — authenticated media registry update
- `POST /api/secure-browser/launch` / `POST /api/secure-browser/clear`
- `POST /api/simulate/tick` — authenticated demo event generator when simulation mode is enabled

## Microsoft Teams setup (high level)

1. Create a customer-owned Teams workflow/webhook or Graph-backed relay endpoint.
2. Store the resulting endpoint URL in `TEAMS_WEBHOOK_URL`.
3. For inbound events, expose a relay that authenticates Microsoft-originated traffic and forwards normalized payloads to `/api/teams/events` using a bearer token whose value matches `TEAMS_INBOUND_TOKEN`.
4. Confirm timeouts, retries, and redacted logging satisfy your tenant’s controls.

Production Teams behavior requires **customer-owned credentials, permissions, licenses, and endpoints**.

## Grace AI setup (high level)

1. Host or provision an approved external AI endpoint you control.
2. Require the endpoint to return structured JSON only.
3. Set `GRACE_AI_ENDPOINT` and `GRACE_AI_API_KEY`.
4. The subsystem will still validate and post-filter the model output so towing/winching cannot be dispatched internally.

Production AI behavior requires **customer-owned credentials, policies, and endpoint operations**.

## Media and live TV requirements

- Only register streams or embeds that the operator is authorized to use.
- Supported source types: `HLS`, `DASH`, `WEBRTC`, `EMBED`.
- Configure `ISOLATED_OPS_MEDIA_ALLOWLIST`, `ISOLATED_OPS_CSP_MEDIA_SRC`, and `ISOLATED_OPS_CSP_FRAME_SRC` to reflect authorized origins.
- This subsystem does **not** scrape, rebroadcast, or bypass DRM/paywalls.
- Safe demo placeholders are included for simulation mode only.

Production media/TV behavior requires **customer-owned stream URLs, licenses, permissions, and browser-compatible embedding rights**.

## Secure browser production notes

This launcher is an **isolated panel helper**, not a hardened enterprise browser.

For production, pair it with:

- managed browser policies
- kiosk / device management
- endpoint protection
- session timeout policy enforcement
- trusted certificate / SSO controls
- destination-specific review of `X-Frame-Options` / CSP embedding restrictions

If a site blocks embedding, operators should use the protected-tab fallback and the UI should report that state honestly.

## Backup, restore, and persistence

- State snapshot: `ops-state.json`
- Append-only audit log: `audit.log.jsonl`
- Both live under `ISOLATED_OPS_DATA_DIR`
- State writes use atomic temp-file rename

Suggested backup workflow:

1. Pause automation.
2. Stop the isolated server.
3. Copy the isolated data directory.
4. Restore both files together to preserve queue + audit continuity.

For production scale, replace local files with a managed database or append-only event store while keeping the same policy and approval controls.

## Remaining blockers for production

- Real Teams, AI, video, and TV integrations are **not live** unless customer-owned credentials and authorized endpoints are configured.
- External webhook and AI schema governance must be reviewed by the customer’s security team.
- Secure browser hardening still depends on managed browser and device controls outside this repository.
