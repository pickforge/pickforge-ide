import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

// ---- Flutter widget inspector ----
export const vmFindIsolate = () => invoke<string>("vm_find_isolate");
export const vmSetSelection = (isolateId: string, valueId: string, groupName: string) =>
  invoke<boolean>("vm_set_selection", { isolateId, valueId, groupName });
export const vmShowSelectMode = (isolateId: string, enabled: boolean) =>
  invoke<void>("vm_show_select_mode", { isolateId, enabled });
export const vmSelectedWidget = (isolateId: string, groupName: string) =>
  invoke<WidgetNode | null>("vm_selected_widget", { isolateId, groupName });
export const vmDisposeGroup = (isolateId: string, groupName: string) =>
  invoke<void>("vm_dispose_group", { isolateId, groupName });
export const vmScreenshot = (isolateId: string, valueId: string, width: number, height: number) =>
  invoke<string | null>("vm_screenshot", { isolateId, valueId, width, height });

/** One widget property (name + display value) for the details panel. */
export interface WidgetProp {
  name: string;
  value: string;
}
export const vmWidgetProperties = (isolateId: string, valueId: string, groupName: string) =>
  invoke<WidgetProp[]>("vm_widget_properties", { isolateId, valueId, groupName });

export interface InspectPaths {
  mdPath: string;
  pngPath: string | null;
}
/** Resolve (and create) the capture dir: PickForge home by default, or the
 *  project repo when repoLocal. Returns the absolute dir. */
export const inspectDir = (repoLocal: boolean, projectRoot: string) =>
  invoke<string>("inspect_dir", { repoLocal, projectRoot });

/** Write the inspector capture (context markdown + optional screenshot PNG) into
 *  `dir` (from inspectDir). Returns absolute paths. */
export const inspectSave = (
  dir: string,
  baseName: string,
  markdown: string,
  pngBase64: string | null,
) => invoke<InspectPaths>("inspect_save", { dir, baseName, markdown, pngBase64 });

/** A device tap (select mode) surfaces a source location to jump to. */
export interface VmNavigate {
  fileUri?: string;
  line?: number;
  column?: number;
}
export const onVmNavigate = (cb: (n: VmNavigate | null) => void): Promise<UnlistenFn> =>
  listen<VmNavigate | null>("vm-navigate", (e) => cb(e.payload));
/** Fires once per rendered frame — debounce before refetching the selection. */
export const onVmFrame = (cb: () => void): Promise<UnlistenFn> =>
  listen("vm-frame", () => cb());
