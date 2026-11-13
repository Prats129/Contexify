import type {
  SimulationChallenge, SimulationClaim, SimulationPermit, SimulationTaskView,
} from "./contracts";
import { checkLocalPolicy, validateAction, type AssistantAction, type LocalPolicyContext } from "./validation";

export interface SimulationTransport {
  read(taskId: string): Promise<SimulationTaskView>;
  authorizationChallenge(taskId: string, actionId: string, revision: number): Promise<SimulationChallenge>;
  authorize(taskId: string, actionId: string, revision: number, challenge: SimulationChallenge, signature: string): Promise<SimulationPermit>;
  claim(taskId: string, actionId: string, permit: SimulationPermit, signature: string): Promise<SimulationClaim>;
  receiptChallenge(taskId: string, actionId: string, claim: SimulationClaim, outcome: SimulationOutcome): Promise<SimulationChallenge>;
  receipt(taskId: string, actionId: string, claim: SimulationClaim, outcome: SimulationOutcome, challenge: SimulationChallenge, signature: string): Promise<SimulationTaskView>;
}

export interface NativeConfirmation {
  confirm(payload: string): Promise<string | null>;
  signStep(payload: string): Promise<string>;
}

export type SimulationOutcome = "simulated" | "failed" | "outcome_unknown";
export interface SimulationExecutor {
  readonly mode: "simulation";
  execute(action: AssistantAction): Promise<SimulationOutcome>;
}

/** Pure fake: never imports a browser API, native API or network library. */
export function simulatedExecutor(): SimulationExecutor {
  return { mode: "simulation", async execute(action) { validateAction(action); return "simulated"; } };
}

export function describeState(state: string): string {
  switch (state) {
    case "simulated": return "Simulation finished. No device action was performed.";
    case "executing": return "Simulation is in progress.";
    case "outcome_unknown": return "The simulation outcome is unknown. It will not be retried automatically.";
    case "awaiting_confirmation": return "Review the exact simulation action before approving.";
    case "authorized": return "Simulation approved; it has not been claimed.";
    case "cancelled": return "Simulation cancelled.";
    case "expired": return "Simulation expired.";
    case "failed": return "Simulation failed.";
    default: throw new Error("Unknown simulation state.");
  }
}

function validateEnvelope(payload: string, taskId: string, actionId: string,
                          action: AssistantAction, purpose: string, revision: number): Record<string, unknown> {
  if (typeof payload !== "string" || payload.length > 2048) throw new Error("Invalid simulation envelope.");
  const fields = JSON.parse(payload);
  if (fields.mode !== "simulation" || fields.protocol_version !== 1 || fields.policy_version !== 1 ||
      fields.task_id !== taskId || fields.action_id !== actionId || fields.purpose !== purpose ||
      fields.action_revision !== revision || typeof fields.arguments_json !== "string" ||
      JSON.stringify(validateAction(JSON.parse(fields.arguments_json))) !== JSON.stringify(action))
    throw new Error("The exact simulation action changed.");
  return fields;
}

/** Native signatures and the server ledger remain the authority, not JS flags. */
export function createSimulationRunner(
  transport: SimulationTransport, confirmation: NativeConfirmation,
  executor: SimulationExecutor, context: () => LocalPolicyContext,
  now: () => number = () => Date.now() / 1000,
) {
  const inFlight = new Set<string>();
  return {
    async runStep(taskId: string, actionId: string): Promise<SimulationTaskView> {
      const key = `${taskId}:${actionId}`;
      if (inFlight.has(key)) throw new Error("This simulation step is already in progress.");
      inFlight.add(key);
      try {
        const task = await transport.read(taskId);
        if (task.task_id !== taskId || task.mode !== "simulation" || task.protocol_version !== 1 || task.policy_version !== 1 || executor.mode !== "simulation")
          throw new Error("Only the reviewed simulation protocol is accepted.");
        const step = task.actions.find((value) => value.action_id === actionId);
        if (!step || step.state !== "awaiting_confirmation" || !Number.isInteger(step.revision) || step.revision < 1)
          throw new Error("This action cannot be executed or retried.");
        const action = validateAction(step.action);
        checkLocalPolicy(action, context());
        const challenge = await transport.authorizationChallenge(taskId, actionId, step.revision);
        validateEnvelope(challenge.payload, taskId, actionId, action, "assistant_simulation_authorize", step.revision);
        const signature = await confirmation.confirm(challenge.payload);
        if (!signature) return transport.read(taskId);
        checkLocalPolicy(action, context());
        const permit = await transport.authorize(taskId, actionId, step.revision, challenge, signature);
        if (permit.action_revision !== step.revision + 1 || !Number.isFinite(permit.expires_at) || permit.expires_at <= now())
          throw new Error("The simulation authorization expired or changed.");
        validateEnvelope(permit.claim_challenge.payload, taskId, actionId, action, "assistant_simulation_claim", permit.action_revision);
        const claimSignature = await confirmation.signStep(permit.claim_challenge.payload);
        checkLocalPolicy(action, context());
        // If this call fails/its acknowledgement is lost, never invoke the adapter.
        const claim = await transport.claim(taskId, actionId, permit, claimSignature);
        if (claim.execution !== "simulation_only" || claim.action_revision !== permit.action_revision + 1 ||
            !Number.isFinite(claim.expires_at) || claim.expires_at <= now() || claim.expires_at > now() + 20)
          return transport.read(taskId);
        let outcome: SimulationOutcome = "outcome_unknown";
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          checkLocalPolicy(action, context());
          const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Simulation deadline exceeded.")),
              Math.max(1, Math.min(15000, (claim.expires_at - now()) * 1000)));
          });
          outcome = await Promise.race([executor.execute(action), deadline]);
        }
        catch { /* Reconcile unknown rather than replay an interrupted effect. */ }
        finally { if (timer !== undefined) clearTimeout(timer); }
        if (!["simulated", "failed", "outcome_unknown"].includes(outcome)) outcome = "outcome_unknown";
        const receipt = await transport.receiptChallenge(taskId, actionId, claim, outcome);
        const receiptFields = validateEnvelope(receipt.payload, taskId, actionId, action, "assistant_simulation_receipt", claim.action_revision);
        if (receiptFields.claim_id !== claim.claim_id || receiptFields.outcome !== outcome)
          throw new Error("The simulation receipt changed.");
        const receiptSignature = await confirmation.signStep(receipt.payload);
        return transport.receipt(taskId, actionId, claim, outcome, receipt, receiptSignature);
      } finally { inFlight.delete(key); }
    },
  };
}
