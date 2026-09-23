# Branding — EH Graced Roads Solutions LLC

Status: derived from what the shipped pages already use. Owner review
required before anything here is used outside the product.

## Name and usage

- Legal name: **EH Graced Roads Solutions LLC**
- Product header form: **EH GRACED ROADS** with sub-line
  **Solutions LLC • Safe & Dependable Response Times**
- Assistant persona: **Grace** (also styled GRACE in console UIs)
- Operations wall label: **EH Graced Roads Solutions LLC — Isolated
  Operations Command** (will read Operations Command after the merge)
- Copyright line: `© 2026 EH Graced Roads Solutions LLC`
- Hotline as shown in product: `215-821-8046`

Do not abbreviate to "Graced Roads" alone in customer-facing copy. "EH" is
part of the name.

## Voice

Calm, direct, operational. Short sentences. No hype. Every claim about
response time is an estimate and says so. Never say "emergency dispatch",
"certified", "guaranteed", "instant", or "tow".

Approved phrases already in use:

- "Safe & Dependable Response Times"
- "When there's a breakdown, we provide solutions."
- "ETAs are estimated times of arrival factoring technician availability and
  location."
- "The company does not provide towing services."

## Color system (from the shipped CSS)

| Role | Hex | Where used |
|---|---|---|
| Background deep | `#020617` | page background, footers |
| Surface | `#0f172a` | cards, containers |
| Surface raised | `#1e293b` | inputs, inner cards |
| Border | `#334155` | card and input borders |
| Text primary | `#f1f5f9` | body text |
| Text muted | `#94a3b8` | labels, meta |
| Text faint | `#64748b` | footers, hints |
| Accent amber | `#f59e0b` | brand accent, 24/7 badge, hotline, active values |
| Accent green | `#10b981` | online, positive, prices |
| Accent blue | `#38bdf8` | telemetry, source tags |
| Danger red | `#ef4444` / `#dc2626` | disclaimers, human override |
| Warning orange | `#ff9f1c` / `#fb923c` | convert to work order, scanner CTA |

Status colors on the operations wall map to the five monitor states:
online (green), simulated (blue), stale (muted), offline (faint), error
(red). A simulated source is never shown in the online color.

## Typography

System sans-serif for UI, monospace for identifiers, timestamps, ledger
values, and terminal logs. Labels are small, bold, uppercase, muted. Brand
title is heavy weight (900).

## Badges and labels

- `24/7` badge: amber text on deep background with border.
- Status pills: small radius, bold, uppercase.
- Every simulated feed carries a visible label such as
  `[SIMULATED DEMO FEED]` or a SIMULATION banner.
- Disclaimer block: dashed red border, red tint, small text. Appears on
  operational pages.

## Assets

No logo file exists in the repository yet. Until one is supplied, use the
text wordmark above. Do not generate or embed third-party imagery.

## Mobile app

The mobile app in `grace-roads-mobile` uses the same palette with larger
touch targets and higher contrast for outdoor use. Display name: **Grace
Roads Operations**. Demo mode banner uses the warning orange.
