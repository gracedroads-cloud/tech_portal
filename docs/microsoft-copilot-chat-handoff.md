# Microsoft Copilot Chat: System Handoff

## Open this system in VS Code

1. Open **Visual Studio Code**.
2. Select **File > Open Folder**.
3. Open this system folder:

   ```text
   C:\Users\elija\.copilot\repos\copilot-worktrees\backend-api\gracedroads-cloud-improved-giggle
   ```

4. Open **Terminal > New Terminal**.
5. Confirm VS Code is in the correct folder:

   ```powershell
   Get-Location
   ```

## Get current system information

Run these commands in the VS Code PowerShell terminal:

```powershell
# Console health and uptime
curl.exe -s http://127.0.0.1:3109/healthz

# Current local/LAN addresses and Operations Wall health
Get-Content .\data\startup-report.json -Raw

# Current source changes not yet committed
git status --short

# Latest saved project update
git --no-pager log --oneline -5

# Node runtime and installed application dependencies
node --version
npm ls --depth=0
```

Open these files for operating details:

| Need | File |
|---|---|
| Startup, maintenance, and Operations Wall instructions | `docs\operations-startup-guide.md` |
| Live operations and traffic-source behavior | `docs\live-operations.md` |
| Master Command Center and PTT safeguards | `docs\master-command-center.md` |
| Voice field logging procedure | `docs\voice-field-logging.md` |
| Remote-access and API-key guidance | `docs\remote-access.md` |
| Central server APIs | `server.js` |
| Persisted dispatch data model | `data\storage.js` |

## Send this update to Microsoft Copilot Chat

Copy this prompt into VS Code Copilot Chat after opening the system folder:

```text
You are continuing work on the Grace Dispatch Console. First read:
- README.md
- docs/operations-startup-guide.md
- docs/live-operations.md
- docs/microsoft-copilot-chat-handoff.md
- server.js
- data/storage.js

Current operating state:
- The local console runs on port 3109.
- Verify it with: curl.exe -s http://127.0.0.1:3109/healthz
- Read data/startup-report.json for the current LAN address and health status.
- Operations Wall: /operations.html
- The Operations Wall, live breakdown feeds, and Operations SSE feed require
  OPERATIONS_ACCESS_KEY and must stay restricted to authorized operations monitors.
- The Windows Startup shortcut automatically starts the console after Windows Hello
  sign-in, waits for readiness, opens the authorized Operations Wall, and writes
  data/startup-report.json.
- Do not expose or commit OPERATIONS_ACCESS_KEY, DISPATCH_API_KEY, or key-bearing URLs.
- Real traffic and live breakdown data must never be fabricated. Use configured providers
  or authenticated real intake records only.

Before changing anything, run:
1. git status --short
2. curl.exe -s http://127.0.0.1:3109/healthz
3. Get-Content .\data\startup-report.json -Raw
4. git --no-pager log --oneline -5

Make focused changes only, preserve the existing startup and operations access controls,
validate the affected behavior, and report the changed files plus validation results.
```

## Important safety rules

- Do not commit `data\dispatches.sqlite`, SQLite WAL/SHM files, or
  `data\startup-report.json`.
- Do not add access keys or credentials to source files, documentation, Git commits,
  screenshots, or chat messages.
- Do not claim traffic, breakdown, voice, vision, or OEM-manual data is live unless
  its real provider has been configured and verified.
- Do not stop or replace a separate service on another port unless that action is
  explicitly approved.
