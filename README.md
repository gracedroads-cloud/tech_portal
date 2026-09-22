# GRACE Operations Hub

## Automation coverage

The command center includes operational workflow paths for fleet scheduling and routing, fleet accounts and vendors, compliance and legal administration, billing and financial support, workforce and emergency logistics, safety leadership, and office operations and software ownership. Safety leadership paths cover briefings, incident and near-miss review, field observations, and safety KPI review.

## Extending automations

The dashboard reads automation workflows from its persisted `data/grace_operations.json` state. Add a workflow with `POST /api/grace/automations` using a `domain` and an `automation` object containing `id`, `name`, `trigger`, and `outcome`. The domain is created when it does not yet exist; workflow IDs must be unique lowercase letters, numbers, and hyphens.

Update an existing workflow's `name`, `trigger`, or `outcome` with `PUT /api/grace/automations/:id`. Both endpoints persist the change and return the current operations object, so clients can refresh the dashboard without modifying `app.js`.
