// Ember talk-back's spoken-form template: a pure function mapping operator
// route/dispatch outcomes to a literal spoken string. No #189 persona copy
// yet — these strings are deliberately plain and swappable once that lands.
//
// The safe-action gate lives here too: a `dispatch` outcome only speaks when
// its action's risk tier is 0 (safe/read-only, per operatorIntent's existing
// `riskTier` classification — never reimplemented). Tier-1 actions (spend,
// file-write, run, git, PR, delete) and anything still needing on-screen
// confirmation return null — screen-gate only, by construction, regardless
// of who calls this.
import type { DispatchResult } from "../stores/operator";
import type { RouteOutcome } from "./operatorRouter";

export type SpokenFormInput =
  | { kind: "dispatch"; result: DispatchResult; riskTier: 0 | 1 }
  | Extract<RouteOutcome, { kind: "unclear" }>
  | Extract<RouteOutcome, { kind: "error" }>
  | Extract<RouteOutcome, { kind: "needsCredits" }>
  | Extract<RouteOutcome, { kind: "unconfigured" }>;

function dispatchSpokenForm(result: DispatchResult): string | null {
  switch (result.status) {
    case "done":
    case "noop":
      return result.summary;
    case "denied":
      return `Cancelled. ${result.message}`;
    case "failed":
      return `That failed. ${result.message}`;
    case "unsupported":
      return `I can't do that. ${result.message}`;
    case "needsConfirmation":
      // Always on-screen, safe action or not — never reached via the
      // gated call sites, but returning null here keeps this function
      // correct standalone.
      return null;
  }
}

export function spokenForm(input: SpokenFormInput): string | null {
  switch (input.kind) {
    case "dispatch":
      return input.riskTier === 0 ? dispatchSpokenForm(input.result) : null;
    case "unclear":
      return `I didn't catch that. ${input.reason}`;
    case "error":
      return `Something went wrong. ${input.message}`;
    case "needsCredits":
      return "You're out of routing credits.";
    case "unconfigured":
      return "The operator router isn't set up.";
  }
}
