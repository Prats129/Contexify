import type { AssistantProposal } from "./contracts";
import { validateProposal } from "./validation";

export type PlanningResult =
  | { status: "proposed"; proposal: AssistantProposal }
  | { status: "needs_clarification"; message: string };

/** Whole-command grammar only. Retrieved/tool text can never initiate a plan. */
export function planCommand(
  text: string,
  source: "user" | "untrusted" = "user",
): PlanningResult {
  if (source !== "user" || typeof text !== "string" || text.length > 1024)
    return {
      status: "needs_clarification",
      message: "Enter a direct, supported command.",
    };
  const parts = text.trim().split(/\s+then\s+/i);
  if (parts.length < 1 || parts.length > 5)
    return {
      status: "needs_clarification",
      message: "Use at most five explicit steps.",
    };
  const steps = [];
  for (const [index, part] of parts.entries()) {
    let action;
    const numeric =
      /^(?:set\s+)?(media volume|volume|brightness)\s+to\s+(\d{1,3})\s*(?:%|percent)$/i.exec(
        part.trim(),
      );
    const open = /^open\s+(spotify|clock)$/i.exec(part.trim());
    if (numeric)
      action = {
        capability_id: /brightness/i.test(numeric[1])
          ? "brightness.set_app"
          : "media_volume.set",
        percent: Number(numeric[2]),
      };
    else if (open)
      action = {
        capability_id: "application.open",
        application_id: open[1].toLowerCase(),
      };
    else
      return {
        status: "needs_clarification",
        message: "Specify a supported app or an exact permitted percentage.",
      };
    steps.push({ action, depends_on: index ? [index - 1] : [] });
  }
  try {
    return { status: "proposed", proposal: validateProposal({ steps }) };
  } catch {
    return {
      status: "needs_clarification",
      message: "That command exceeds the permitted capability limits.",
    };
  }
}

export interface ProposalPlanner {
  propose(
    input: { text: string; repair: boolean },
    signal: AbortSignal,
  ): Promise<string>;
}

/** An injected provider port, not an enabled cloud integration or tool agent. */
export async function planWithProvider(
  text: string,
  source: "user" | "untrusted",
  planner: ProposalPlanner,
  consentForExternalProcessing: boolean,
  timeoutMs = 30000,
): Promise<PlanningResult> {
  if (
    source !== "user" ||
    consentForExternalProcessing !== true ||
    typeof text !== "string" ||
    text.length > 1024 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    throw new Error(
      "Explicit processing consent, trusted user input and bounded work are required.",
    );
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Planning deadline exceeded."));
    }, timeoutMs);
  });
  async function generate(): Promise<PlanningResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted) throw new Error("Planning cancelled.");
      const response = await planner.propose(
        { text, repair: attempt === 1 },
        controller.signal,
      );
      if (controller.signal.aborted) throw new Error("Planning cancelled.");
      if (
        typeof response !== "string" ||
        new TextEncoder().encode(response).length > 8192
      )
        throw new Error("Planner output exceeded its limit.");
      try {
        return {
          status: "proposed",
          proposal: validateProposal(JSON.parse(response)),
        };
      } catch {
        /* A single schema-repair attempt is allowed; it authorizes nothing. */
      }
    }
    return {
      status: "needs_clarification",
      message: "The planner did not produce a supported structured proposal.",
    };
  }
  try {
    return await Promise.race([generate(), timeout]);
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}
