import { invoke } from "@tauri-apps/api/core";

export interface WidgetNode {
  id: string;
  className: string;
  children: WidgetNode[];
  creationLocation: { file: string; line: number; column: number } | null;
}

export const vmConnect = (url: string) => invoke<void>("vm_connect", { url });
export const vmDisconnect = () => invoke<void>("vm_disconnect");
export const vmStatus = () => invoke<string | null>("vm_status");
export const vmGetVm = () => invoke<unknown>("vm_get_vm");
export const vmWidgetTree = (isolateId: string, groupName: string) =>
  invoke<WidgetNode>("vm_widget_tree", { isolateId, groupName });
