import { createSignal, onMount } from "solid-js";
import {
  TerminalHost,
  type TerminalHostHandle,
} from "./components/TerminalHost";
import { Chip, MonoEyebrow, StatusPill } from "./components/ui";
import { detectBinaries } from "./lib/process";
import "./App.css";

// Phase 0/1 quick-launch set. Shell-first: each chip just *types* the command
// into the focused shell (no auto-execute), mirroring the Flutter chips.
const QUICK_LAUNCH: { label: string; command: string; ember?: boolean }[] = [
  { label: "claude", command: "claude ", ember: true },
  { label: "codex", command: "codex " },
  { label: "flutter doctor", command: "flutter doctor " },
  { label: "adb devices", command: "adb devices " },
];

export function App() {
  const [host, setHost] = createSignal<TerminalHostHandle | null>(null);
  // Availability per chip; optimistically true until detection resolves.
  const [available, setAvailable] = createSignal<boolean[]>(
    QUICK_LAUNCH.map(() => true),
  );

  onMount(async () => {
    try {
      const binaries = QUICK_LAUNCH.map((i) => i.command.trim().split(/\s+/)[0]);
      setAvailable(await detectBinaries(binaries));
    } catch (err) {
      console.error("[pickforge] detect_binaries failed", err);
    }
  });

  return (
    <div class="pf-app">
      <header class="pf-header">
        <div class="pf-brand">
          <span class="pf-mark" />
          <span class="pf-wordmark">PickForge</span>
          <MonoEyebrow text="Tauri" />
        </div>
        <StatusPill label="shell · live" intent="live" pulsing />
      </header>

      <div class="pf-launch">
        <MonoEyebrow text="Quick launch" tick />
        <div class="pf-chips">
          {QUICK_LAUNCH.map((item, idx) => (
            <Chip
              label={item.label}
              ember={item.ember}
              disabled={available()[idx] === false}
              onClick={() => host()?.typeToFocused(item.command)}
            />
          ))}
        </div>
      </div>

      <main class="pf-main">
        <TerminalHost onReady={setHost} />
      </main>
    </div>
  );
}
