import { invoke } from "@tauri-apps/api/core";
import { hostPlatform } from "./platform";

function titlebarHeight(): number | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--pf-titlebar-h");
  const height = Number.parseFloat(value);
  return Number.isFinite(height) && height > 0 ? height : undefined;
}

export async function applyTrafficLightBarHeight(zoom: number): Promise<void> {
  if (hostPlatform() !== "macos") return;
  const height = titlebarHeight();
  if (height === undefined) return;
  try {
    await invoke("set_traffic_light_bar_height", { barHeight: height * zoom });
  } catch (error) {
    console.debug("[pickforge] traffic-light positioning unavailable", error);
  }
}
