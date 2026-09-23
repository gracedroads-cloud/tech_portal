# Mockups — text wireframes of the shipped and planned screens

These describe what exists in `public/` and `isolated-ops-command/public/`
today plus the merged layout. Use them to keep new work consistent. Actual
pixel designs are the owner's call.

## Portal: Master Suite (`index.html`)

```
+------------------------------------------------------------------+
| [24/7]  EH GRACED ROADS                    Active Dispatcher: [ ] |
|         Solutions LLC • Safe & Dependable Response Times          |
+------------------------------------------------------------------+
| LIVE FIELD FEED MONITOR  ●     | FINANCIAL LEDGER BALANCE         |
|  Active Ticket  #GRS-____      |  <Client> Repair Deposit  +$___  |
|  Customer / Carrier [       ]  |  Internal System Ledger          |
|  Assigned Unit      [       ]  +----------------------------------+
|  Scene Location     [       ]  | AUTOMATED PRICE SOURCING  [BACK  |
|                                |  OFFICE CTRL]                    |
|                                |  Item [           ]  Base $[   ] |
|                                |  25% Fleet $__   35% Retail $__  |
+------------------------------------------------------------------+
| ! SYSTEM LIABILITY PROTECTIONS ACTIVE: estimated ETAs...          |
+------------------------------------------------------------------+
| Support Hotline: 215-821-8046        © 2026 EH Graced Roads ...   |
+------------------------------------------------------------------+
```

## Portal: Business Dashboard, Grace module (`business_dashboard.html`)

```
+------------------------------+  +------------------------------+
| GRACE STREAM MONITOR &       |  | DISPATCH CONSOLE 2.0         |
| VOICE INTERCEPT 2.0          |  | (EASTON BASE)   [RADAR 150MI]|
|              [● GRACE AI     |  | VAN #1 ● DISPATCH READY      |
|                 HANDLING]    |  | VAN #2 ▲ ON SCENE (BD-101)   |
| Incoming Line | Origin       |  | DIRECT DISPATCH ACTIONS:     |
| LIVE AUDIO STREAM TRANSCRIPT |  | [PTT RADIO] [ROADSIDE        |
| [GRACE AI]: ...              |  |  DISPATCH] [DISPATCH CLOSEST]|
| [PICK UP / OVERRIDE] [RETURN |  | Base: Easton, PA  GPS ...    |
|  TO GRACE] [CONVERT TO WO]   |  |                              |
+------------------------------+  +------------------------------+
| CONSOLE TERMINAL LOG                                            |
| [STREAM CONTROL] Update confirmed by backend.                   |
+-----------------------------------------------------------------+
```

Behavior: override and resume call the backend first, then change the
badge, append to the transcript, and speak. Dispatch Closest is a preview
only and says so in the log.

## Portal: Breakdown Scanner (`breakdown_scanner.html`)

```
| ● 100-Mile Commercial Breakdown Scanner    RADAR HUB ACTIVE      |
| +----------------------------+ +----------------------------+     |
| | SOURCE • HIGH   26.4 mi    | | SOURCE • MEDIUM  41.7 mi   |     |
| | 🚨 Vehicle — Issue         | | 🚨 Vehicle — Issue         |     |
| | Location • <timestamp>     | | Location • <timestamp>     |     |
| | ID: BD-DEMO-101  TECH: ... | | ID: BD-DEMO-102            |     |
| | Dispatch Ready [Triage ➔]  | | Dispatch Ready [Triage ➔]  |     |
| +----------------------------+ +----------------------------+     |
```

Known issue: the timestamp and source fields are not returned by the current
backend. See `docs/GRACE_AI_INVENTORY.md` section D.

## Portal: No-Tow Authorization (`no_tow_authorization.html`)

Red legal notice block stating the company does not tow, then a form:
carrier, unit/asset, agent, execution date, signature. Submits to
`/api/submit-job`. Records acknowledgement only.

## Operations wall (`isolated-ops-command/public/index.html`, future `/ops/`)

```
+------------------------------------------------------------------+
| EH Graced Roads Solutions LLC                                     |
| Isolated Operations Command        [token ____] [operator ____]   |
| [SIMULATION MODE banner when on]   Updated hh:mm:ss  [Fullscreen] |
+------------------------------------------------------------------+
| MONITOR GRID (12 cards, status-colored)                           |
| System Health | Automation Pause | Incident Feed | Dispatch Queue |
| Active Units  | Grace AI Activity| Comms / Teams | Video Sources  |
| Live TV/News  | Secure Browser   | Policy Rejects| Audit Events   |
+------------------------------------------------------------------+
| INCIDENT INTAKE          | DISPATCH QUEUE                         |
|  description [        ]  |  card: service • status pill           |
|  service type [v]        |   description, priority, approval flag |
|  customer, origin        |   [Approve Dispatch] / [Next step]     |
|  [Submit]                |                                        |
+--------------------------+----------------------------------------+
| AUTOMATION PAUSE [reason] [Toggle]   | TECHNICIAN COPILOT form    |
| [Generate simulation event]          |  source, vehicle, code...  |
+--------------------------------------+----------------------------+
| MEDIA GRID (video / tv cards, sandboxed embeds, mute/reconnect)   |
| SECURE BROWSER SESSIONS (allowlisted, sandboxed iframe or new tab)|
| POLICY REJECTIONS feed | AUDIT feed (type, time, redacted detail) |
+------------------------------------------------------------------+
```

Rules baked into the layout: token never stored, simulated sources never
shown as online, every card shows last-updated time, approve and transition
buttons require an operator name.

## Merged navigation (planned)

```
/                 Master Suite (unchanged)
/business_dashboard.html, /breakdown_scanner.html, ... (unchanged)
/no_tow_authorization.html (unchanged)
/ops/             Operations wall (was :4300)
```

A small link strip on the Master Suite header pointing to the Operations
wall is acceptable after the merge. Nothing else on the portal pages changes.

## Mobile (separate repo)

Sign in (demo, labeled) → role-based home. Admin: dashboard, users,
dispatches, incidents, inspections, reports, settings, profile. Driver:
assigned dispatches, breakdown report, DVIR, profile. Confirmation dialogs
on every high-impact action. Large touch targets, high contrast, offline
drafts.
