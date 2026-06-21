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

/** Parse a `file:line[:col]` source string into its parts. Lines/cols are
 *  one-based in the framework attribute; the source-map decoder is zero-based,
 *  so the caller adjusts. `null` when there is no usable `file:line`. */
function parseGeneratedPos(raw: string): { file: string; line: number; column: number } | null {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(raw.trim());
  if (!m) return null;
  const line = Number(m[2]);
  if (!Number.isFinite(line)) return null;
  return { file: m[1], line, column: m[3] ? Number(m[3]) : 0 };
}

/** Resolve a framework source attribute (a generated `file:line:col`) to the
 *  authored position through the page's source map, returning `file:line`.
 *
 *  Many bundlers emit a `data-*` source attribute pointing at the *generated*
 *  (bundled / transpiled) file, with a `<file>.map` sidecar that carries the
 *  authored location. This fetches that map and maps the position back so the
 *  forge records the authored `file:line`, not the build artifact. Best-effort:
 *  any failure (no `.map`, malformed, unmapped) returns `null` and the caller
 *  keeps the raw attribute. */
export async function cdpResolveSource(
  host: string,
  port: number,
  sourceAttr: string,
): Promise<string | null> {
  const pos = parseGeneratedPos(sourceAttr);
  if (!pos) return null;
  // Only attempt when the position points at a generated artifact that plausibly
  // has a source map (a fetchable path with an extension). Authored TS/JSX paths
  // a plugin already resolved have no sidecar `.map` and are left untouched.
  if (!/\.[cm]?[jt]sx?$/i.test(pos.file)) return null;
  let mapJson: string;
  try {
    mapJson = await cdpFetchSourceMap(host, port, `${pos.file}.map`);
  } catch {
    return null;
  }
  // The decoder is zero-based; the attribute is one-based.
  const line = Math.max(0, pos.line - 1);
  const column = Math.max(0, pos.column - (pos.column > 0 ? 1 : 0));
  const mapped = await cdpMapSource(mapJson, line, column).catch(() => null);
  if (!mapped) return null;
  // Re-base to one-based for display / recording parity with the attribute.
  return `${mapped.source}:${mapped.line + 1}`;
}
