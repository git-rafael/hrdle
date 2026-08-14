# Pi Integration

## Goal

Hrdle can create, detect, resume, and display sessions that run the Pi coding
agent as a first-class provider. Pi conversations and structured `ask_user`
questions are available in the browser and on EVEN Realities G2 glasses.

The integration is designed to work with the existing G2 relay protocol, so a
server-side Pi adapter does not require a companion-app rebuild.

## Scope

- Register `pi` as an agent provider in the shared provider registry and UI.
- Create Pi sessions with `pi` and resume them with `pi --session <id>`.
- Preserve and safely canonicalize path-valued Pi session references reported
  by herdr.
- Discover Pi JSONL sessions in configured and default session directories.
- Reconstruct only the active `id` / `parentId` branch of an append-only Pi
  transcript.
- Expose Pi session metadata, search results, history, and conversation turns.
- Read unresolved Pi `ask_user` tool calls from structured transcript records.
- Relay single-choice, multi-select, and free-text questions to the G2 app.
- Prevent Pi output from falling through to generic numbered-screen scraping.

## Out of Scope

- Pi usage or token metrics.
- Pi-specific completion hooks or browser notifications.
- Changes to the G2 companion application or its relay protocol.
- Replacing Hrdle's upstream self-update and service-management design.

## Important Behavior

### Session Identity

Herdr may report a Pi session as an absolute JSONL path. Hrdle accepts such a
path only from the trusted herdr integration boundary, validates that it is a Pi
version 3 session, and canonicalizes it to the session UUID before exposing it
to clients.

Public history and conversation routes accept canonical UUIDs only. A
URL-encoded absolute path supplied by an HTTP client is rejected.

### Conversation Reconstruction

Pi JSONL files are append-only trees rather than linear transcripts. The reader
starts at the active leaf and follows `parentId` links to the root. Abandoned
branches therefore do not appear in conversation history, metadata, or open
question state.

Session discovery considers the Pi configuration and default storage roots,
deduplicates sessions by UUID, confines configured roots, and incrementally
caches parsed transcript data. Full transcript caching is bounded to eight
sessions.

### Structured Questions

An unresolved Pi question is an assistant `toolCall` named `ask_user` without a
matching `toolResult` on the active branch. Hrdle uses those records instead of
screen heuristics and preserves:

- question context;
- option labels and descriptions;
- single-choice or multi-select behavior;
- the custom-response row;
- Pi-specific terminal key sequences.

Herdr can continue reporting Pi as `working` while `ask_user` owns its TUI;
Hrdle displays that state as `processing`. For glasses relay purposes, an
unresolved structured Pi question is therefore treated as an effective blocked
state. This lookup is gated on an active glasses relay subscriber, so ordinary
browser-only sessions do not poll Pi transcripts unnecessarily.

## Validation Environment

Validation was performed on 2026-08-14 with:

- Hrdle v0.3.126, based on upstream commit `4f00f87`;
- Pi v0.80.6;
- herdr v0.8.0, protocol 20;
- Bun v1.3.3;
- NixOS on x86_64 Linux;
- physical EVEN Realities G2 glasses;
- the unmodified Hrdle G2 companion app, whose runtime reported v0.0.76;
- Groq `whisper-large-v3-turbo` for glasses speech-to-text.

Voice-test reproduction requires a reachable Hrdle deployment and the tester's
own Groq API key. No secret, device serial number, tailnet address, local session
UUID, or transcript path is included in this document.

## Automated Verification

The following checks passed against the trial branch:

```bash
bun run --cwd shared typecheck
bun run --cwd backend typecheck
bun run --cwd glasses typecheck
bun run --cwd frontend typecheck

bun run --cwd backend test
bun run --cwd frontend test
bun run --cwd glasses test

bun run lint
bun run build:binary
```

Focused coverage includes:

- provider registration, create-session validation, process detection, and
  lifecycle commands;
- herdr `id` and `path` session references;
- canonical UUID resolution, exact trusted Pi paths, Pi v3 header validation,
  and rejection of public absolute-path reads;
- active-branch reconstruction and abandoned-branch exclusion;
- append-only cache updates;
- metadata, search, history, and conversation conversion;
- answered and unanswered `ask_user` correlation;
- single-choice, multi-select, descriptions, comments, and free-text rows;
- Pi-compatible `PI_ASK_USER_ALLOW_COMMENT` environment values;
- suppression of unsafe generic screen scraping for Pi;
- glasses snapshots and question appearance/removal without a herdr status
  transition.

The final focused glasses relay suite passed 138 tests with 267 expectations.
Editor/LSP error diagnostics were also clean for the changed relay files.

## Physical G2 Verification

Each test was performed against the same active Pi conversation through the
running Hrdle service. Structured Pi records and server logs were checked after
the user-visible result.

| Test | Procedure | Expected result | Result |
|---|---|---|---|
| Voice transport | Send a spoken prompt from the G2 | STT text reaches the active Pi pane | Passed |
| Open `ask_user` while herdr reports working | Open a Pi question while herdr remains `working` (shown as `processing` by Hrdle) | G2 shows an interactive picker instead of raw `[ask_user]` activity | Passed |
| Multi-select | Mark the first and third of three options, then submit | Pi records exactly those two selections | Passed: `Voz`, `Retomada` |
| Free-text answer | Select the custom-response row and dictate “Alfa quarenta e dois” | Pi records a non-cancelled `freeform` result | Passed: STT normalized it to `Alpha 42` |
| Conversation history | Add marker `AZUL-731`, exchange two more messages, then scroll backward | Marker and messages remain visible in chronological order | Passed |
| Long response | Navigate a ten-item response from `INÍCIO-204` to `FIM-908` and identify items 4 and 9 | Entire response is reachable without missing middle content | Passed: `Cobalto`, `Farol` |
| Session resume | Close the G2 app, reopen it, select the same Pi session, find `RETOMADA-515`, and send another prompt | New WebSocket instance restores the same Pi conversation and accepts input | Passed |
| Question resolution | Answer a displayed picker | Matching Pi `toolResult` resolves the call and the relay removes the waiting item | Passed |

The session-resume logs showed the original glasses WebSocket closing, a new G2
instance connecting, the same Hrdle workspace being subscribed, conversation
rendering, and a new STT prompt reaching the same canonical Pi session UUID.
The UUID and device identifiers are intentionally omitted from this document.

## Known Caveats

- Hrdle v0.3.126 declares herdr protocol 16 as tested. This trial used protocol
  20 and emitted the expected warning. All automated and physical tests above
  passed, but upstream protocol certification remains separate work.
- The transcript cache is bounded by session count, not total bytes. Opening
  several unusually large Pi histories can increase Hrdle memory use and should
  remain part of the multi-day trial monitoring.
- Pi usage metrics and Pi-specific hook notifications are intentionally absent
  from this change.
- The adapter changes only the server, shared provider registry, and web UI. The
  existing G2 app worked without rebuilding or changing the EHPK.

## Verification Summary

Validated on Hrdle v0.3.126 with Pi v0.80.6, herdr v0.8.0 protocol 20,
Bun v1.3.3, and physical EVEN Realities G2 glasses. All workspace typechecks,
backend/frontend/glasses tests, lint, and the production binary build passed.
Physical testing covered voice input, Pi `ask_user` rendering while herdr still
reported the pane as working, exact multi-select results, free-text voice
replies, ordered conversation history, long-response scrolling, app close/reopen
session resume, and removal of resolved questions. The existing G2 companion
app required no changes. Known follow-ups are formal herdr protocol-20
certification and byte-based memory limits for unusually large Pi transcript
caches.
