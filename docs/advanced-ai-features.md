# Advanced AI feature configuration

## OEM manual retrieval

Only ingest OEM manuals your organization is licensed or otherwise authorized to use.
`automation/ragEngine.js` chunks local PDF manuals into the `oem_manuals` SQLite
table and performs local keyword retrieval. It does not create embeddings or send
manual content to a third party.

Create a `RagEngine` with `dispatchStorage.getDatabase()` and call
`ingestManual(absolutePdfPath, manualName)` from a trusted administrative process.
Do not expose manual ingestion over the public API. The `/api/rag/query` route
returns up to three matching, locally stored excerpts.

## Computer vision

The vision endpoint accepts one image up to 10 MB in memory and clears its buffer
after analysis. With no `VISION_ANALYZER_URL`, it returns a development fixture.
For production, set `VISION_ANALYZER_URL` and, if required,
`VISION_ANALYZER_API_KEY` in the server's protected environment. Verify the
provider's data retention policy before sending field images.

## Predictive maintenance

`/api/analytics/predictive-maintenance` groups completed dispatches by carrier and
corridor once two or more records exist, then calculates a capped risk score. It is
a prioritization signal, not a mechanical diagnosis; require qualified personnel to
review recommendations before scheduling maintenance.

## Offline dashboard

The service worker caches only dashboard shell assets. Approved DVIR and voice-DVIR
mutations made while offline are stored in IndexedDB and replayed only after the
device reconnects. Each replay is removed only after a successful authenticated API
response.
