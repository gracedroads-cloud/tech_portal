# Grace AI Inventory — everything that must survive the merge

Grace (also written GRACE) is the operator-facing assistant persona used on
both sides. The main portal treats Grace as a voice and call-handling
presence. The backup treats Grace as an advisory triage adapter behind a
policy filter. Both sets of behavior stay in the merged system. This file is
the checklist; tick every row in the merge PR.

## A. Main portal Grace touchpoints

| # | Where | What it does today | Merge requirement |
|---|---|---|---|
| M-1 | `src/validation.js` `normalizeStreamOverride` | Accepts only `pickup` or `resume_grace` | Unchanged |
| M-2 | `src/server.js` `POST /api/stream/override` | Stores an `stream_overrides` record; responds with `state: 'human_operator_override'` for pickup or `'grace_ai_resumed'` for resume, labeled `source: 'simulated_demo_data'` | Unchanged route, shape, and label |
| M-3 | `public/business_dashboard.html` Grace Stream Monitor module | Pick up / override line, return to Grace, convert to work order buttons; live transcript panel; status badge `GRACE AI HANDLING` vs `HUMAN OPERATOR OVERRIDE ACTIVE` | Page keeps working at its current URL |
| M-4 | `public/business_dashboard.html` `speakGrace()` | Browser `speechSynthesis` reads confirmations aloud after backend confirms | Keep. This is client-side only and needs `'unsafe-inline'` in the portal CSP, which is why portal and ops CSPs stay separate |
| M-5 | `public/business_dashboard.html` Dispatch Closest | Reads `/api/breakdowns/scanner`, shows a preview, speaks it; explicitly does not mutate anything | Keep the "preview only" behavior and the log text saying no dispatch was sent |
| M-6 | `public/master_hub.html` | HTML fragment of the Grace Stream Monitor and Dispatch Console with no script | Keep as a fragment or wire it identically to M-3; do not add inline handlers that bypass backend confirmation |
| M-7 | `public/grace_stream_monitor.html` | Grace telemetry stream display with an audio ping test; static demo lines | Keep; label content as demo |
| M-8 | `public/grace_dispatch_console.html` | Grace Automated Dispatch Desk: `POST /api/dispatch/quotes` intake with demo price references | Keep; prices remain labeled demo references |
| M-9 | `public/breakdown_scanner.html` | Renders scanner alerts and redirects to the Grace dispatch console with carrier, location, serviceKey | Keep; see regression note in section D |
| M-10 | `radio_dispatch_logs.json` (root) | Legacy export of "GRACE Voice On-Site Assist" CB radio dispatches | Leave untouched; not an app input |

## B. Backup Grace touchpoints

| # | Where | What it does today | Merge requirement |
|---|---|---|---|
| B-1 | `isolated-ops-command/src/grace-ai.js` `createGraceAiAdapter` | Simulation provider when `GRACE_AI_ENDPOINT` or `GRACE_AI_API_KEY` is missing; otherwise POSTs `{ mode, promptGuard, toolsAllowed, incident }` to the endpoint with bearer auth and a timeout | Move to `src/ops/grace-ai.js` unchanged |
| B-2 | `simulationDecision` | Flags towing-like text, picks priority by brake/hazmat/fire keywords, always `requiresHumanApproval: true`, `provider: 'simulation'`, flags `simulated_classification` or `policy_rejection` | Unchanged |
| B-3 | `normalizeExternalDecision` | Clamps summary to 500 chars, priority to the four allowed values, flags to 10, `provider: 'external'` | Unchanged |
| B-4 | `policy.js` `applyPolicyToAiOutput` | Post-filters every decision: rejects towing language, sanitizes recommended service to the supported list, forces `requiresHumanApproval` unless explicitly false, filters `allowedActions` to `draft_dispatch` and `notify_teams` | Unchanged. This is the control that makes Grace advisory |
| B-5 | `server.js` `handleIncident` fallback | On adapter error, uses `provider: 'fallback'`, summary "Grace AI unavailable. Defaulting to mobile diagnostics triage.", flag `grace_ai_unavailable`, audits `grace_ai.error` | Unchanged |
| B-6 | `state.lastGraceAiDecision` | Persisted with state, exposed in `getPublicState()`, restored from snapshots | Unchanged, including the restore validation that requires an object |
| B-7 | `monitors.graceAiActivity` | `simulated` when provider is simulation, `online` when external, `stale` when no decisions | Unchanged |
| B-8 | `/api/config` | Exposes `graceAvatarProfile` (`GRACE_AVATAR_PROFILE`, default `interactive-business-assistant`) and `graceVoiceProfile` (`GRACE_VOICE_PROFILE`, default `en-GB-modern-neutral`) | Keep both variables and both fields at `/ops/api/config` |
| B-9 | `/health/ready` | `graceAiMode: 'external' or 'simulation'`, `dependencies.graceAi: 'configured' or 'simulation'` | Fold into merged `/readyz` under an `ops` block |
| B-10 | `/api/technician/copilot` | Structured technician assistance from authorized sources only; forced professional-review escalation for legal, accounting, tax, business | Move to `/ops/api/technician/copilot` unchanged |
| B-11 | `public/app.js` incident form | Client-side pre-check rejects towing text before calling the API, then shows the triage status with the human-approval reminder | Keep the pre-check and the message text |
| B-12 | Tests | "rejects Grace AI output that proposes towing", "auto-dispatches only low-risk approved services when explicitly enabled", copilot escalation test | All three must pass against the merged app |

## C. Environment variables Grace depends on

`GRACE_AI_ENDPOINT`, `GRACE_AI_API_KEY`, `GRACE_AVATAR_PROFILE`,
`GRACE_VOICE_PROFILE`, `ISOLATED_OPS_TIMEOUT_MS` (adapter timeout),
`ISOLATED_OPS_ENABLE_AUTO_DISPATCH`, `ISOLATED_OPS_TECH_KNOWLEDGE_SOURCES`.
All move into the root `.env.example` with empty or default values. Keys and
endpoints are never committed.

## D. Regression found while preparing this inventory

Pull request #2 (`copilot/vr-system-code-update`) added a vehicle-repair
breakdown alert flow to the old monolithic `app.js`: `POST
/api/breakdowns/ingest` with its own auth, `GET /api/breakdowns/live`, `GET
/api/breakdowns/schema`, and DVIR submissions with `safeToOperate: false`
publishing a breakdown alert. It also rewrote `public/breakdown_scanner.html`
to render `sourceType`, `alertType`, `technician`, `coordinates`, and
`timestamp`.

The current `src/server.js` does not have those three routes, and its scanner
response does not include `sourceType`, `alertType`, `timestamp`, or
`coordinates`. The scanner page still renders those fields, so today it shows
"Invalid Date" and defaults for every card. The merge branch kept the new
page but not the backend it was written against.

Decision needed from the owner, recorded in the PR:

- Option 1: restore the ingest, live, and schema routes in `src/server.js`
  under the existing `requireMutatingAccess` guard, with validation in
  `src/validation.js`, atomic persistence to a `breakdown_alerts` collection,
  and no `file` path in responses. Extend the scanner response to include the
  fields the page expects. Add the routes to `frontendRouteInventory`.
- Option 2: revert `public/breakdown_scanner.html` to the fields the current
  scanner returns and document that the vehicle-repair alert flow was
  dropped.

Do not leave it in the current half-state. Either way, the earlier CB radio
console and Grace text-to-speech commits from that branch should be checked
against `public/business_dashboard.html` to confirm nothing else was lost.
