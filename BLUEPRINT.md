# EH GRACED ROADS SOLUTIONS LLC — SYSTEM BLUEPRINT

## 1. Executive Summary & Enterprise Vision

EH Graced Roads Solutions LLC operates as a digitally automated commercial heavy-duty mobile truck and trailer repair enterprise based in Pennsylvania. This blueprint establishes the architectural standard for the **Grace Dispatch Console**—a self-operating enterprise backbone combining automated backend workers, real-time WebSocket telemetry, and a live React command center.

## 2. Directory & File Architecture (`SystemSkeleton`)

```text
C:\GracedRoadsSystem\
│
├── backend-api\
│   ├── server.js               # Express + Socket.IO server & master routing
│   ├── engine.js               # Central automation & scheduler engine
│   ├── scheduler.js            # Cron & interval event scheduler
│   ├── queue.js                # Job execution queue
│   ├── triggers.js             # Event-based workflow triggers
│   └── grace_ai.js             # Grace AI operational oversight module
│
├── workers\
│   ├── dispatchWorker.js       # Handles incoming service calls & technician assignments
│   ├── hrWorker.js             # Manages time-tracking, compliance, and onboarding
│   ├── payrollWorker.js        # Automated payroll cycle calculations & records
│   ├── billingWorker.js        # Processes invoices, receipts, and payment events
│   ├── systemHealthWorker.js   # Monitors CPU, memory, API latency, and uptime
│   └── aiWorker.js             # Executes scheduled AI audits and anomaly detection
│
├── workflows\
│   ├── dispatch.json           # Dispatch workflow rules
│   ├── hr.json                 # HR compliance rules
│   ├── payroll.json            # Payroll distribution rules
│   ├── billing.json            # Invoice triggers
│   ├── compliance.json         # DOT expiration checks
│   └── ai.json                 # AI oversight parameters
│
├── public\
│   ├── business_dashboard.html # Main operations cockpit
│   ├── master_hub.html         # Central navigation hub
│   └── breakdown_scanner.html  # Diagnostic scanner interface
│
└── package.json                # Project dependencies (express, socket.io, etc.)
```

## 3. Core Operational Domains & Automation Engine

The automation engine orchestrates scheduled tasks, event triggers, and worker coordination to maintain continuous operations without manual intervention:

* **Dispatch:** Captures inbound calls, CB radio logs, and customer requests, assigning on-call mobile technicians instantly via `/api/dispatch`.
* **Fleet & Compliance:** Monitors DOT expiration warnings, vehicle telemetry, and required maintenance actions.
* **HR & Payroll:** Streamlines employee time-tracking, hour calculation, and payroll processing.
* **System Health:** Provides continuous live feedback on server uptime, API response times, and error logs.

## 4. React Command Center & Real-Time Telemetry

Designed to mimic a live operations cockpit (similar to modern logistics and emergency command centers), the frontend interfaces directly with the backend via **WebSockets (`Socket.IO`)**:

* **Live Dispatch Monitor:** Real-time terminal feed auto-scrolling with color-coded status tracking (`Dispatched`, `En-route`, `Completed`, `Cancelled`).
* **Explanation System:** Translates raw operational logs and workflow results into human-readable leadership insights.
* **Grace AI Integration:** Functions as the digital operations analyst, evaluating risk, monitoring logs, and generating automated field responses.

## 5. 2-Week Execution Timetable

* **Week 1 (Backend & Automation):** Finalize `SystemSkeleton`, build `engine.js` and `scheduler.js`, deploy core workers and workflows, and integrate `grace_ai.js` safeguards.
* **Week 2 (Command Center & Launch):** Initialize React environment, build monitor grid layout, wire WebSocket telemetry feeds for dispatch, HR, billing, and system health, and run full end-to-end integration testing.
