import {
  reviewedPercent,
  type ReviewedCommand,
} from "@contexify/assistant-core";
import { percentControlResult } from "./assistant_device_controls";
import type { PercentExecutionResult } from "../../modules/assistant-device-security";

export function reviewedBrightnessPercent(
  review: ReviewedCommand | null | undefined,
): number | null {
  return reviewedPercent(review, "brightness.set_app");
}

export function brightnessResult(
  value: unknown,
  percent: number,
): PercentExecutionResult {
  return percentControlResult(value, percent, true);
}

export function describeBrightnessResult(
  result: PercentExecutionResult,
): string {
  if (result.outcome === "cancelled")
    return "App-window brightness change cancelled.";
  if (result.outcome === "outcome_unknown")
    return "The app-window brightness outcome is uncertain. Review the app before trying again.";
  if (result.outcome === "failed")
    return "Contexify's app-window brightness could not be verified.";
  return (
    `Contexify app-window brightness verified at ${result.observed_percent}%. This verifies the window setting, not measured display luminance. The previous setting returns when Contexify goes into the background.` +
    (result.receipt_recorded
      ? ""
      : " Server receipt unavailable; do not retry automatically.")
  );
}
