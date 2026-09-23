# Marketing — positioning and claims guardrails

Status: **draft for owner review.** Nothing here is approved for external
use until the owner signs off. The claims guardrails section is binding on
all copy, approved or not.

## Positioning

EH Graced Roads Solutions LLC keeps commercial fleets moving by bringing the
mechanic to the truck. Mobile diagnostics, roadside mechanical repair, tire
service, air brake triage, and battery and electrical help along the I-78
and US-22 corridor from an Easton, PA base.

One sentence: **We fix it where it stopped. We don't tow.**

## Audience

- Fleet managers and dispatchers at regional and national carriers running
  the Lehigh Valley corridor.
- Owner-operators who need a repair, not a recovery.
- Yard and lot managers needing on-site service without moving equipment.

## Service list (must match `SUPPORTED_SERVICES` in code)

- Mobile diagnostics
- Roadside mechanical repair
- Tire service
- Air brake triage
- Battery and electrical help

If marketing wants to add a service, engineering adds it to the supported
list first, with the owner's approval, and the tests pass. Copy follows
code, not the other way around.

## What we say about Grace

Grace is the company's operations assistant. It helps the dispatcher triage
and track work. Say: "Grace helps our team triage faster." Do not say:
"AI dispatches your repair", "automated dispatch", or anything implying a
machine decides. A person approves every job.

## Claims guardrails (binding)

Never claim, in any channel:

- Emergency dispatch, emergency services, or 911 substitution.
- Towing, winching, recovery, or pull-out services.
- Guaranteed or fixed response times. Say "estimated" and cite conditions.
- Certified, licensed, or regulated status the company does not hold.
- Live tracking, live telematics, or live integrations unless the customer
  has configured them and the owner has verified them.
- Payment processing, financing, or invoicing capabilities beyond what
  actually exists.
- App Store availability, production authentication, or MFA for the mobile
  app until they exist.

Prices shown in the dispatch console are labeled demo references. They are
not quotes.

## Channels and materials (to be produced, owner to prioritize)

- One-page service sheet: services, corridor coverage, hotline, no-tow
  statement.
- Fleet onboarding page: already exists as `client_onboarding.html`; copy
  review pending.
- Dispatcher quick card: how to reach the team, what to have ready (unit,
  location, symptom), what we do not do.

## Measurement

Track what the software already records: intake count, policy referrals,
approval-to-assignment time, completion-to-close time. These are internal
operational metrics from the audit log, not public claims.
