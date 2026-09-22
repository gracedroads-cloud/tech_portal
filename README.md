# EH Graced Roads Solutions LLC

## Overview
EH Graced Roads Solutions LLC is an enterprise roadside assistance and fleet support platform focused on heavy-duty repair operations, AI-assisted dispatch, GPS-based routing, and after-hours vehicle recovery support without towing.

## Mission
Keep commercial trucks and trailers moving through rapid inspection, diagnostics, dispatch, repair coordination, and safety-first workflow automation.

## Policies
- No tow service
- No winching service
- Repair-first response model
- Safety and technician coordination always prioritized

## Repository Contents
- `CopilotMasterContext.md` — primary source of truth for the company and system context
- `Architecture.md` — architecture and operational model
- `Branding.md` — tone, identity, and messaging guidelines
- `Marketing.md` — customer-facing value proposition and market messaging
- `Mockups.md` — UI and brochure concept descriptions
- `PromptPack.md` — reusable prompt library for Copilot workflows
- `Diagram.txt` — ASCII architecture diagram
- `SystemRules.md` — operating rules and constraints
- `EmergencyProtocol.md` — escalation and response workflow
- `NoTowPolicy.md` — official policy statement

## Operating Model
This platform supports:
- dispatch coordination
- GPS tracking for tractors, trailers, drivers, and technicians
- AI-assisted route optimization
- system health monitoring
- emergency escalation handling
- repair network dispatching

## Stack Overview
- Frontend: React command center UI
- Backend: Node.js / Express services
- Real-time communication: Socket.IO
- GPS: tracking and routing pipeline
- Automation: Grace Automation Engine
- Document system: Markdown-based operational context

## Command Center Design
The command center is organized into dual-monitor operational views:
1. Breakdown and dispatch monitoring
2. GPS, routing, fleet, and technician coordination

## Company Positioning
The brand is defined by speed, technical excellence, repair-first support, and safety-conscious operations in the commercial trucking sector.

## Official Policy Statement
We do not provide tow service or winching service.

## Isolated Grace Learning Subsystem
An isolated, integration-ready learning/governance module is available at `isolated-ops-command/`.
See `isolated-ops-command/LEARNING_AND_GOVERNANCE.md` for safety controls, auditability, and integration notes.
