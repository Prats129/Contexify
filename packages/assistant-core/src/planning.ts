import type {
  PlanningFeedback,
  PlanningGrant,
  PlanningResponse,
} from "./contracts";
import {
  dataRecord,
  validateAction,
  validateProposal,
  type AssistantAction,
} from "./validation";
import type { OperationPlan } from "./operations";

export interface PlanningContext {
  userId: string;
  deviceId: string | null;
  request(path: string, body: unknown, signal: AbortSignal): Promise<unknown>;
}
export interface PlanningAccess {
  planningContext(
    userId: string,
    signal: AbortSignal,
  ): Promise<PlanningContext>;
}
export interface CommandPlanner {
  plan(text: string, signal: AbortSignal): Promise<PlanningResponse>;
  close(): void;
}
export interface ReviewedCommand {
  readonly source: "local" | "planner" | "clarification";
  readonly expiresAt: number;
  readonly actions: readonly Readonly<AssistantAction>[];
  readonly contextId?: string;
  readonly operationPlan?: OperationPlan;
}

export class PlanningError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const reasons: Record<PlanningFeedback["reason"], string> = {
  missing_target: "Which supported target do you mean?",
  missing_value: "What exact percentage do you want?",
  relative_value: "Choose the target, amount and units for this change.",
  ambiguous_request:
    "Please give one clear command with an exact target and value.",
  unsupported_request:
    "That action is not supported. No device action was performed.",
  policy_limit:
    "Media volume allows 0–70%; app-window brightness allows 10–100%.",
  not_a_command: "No action requested. No device action was performed.",
  model_refusal:
    "The planner declined this request. No device action was performed.",
};

export function planningFeedback(value: PlanningFeedback): string {
  return reasons[value.reason];
}

export function validatePlanningResponse(
  value: unknown,
  context: Pick<PlanningContext, "userId" | "deviceId">,
): PlanningResponse {
  const row = dataRecord(
    value,
    [
      "plan_id",
      "revision",
      "owner_user_id",
      "owner_device_id",
      "expires_at",
      "execution",
      "proposal",
    ],
    [
      "plan_id",
      "revision",
      "owner_user_id",
      "owner_device_id",
      "expires_at",
      "execution",
      "proposal",
    ],
  );
  if (
    typeof row.plan_id !== "string" ||
    !uuid.test(row.plan_id) ||
    row.revision !== 1 ||
    row.execution !== "not_authorized" ||
    row.owner_user_id !== context.userId ||
    row.owner_device_id !== context.deviceId ||
    typeof row.expires_at !== "number" ||
    !Number.isFinite(row.expires_at) ||
    row.expires_at * 1000 <= Date.now() ||
    row.expires_at * 1000 > Date.now() + 185000
  )
    throw new PlanningError(
      "The planning response expired or belongs to another session.",
    );
  const candidate = dataRecord(
    row.proposal,
    ["protocol_version", "mode", "status", "steps", "reason"],
    ["mode", "status"],
  );
  if (
    candidate.mode !== "proposal" ||
    (candidate.protocol_version !== undefined &&
      candidate.protocol_version !== 1)
  )
    throw new PlanningError("Invalid planning protocol.");
  let proposal: PlanningResponse["proposal"];
  if (candidate.status === "proposed") {
    dataRecord(
      candidate,
      ["protocol_version", "mode", "status", "steps"],
      ["mode", "status", "steps"],
    );
    // Reuse only step/action validation. A proposal is never execution authority.
    const steps = validateProposal({ steps: candidate.steps }).steps;
    proposal = {
      protocol_version: 1,
      mode: "proposal",
      status: "proposed",
      steps,
    };
  } else {
    dataRecord(
      candidate,
      ["protocol_version", "mode", "status", "reason"],
      ["mode", "status", "reason"],
    );
    if (
      !["needs_clarification", "unsupported", "refused", "non_action"].includes(
        String(candidate.status),
      ) ||
      typeof candidate.reason !== "string" ||
      !Object.prototype.hasOwnProperty.call(reasons, candidate.reason)
    )
      throw new PlanningError("Invalid planning feedback.");
    proposal = {
      protocol_version: 1,
      mode: "proposal",
      status: candidate.status,
      reason: candidate.reason,
    } as PlanningFeedback;
  }
  return {
    plan_id: row.plan_id,
    revision: 1,
    owner_user_id: context.userId,
    owner_device_id: context.deviceId,
    expires_at: row.expires_at,
    execution: "not_authorized",
    proposal,
  };
}

export function reviewedCommand(
  actions: readonly AssistantAction[],
  source: ReviewedCommand["source"],
  expiresAt: number,
  contextId?: string,
  operationPlan?: OperationPlan,
): ReviewedCommand {
  return Object.freeze({
    source,
    expiresAt,
    ...(contextId ? { contextId } : {}),
    ...(operationPlan ? { operationPlan } : {}),
    actions: Object.freeze(
      actions.map((action) => Object.freeze(validateAction(action))),
    ),
  });
}

/** Select from the reviewed snapshot, never from raw language. Never execute part of a plan. */
export function reviewedPercent(
  review: ReviewedCommand | null | undefined,
  capability: "media_volume.set" | "brightness.set_app",
): number | null {
  if (
    !review ||
    typeof review !== "object" ||
    !Number.isFinite(review.expiresAt) ||
    review.expiresAt <= Date.now() ||
    !Array.isArray(review.actions) ||
    review.actions.length !== 1 ||
    (review.source !== "local" && capability !== "media_volume.set")
  )
    return null;
  try {
    const action = validateAction(review.actions[0]);
    return action.capability_id === capability ? action.percent : null;
  } catch {
    return null;
  }
}

/** Fixed messages only: never render SDK bodies, model prose or raw server errors. */
export async function planningJson(
  url: string,
  options: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw new PlanningError("Planning cancelled.");
  const response = await fetch(url, {
    ...options,
    signal,
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "Sign in and enable assistant security again.",
      403: "Planning consent or processing scope is unavailable. Only approved public test commands are permitted for now.",
      404: "AI planning is not enabled or this planning session has expired.",
      429: "AI planning is busy or its quota has been reached. Try later.",
      502: "The planner returned an invalid proposal. No device action was performed.",
      503: "AI planning is unavailable. No device action was performed.",
      504: "AI planning timed out. No device action was performed.",
    };
    throw new PlanningError(
      messages[response.status] ??
        "Planning was interrupted. No device action was performed.",
      response.status,
    );
  }
  const length = Number(response.headers?.get("Content-Length"));
  if (Number.isFinite(length) && length > 16384)
    throw new PlanningError("Planning response exceeded its limit.");
  const text = await response.text();
  if (signal.aborted) throw new PlanningError("Planning cancelled.");
  if (new TextEncoder().encode(text).length > 16384)
    throw new PlanningError("Planning response exceeded its limit.");
  return JSON.parse(text);
}

export function planningPath(path: string): string {
  if (
    path !== "/grants" &&
    path !== "/proposals" &&
    !/^\/grants\/[a-f0-9-]{36}\/revoke$/.test(path)
  )
    throw new PlanningError("Invalid planning path.");
  return "/api/v1/assistant/planning" + path;
}

/** One memory-only grant per consent session. No direct provider, fallback or effect port. */
export function createCommandPlanner(
  connect: (signal: AbortSignal) => Promise<PlanningContext>,
): CommandPlanner {
  let cached: { context: PlanningContext; grant: PlanningGrant } | null = null;
  let active: AbortController | null = null;
  let version = 0;
  return {
    async plan(text, parent) {
      if (active)
        throw new PlanningError("A planning request is already in progress.");
      if (
        parent.aborted ||
        !text.trim() ||
        text.length > 1024 ||
        new TextEncoder().encode(text).length > 3072
      )
        throw new PlanningError("Enter a command of at most 1,024 characters.");
      const current = version;
      const controller = new AbortController();
      active = controller;
      const abort = () => controller.abort();
      parent.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout>;
      let interrupted!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        interrupted = () => reject(new PlanningError("Planning cancelled."));
        controller.signal.addEventListener("abort", interrupted, {
          once: true,
        });
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new PlanningError(
              "AI planning timed out. No device action was performed.",
            ),
          );
          controller.abort();
        }, 35000);
      });
      const check = () => {
        if (current !== version || controller.signal.aborted)
          throw new PlanningError("Planning cancelled.");
      };
      async function work() {
        if (!cached || cached.grant.expires_at * 1000 <= Date.now()) {
          const context = await connect(controller.signal);
          check();
          const value = await context.request(
            "/grants",
            {
              consent: true,
              consent_policy_version: 1,
              data_scope: "synthetic_evaluation",
            },
            controller.signal,
          );
          check();
          const grant = dataRecord(
            value,
            [
              "grant_id",
              "scope",
              "consent_policy_version",
              "data_scope",
              "expires_at",
            ],
            [
              "grant_id",
              "scope",
              "consent_policy_version",
              "data_scope",
              "expires_at",
            ],
          );
          if (
            typeof grant.grant_id !== "string" ||
            !uuid.test(grant.grant_id) ||
            grant.scope !== "assistant:plan" ||
            grant.consent_policy_version !== 1 ||
            grant.data_scope !== "synthetic_evaluation" ||
            typeof grant.expires_at !== "number" ||
            !Number.isFinite(grant.expires_at) ||
            grant.expires_at * 1000 <= Date.now() ||
            grant.expires_at * 1000 > Date.now() + 305000
          )
            throw new PlanningError("Invalid planning consent response.");
          cached = { context, grant: grant as unknown as PlanningGrant };
        }
        const { context, grant } = cached;
        check();
        const result = await context.request(
          "/proposals",
          { grant_id: grant.grant_id, text, source: "user" },
          controller.signal,
        );
        check();
        const response = validatePlanningResponse(result, context);
        if (response.expires_at > grant.expires_at)
          throw new PlanningError("Planning response outlived its consent.");
        return response;
      }
      try {
        return await Promise.race([work(), cancelled, timeout]);
      } catch (error) {
        const reusable =
          controller.signal.aborted ||
          (error instanceof PlanningError &&
            error.status !== undefined &&
            ![401, 403, 404, 409].includes(error.status));
        if (current !== version || !reusable) cached = null;
        if (error instanceof PlanningError) throw error;
        throw new PlanningError(
          "AI planning is unavailable. No device action was performed.",
        );
      } finally {
        clearTimeout(timer!);
        parent.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", interrupted);
        controller.abort();
        if (active === controller) active = null;
      }
    },
    close() {
      version++;
      active?.abort();
      const previous = cached;
      cached = null;
      if (previous) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        void previous.context
          .request(
            `/grants/${previous.grant.grant_id}/revoke`,
            {},
            controller.signal,
          )
          .catch(() => {})
          .finally(() => clearTimeout(timer));
      }
    },
  };
}
