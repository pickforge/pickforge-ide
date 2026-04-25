# Embedded Terminal Architecture

Pickforge hosts every agent CLI session inside an embedded `xterm` widget bound
to a `flutter_pty` pseudo-terminal. The legacy "spawn an external terminal app"
flow is gone. Each chat is a long-lived PTY session that survives chat switches
and persists scrollback across app restarts.

Cross-references:
- Full design rationale: `docs/superpowers/specs/2026-04-25-embedded-terminal-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-25-embedded-terminal.md`
- Decisions log: `NOTES.md`

## Lifecycle of a chat

```
created (Drift insert) ──▶ activated by UI
        │                         │
        │                         ▼
        │                   PtySession.start()
        │                         │
        │                         ▼
        │                  PtyRunning ◀──── user input ──── xterm.onOutput
        │                         │
        │                         ▼
        │                  PtyExited / PtyFailed
        │
        ▼
   removed (Drift cascade
   delete + transcript dir
   wiped on disk)
```

A chat never auto-spawns until the user activates it. `PtySessionPool.activate`
returns the existing session if one already exists for that chat id, otherwise
calls the `create` callback the UI provides and starts the new session.

## PTY pool policy

- One `PtySessionPool` per app instance, registered as a `@lazySingleton` in DI.
- Sessions are keyed by `chatId`.
- `attach`/`detach` add and remove sessions; `parkAll` disposes everything (used
  on app shutdown).
- `sendPrompt(chatId, text)` writes `"$text\r"` to the targeted session.
- The pool deliberately knows nothing about agent profiles, transcript files,
  or UI state — those concerns live in `ChatWorkbenchPanel` and the recorder.

## Transcript on disk

Per-chat layout under each project root:

```
.pickforge/
  chats/
    <chatId>/
      transcript.log         # ANSI-stripped UTF-8, head-truncated at maxBytes
      transcript.spans.bin   # binary varint-framed SGR spans aligned to log
      meta.json              # {schemaVersion, bytes, updatedAt}
```

`TranscriptRecorder` subscribes to each `PtySession.output` *before* xterm sees
any bytes (via `PtySession.onOutput`), strips ANSI for the log, encodes
formatting spans separately, and head-truncates the log when it grows past
`truncateAt` (default `maxBytes + 1MB`).

`TranscriptReplayer.replay()` streams `transcript.log` back into xterm before a
freshly-spawned PTY is wired up, so users see prior history immediately.

## Forge It data flow

```
WidgetPicker selection ──▶ ForgeCubit.forge(chatId) ──▶ AgentLauncher.prepareContext(req)
                                                                │
                                                                ▼
                                                  PickforgeContextWriter writes
                                                  .pickforge/{skill,widget,initial}.md
                                                                │
                                                                ▼
                                                  PtySessionPool.sendPrompt(
                                                    chatId,
                                                    initialPrompt,
                                                  )
                                                                │
                                                                ▼
                                                  Active xterm receives the
                                                  prompt; agent reads files.
```

## Where to read code

| Concern | Path |
|---|---|
| PTY abstraction + flutter_pty adapter | `lib/core/terminal/pty_process.dart`, `flutter_pty_adapter.dart` |
| Session lifecycle + state machine | `lib/core/terminal/pty_session.dart`, `pty_session_state.dart` |
| Pool (activate / parkAll / sendPrompt) | `lib/core/terminal/pty_session_pool.dart` |
| ANSI strip / SGR span parser | `lib/core/terminal/ansi.dart` |
| Transcript record / replay | `lib/core/terminal/transcript_recorder.dart`, `transcript_replayer.dart` |
| Embedded terminal user prefs | `lib/core/terminal/embedded_terminal_settings.dart` |
| Drift schema (Projects, Chats) | `lib/core/drift/tables/projects.dart`, `chats.dart`, `pickforge_database.dart` |
| Repositories | `lib/core/projects/projects_repository.dart`, `lib/core/chats/chats_repository.dart` |
| Workbench cubits | `lib/features/workbench/cubit/` |
| Workbench shell + panels | `lib/features/workbench/view/` |
| Agent context writer | `lib/core/agent/pickforge_context_writer.dart` |
| Agent launcher (prepareContext) | `lib/core/agent/agent_launcher.dart` |
