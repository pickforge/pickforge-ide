// Shared registry of mounted chat terminal hosts, so views outside the
// workbench center (e.g. the Inspector's "send widget to AI") can open a new
// pane in the active chat. The workbench registers/clears handles here.
import type { TerminalHostHandle } from "../components/TerminalHost";

const hosts = new Map<string, TerminalHostHandle>();

export function setTerminalHost(chatId: string, handle: TerminalHostHandle) {
  hosts.set(chatId, handle);
}

export function deleteTerminalHost(chatId: string) {
  hosts.delete(chatId);
}

export function getTerminalHost(chatId: string | null | undefined): TerminalHostHandle | undefined {
  return chatId ? hosts.get(chatId) : undefined;
}
