import { invoke } from "@tauri-apps/api/core";

// Persistent Linux graphics compatibility mode (#238). Linux-only: these
// commands don't exist in non-Linux builds, so they must only ever be called
// after checking `hostPlatform() === "linux"`.

export type LinuxGraphicsMode = "auto" | "compatibility" | "native-wayland";

export interface LinuxGraphicsConfig {
  mode: LinuxGraphicsMode;
  recommendation_dismissed: boolean;
}

export const linuxGraphicsGet = () => invoke<LinuxGraphicsConfig>("linux_graphics_get");

export const linuxGraphicsSet = (mode: LinuxGraphicsMode) =>
  invoke<void>("linux_graphics_set", { mode });

/** The mode actually applied at process boot — independent of any Settings
 * edit made since. Compare against the live selection to know whether a
 * restart is still actually required. */
export const linuxGraphicsBootModeGet = () =>
  invoke<LinuxGraphicsMode>("linux_graphics_boot_mode_get");

export const linuxGraphicsRecommendationGet = () =>
  invoke<boolean>("linux_graphics_recommendation_get");

export const linuxGraphicsRecommendationDismiss = () =>
  invoke<void>("linux_graphics_recommendation_dismiss");
