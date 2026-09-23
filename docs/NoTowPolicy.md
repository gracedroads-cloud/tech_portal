# NO TOWING / NO WINCHING Policy

## Business statement

EH Graced Roads Solutions LLC is a mobile mechanic service. Technicians
repair vehicles where they sit. The company does not tow, winch, recover,
or pull out vehicles. When a customer needs those services, the company
refers them to an approved external provider and records the referral.

The customer-facing statement already lives on `no_tow_authorization.html`
and is recorded through `POST /api/submit-job` as a waiver submission. That
page records acknowledgement; it does not execute a legal contract.

## Where the policy is enforced in code

Module: `isolated-ops-command/src/policy.js` (moves to `src/ops/policy.js`
in the merge, unchanged).

| Export | Purpose |
|---|---|
| `POLICY_LABEL` | `NO TOWING and NO WINCHING`, echoed in every rejection |
| `POLICY_PATTERNS` | `/\btow(?:ing\|ed)?\b/i`, `/\bwinch(?:ing\|ed)?\b/i`, `/\brecovery\b/i`, `/\bpull(?:[-\s]?out)?\b/i` |
| `SUPPORTED_SERVICES` | mobile_diagnostics, roadside_mechanical_repair, tire_service, air_brake_triage, battery_electrical_help |
| `LOW_RISK_AUTO_DISPATCH_SERVICES` | battery_electrical_help, tire_service |
| `evaluatePolicy(candidate)` | Scans serviceType, requestedService, description, summary. Returns a rejection object or null |
| `applyPolicyToAiOutput(output)` | Re-runs the scan on AI output, nulls the recommendation on match, otherwise sanitizes the service to the supported list, forces human approval unless explicitly false, filters actions to draft_dispatch and notify_teams |
| `sanitizeRecommendedService` | Unknown service becomes mobile_diagnostics |

## Enforcement points

1. **UI pre-check** (`public/app.js` incident form): blocks towing words
   before any network call, with the message "Rejected locally: NO TOWING
   and NO WINCHING."
2. **Intake** (`handleIncident`): `evaluatePolicy` on the validated
   incident. Match returns HTTP 422, stores a `policyRejections` entry,
   stores the incident with status `policy_rejected`, audits
   `policy.rejected`, posts a Teams summary (simulated by default), and
   caches the response under the idempotency key.
3. **AI output** (`applyPolicyToAiOutput` after `graceAi.classifyIncident`):
   an external or simulated model recommending towing gets HTTP 422, a
   rejection entry, and audit `policy.rejected_ai_output`.
4. **Auto-dispatch guard**: even with auto-dispatch enabled, only services
   in `LOW_RISK_AUTO_DISPATCH_SERVICES` qualify. Towing is not a supported
   service, so it can never reach the queue, let alone auto-dispatch.

## Tests that prove it

- `rejects towing requests at the API layer and records audit history`
- `rejects Grace AI output that proposes towing`
- `auto-dispatches only low-risk approved services when explicitly enabled`

These three must pass in every PR. See `docs/TEST_PLAN.md` Gate 2.

## What operators do on a rejection

1. Read the rejection in the Policy Rejections panel. It names the referral
   provider field (`routedTo`).
2. Tell the customer the company does not tow or winch and give them the
   approved provider's contact.
3. If the vehicle also needs a mobile repair after recovery, open a new
   incident describing only the repair.
4. Do not edit the description to slip a tow past the filter. The audit log
   keeps both the rejection and any later incident.

## Changing this policy

Only the owner can approve a change. A PR that changes `POLICY_PATTERNS`,
`SUPPORTED_SERVICES`, or `LOW_RISK_AUTO_DISPATCH_SERVICES` must:

- add or update tests for the new behavior,
- update this file and `docs/SystemRules.md`,
- carry the owner's explicit approval in the PR description.

Adding a pattern (making the filter stricter) is allowed with the same
paperwork. Removing one is a business decision, not an engineering one.
