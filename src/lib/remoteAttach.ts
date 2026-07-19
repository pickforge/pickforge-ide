// Headless state machine for the per-project remote-host attach panel. Keeps the
// component thin and the async flow unit-testable at the remoteHost.ts boundary:
// attach verifies via projectRemoteSet (its rejection surfaces inline), detach
// clears the binding, and a test connection runs remoteHostHealth for the three
// probe rows.
import { createSignal, type Accessor } from "solid-js";
import { errorText } from "./errors";
import {
  projectRemoteClear,
  projectRemoteSet,
  remoteHostHealth,
  type RemoteHostHealth,
} from "./remoteHost";

export type AttachState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string };

// running/done pin the host captured when the probe started, so the result is
// always cached and rendered under the host that was actually probed — even if
// the input is edited mid-flight.
export type TestState =
  | { kind: "idle" }
  | { kind: "running"; host: string }
  | { kind: "done"; host: string; health: RemoteHostHealth }
  | { kind: "error"; message: string };

export interface TestResult {
  host: string;
  health: RemoteHostHealth;
}

export interface RemoteAttach {
  attach: Accessor<AttachState>;
  test: Accessor<TestState>;
  doAttach: (host: string, remoteRoot: string) => Promise<boolean>;
  doDetach: () => Promise<boolean>;
  runTest: (host: string) => Promise<TestResult | null>;
  clearAttachError: () => void;
  resetTest: () => void;
}

export function createRemoteAttach(projectRoot: () => string): RemoteAttach {
  const [attach, setAttach] = createSignal<AttachState>({ kind: "idle" });
  const [test, setTest] = createSignal<TestState>({ kind: "idle" });

  const doAttach = async (host: string, remoteRoot: string): Promise<boolean> => {
    if (attach().kind === "busy") return false;
    const h = host.trim();
    const r = remoteRoot.trim();
    if (!h || !r) {
      setAttach({ kind: "error", message: "Host and remote root are required." });
      return false;
    }
    setAttach({ kind: "busy" });
    try {
      await projectRemoteSet(projectRoot(), h, r);
      setAttach({ kind: "idle" });
      return true;
    } catch (e) {
      setAttach({ kind: "error", message: errorText(e) });
      return false;
    }
  };

  const doDetach = async (): Promise<boolean> => {
    if (attach().kind === "busy") return false;
    setAttach({ kind: "busy" });
    try {
      await projectRemoteClear(projectRoot());
      setAttach({ kind: "idle" });
      return true;
    } catch (e) {
      setAttach({ kind: "error", message: errorText(e) });
      return false;
    }
  };

  const runTest = async (host: string): Promise<TestResult | null> => {
    if (test().kind === "running") return null;
    const h = host.trim();
    if (!h) {
      setTest({ kind: "error", message: "Enter a host first." });
      return null;
    }
    setTest({ kind: "running", host: h });
    try {
      const health = await remoteHostHealth(h);
      setTest({ kind: "done", host: h, health });
      return { host: h, health };
    } catch (e) {
      setTest({ kind: "error", message: errorText(e) });
      return null;
    }
  };

  return {
    attach,
    test,
    doAttach,
    doDetach,
    runTest,
    // Only dismisses an inline error — must never knock an in-flight
    // attach/detach out of busy (that would re-enable the buttons mid-request).
    clearAttachError: () =>
      setAttach((a) => (a.kind === "error" ? { kind: "idle" } : a)),
    resetTest: () => setTest({ kind: "idle" }),
  };
}
