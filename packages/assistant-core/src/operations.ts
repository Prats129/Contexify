import { dataRecord, validateProposal } from "./validation";
import type { ProposalStep } from "./contracts";

export interface OperationPlan {
  readonly protocol_version: 2;
  readonly plan_id: string;
  readonly plan_revision: number;
  readonly expires_at: number;
  readonly context_id?: string;
  readonly steps: readonly {
    readonly step_id: number;
    readonly depends_on: readonly number[];
    readonly action: ProposalStep["action"];
  }[];
}
export interface OperationResult {
  readonly protocol_version: 2;
  readonly plan_id: string;
  readonly plan_revision: number;
  readonly revision: number;
  readonly steps: readonly {
    readonly step_id: number;
    readonly capability_id: "media_volume.set" | "brightness.set_app";
    readonly state:
      | "pending"
      | "skipped"
      | "verified"
      | "failed"
      | "cancelled"
      | "outcome_unknown";
    readonly result: {
      readonly outcome: "verified" | "failed" | "cancelled" | "outcome_unknown";
      readonly requested_percent: number;
      readonly observed_percent: number | null;
      readonly receipt_recorded: boolean;
    } | null;
  }[];
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Copy validated dependencies and identity once; never reconstruct from text at dispatch. */
export function operationPlan(
  id: string,
  revision: number,
  expiresAt: number,
  steps: ProposalStep[],
  contextId?: string,
): OperationPlan {
  if (
    typeof id !== "string" ||
    !uuid.test(id) ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    revision > 1000 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 185000 ||
    (contextId !== undefined &&
      (typeof contextId !== "string" || !uuid.test(contextId)))
  )
    throw Error("Invalid or expired operation identity.");
  const validated = validateProposal({ steps }).steps;
  if (
    contextId &&
    (validated.length !== 1 ||
      validated[0].action.capability_id !== "media_volume.set")
  )
    throw Error("A local reading belongs to one media-volume action.");
  return Object.freeze({
    protocol_version: 2,
    plan_id: id,
    plan_revision: revision,
    expires_at: expiresAt / 1000,
    ...(contextId ? { context_id: contextId } : {}),
    steps: Object.freeze(
      validated.map((step, i) =>
        Object.freeze({
          step_id: i,
          depends_on: Object.freeze([...(step.depends_on ?? [])]),
          action: Object.freeze(step.action),
        }),
      ),
    ),
  });
}

export function supportedOperationPlan(plan: OperationPlan): boolean {
  return (
    plan.expires_at * 1000 > Date.now() &&
    plan.steps.length > 0 &&
    plan.steps.every(
      (step) =>
        step.action.capability_id === "media_volume.set" ||
        step.action.capability_id === "brightness.set_app",
    )
  );
}

/** Strict native result projection. Unknown is never promoted to verified from a model. */
export function operationResult(
  value: unknown,
  expected?: OperationPlan,
): OperationResult {
  const row = dataRecord(
    value,
    ["protocol_version", "plan_id", "plan_revision", "revision", "steps"],
    ["protocol_version", "plan_id", "plan_revision", "revision", "steps"],
  );
  if (
    row.protocol_version !== 2 ||
    typeof row.plan_id !== "string" ||
    !uuid.test(row.plan_id) ||
    !Number.isInteger(row.plan_revision) ||
    (row.plan_revision as number) < 1 ||
    (row.plan_revision as number) > 1000 ||
    !Number.isInteger(row.revision) ||
    (row.revision as number) < 1 ||
    !Array.isArray(row.steps) ||
    row.steps.length < 1 ||
    row.steps.length > 5 ||
    (expected &&
      (row.plan_id !== expected.plan_id ||
        row.plan_revision !== expected.plan_revision ||
        row.steps.length !== expected.steps.length))
  )
    throw Error("Invalid operation evidence.");
  const steps = Array.from(row.steps, (value: unknown, i: number) => {
    const step = dataRecord(
      value,
      ["step_id", "capability_id", "state", "result"],
      ["step_id", "capability_id", "state", "result"],
    );
    if (
      step.step_id !== i ||
      typeof step.capability_id !== "string" ||
      !["media_volume.set", "brightness.set_app"].includes(
        step.capability_id,
      ) ||
      (expected &&
        step.capability_id !== expected.steps[i].action.capability_id) ||
      typeof step.state !== "string" ||
      ![
        "pending",
        "skipped",
        "verified",
        "failed",
        "cancelled",
        "outcome_unknown",
      ].includes(step.state)
    )
      throw Error("Invalid operation state.");
    if (step.result !== null) {
      const result = dataRecord(
        step.result,
        [
          "outcome",
          "requested_percent",
          "observed_percent",
          "receipt_recorded",
        ],
        [
          "outcome",
          "requested_percent",
          "observed_percent",
          "receipt_recorded",
        ],
      );
      if (
        result.outcome !== step.state ||
        !["verified", "failed", "cancelled", "outcome_unknown"].includes(
          String(result.outcome),
        ) ||
        typeof result.receipt_recorded !== "boolean" ||
        !Number.isInteger(result.requested_percent) ||
        (result.requested_percent as number) <
          (step.capability_id === "media_volume.set" ? 0 : 10) ||
        (result.requested_percent as number) >
          (step.capability_id === "media_volume.set" ? 70 : 100) ||
        (expected &&
          result.requested_percent !==
            (expected.steps[i].action as { percent: number }).percent) ||
        (result.observed_percent !== null &&
          (!Number.isInteger(result.observed_percent) ||
            (result.observed_percent as number) < 0 ||
            (result.observed_percent as number) > 100)) ||
        (result.outcome === "verified" &&
          (result.observed_percent === null ||
            (result.observed_percent as number) >
              (result.requested_percent as number) ||
            (step.capability_id === "brightness.set_app" &&
              result.observed_percent !== result.requested_percent))) ||
        (result.outcome === "cancelled" && result.receipt_recorded)
      )
        throw Error("Invalid operation result.");
    } else if (
      step.state === "verified" ||
      step.state === "failed" ||
      step.state === "cancelled"
    )
      throw Error("Missing operation result.");
    return step;
  });
  return { ...row, steps } as unknown as OperationResult;
}

export function describeOperationResult(result: OperationResult): string {
  return result.steps
    .map((step) => {
      const prefix = `Step ${step.step_id + 1}: ${step.capability_id === "media_volume.set" ? "media volume" : "Contexify brightness"} `;
      if (step.state === "verified")
        return (
          prefix +
          `verified at ${step.result!.observed_percent}%` +
          (step.result!.receipt_recorded
            ? "."
            : "; server receipt unavailable. Remaining steps stopped.")
        );
      if (step.state === "pending" || step.state === "skipped")
        return prefix + "not started.";
      if (step.state === "outcome_unknown")
        return (
          prefix +
          "outcome unknown. Check the device before making a new request."
        );
      return (
        prefix +
        (step.state === "cancelled"
          ? "cancelled."
          : "failed; the requested change could not be verified.")
      );
    })
    .join(" ");
}
