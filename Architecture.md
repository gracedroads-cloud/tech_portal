# Architecture

## Executive Summary
The EH Graced Roads Solutions platform combines a React-based command center with a backend automation and live operational data layer. The architecture supports dispatch, GPS telemetry, technician coordination, AI-assisted routing, and after-hours repair workflows.

## Core Principles
- Safety first
- Repair-only operations
- No tow service
- Real-time operational visibility
- AI-assisted coordination
- Redundant/backup operations layer

## Main System
### 1. Frontend Command Center
The main portal is a React interface that provides:
- dispatch feed
- service status dashboards
- GPS map interface
- asset and technician panels
- AI routing and ETA support
- dual-monitor workflow support

### 2. Backend Services
The backend system is built on Node.js and Express and handles:
- API route management
- GPS ingestion
- event broadcasting
- service-state updates
- customer and technician records
- logging and automation tasks

### 3. Real-Time Layer
Socket.IO supports real-time communications for:
- new dispatch events
- technician status changes
- GPS updates
- emergency escalations
- route recalculations

## Backup / Operations Layer
The backup subsystem provides a parallel operational workflow to ensure continuity during incidents, outages, or not-available primary services. It maintains:
- automation scripts
- JSON output capture
- log persistence
- safe operations and fallbacks
- route and asset consistency

## Grace Automation Engine
The Grace Automation Engine orchestrates:
- asset tracking
- dispatch logic
- AI-guided routing
- fleet operational health
- emergency handling
- repair coordination

## Event Flow
1. Vehicle or fleet issue is reported
2. System validates hazard and service category
3. AI triage identifies repair pathway
4. Technician or partner network is assigned
5. GPS and routing updates are sent live
6. Command center monitors status continuously
7. Emergency escalation triggers if required

## Data Model Categories
- assets: tractors, trailers, equipment
- drivers and technicians
- service calls and dispatch records
- GPS telemetry
- incident and repair logs
- route and ETA data

## System Responsibilities
### Operational responsibilities
- dispatch intake
- technician matching
- route generation
- staged escalation
- after-hours support

### Business responsibilities
- customer communication support
- billing groundwork
- service documentation
- fleet continuity

## Architecture Standards
- Keep UI workflow readable and operationally simple
- Keep responses fast and visible
- Maintain a repair-only rule across application layers
- Log all critical operations and escalations

## Summary
The architecture is intentionally built to support a fast, high-trust repair-first service operation with strong operational visibility and AI-enabled coordination.
