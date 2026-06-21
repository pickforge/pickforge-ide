// Chrome DevTools Protocol bridge for the web inspector. Mirrors lib/vm.ts: thin
// invoke() wrappers over the cdp_* Tauri commands. The flow is best-effort — a
// web dev server must be running under a Chromium-based browser with the
// debugger exposed (e.g. `--remote-debugging-port=9222`); when nothing is
// reachable the commands error and the UI shows an honest empty state.
import { invoke } from "@tauri-apps/api/core";

/** A discovered CDP page target (mirrors `CdpTarget` in crates/.../cdp.rs). */
export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/** A DOM node distilled from `DOM.getDocument` (mirrors `DomNode` in cdp.rs). */
export interface DomNode {
  nodeId: string;
  backendNodeId: string;
  tag: string;
  id: string | null;
  class: string | null;
  /** A framework-injected source attribute (`data-*`), if present. */
  sourceAttr: string | null;
  text: string | null;
  children: DomNode[];
}

/** An authored source position (mirrors `SourceMapping` in source_map.rs). */
export interface SourceMapping {
  source: string;
  line: number;
  column: number;
  name: string | null;
}

/** Discover the debuggable pages on a dev server's debugger host:port. An empty
 *  list (or a thrown error) means "no dev server reachable". */
export const cdpDiscover = (host: string, port: number) =>
  invoke<CdpTarget[]>("cdp_discover", { host, port });

export const cdpAttach = (wsUrl: string) => invoke<void>("cdp_attach", { wsUrl });
export const cdpDetach = () => invoke<void>("cdp_detach");
export const cdpStatus = () => invoke<string | null>("cdp_status");
export const cdpDomTree = () => invoke<DomNode | null>("cdp_dom_tree");

/** Map a generated line/col (zero-based) to authored source, given the script's
 *  source map JSON. `null` when unmapped or the map is malformed. */
export const cdpMapSource = (mapJson: string, line: number, column: number) =>
  invoke<SourceMapping | null>("cdp_map_source", { mapJson, line, column });

/** Fetch a script's `.map` from the dev server (best-effort). */
export const cdpFetchSourceMap = (host: string, port: number, mapPath: string) =>
  invoke<string>("cdp_fetch_source_map", { host, port, mapPath });
