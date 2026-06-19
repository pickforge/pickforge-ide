// Open a path with the OS default handler (the user's default editor).
import { invoke } from "@tauri-apps/api/core";

export const openPathSystem = (path: string) => invoke<void>("open_path", { path });
