import {
  PlanningError,
  reviewedCommand,
  type ReviewedCommand,
} from "./planning";
import { dataRecord, validateAction } from "./validation";

export type PercentTarget = "media_volume.set" | "brightness.set_app";
export interface ClarificationAnswer {
  capability_id: PercentTarget;
  operation: "set" | "increase" | "decrease";
  amount: number;
  unit: "percent" | "percentage_points";
}
export interface PendingClarification {
  readonly id: number;
  readonly expiresAt: number;
  readonly previousTarget: PercentTarget | null;
}
export interface LocalVolumeContext {
  protocol_version: 1;
  capability_id: "media_volume.set";
  context_id: string;
  current_index: number;
  min_index: number;
  max_index: number;
  expires_in_ms: number;
}
export type VolumeContextReader = (signal: AbortSignal) => Promise<unknown>;
export interface ClarificationFormProps {
  pending: PendingClarification;
  busy: boolean;
  onSubmit(answer: ClarificationAnswer, allowLocalRead: boolean): void;
}
export const percentTargets = [
  ["media_volume.set", "Media volume"],
  ["brightness.set_app", "App-window brightness (preview)"],
] as const;
export function clarificationFromFields(
  target: string,
  operation: string,
  amount: string,
  unit: string,
): ClarificationAnswer {
  if (typeof amount !== "string" || !/^\d{1,3}$/.test(amount))
    throw new PlanningError(
      "Enter a whole-number amount using decimal digits.",
    );
  return validateClarification({
    capability_id: target,
    operation,
    amount: Number(amount),
    unit,
  });
}

export function validateClarification(value: unknown): ClarificationAnswer {
  const answer = dataRecord(
    value,
    ["capability_id", "operation", "amount", "unit"],
    ["capability_id", "operation", "amount", "unit"],
  );
  if (
    typeof answer.capability_id !== "string" ||
    !["media_volume.set", "brightness.set_app"].includes(
      answer.capability_id,
    ) ||
    typeof answer.operation !== "string" ||
    !["set", "increase", "decrease"].includes(answer.operation) ||
    typeof answer.unit !== "string" ||
    !["percent", "percentage_points"].includes(answer.unit) ||
    typeof answer.amount !== "number" ||
    !Number.isInteger(answer.amount) ||
    (answer.operation === "set"
      ? answer.unit !== "percent"
      : answer.amount < 1 || answer.amount > 100)
  )
    throw new PlanningError(
      "Choose a target, operation, whole-number amount and explicit units.",
    );
  if (answer.operation === "set") {
    try {
      validateAction({
        capability_id: answer.capability_id,
        percent: answer.amount,
      });
    } catch (error) {
      throw new PlanningError(
        error instanceof Error
          ? error.message
          : "Choose a permitted exact percentage.",
      );
    }
  }
  return { ...answer } as unknown as ClarificationAnswer;
}

export function validateVolumeContext(value: unknown): LocalVolumeContext {
  const row = dataRecord(
    value,
    [
      "protocol_version",
      "capability_id",
      "context_id",
      "current_index",
      "min_index",
      "max_index",
      "expires_in_ms",
    ],
    [
      "protocol_version",
      "capability_id",
      "context_id",
      "current_index",
      "min_index",
      "max_index",
      "expires_in_ms",
    ],
  );
  if (
    row.protocol_version !== 1 ||
    row.capability_id !== "media_volume.set" ||
    typeof row.context_id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      row.context_id,
    ) ||
    ![row.current_index, row.min_index, row.max_index, row.expires_in_ms].every(
      (item) => typeof item === "number" && Number.isInteger(item),
    ) ||
    Number(row.min_index) < 0 ||
    Number(row.max_index) < 1 ||
    Number(row.max_index) > 10000 ||
    Number(row.current_index) < Number(row.min_index) ||
    Number(row.current_index) > Number(row.max_index) ||
    Number(row.expires_in_ms) < 1 ||
    Number(row.expires_in_ms) > 30000
  )
    throw new PlanningError(
      "Fresh device state is unavailable. Use an exact percentage instead.",
    );
  return { ...row } as unknown as LocalVolumeContext;
}

/** One consented local read; no provider call, device write, history upload or guessed default. */
export async function resolveClarification(
  value: unknown,
  read: VolumeContextReader | undefined,
  consent: boolean,
  signal: AbortSignal,
): Promise<{ review: ReviewedCommand; summary: string }> {
  const answer = validateClarification(value);
  if (signal.aborted) throw new PlanningError("Clarification cancelled.");
  if (answer.operation === "set") {
    const action = validateAction({
      capability_id: answer.capability_id,
      percent: answer.amount,
    });
    return {
      review: reviewedCommand([action], "clarification", Date.now() + 60000),
      summary:
        action.capability_id === "media_volume.set"
          ? "Exact media-volume target chosen; Android confirmation is required for a supported device change."
          : "Exact app-window brightness target chosen; this clarified action remains a preview.",
    };
  }
  if (answer.capability_id !== "media_volume.set")
    throw new PlanningError(
      "Relative app-window brightness is not connected. Choose an exact percentage for a preview instead.",
    );
  if (!read)
    throw new PlanningError(
      "Relative changes need a compatible Android volume build. Choose an exact percentage instead.",
    );
  if (consent !== true)
    throw new PlanningError(
      "Allow the one local volume reading before resolving a relative change.",
    );
  const started = Date.now();
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout>;
  let rejectAbort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = () =>
      reject(
        new PlanningError(
          "Local context reading stopped. Nothing was changed.",
        ),
      );
    request.signal.addEventListener("abort", rejectAbort, { once: true });
    timer = setTimeout(abort, 3000);
  });
  let context: LocalVolumeContext;
  try {
    context = validateVolumeContext(
      await Promise.race([read(request.signal), interrupted]),
    );
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener("abort", abort);
    request.signal.removeEventListener("abort", rejectAbort);
    request.abort();
  }
  if (signal.aborted || Date.now() >= started + context.expires_in_ms)
    throw new PlanningError("Device state expired. Review the command again.");
  const base = (context.current_index * 100) / context.max_index;
  const delta =
    answer.unit === "percentage_points"
      ? answer.amount
      : (base * answer.amount) / 100;
  const raw = base + (answer.operation === "increase" ? delta : -delta);
  if (raw < 0 || raw > 70)
    throw new PlanningError(
      "That relative change exceeds the 0–70% media-volume limit. Choose a different amount; nothing was changed.",
    );
  const percent = Math.round(raw);
  const target = Math.floor((percent * context.max_index) / 100);
  if (target < context.min_index || target === context.current_index)
    throw new PlanningError(
      "That change cannot be represented by this device's volume steps. Choose another amount or an exact percentage.",
    );
  return {
    review: reviewedCommand(
      [{ capability_id: "media_volume.set", schema_version: 1, percent }],
      "clarification",
      started + context.expires_in_ms,
      context.context_id,
    ),
    summary: `Current media volume: step ${context.current_index} of ${context.max_index} (${base.toFixed(2)}%). Requested ${answer.operation} by ${answer.amount} ${answer.unit === "percent" ? "% of the current value" : "percentage points"}: target ${percent}% (rounded to a whole percentage). Android uses volume steps; native confirmation rechecks this reading.`,
  };
}
