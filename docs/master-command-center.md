# Master command center

Open `/command_center.html` on a dedicated control monitor. It provides live module
status, SSE connection visibility, and links to the dispatch console and operations
wall.

Push-to-talk requires explicit consent and browser speech-recognition support.
Depending on the browser, speech recognition may use the browser or its configured
speech provider. No transcript is sent to the server until the operator selects
**Send to Grace**.

The current command interpreter is intentionally limited to safe operations:

- Open the dispatch console or operations wall
- Refresh module status
- Report system status

Requests to create, modify, dispatch, stop, restart, delete, or otherwise change
system state are returned as **review required** and do not execute automatically.
