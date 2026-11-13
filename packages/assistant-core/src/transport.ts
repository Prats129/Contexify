import type {
  CreateTaskRequest, SimulationChallenge, SimulationClaim, SimulationEvent,
  SimulationPermit, SimulationTaskView,
} from "./contracts";
import type { SimulationTransport } from "./simulation";
import { validateProposal } from "./validation";

export type SimulationRequest = <T>(path: string, body?: unknown) => Promise<T>;

function identifier(value: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))
    throw new Error("Invalid simulation identifier.");
  return value;
}

/** Constructs only registered API paths. Model output never supplies a URL. */
export function createSimulationTransport(request: SimulationRequest) {
  const taskPath = (taskId: string) => `/api/v1/assistant/simulation/tasks/${identifier(taskId)}`;
  const actionPath = (taskId: string, actionId: string) => `${taskPath(taskId)}/actions/${identifier(actionId)}`;
  const transport: SimulationTransport = {
    read: (taskId) => request<SimulationTaskView>(taskPath(taskId)),
    authorizationChallenge: (taskId, actionId, revision) => request<SimulationChallenge>(
      `${actionPath(taskId, actionId)}/authorization-challenge`, { expected_revision: revision }),
    authorize: (taskId, actionId, revision, challenge, signature) => request<SimulationPermit>(
      `${actionPath(taskId, actionId)}/authorize`, { expected_revision: revision, challenge_id: challenge.challenge_id, signature }),
    claim: (taskId, actionId, permit, signature) => request<SimulationClaim>(
      `${actionPath(taskId, actionId)}/claim`, { expected_revision: permit.action_revision,
        challenge_id: permit.claim_challenge.challenge_id, permit: permit.permit, signature }),
    receiptChallenge: (taskId, actionId, claim, outcome) => request<SimulationChallenge>(
      `${actionPath(taskId, actionId)}/receipt-challenge`, { expected_revision: claim.action_revision, claim_id: claim.claim_id, outcome }),
    receipt: (taskId, actionId, claim, outcome, challenge, signature) => request<SimulationTaskView>(
      `${actionPath(taskId, actionId)}/receipt`, { expected_revision: claim.action_revision,
        claim_id: claim.claim_id, outcome, challenge_id: challenge.challenge_id, signature }),
  };
  return {
    ...transport,
    create(payload: CreateTaskRequest): Promise<SimulationTaskView> {
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(payload.idempotency_key)) throw new Error("Invalid idempotency key.");
      return request("/api/v1/assistant/simulation/tasks", { idempotency_key: payload.idempotency_key, proposal: validateProposal(payload.proposal) });
    },
    cancel: (taskId: string): Promise<SimulationTaskView> => request(`${taskPath(taskId)}/cancel`, {}),
    events: (taskId: string): Promise<SimulationEvent[]> => request(`${taskPath(taskId)}/events`),
  };
}
