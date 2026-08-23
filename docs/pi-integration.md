# Pi Integration

## Goal

Hrdle can create, detect, resume, and display sessions that run the Pi coding
agent as a first-class provider. Pi conversations and structured `ask_user`
questions are available in the browser and on EVEN Realities G2 glasses.

The base Pi adapter works through Hrdle's existing glasses relay. The later
question-context and pending-picker restoration improvements extend the relay
with optional fields and update the G2 companion. Older clients remain wire
compatible, but they cannot display or restore those enhanced states.

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
- Relay single-choice, multi-select, free-text, context, and option descriptions
  to the G2 app.
- Preserve an unanswered picker when the wearer closes it, leaves the
  conversation, and later returns to answer it.
- Prevent Pi output from falling through to generic numbered-screen scraping.

## Out of Scope

- Pi usage or token metrics.
- Pi-specific completion hooks or browser notifications.
- Replacing Hrdle's upstream self-update and service-management design.
- Packaging Hrdle through the workstation environment repository.

## Important Behavior

### Session Identity

Herdr may report a Pi session as an absolute JSONL path. Hrdle accepts such a
path only from the trusted herdr integration boundary, validates that it is a Pi
version 3 session, and canonicalizes it to the session UUID before exposing it
to clients.

Public history and conversation routes accept canonical UUIDs only. A
URL-encoded absolute path supplied by an HTTP client is rejected. If a trusted
path cannot temporarily be resolved, Hrdle omits the public Pi session identity
instead of exposing the host path.

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

### G2 Context and Picker Restoration

The relay carries context separately from the question and choices. The updated
G2 companion renders bounded context and question text before selectable rows,
reserving display lines so a long option description cannot push the decision
context off-screen.

Closing a picker does not answer or dismiss its structured question. Leaving a
conversation uses a non-destructive back action, so returning to the session
and tapping the pending question opens the picker again. Explicitly choosing to
handle a question later from the relay overlay retains the existing server-side
dismissal behavior. Reader pin/release remains the innermost double-tap action.

## Validation Environments

### Current v0.3.189 Port

Automated validation was performed on 2026-08-23 with:

- Hrdle v0.3.189, based on upstream main commit `286d5733`;
- branch `feature/pi-adapter-trial-v0.3.189`;
- Bun v1.3.3;
- NixOS on x86_64 Linux;
- G2 companion manifest `com.hrdle.glasses` v0.0.85.

The current port has not yet completed physical G2 validation. In particular,
context rendering and pending-picker restoration remain publication gates.

### Historical Physical Baseline

Physical validation of the base adapter was performed on 2026-08-14 with:

- Hrdle v0.3.126, based on upstream commit `4f00f87`;
- Pi v0.80.6;
- herdr v0.8.0, protocol 20;
- Bun v1.3.3;
- NixOS on x86_64 Linux;
- physical EVEN Realities G2 glasses;
- the then-unmodified Hrdle G2 companion, whose runtime reported v0.0.76;
- Groq `whisper-large-v3-turbo` for glasses speech-to-text.

Voice-test reproduction requires a reachable Hrdle deployment and the tester's
own Groq API key. No secret, device serial number, tailnet address, local session
UUID, transcript path, or local home path is included in this document.

## Automated Verification

The following checks pass against the v0.3.189 port:

```bash
bun run --cwd shared typecheck
bun run --cwd backend typecheck
bun run --cwd glasses typecheck
bun run --cwd frontend typecheck

bun run --cwd backend test
bun run --cwd frontend test
bun run --cwd glasses test

bun run build
bun run build:binary
```

Biome lint passes on all files changed by the port. The repository-wide lint
command still reports an upstream error in unchanged
`frontend/src/utils/stl-render.ts`: Biome classifies WebGL's
`gl.useProgram(...)` as a conditional React hook call. This is reproducible at
upstream commit `286d5733` and is not changed or suppressed by the Pi port.

Focused coverage includes:

- provider registration, create-session validation, process detection, and
  lifecycle commands;
- herdr `id` and `path` session references;
- canonical UUID resolution, trusted Pi paths, Pi v3 header validation, public
  and self-peer path rejection, and omission when canonicalization fails;
- distinct canonical identities for multiple Pi panes;
- active-branch reconstruction and abandoned-branch exclusion;
- append-only cache updates;
- metadata, search, history, and conversation conversion;
- answered and unanswered `ask_user` correlation;
- single-choice, multi-select, descriptions, comments, and free-text rows;
- Pi-compatible `PI_ASK_USER_ALLOW_COMMENT` environment values;
- suppression of unsafe generic screen scraping for Pi;
- glasses snapshots and question appearance/removal without a herdr status
  transition;
- context propagation through the backend, shared wire type, G2 overlay, and
  picker;
- context-aware relay refresh and display-line reservation in both the overlay
  and picker, including long decision text that must leave a visible choice;
- cancel, leave, return, and reopen navigation without a dismiss request;
- coexistence with the upstream reader pin/release behavior;
- Steward source links that preserve the Pi provider when opening the original
  conversation.

The expanded focused suite passed 522 tests with 1,071 expectations. The complete
backend, frontend, and G2 suites passed 1,244, 268, and 600 tests respectively,
with zero failures. The G2 suite recorded 1,380 expectations. Error-level LSP
diagnostics and `git diff --check` were also clean for the current changes.

## Historical Physical G2 Verification

Each baseline test was performed against the same active Pi conversation through
the running Hrdle v0.3.126 service. Structured Pi records and server logs were
checked after the user-visible result.

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
The UUID and device identifiers are intentionally omitted.

## Pending Physical G2 Verification

The v0.3.189 binary and v0.0.85 companion must pass these tests one at a time
before the branch is pushed:

| Test | Procedure | Expected result | Status |
|---|---|---|---|
| Context rendering | Open a Pi `ask_user` containing a distinct context marker, question, and described options | Context appears before the question and choices in both overlay and picker | Pending |
| Picker restoration | Open a structured picker, cancel it, leave the conversation, return to the same session, and tap the pending question | The same picker reopens and no dismiss request or accidental answer is emitted | Pending |

## Known Caveats

- Hrdle v0.3.189 still declares herdr protocol 16 as tested. The historical trial
  used protocol 20 successfully, but the current v0.3.189 binary must repeat the
  runtime protocol smoke test.
- The transcript cache is bounded by session count, not total bytes. Opening
  several unusually large Pi histories can increase Hrdle memory use and should
  remain part of trial monitoring.
- Trusted custom transcript paths can expand the in-memory discovery set over a
  long-lived server process; bounded exact-path indexing remains follow-up work.
- If `allowComment` is omitted, free-text cursor routing uses the Hrdle service's
  `PI_ASK_USER_ALLOW_COMMENT` environment. A Pi pane launched with a different
  value can disagree with that inferred row count.
- Pi usage metrics and Pi-specific hook notifications are intentionally absent.
- The context and picker-restoration behavior requires the updated v0.0.85 G2
  companion; the base Pi picker remains compatible with older companions.

## Verification Summary

The Pi adapter has been ported onto Hrdle v0.3.189 and passes workspace
TypeScript checks, backend/frontend/glasses tests, changed-file lint, production
builds, binary build, focused security/session-identity regressions, and G2
controller regressions. Historical physical testing established the base
adapter's voice, conversation, picker, selection, free-text, scrolling, and
session-continuity behavior on v0.3.126. Publication of the v0.3.189 branch
remains gated on a new runtime smoke test and physical validation of context
rendering and pending picker restoration with companion v0.0.85.
