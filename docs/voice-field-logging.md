# Voice field logging

The voice logger accepts one `audio/*` upload up to 5 MB, keeps it only in process
memory, and clears its upload buffer after a draft transcription is produced. Audio
is never written to the SQLite database or local filesystem.

Set `WHISPER_API_KEY` in the host's protected environment to enable the server-side
Whisper transcription provider. Optionally set `WHISPER_MODEL` (defaults to
`whisper-1`). Do not place either value in the browser, source control, or a public
configuration file.

Without `WHISPER_API_KEY`, the server returns a deterministic local fixture
transcript for development only. Configure a provider key before production use.

Mechanics must explicitly consent before recording. A recording stops automatically
after 60 seconds, and its parsed values remain editable in the review dialog. Only
the approved transcript and reviewed metrics are saved to the selected dispatch's
DVIR inspection record.
