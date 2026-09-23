# Grace Dispatch Console

## Windows automatic startup

Run PowerShell once from the installed console folder:

```powershell
.\Install_Grace_Dispatch_Autostart.ps1 -Port 3109 -RunNow
```

This registers a **Grace Dispatch Console - Logon** scheduled task. At each Windows
Hello sign-in, it waits 30 seconds for Windows and the network to settle, then runs
`auto_launch_cockpit.ps1`. The launcher checks whether the configured local port
(default `3109`) is already listening and validates `GET /healthz`. If the console is
already healthy, it leaves it untouched; otherwise it starts `node app.js` in the
background. If another service occupies that port, the launcher warns and leaves the
service untouched rather than attempting a destructive restart.

After each startup, it writes `data/startup-report.json` with the computer name,
console/Operations Wall health, loopback address, detected LAN addresses, and key
endpoint URLs. It opens the authorized Operations Wall automatically when
`OPERATIONS_ACCESS_KEY` is configured for the Windows user. To open the Operations
Wall manually without restarting a running server, run
`Launch_Graced_Roads_Cockpit.bat`.

If Windows blocks Scheduled Task registration for the current account, the installer
automatically places the same launcher in that user's Windows Startup folder instead.
It uses the same 30-second readiness wait and generates the same health report.

The console can run continuously only while the laptop is powered on and awake.
For unattended 24/7 operation, use an always-on host or configure a separate
administrator-managed startup/service task; a logon task cannot run while the
laptop is powered off.

For operator startup, Operations Wall, maintenance, access-control, and recovery
instructions, read [the Operations startup guide](docs/operations-startup-guide.md).

<<<<<<< HEAD
## Official Policy Statement
We do not provide tow service or winching service.

## Isolated Grace Learning Subsystem
An isolated, integration-ready learning/governance module is available at `isolated-ops-command/`.
See `isolated-ops-command/LEARNING_AND_GOVERNANCE.md` for safety controls, auditability, and integration notes.
=======
For VS Code system-information commands and a ready-to-copy Microsoft Copilot Chat
handoff, read [the Copilot Chat handoff](docs/microsoft-copilot-chat-handoff.md).

For the owner-only local encrypted vault, read [the Company Safe guide](docs/company-safe.md).

The company-wide no-towing/no-winching rule is documented and enforced in
[the Service Policy](docs/service-policy.md).
>>>>>>> origin/main
