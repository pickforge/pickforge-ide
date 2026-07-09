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
window.addEventListener("hashchange", () => applyRoute(fromHash()));

export { route };

// Imperative subscription for module-scope stores that must react to route
// changes outside a reactive root (solid effects don't run there in tests).
type RouteListener = (r: Route) => void;
const listeners = new Set<RouteListener>();

export function onRouteChange(listener: RouteListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyRoute(r: Route) {
  const changed = r !== route();
  setRouteSignal(r);
  if (changed) for (const listener of listeners) listener(r);
}

export function navigate(r: Route) {
  if (window.location.hash !== `#/${r}`) {
    window.location.hash = `/${r}`;
  }
  applyRoute(r);
}
