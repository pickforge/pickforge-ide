/* @refresh reload */
import { render } from "solid-js/web";
import "./styles/global.css";
import { installTauriMock } from "./lib/tauriMock";
import { installStudioUpdateFixture } from "./lib/studioUpdateFixture";
import { installFlatChatListFixture } from "./lib/flatChatListFixture";
import { App } from "./App";

// VRT builds (VITE_PICKFORGE_VRT=1) stub the Tauri runtime so the app renders
// in a plain browser. No-op (and unused) in the shipped app.
if (import.meta.env.VITE_PICKFORGE_VRT) {
  installTauriMock();
  installStudioUpdateFixture();
  installFlatChatListFixture();
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root element");
}
render(() => <App />, root);
