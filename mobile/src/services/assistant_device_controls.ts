import type { PercentExecutionResult } from "../../modules/assistant-device-security";
import type { PlanningAccess } from "@contexify/assistant-core";

export interface DeviceControls {
  readVolumeContext?(userId: string, signal: AbortSignal): Promise<unknown>;
  changeVolumeFromContext?(
    userId: string,
    percent: number,
    contextId: string,
  ): Promise<PercentExecutionResult>;
  planningContext?: PlanningAccess["planningContext"];
  enableVolume(userId: string): Promise<void>;
  changeVolume(
    userId: string,
    percent: number,
  ): Promise<PercentExecutionResult>;
  enableBrightness?(userId: string): Promise<void>;
  changeBrightness?(
    userId: string,
    percent: number,
  ): Promise<PercentExecutionResult>;
  cancel(): void;
}

export function percentControlResult(
  value: unknown,
  percent: number,
  exact = false,
): PercentExecutionResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid device-control result.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw Error("Invalid device-control result.");
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = [
    "outcome",
    "requested_percent",
    "observed_percent",
    "receipt_recorded",
  ];
  if (
    Reflect.ownKeys(fields).length !== keys.length ||
    keys.some((key) => !fields[key] || !("value" in fields[key]))
  )
    throw Error("Invalid device-control result.");
  const data = Object.fromEntries(keys.map((key) => [key, fields[key].value]));
  if (
    !["verified", "failed", "outcome_unknown", "cancelled"].includes(
      data.outcome,
    ) ||
    data.requested_percent !== percent ||
    typeof data.receipt_recorded !== "boolean" ||
    (data.observed_percent !== null &&
      (!Number.isInteger(data.observed_percent) ||
        data.observed_percent < 0 ||
        data.observed_percent > 100)) ||
    (data.outcome === "verified" &&
      (data.observed_percent === null ||
        data.observed_percent > percent ||
        (exact && data.observed_percent !== percent))) ||
    (data.receipt_recorded && data.outcome === "cancelled")
  )
    throw Error("Invalid device-control result.");
  return data as unknown as PercentExecutionResult;
}
