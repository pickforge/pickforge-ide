// Minimal hash-based router (back/forward work via the address hash).
import { createSignal } from "solid-js";

export type Route =
  | "workbench"
  | "history"
  | "run-history"
  | "settings"
  | "onboarding";

const ROUTES: Route[] = [
  "workbench",
  "history",
  "run-history",
  "settings",
  "onboarding",
];

function fromHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.includes(h) ? h : "workbench";
}

const [route, setRouteSignal] = createSignal<Route>(fromHash());
window.addEventListener("hashchange", () => setRouteSignal(fromHash()));

export { route };

export function navigate(r: Route) {
  if (window.location.hash !== `#/${r}`) {
    window.location.hash = `/${r}`;
  }
  setRouteSignal(r);
}
