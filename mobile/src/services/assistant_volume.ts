import {
  reviewedPercent,
  type ReviewedCommand,
} from "@contexify/assistant-core";
import type { VolumeExecutionResult } from "../../modules/assistant-device-security";

/** A multi-step preview must never silently execute just its first action. */
export function reviewedVolumePercent(
  review: ReviewedCommand | null | undefined,
): number | null {
  return reviewedPercent(review, "media_volume.set");
}

export { percentControlResult as volumeResult } from "./assistant_device_controls";

export function describeVolumeResult(result: VolumeExecutionResult): string {
  if (result.outcome === "cancelled") return "Volume change cancelled.";
  if (result.outcome === "outcome_unknown")
    return "The volume outcome is uncertain. Check your phone's media volume before trying again.";
  if (result.outcome === "failed")
    return "The requested volume could not be verified. Android may restrict this change. Check media volume before trying again.";
  return (
    `Media volume verified at ${result.observed_percent}% (requested ${result.requested_percent}%; Android uses volume steps).` +
    (result.receipt_recorded
      ? ""
      : " Server receipt unavailable; the phone verified this result. Do not retry automatically.")
  );
}
