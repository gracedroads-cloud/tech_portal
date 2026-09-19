# Grace Dispatch Console: Start and Maintain Guide

## 1. Automatic Windows Hello startup

This laptop is configured to start the Grace Dispatch Console automatically after
Windows Hello sign-in.

1. Turn on the laptop and sign in with Windows Hello.
2. Wait about 30 seconds. This gives Windows and the network time to become ready.
3. The Grace launcher checks the console on port 3109.
4. If the console is already healthy, it leaves it running. If it is not running,
   it starts it.
5. The authorized Operations Wall opens automatically in the default browser.
6. The launcher writes the latest status report to
   `data\startup-report.json`.

The active startup entry is the per-user Windows Startup shortcut:

```text
C:\Users\elija\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Grace Dispatch Console.lnk
```

Keep this shortcut in place. It starts the console after every Windows Hello sign-in.

## 2. Verify the system after startup

1. Open the Operations Wall at `http://127.0.0.1:3109/operations.html`.
   The startup launcher provides the authorized access automatically.
2. Confirm the header shows **System Online** and **SSE Connected**.
3. Open `data\startup-report.json`.
4. Confirm both values are healthy:
   - `"health": "HEALTHY"`
   - `"operationsWall": "HEALTHY"`
5. Check the current addresses listed in the report:
   - Local console: `http://127.0.0.1:3109`
   - LAN console: `http://192.168.12.243:3109`

The LAN address can change when the laptop reconnects to a network. Always use the
current value in `startup-report.json`.

## 3. Operating the Operations Wall

### View current activity

1. Keep the Operations Wall open on each authorized operations monitor.
2. The wall updates from the live server event stream; **SSE Connected** confirms
   that automatic updates are active.
3. Review the Active Dispatches, Recent Activity, Location Alerts, and corridor
   panels.

### Monitor urgent breakdowns

1. In **Urgent Priority Breakdowns**, set the base latitude and longitude, or select
   **Use Current Location**.
2. Set the service radius. The normal operating radius is **150 miles**.
3. Select **Refresh / Filter**.
4. Review each priority-one alert for carrier, vehicle, location, cause, priority,
   timestamp, and distance.
5. Select **Enable Alerts** once per browser when browser notifications are wanted.

Live breakdown cards are created only when a real intake source or saved dispatch
provides an event. The wall does not invent incidents.

### Check traffic status

1. Review the **Traffic Provider** panel.
2. **Live provider available** means the configured provider can be reached.
3. **Live provider unavailable** means traffic data is not currently available.
4. Continue using dispatch and breakdown information while the traffic provider is
   unavailable; do not treat unavailable traffic as clear traffic.

## 4. Access control for operations monitors

The Operations Wall and its live breakdown/traffic feeds are restricted to
operations access.

1. Do not give ordinary employee displays the Operations Wall access key.
2. Open the authorized wall once on each designated operations monitor.
3. The browser stores access only for that browser session and removes the access
   key from the visible address bar.
4. If an operations monitor is replaced or its browser data is cleared, have an
   authorized administrator launch it again through the configured startup process.
5. Never email, text, bookmark, or publish a URL containing an access key.

## 5. Start the system manually

Use this only if the automatic launch has not completed.

1. Open the Grace Dispatch Console folder.
2. Double-click `Launch_Graced_Roads_Cockpit.bat`.
3. Wait for the Operations Wall to open.
4. Complete the checks in **Verify the system after startup**.

Alternatively, in PowerShell from the console folder:

```powershell
.\auto_launch_cockpit.ps1 -Port 3109 -OpenOperationsWall -StartupDelaySeconds 0
```

## 6. Daily maintenance

1. At the start of each shift, inspect `data\startup-report.json`.
2. Keep the laptop powered, connected to the required network, and awake while the
   console is expected to run.
3. Confirm **SSE Connected** on every Operations Wall display.
4. Review priority-one breakdowns and location alerts before dispatch decisions.
5. Do not delete `data\dispatches.sqlite`; it stores the saved dispatch history.
6. Do not copy the Operations Wall access key into documentation, tickets, or chat.

## 7. Troubleshooting

| Problem | Action |
|---|---|
| Operations Wall does not open after sign-in | Wait 30 seconds, then run `Launch_Graced_Roads_Cockpit.bat`. |
| System Online is missing | Open `http://127.0.0.1:3109/healthz`. If it does not report `status: ok`, run the manual-start command. |
| SSE shows disconnected | Refresh the Operations Wall. If it remains disconnected, confirm the health endpoint and network connection. |
| Operations Wall says access is required | Use the authorized Operations Wall launch process; do not bypass or weaken access control. |
| LAN monitor cannot connect | Read the current LAN address from `data\startup-report.json`, then confirm both devices are on the same trusted network. |
| Traffic provider unavailable | Treat traffic information as unavailable. Do not assume live traffic is clear. |

## 8. Updating the automatic startup setup

If the console folder moves, the laptop is replaced, or automatic startup needs to be
re-created:

1. Open PowerShell in the new console folder.
2. Run:

   ```powershell
   .\Install_Grace_Dispatch_Autostart.ps1 -Port 3109
   ```

3. Confirm the message identifies either the logon task or the per-user Startup
   shortcut.
4. Run `Launch_Graced_Roads_Cockpit.bat`.
5. Verify a new `data\startup-report.json` reports both console and Operations Wall
   as healthy.
