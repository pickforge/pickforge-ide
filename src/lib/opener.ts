// Open a path with the OS default handler (the user's default editor).
import { invoke } from "@tauri-apps/api/core";

export const openPathSystem = (path: string) => invoke<void>("open_path", { path });

/// Open the native directory picker from the Rust side and register the chosen
/// directory as an approved filesystem root server-side. Returns the picked path,
/// or null if the user cancelled. Use this (not the JS dialog `open`) for the
/// add-project flow so the renderer can't approve an arbitrary root.
export const pickProjectDir = () => invoke<string | null>("pick_project_dir");
