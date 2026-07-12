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

function fromHash(): { route: Route; section: string | null } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/");
  const [routePart, section = null] = parts;
  const isSettingsHash = routePart === "settings" && parts.length <= 2;
  const route = (isSettingsHash || parts.length === 1 ? routePart : hash) as Route;
  let decodedSection = section;
  if (isSettingsHash && section) {
    try {
      decodedSection = decodeURIComponent(section);
    } catch {
      // Keep malformed explicit sections invalid without breaking routing.
    }
  }
  return {
    route: ROUTES.includes(route) ? route : "workbench",
    section: isSettingsHash && decodedSection ? decodedSection : null,
  };
}

const initialLocation = fromHash();
const [route, setRouteSignal] = createSignal<Route>(initialLocation.route);
const [settingsSection, setSettingsSection] = createSignal<string | null>(
  initialLocation.section,
);
window.addEventListener("hashchange", () => applyLocation(fromHash()));

export { route, settingsSection };

// Imperative subscription for module-scope stores that must react to route
// changes outside a reactive root (solid effects don't run there in tests).
type RouteListener = (r: Route) => void;
const listeners = new Set<RouteListener>();

export function onRouteChange(listener: RouteListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyLocation(location: { route: Route; section: string | null }) {
  const changed = location.route !== route();
  setRouteSignal(location.route);
  setSettingsSection(location.section);
  if (changed) for (const listener of listeners) listener(location.route);
}

export function navigate(r: Route) {
  if (window.location.hash !== `#/${r}`) {
    window.location.hash = `/${r}`;
  }
  applyLocation({ route: r, section: null });
}

export function navigateSettingsSection(section: string, options?: { replace?: boolean }) {
  const hash = `#/settings/${encodeURIComponent(section)}`;
  if (window.location.hash !== hash) {
    if (options?.replace) {
      window.history.replaceState(null, "", hash);
    } else {
      window.location.hash = `/settings/${encodeURIComponent(section)}`;
    }
  }
  applyLocation({ route: "settings", section });
}
