# Grace Dispatch Console: GitHub Copilot Coding Agent Export

## Official service labels

- **GitHub Copilot**
- **GitHub Copilot coding agent**
- **GitHub cloud agent session / coding agent session**

## Export contents

The export package contains application source, public consoles, PowerShell startup
automation, dependency manifests, documentation, and a Git history bundle. It
intentionally excludes credentials, `.env`, `node_modules`, SQLite databases, Safe
data, runtime reports, logs, and other machine-specific records.

## Restore in VS Code

1. Extract the ZIP to a trusted local folder.
2. Open that folder in Visual Studio Code.
3. Run `npm install`.
4. Copy the local environment values from the original trusted system; do not place
   access keys in Git or source files.
5. Read `README.md`, `docs/operations-startup-guide.md`, and
   `docs/microsoft-copilot-chat-handoff.md`.

## GitHub Copilot coding agent continuation prompt

```text
You are GitHub Copilot coding agent continuing the Grace Dispatch Console.

Read README.md and all files under docs/ before changing anything. This export
contains source only; credentials, runtime SQLite data, Company Safe data, and
machine-specific reports were intentionally excluded.

Preserve these non-negotiable rules:
- No towing, winching, or vehicle recovery services.
- Never fabricate live traffic, truck routes, fleet GPS, or external AI results.
- Keep Operations data restricted to authorized operations users.
- Never expose or commit DISPATCH_API_KEY, OPERATIONS_ACCESS_KEY, Company Safe
  data, or key-bearing URLs.
- Keep Company Safe local-only and encrypted at rest.

Before edits, run git status --short, node --check server.js, and the smallest
relevant validation. Report changed files and validation results.
```
