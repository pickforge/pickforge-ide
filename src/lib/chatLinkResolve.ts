// Tauri IPC wrapper for the Rust trust boundary a workspace citation must
// cross before it is ever opened (#234): `resolve_chat_citation` canonicalizes
// `path` against the chat's OWN `projectRoot` (not the general approved-roots
// registry) and returns the resolved file only if it's an existing regular
// file contained inside that exact root. `src/lib/chatLinkTarget.ts` classifies
// syntax; this is the only place that turns a classified citation into a real,
// safe-to-open filesystem path — never call `invoke("resolve_chat_citation", ...)`
// directly from a component.
import { invoke } from "@tauri-apps/api/core";

export function resolveWorkspaceCitation(projectRoot: string, path: string): Promise<string> {
  return invoke<string>("resolve_chat_citation", { projectRoot, path });
}
