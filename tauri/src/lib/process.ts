import { invoke } from "@tauri-apps/api/core";

/** Returns, for each name, whether it resolves on the login-shell PATH. */
export function detectBinaries(names: string[]): Promise<boolean[]> {
  return invoke<boolean[]>("detect_binaries", { names });
}
