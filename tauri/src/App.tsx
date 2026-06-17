import { createSignal } from "solid-js";
import { TerminalPane, type TerminalHandle } from "./components/Terminal";
import { Chip, MonoEyebrow, StatusPill } from "./components/ui";
import "./App.css";

// Phase 0 quick-launch set. Shell-first: each chip just *types* the command
// into the focused shell (no auto-execute), mirroring the Flutter chips.
const QUICK_LAUNCH: { label: string; command: string; ember?: boolean }[] = [
  { label: "claude", command: "claude ", ember: true },
  { label: "codex", command: "codex " },
  { label: "flutter doctor", command: "flutter doctor " },
  { label: "adb devices", command: "adb devices " },
];

export function App() {
  const [handle, setHandle] = createSignal<TerminalHandle | null>(null);
  const [exited, setExited] = createSignal(false);

  return (
    <div class="pf-app">
      <header class="pf-header">
        <div class="pf-brand">
          <span class="pf-mark" />
          <span class="pf-wordmark">PickForge</span>
          <MonoEyebrow text="Tauri" />
        </div>
        <StatusPill
          label={exited() ? "shell · exited" : "shell · live"}
          intent={exited() ? "neutral" : "live"}
          pulsing={!exited()}
        />
      </header>

      <div class="pf-launch">
        <MonoEyebrow text="Quick launch" tick />
        <div class="pf-chips">
          {QUICK_LAUNCH.map((item) => (
            <Chip
              label={item.label}
              ember={item.ember}
              disabled={exited()}
              onClick={() => handle()?.typeText(item.command)}
            />
          ))}
        </div>
      </div>

      <main class="pf-main">
        <div class="pf-forge-frame">
          <div class="pf-forge-inner">
            <TerminalPane
              onReady={setHandle}
              onExit={() => setExited(true)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
