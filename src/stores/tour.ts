// First-run coach-marks tour state. `pickforge.tourDone` in localStorage gates
// the one-time auto-start; the pure step math is unit-tested. Steps target
// elements by a `data-tour` attribute — a null target renders the card centered
// with no spotlight.
import { createSignal } from "solid-js";

const KEY = "pickforge.tourDone";

export interface TourStep {
  target: string | null;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "projects",
    title: "Your projects",
    body: "Add a folder, then select it to open a workspace. Each project keeps its own chats nested underneath.",
  },
  {
    target: "new-chat",
    title: "Start a chat",
    body: "The + opens a picker — a Terminal chat for a raw shell, or an Agent chat driving Claude Code (CC) or Codex (CX).",
  },
  {
    target: "chat",
    title: "The agent surface",
    body: "Agent chats surface approvals, running cost and a context meter. Steer the run from the composer at the bottom.",
  },
  {
    target: "orchestra",
    title: "Orchestrate lanes",
    body: "Open Orchestra to run several agent lanes across one project and hand work off between them.",
  },
  {
    target: "settings",
    title: "Make it yours",
    body: "Set your default chat kind, agent engine and models in Settings. You can replay this tour there anytime.",
  },
];

export function clampStep(i: number): number {
  return Math.max(0, Math.min(TOUR_STEPS.length - 1, i));
}

export function tourSeen(): boolean {
  if (import.meta.env.VITE_PICKFORGE_VRT === "1") return true;
  return localStorage.getItem(KEY) === "true";
}

export function markTourDone() {
  localStorage.setItem(KEY, "true");
}

const [active, setActive] = createSignal(false);
export const tourActive = active;
const [step, setStep] = createSignal(0);
export const tourStep = step;

export function startTour() {
  setStep(0);
  setActive(true);
}

export function endTour() {
  setActive(false);
  markTourDone();
}

export function tourNext() {
  if (step() >= TOUR_STEPS.length - 1) {
    endTour();
    return;
  }
  setStep(clampStep(step() + 1));
}

export function tourPrev() {
  setStep(clampStep(step() - 1));
}
