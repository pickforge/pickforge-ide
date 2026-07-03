import { createSignal } from "solid-js";
import { selectedLanes } from "./orchestra";
import { workspace } from "./workspace";

const [open, setOpen] = createSignal(false);

export const orchestraOpen = open;

export function setOrchestraOpen(next: boolean) {
  setOpen(next);
}

export function stagedChatIds(): string[] {
  // Staged lanes are only visible for the active project root.
  return orchestraOpen() && workspace.activeRoot ? selectedLanes(workspace.activeRoot) : [];
}

export function isChatStaged(chatId: string): boolean {
  return stagedChatIds().includes(chatId);
}
