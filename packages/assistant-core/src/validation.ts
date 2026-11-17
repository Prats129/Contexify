import type {
  AssistantProposal,
  BrightnessAction,
  OpenApplicationAction,
  VolumeAction,
} from "./contracts";

export type AssistantAction =
  | BrightnessAction
  | OpenApplicationAction
  | VolumeAction;
export type AssistantPlatform = "web" | "android" | "ios";
export const POLICY_VERSION = 1;

function record(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype)
    throw new Error("Expected a plain data object.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    ) ||
    Object.values(descriptors).some(
      (item) => !Object.prototype.hasOwnProperty.call(item, "value"),
    ) ||
    required.some(
      (key) => !Object.prototype.hasOwnProperty.call(descriptors, key),
    )
  )
    throw new Error("Unknown or missing proposal fields.");
  return value as Record<string, unknown>;
}

/** @internal Strict plain-data checks shared by the planning wire contract. */
export { record as dataRecord };

export function validateAction(value: unknown): AssistantAction {
  const action = record(
    value,
    ["capability_id", "schema_version", "percent", "application_id"],
    ["capability_id"],
  );
  if (action.schema_version !== undefined && action.schema_version !== 1)
    throw new Error("Unsupported capability version.");
  const capability = action.capability_id;
  if (capability === "application.open") {
    record(
      value,
      ["capability_id", "schema_version", "application_id"],
      ["capability_id", "application_id"],
    );
    if (
      action.application_id !== "spotify" &&
      action.application_id !== "clock"
    )
      throw new Error("Unknown application catalog entry.");
    return {
      capability_id: capability,
      schema_version: 1,
      application_id: action.application_id,
    };
  }
  record(
    value,
    ["capability_id", "schema_version", "percent"],
    ["capability_id", "percent"],
  );
  if (capability !== "brightness.set_app" && capability !== "media_volume.set")
    throw new Error("Unregistered capability.");
  const minimum = capability === "brightness.set_app" ? 10 : 0;
  const maximum = capability === "brightness.set_app" ? 100 : 70;
  if (
    typeof action.percent !== "number" ||
    !Number.isInteger(action.percent) ||
    action.percent < minimum ||
    action.percent > maximum
  )
    throw new Error(
      `${capability === "media_volume.set" ? "Media volume" : "App brightness"} must be a whole number from ${minimum}% to ${maximum}%.`,
    );
  return {
    capability_id: capability,
    schema_version: 1,
    percent: action.percent,
  };
}

export function validateProposal(value: unknown): AssistantProposal {
  const proposal = record(
    value,
    ["protocol_version", "mode", "steps"],
    ["steps"],
  );
  if (
    (proposal.protocol_version !== undefined &&
      proposal.protocol_version !== 1) ||
    (proposal.mode !== undefined && proposal.mode !== "simulation")
  )
    throw new Error("Unsupported assistant protocol or mode.");
  if (
    !Array.isArray(proposal.steps) ||
    proposal.steps.length < 1 ||
    proposal.steps.length > 5
  )
    throw new Error("Plans require one to five steps.");
  const steps = Array.from(proposal.steps, (value, index) => {
    const step = record(value, ["action", "depends_on"], ["action"]);
    const dependencies = step.depends_on === undefined ? [] : step.depends_on;
    if (
      !Array.isArray(dependencies) ||
      dependencies.length > 4 ||
      new Set(dependencies).size !== dependencies.length ||
      Array.from(dependencies).some(
        (item) => !Number.isInteger(item) || item < 0 || item >= index,
      )
    )
      throw new Error("Invalid step dependencies.");
    return {
      action: validateAction(step.action),
      depends_on: [...dependencies] as number[],
    };
  });
  return { protocol_version: 1, mode: "simulation", steps };
}

export function supported(
  action: AssistantAction,
  platform: AssistantPlatform,
): boolean {
  if (platform !== "web" && platform !== "android" && platform !== "ios")
    return false;
  return (
    action.capability_id === "application.open" ||
    (action.capability_id === "brightness.set_app" && platform !== "web") ||
    (action.capability_id === "media_volume.set" && platform === "android")
  );
}

export interface LocalPolicyContext {
  platform: AssistantPlatform;
  foreground: boolean;
  unlocked: boolean;
  consent: boolean;
  permissionsGranted: boolean;
}

export function checkLocalPolicy(
  action: AssistantAction,
  context: LocalPolicyContext,
): void {
  validateAction(action);
  if (!supported(action, context.platform))
    throw new Error("Capability unavailable on this platform.");
  if (
    context.foreground !== true ||
    context.unlocked !== true ||
    context.consent !== true ||
    context.permissionsGranted !== true
  )
    throw new Error(
      "Current foreground, unlock, consent and permission checks are required.",
    );
}
