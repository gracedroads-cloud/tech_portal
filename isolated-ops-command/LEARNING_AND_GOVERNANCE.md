# LEARNING_AND_GOVERNANCE

## Purpose

This isolated prototype adds a safe, auditable continuous-improvement loop for Grace AI inside the EH Graced Roads Operations Command subsystem.

It **does not** modify root/legacy app behavior.

Grace improves through:
- authorized event observation,
- approved knowledge retrieval,
- operator/technician feedback,
- synthetic evaluation,
- human-reviewed lesson promotion.

Grace does **not** perform unsupervised online retraining or autonomous self-modification.

> Grace is an AI assistant and is not an autonomous mechanic, emergency dispatcher, attorney, CPA, or final decision-maker.

## Integration readiness (for related isolated Operations Command merge)

If broader isolated Operations Command files are merged later, connect this module by:

1. Routing the isolated event bus normalized events to `POST /api/ops/events`.
2. Wiring Grace recommendation output through `POST /api/ops/recommendations/validate` before any action proposal is displayed.
3. Mounting the monitor stream from `GET /api/ops/intelligence/stream` into the existing isolated monitor wall SSE/WebSocket adapter.
4. Pointing role-based admin/reviewer UIs to lesson and governance APIs in this module.

No root `app.js` route changes are required.

## Observation pipeline

Authorized event types only:
- `incident.lifecycle`
- `dispatch.decision`
- `technician.question`
- `diagnostic.code`
- `recommendation.generated`
- `operator.approval`
- `operator.rejection`
- `work_order.outcome`
- `integration.failure`
- `policy.rejection`
- `system.health`

Data minimization/redaction removes sensitive keys matching credential/bank/token/auth/private media patterns before persistence.
The subsystem observes **system events only** and does not implement covert employee surveillance, biometrics, emotion detection, or background recording.

Learning pause/resume APIs:
- `POST /api/ops/learning/pause`
- `POST /api/ops/learning/resume`

The current visible state is published by:
- `GET /api/ops/intelligence/monitor`
- `GET /api/ops/intelligence/stream`

## Structured operational memory

Lesson entries store:
- source/provenance and citation
- owner
- version
- effective date
- last reviewed date
- confidence category
- approval state (`candidate`, `approved`, `rejected`, `rolled_back`)
- expiration/review date
- applicability scope (equipment/service/code family)

Knowledge search endpoint: `GET /api/ops/knowledge/search`

Rules:
- unreviewed candidates are excluded
- expired lessons are excluded
- rolled-back lessons are excluded
- stale reviewed lessons include freshness warnings and are not marked authoritative

Adapter stubs and policy are designed for future licensed OEM/Mitchell-style/accounting/legal/business connectors.
No proprietary source scraping is implemented.

## Feedback and learning loop

Feedback endpoint: `POST /api/ops/feedback`

Verdicts:
- `correct`
- `incorrect`
- `partially_useful`
- `unsafe`
- `outdated`
- `add_note`

Feedback links to recommendation id, source set, model/provider version, prompt-policy version, incident, and final outcome.

Candidate lessons are generated from synthetic approved `work_order.outcome` completion events and remain non-authoritative until reviewer approval.

Lesson review endpoint:
- `POST /api/ops/lessons/:lessonId/review` with `approve`, `reject`, or `rollback`

## Evaluation and Grace Intelligence monitor

Evaluation endpoint:
- `POST /api/ops/evaluations/run`
- `GET /api/ops/evaluations/status/:evaluationId`

Synthetic domains in default harness:
- heavy-duty diesel diagnostics
- roadside operations
- no-tow/no-winching policy
- business administration
- accounting-information assistance
- legal-information escalation

Persisted metrics include policy compliance, grounding/citation validity, freshness pass rate, diagnostic usefulness, unsafe/hallucination rates, correction rate, escalation correctness, latency, and integration reliability.

Monitor includes provider/model state, simulation/live indicator, learning status, freshness summary, evaluation trend anchor (latest), correction backlog, unreviewed lessons, degraded mode, and last successful evaluation.

## Reasoning and action safety

- Schema and action validation is enforced through allowlisted action catalog.
- Policies are reapplied **after model output**.
- `NO TOWING` and `NO WINCHING` are deterministic non-bypass checks.
- Human approval is required for dispatch commitment, safety-critical diagnostics, financial/legal/accounting actions, policy changes, and lesson promotion.
- Prompt-injection resistance: retrieved text is treated as data; untrusted sources cannot grant actions.
- Circuit breaker/degraded mode is activated on action-allowlist violations.

## Technician assistance boundaries

Resolved-case lessons can include:
- applicability (vehicle/engine scope)
- diagnostic code family
- symptoms/measurements
- authorized source citations
- last verification markers
- confidence category
- assumptions and escalation triggers

Unsafe bypass instructions (safety devices, emissions controls, unauthorized procedures) are blocked by governance/policy review process.

## Administration and governance

Role-gated workflows:
- operator: submit events/feedback, search knowledge, read metrics
- reviewer: approve/reject/rollback lessons, run evaluations, pause/resume learning
- admin: export/restore/anonymization/legal-hold-adjacent operational controls

Prototype governance endpoints:
- `GET /api/ops/governance/export`
- `POST /api/ops/governance/restore`
- `POST /api/ops/governance/anonymize`
- `POST /api/ops/governance/delete-incident`
- `POST /api/ops/governance/legal-hold`
- `POST /api/ops/governance/config`
- `GET /api/ops/audit`

Persistent JSON stores support backup/restore testing and restart recovery.

## API & event update requirements

All mutation APIs require:
- bearer token auth
- role checks
- idempotency key
- input validation
- redacted errors (no secret echo)

Reactive updates are pushed through SSE from `/api/ops/intelligence/stream`.
Provider health and degraded mode controls:
- `POST /api/ops/provider/health`

## Retention, consent, legal and production blockers

This prototype includes consent flags, retention-day controls, and anonymization workflow.
Before production:

1. Add formal privacy notices and employee/customer consent implementation where applicable.
2. Add access-review process and periodic role attestation.
3. Finalize licensed data agreements for OEM/repair/legal/accounting sources.
4. Finalize model/vendor agreements and monitoring SLOs.
5. Add professional legal/accounting policy review and sign-off process.
6. Integrate legal hold workflow with organization records retention policy.

## Evaluation cadence and incident response

Recommended cadence:
- nightly synthetic evaluation
- ad-hoc evaluation after policy/model/prompt/provider changes
- mandatory review on degraded-mode trigger

Incident response:
1. Pause learning (`/learning/pause`)
2. Run evaluation and inspect latest metrics
3. Review audit entries and rollback risky lessons if required
4. Resume learning only after reviewer sign-off
