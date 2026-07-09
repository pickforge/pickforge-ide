import { z } from "zod";

const optionalString = z.string().nullable().default(null);
const nonEmptyString = z.string().min(1);
const agentProviderSchema = z.union([z.literal("claude"), z.literal("codex")]);
const swarmModeSchema = z.union([z.literal("scout"), z.literal("review")]);
const swarmProviderSchema = z.union([
  z.literal("claude"),
  z.literal("codex"),
  z.literal("mixed"),
]);

const openProjectSchema = z.strictObject({
  action: z.literal("openProject"),
});

const openChatSchema = z.strictObject({
  action: z.literal("openChat"),
  chat: optionalString,
});

const createChatSchema = z.strictObject({
  action: z.literal("createChat"),
  provider: agentProviderSchema,
  model: optionalString,
});

const sendPromptSchema = z.strictObject({
  action: z.literal("sendPrompt"),
  prompt: nonEmptyString,
  chat: optionalString,
});

const startSwarmSchema = z.strictObject({
  action: z.literal("startSwarm"),
  mode: swarmModeSchema,
  count: z.int().min(1).max(5),
  goal: nonEmptyString,
  provider: swarmProviderSchema,
});

const swarmStatusSchema = z.strictObject({
  action: z.literal("swarmStatus"),
});

const interruptRunSchema = z.strictObject({
  action: z.literal("interruptRun"),
  run: optionalString,
});

const steerRunSchema = z.strictObject({
  action: z.literal("steerRun"),
  run: optionalString,
  instruction: nonEmptyString,
});

const launchEmulatorSchema = z.strictObject({
  action: z.literal("launchEmulator"),
  device: optionalString,
});

const launchRunSchema = z.strictObject({
  action: z.literal("launchRun"),
  target: optionalString,
});

const reloadRunSchema = z.strictObject({
  action: z.literal("reloadRun"),
});

const stopRunSchema = z.strictObject({
  action: z.literal("stopRun"),
});

const hotRestartSchema = z.strictObject({
  action: z.literal("hotRestart"),
});

const enterSelectModeSchema = z.strictObject({
  action: z.literal("enterSelectMode"),
});

const takeScreenshotSchema = z.strictObject({
  action: z.literal("takeScreenshot"),
});

const selectWidgetSchema = z.strictObject({
  action: z.literal("selectWidget"),
  description: nonEmptyString,
});

const operatorActionSchema = z.discriminatedUnion("action", [
  openProjectSchema,
  openChatSchema,
  createChatSchema,
  sendPromptSchema,
  startSwarmSchema,
  swarmStatusSchema,
  interruptRunSchema,
  steerRunSchema,
  launchEmulatorSchema,
  launchRunSchema,
  reloadRunSchema,
  stopRunSchema,
  hotRestartSchema,
  enterSelectModeSchema,
  takeScreenshotSchema,
  selectWidgetSchema,
]);

const legacyOperatorActionSchema = z.discriminatedUnion("action", [
  openProjectSchema,
  openChatSchema,
  createChatSchema,
  sendPromptSchema,
  startSwarmSchema,
  swarmStatusSchema,
  interruptRunSchema,
  steerRunSchema,
  launchEmulatorSchema,
  launchRunSchema,
  reloadRunSchema,
  enterSelectModeSchema,
  takeScreenshotSchema,
  selectWidgetSchema,
]);

export const operatorIntentSchema = z.strictObject({
  v: z.literal(2),
  id: nonEmptyString,
  provenance: z.union([z.literal("typed"), z.literal("voice")]),
  confidence: z.number().min(0).max(1),
  projectRef: optionalString,
  action: operatorActionSchema,
});

const legacyOperatorIntentSchema = z.strictObject({
  v: z.literal(1),
  id: nonEmptyString,
  provenance: z.union([z.literal("typed"), z.literal("voice")]),
  confidence: z.number().min(0).max(1),
  projectRef: optionalString,
  action: legacyOperatorActionSchema,
});

export type OperatorIntent = z.infer<typeof operatorIntentSchema>;
export type OperatorAction = z.infer<typeof operatorActionSchema>;

export type OperatorIntentParseResult =
  | { ok: true; intent: OperatorIntent }
  | { ok: false; error: string };

/**
 * Validates a locally composed or stored intent, never raw router output; routers
 * may only propose `{action, confidence}` before the composer stamps the envelope.
 */
export function parseOperatorIntent(json: string): OperatorIntentParseResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const version = z.object({ v: z.int() }).safeParse(value);
  if (!version.success) {
    return { ok: false, error: version.error.message };
  }

  if (version.data.v === 1) {
    const legacy = legacyOperatorIntentSchema.safeParse(value);
    if (!legacy.success) {
      return { ok: false, error: legacy.error.message };
    }
    return { ok: true, intent: { ...legacy.data, v: 2 } };
  }

  const parsed = operatorIntentSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  return { ok: true, intent: parsed.data };
}

export function riskTier(action: OperatorAction): 0 | 1 {
  switch (action.action) {
    case "openProject":
    case "openChat":
    case "swarmStatus":
    case "launchEmulator":
    case "launchRun":
    case "reloadRun":
    case "stopRun":
    case "hotRestart":
    case "enterSelectMode":
    case "takeScreenshot":
    case "selectWidget":
      return 0;
    case "createChat":
    case "sendPrompt":
    case "startSwarm":
    case "interruptRun":
    case "steerRun":
      return 1;
  }

  const exhaustive: never = action;
  return exhaustive;
}
