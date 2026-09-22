# Live operations wall

Open `/operations.html` on a dedicated monitor for current saved dispatch activity,
location alerts, corridor counts, and live updates from the console's SSE stream.
The wall refreshes when this console creates or updates a dispatch record.

## Access control

The live Operations Wall, live breakdown feed, compatibility scanner, and its SSE
feed are restricted to operations staff. Before starting the server, set a strong,
unique `OPERATIONS_ACCESS_KEY` in the server environment. The monitor fails closed
with a configuration error until this value is set.

Authorized operators open the monitor with:

```text
/operations.html?operationsKey=YOUR_OPERATIONS_ACCESS_KEY
```

The page stores the key only in that browser tab's session storage and immediately
removes it from the visible URL. Do not bookmark, email, or share the key-bearing
URL. When `DISPATCH_API_KEY` is also set, authorized operators must additionally
supply `apiKey=YOUR_DISPATCH_API_KEY` for the common API protection.

Live road traffic is not invented or simulated. Until a traffic provider is
configured, the wall explicitly reports that traffic is unavailable while continuing
to show live dispatch activity. Set `TRAFFIC_PROVIDER_URL` to a trusted provider
health/data endpoint that the server can reach. The server exposes only connection
status and provider host name, not provider credentials or raw private responses.

The older `business_dashboard.html` scanner now receives compatibility data from
saved dispatches through `/api/breakdowns/scanner`; use the operations wall for the
modern real-time monitor.
