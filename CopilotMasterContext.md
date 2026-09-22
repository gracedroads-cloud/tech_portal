# Copilot Master Context

## Enterprise Context
EH Graced Roads Solutions LLC is a repair-only roadside assistance and fleet support operation. This system is designed to coordinate heavy-duty truck and trailer repair workflows, field technician dispatch, GPS tracking, AI-assisted triage, and emergency escalation without ever using tow or winch services.

## Core Policy
NO TOW POLICY: We do not provide tow service or winching service. Any workflow, UI element, route, marketing statement, prompt, code path, or operational recommendation must uphold this rule.

## Mission
Keep commercial vehicles moving through rapid, high-quality mechanical repair support, with national after-hours repair network coverage, technician coordination, and real-time command-center visibility.

## Company Operating Model
- Repair-only service model
- After-hours heavy-duty repair network
- GPS-based fleet visibility
- Dual-monitor command center
- AI-assisted dispatch triage
- Hazard awareness and early escalation
- Grace Automation Engine as orchestration layer

## System Principles
1. Repair before tow.
2. Safety first.
3. No tow or winch service in any product surface.
4. Preserve consistent branding and operational tone.
5. Maintain enterprise-grade workflow visibility.
6. Support after-hours service resolution.
7. Use AI to accelerate dispatch, routing, and repair coordination.

## Architecture Summary
### Main Portal
- React-based command center
- Dispatch feed
- GPS map views
- Technician fleet tracking
- System health panel
- AI routing and status support

### Backup Operations Subsystem
- Backend-safe automation layer
- JSON-based workflow output
- Logging and operational recovery
- Parity with main system

### Data Streams
- GPS update feeds from tractors, trailers, drivers, and technicians
- Route and ETA calculations
- Dispatch event broadcasts
- Service-state updates

## GPS Pipeline
- Validate incoming GPS unit events
- Store unit position and status
- Route data to live map navigation
- Trigger AI-assisted routing and ETA updates
- Emit socket updates to the UI

## Emergency Protocol
1. Detect issue and confirm hazard state
2. Evaluate vehicle or asset risk
3. Determine if repair-only service is viable
4. Dispatch technician or repair network partner
5. Update route, ETA, and asset status
6. Broadcast updates to command center
7. Log all actions in the Grace Automation Engine

## Brand Voice
- Professional
- Calm
- Trustworthy
- Execution-driven
- Safety-minded
- Technical but accessible

## Messaging Themes
- Expert repairs, minimal downtime
- 24/7 heavy-duty repair coordination
- Repair-first service model
- Fleet continuity through AI-assisted coordination

## AI Rules for Copilot
- Treat this as the source of truth for company behavior
- Enforce repair-only, no-tow policy in all outputs
- Keep product language aligned to branding
- Use consistent architecture naming and process flow
- Generate code, prompts, documentation, and mockups that reflect the same operating model

## Final Operating Mandate
All Copilot-assisted generation for this company must reflect: repair-first, safety-first, no-tow, AI-enabled, enterprise-grade, after-hours-ready operations.
