# vibe-flutter — Brainstorming Notes

Working memory for this project. Updated as we go.

## Vision (user's words)

A local desktop app, **built in Flutter**, that helps you "vibe code" Flutter apps (and maybe other languages later) by giving the AI rich *widget-level* context from a running app.

Core loop the user described:
- User runs their Flutter app in an emulator (or a web session simulating mobile).
- User hovers over the running app → widgets are auto-detected and outlined (like Flutter DevTools inspector).
- User clicks to select a widget / screen region.
- App extracts that widget's source code + context and feeds it to an AI coding agent.
- AI makes **surgical, precision edits** to that specific widget.
- Optionally: before/after screenshots are sent to the AI so it "sees" the visual change.

Runs locally. Spawns the user's own Claude Code / Codex / OpenCode in a terminal, using their own credentials, but enriched with widget context.

## Reference: BridgeSpace (bridgemind.ai)

The user wants something **inspired by** BridgeSpace but Flutter-focused.
- BridgeSpace = Tauri v2 + React 19 desktop app, multi-pane terminals, AI agent orchestration, built-in editor, command blocks, task board.
- **BridgeSwarm** is especially interesting to the user: multi-agent orchestration — builder / reviewer / scout / coordinator roles, shared mailbox, parallel work.
- BridgeSpace is paid ($20/mo). User is wondering: freemium? free? Worth monetizing?

## Key differentiator vs BridgeSpace / Cursor / Warp

**Widget-level selection from a live running app** is the novel piece. Nobody else is plugging Flutter widget context directly into an agent's prompt.

## Open questions (to work through)

- MVP scope: just the widget-pick → agent flow, or also terminals / editor / swarm?
- Which agents to support first (Claude Code only, or multi)?
- How do we get the widget tree from the running app — VM Service, DevTools protocol, or the VGV MCP `get_widget_tree` tool?
- Platform scope: Flutter targets (mobile/web/desktop emulators) — which first?
- Monetization: free, freemium, paid?

## Decisions log

- **MVP scope = C.** Widget-picker + a single embedded Claude Code / agent terminal pane. No swarm, no editor, no task board, no multi-pane terminals. The loop is: run app in embedded/attached emulator → pick widget → inject context into the one agent pane → see the edit → hot reload → verify visually. Workspace/swarm features are explicitly deferred to post-MVP.
- **Widget-tree transport = VM Service + Flutter Inspector protocol (`ext.flutter.inspector.*`).** Same mechanism DevTools uses. Zero user setup — they just run `flutter run` normally; we attach over WebSocket. The picker queries the widget tree and creation locations (file + line) directly. The embedded *agent* gets the existing `vgv-ai-flutter-plugin` MCP tools (hot_reload, get_widget_tree, analyze_files, etc.) for its own actions. No custom Dart package required.
- **License = MIT, open core.** Widget picker + single-agent pane ships under MIT from day one. Users bring their own Claude Code / Codex / OpenCode creds, so we have zero API cost. Paid pro tier (swarm, team sync, cloud context, premium skills) is a post-MVP decision and lives behind a feature flag or separate repo. The $1k marketing budget is better spent on landing-page polish and organic demo distribution (HN, Product Hunt, Flutter Weekly, a viral widget-picker GIF) than on paid ads for a niche tool.
- **Platform scope = Android emulator first.** iOS and web are trivial follow-ups because the VM Service + Inspector protocol is identical across targets; the scope cost is in docs/QA, not code. Demo video is a mobile app getting live-edited.
- **Product name = Pickforge.** Domain: `pickforge.dev` ($10-15/yr, Google-owned, HTTPS-enforced, developer-native TLD). Repo stays `vibe-flutter` for now; product/brand = Pickforge. ".ai" rejected as overkill ($80/yr for no meaningful brand benefit — AI is plumbing here, not the product identity).
- **Agent support = Claude Code + Codex + OpenCode from day one.** Architected as an `AgentProfile` abstraction (binary, invocation flags, context-file name, system-prompt flag, prefill strategy, MCP config path). One engine, three profiles. Future agents = new profile, ~days of work each.
- **Context delivery = hybrid, stdin/new-terminal first.** On widget pick, Pickforge spawns a new OS-native terminal (respecting `$TERMINAL` on Linux, `Terminal.app`/iTerm on macOS, `wt.exe` on Windows) running a generated wrapper script that: (1) cd's into the project, (2) writes a per-invocation skill + AGENTS.md/CLAUDE.md to a scoped dir, (3) invokes the chosen agent CLI with the pre-filled first message. MCP server path comes in Phase 1.5 for richer interactions (agent re-queries widget tree mid-task).
- **Skill / injected-context licensing = P1 (public skills, value is UX).** All injected skills and AGENTS.md templates live in the OSS repo under MIT. This matches how Aider, Continue.dev, and OpenCode already distribute prompt templates — nobody forks these projects just for the prompt text; the value is the integrated experience. Pickforge Pro (post-MVP) differentiates on **swarm, team sync, cloud context, priority support** — NOT on secret prompts. Community PRs to improve skills become a strength, not a leak.
- **Skill layout = small library, seeded with 3 + 1.** Not a single mega-file. The MVP ships:
  - `skills/edit-widget.md` — modify a selected widget's appearance/behavior in place.
  - `skills/extract-widget.md` — extract the selected subtree into its own widget class.
  - `skills/explain-widget.md` — describe what the selected widget does / trace its data flow.
  - `AGENTS.md` (or per-agent equivalent) — general project context (detected from `pubspec.yaml`, lint config, folder structure) plus Pickforge usage rules.
  All agent profiles point to the same skill source; per-agent templates wire them into that agent's native skill/context mechanism.
- **MVP shape = Approach A (external dock + on-device select mode).** Pickforge is a small, always-on-top Flutter desktop window that runs next to the user's Android emulator. Attaches to VM Service, flips on Flutter Inspector's "Select Widget Mode" (the same mechanism DevTools uses), user taps in the emulator, Flutter's own on-device inspector draws the highlight, Pickforge receives the selection over the Inspector protocol. Pickforge's window renders: widget tree, last-screenshot preview, selected-widget details, skill picker, "Forge it" button. No embedded emulator mirror, no custom pixel overlay, no scrcpy — those are deferred to Phase 2 ("Pickforge Pro" polish). Approach A code is a strict subset of the Approach B code, so Phase 2 adds, it doesn't rewrite.
- **Package stack (confirmed with user):**
  - Runtime: `flutter_bloc`, `bloc`, `equatable`, `freezed_annotation`, `json_annotation`, `get_it`, `injectable`, `go_router`, `drift`, `drift_flutter` (or `sqlite3_flutter_libs`), `dio`, `vm_service`, `web_socket_channel`, `window_manager`, `path_provider`, `path`, `yaml`, `shared_preferences` (thin settings only).
  - Dev: `build_runner`, `freezed`, `json_serializable`, `injectable_generator`, `drift_dev`, `mocktail`, `bloc_test`, `very_good_analysis`, `test`, `flutter_test`.
  - **DI style:** GetIt + Injectable for service/repo/bloc registration. `flutter_bloc`'s `BlocProvider` still used inside the widget tree for scoping cubits to routes; repositories are pulled from GetIt, not RepositoryProvider. This is a valid hybrid, just different from stock VGV examples.
  - **Storage:** Drift from day one (user preference). Initial schema covers `pick_history`, `project_settings`, `agent_run_log`. `shared_preferences` only for lightweight/bootstrap settings (e.g. last-used project path).
  - **Networking:** Dio is included in the stack but has **no confirmed MVP use case**. Flagged for re-evaluation — see notes. Likely first real use is update-check and (post-MVP) Pickforge Pro auth / cloud skills fetch.
- **TerminalProfile registry.** Sibling abstraction to `AgentProfile`. Bundles launcher profiles for Ghostty, iTerm2 (macOS), Warp (URL-scheme launch), WezTerm, Alacritty, Kitty, Windows Terminal, gnome-terminal, Terminal.app, plus an `$TERMINAL` fallback. On first run, Pickforge detects installed terminals and pre-selects the most capable (Ghostty > WezTerm > Alacritty > platform default). User-selectable in Settings.

- **Context injection = scoped `.pickforge/` folder, never touch user's CLAUDE.md/AGENTS.md.** Pickforge writes `.pickforge/skill-active.md`, `.pickforge/widget-context.md`, `.pickforge/screenshot.png`, `.pickforge/device-screen.png`, `.pickforge/run-log.json` to the project root. Auto-generates a `.pickforge/.gitignore` containing `*` on first run. The initial prompt to the agent tells it to `Read` these files. Agent's own `Read` tool is the uniform API; no CLI-flag variance between Claude Code / Codex / OpenCode. User's own `CLAUDE.md` / `AGENTS.md` coexist untouched and are read by the agent as normal.
- **Screenshots = dual capture on Android.** Primary: `ext.flutter.inspector.screenshot` (clean widget surface, platform-agnostic). Secondary (Android only, when `adb` is available): `adb -s <serial> exec-out screencap -p` written to `.pickforge/device-screen.png`. The adb shot shows the selection highlight box + system UI, giving the agent a "this one" visual ground-truth. Both paths sent in the prompt. iOS equivalent (`xcrun simctl io booted screenshot`) deferred per Q4.
- **Design quality is a first-class requirement, not a polish pass.** Target aesthetic is the 2026 power-user dev-tool pocket (Linear, Raycast, Arc, Cursor, Zed, Warp, Ghostty, BridgeSpace). Dark-first with chromatic accent (forge-ember orange or electric violet TBD), Liquid Glass / glassmorphism on floating panels, dense-but-breathable rhythm on an 8px grid, ~13px body, Geist/Inter for chrome + Berkeley/JetBrains Mono for code, subtle noise overlays on dark surfaces, ⌘K command palette as the primary nav, semantic (not decorative) color. No Material 3 defaults — `ThemeData` fully overridden. Motion uses spring physics, is always causally meaningful, respects OS reduce-motion, uses skeletons over spinners. Empty/waiting states animate. Hero transitions between widget picks and the details panel. All animation via `flutter_animate` + Flutter's official `animations` package + `rive` for hero brand motion (Lottie optional later). Budgeted ~2 extra weeks of polish in MVP. Design quality IS the moat for an OSS tool competing with a funded closed paid competitor — underspending here defeats the thesis.

## Explicitly deferred to Phase 2 / post-MVP

Track these so we don't forget the follow-up after the MVP ships.

- **Approach B (embedded emulator mirror + custom overlay):** scrcpy integration, DPR math, input forwarding. The "hero demo" polish version of Approach A.
- **True hover-over-the-screen UX:** currently hover works only over Pickforge's own widget-tree and screenshot panels. Real hover over the live emulator requires Approach B.
- **Target expansion beyond Android emulator:** iOS Simulator, Flutter web (Chrome), Flutter desktop targets. Code is platform-agnostic; scope cost is docs + QA + edge cases.
- **Agent expansion:** Cursor CLI, Gemini CLI, future CLIs. Each = new `AgentProfile` + test.
- **Phase 1.5 — Pickforge MCP server:** expose `get_selected_widget`, `list_pickforge_history`, `capture_screenshot` etc. so agents can re-query state mid-task (e.g., verify their own hot-reload change).
- **Pickforge Pro tier:** BridgeSwarm-style multi-agent orchestration, team sync, cloud-synced context, priority support, premium skill packs. Paid. Lives behind a feature flag or separate repo. Monetization stays open (freemium vs paid) until we have MVP users.
- **Dio wiring:** package included but unused in MVP. First likely use: update-check on startup. Post-MVP: Pro auth, cloud skill packs.
- **Auto-discovery of VM Service URL:** MVP is manual paste. Phase 2: port scan common `flutter run` ports and/or hook into `flutter daemon` for zero-setup discovery.
- **Rebuild tracking:** `ext.flutter.inspector.trackRebuildDirtyWidgets` to show "here's what changed after hot-reload" as a diff in Pickforge's UI.
- **Skill overrides + community skill packs:** `.pickforge/skills/` project-local override works day-one; a registry/market of community-contributed skills is Phase 2.
- **Telemetry + crash reports (Sentry).** Off by default, opt-in toggle.
- **Auto-updater:** Sparkle on macOS, winget/scoop on Windows, `.deb`/AppImage refresh on Linux.
- **Codesigning / notarization / distribution:** macOS notarization, Windows signing cert + SmartScreen reputation, Linux Flathub/Snap listing. Release engineering, not MVP code.
- **Widget-tree diffing between runs:** "here's what changed since the last pick" — nice polish.
- **Screenshot before/after pair sent to the agent:** MVP sends the *before* screenshot with the pick; auto-capturing an *after* screenshot post-hot-reload and re-prompting the agent with "did your change look right?" is Phase 2.
