// Headless state machine for the per-project remote-host attach panel. Keeps the
// component thin and the async flow unit-testable at the remoteHost.ts boundary:
// attach verifies via projectRemoteSet (its rejection surfaces inline), detach
// clears the binding, and a test connection runs remoteHostHealth for the three
// probe rows.
import { createSignal, type Accessor } from "solid-js";
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

export type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; health: RemoteHostHealth }
  | { kind: "error"; message: string };

function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface RemoteAttach {
  attach: Accessor<AttachState>;
  test: Accessor<TestState>;
  doAttach: (host: string, remoteRoot: string) => Promise<boolean>;
  doDetach: () => Promise<boolean>;
  runTest: (host: string) => Promise<RemoteHostHealth | null>;
  clearAttachError: () => void;
  resetTest: () => void;
}

export function createRemoteAttach(projectRoot: () => string): RemoteAttach {
  const [attach, setAttach] = createSignal<AttachState>({ kind: "idle" });
  const [test, setTest] = createSignal<TestState>({ kind: "idle" });

  const doAttach = async (host: string, remoteRoot: string): Promise<boolean> => {
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
      setAttach({ kind: "error", message: errText(e) });
      return false;
    }
  };

  const doDetach = async (): Promise<boolean> => {
    setAttach({ kind: "busy" });
    try {
      await projectRemoteClear(projectRoot());
      setAttach({ kind: "idle" });
      return true;
    } catch (e) {
      setAttach({ kind: "error", message: errText(e) });
      return false;
    }
  };

  const runTest = async (host: string): Promise<RemoteHostHealth | null> => {
    const h = host.trim();
    if (!h) {
      setTest({ kind: "error", message: "Enter a host first." });
      return null;
    }
    setTest({ kind: "running" });
    try {
      const health = await remoteHostHealth(h);
      setTest({ kind: "done", health });
      return health;
    } catch (e) {
      setTest({ kind: "error", message: errText(e) });
      return null;
    }
  };

  return {
    attach,
    test,
    doAttach,
    doDetach,
    runTest,
    clearAttachError: () => setAttach({ kind: "idle" }),
    resetTest: () => setTest({ kind: "idle" }),
  };
}
