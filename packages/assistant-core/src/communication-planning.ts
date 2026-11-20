import type {
  CommunicationPlanningResponse,
  CommunicationProposal,
  PlanningFeedback,
} from "./contracts";
import { communicationDraft } from "./communications";
import { dataRecord } from "./validation";
import {
  createProposalPlanner,
  validatePlanningEnvelope,
  PlanningError,
  type PlanningContext,
} from "./planning";
import { publicCommunicationInput } from "./public-command-scope";

export interface ReviewedCommunication {
  readonly planId: string;
  readonly ownerUserId: string;
  readonly expiresAt: number;
  readonly kind: "dial" | "sms";
  readonly body: string | null;
}

export function validateCommunicationPlanningResponse(
  value: unknown,
  context: PlanningContext,
): CommunicationPlanningResponse {
  const envelope = validatePlanningEnvelope(value, context);
  const proposal = dataRecord(
    envelope.proposal,
    [
      "protocol_version",
      "mode",
      "status",
      "capability_id",
      "request_kind",
      "recipient",
      "message",
      "reason",
    ],
    ["protocol_version", "mode", "status"],
  );
  if (proposal.protocol_version !== 1 || proposal.mode !== "proposal")
    throw new PlanningError("Invalid communication protocol.");
  if (proposal.status === "communication_proposed") {
    dataRecord(
      proposal,
      [
        "protocol_version",
        "mode",
        "status",
        "capability_id",
        "request_kind",
        "recipient",
        "message",
      ],
      [
        "protocol_version",
        "mode",
        "status",
        "capability_id",
        "request_kind",
        "recipient",
        "message",
      ],
    );
    if (
      proposal.capability_id !== "communication.compose" ||
      proposal.recipient !== "local_picker" ||
      (proposal.request_kind !== "dial" && proposal.request_kind !== "sms") ||
      (proposal.request_kind === "dial" && proposal.message !== "") ||
      (proposal.message !== null && typeof proposal.message !== "string")
    )
      throw new PlanningError("Invalid communication proposal.");
    if (proposal.message !== null)
      communicationDraft({
        kind: proposal.request_kind,
        number: "+12025550123",
        body: proposal.message,
      });
    return { ...envelope, proposal: { ...proposal } as CommunicationProposal };
  }
  dataRecord(
    proposal,
    ["protocol_version", "mode", "status", "reason"],
    ["protocol_version", "mode", "status", "reason"],
  );
  if (
    typeof proposal.status !== "string" ||
    !["needs_clarification", "unsupported", "refused", "non_action"].includes(
      proposal.status,
    ) ||
    typeof proposal.reason !== "string" ||
    ![
      "missing_target",
      "missing_value",
      "relative_value",
      "ambiguous_request",
      "unsupported_request",
      "policy_limit",
      "not_a_command",
      "model_refusal",
    ].includes(proposal.reason)
  )
    throw new PlanningError("Invalid communication feedback.");
  return { ...envelope, proposal: { ...proposal } as PlanningFeedback };
}

export function createCommunicationPlanner(
  connect: (signal: AbortSignal) => Promise<PlanningContext>,
) {
  const planner = createProposalPlanner(
    connect,
    "/communication-proposals",
    validateCommunicationPlanningResponse,
    publicCommunicationInput,
  );
  return {
    async plan(text: string, signal: AbortSignal) {
      const canonical = publicCommunicationInput(text).text;
      const response = await planner.plan(canonical, signal);
      const proposal = response.proposal;
      if (
        proposal.status === "communication_proposed" &&
        proposal.message &&
        !canonical.includes(proposal.message)
      )
        throw new PlanningError(
          "The planner changed the requested message. Nothing was opened.",
        );
      return response;
    },
    close() {
      planner.close();
    },
  };
}

export function reviewedCommunication(
  response: CommunicationPlanningResponse,
): ReviewedCommunication | null {
  if (response.proposal.status !== "communication_proposed") return null;
  return Object.freeze({
    planId: response.plan_id,
    ownerUserId: response.owner_user_id,
    expiresAt: response.expires_at * 1000,
    kind: response.proposal.request_kind,
    body: response.proposal.message ?? null,
  });
}

export function communicationFeedback(proposal: PlanningFeedback): string {
  if (proposal.status === "non_action")
    return "No communication was requested. No phone action was performed.";
  if (proposal.status === "needs_clarification")
    return "Complete the recipient and message locally, or give a clear supported public example. Nothing was opened.";
  return "This flow supports one reviewed phone or SMS handoff. Direct sending/calling, multiple recipients and mixed-action plans are unavailable. Nothing was opened.";
}
