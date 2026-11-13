import { deviceSecurity } from "../../modules/assistant-device-security";
import type { NativeConfirmation } from "@contexify/assistant-core";

export {
  planCommand, validateProposal, supported, describeState,
  createSimulationRunner, simulatedExecutor, createSimulationTransport,
} from "@contexify/assistant-core";
export type { AssistantProposal, LocalPolicyContext } from "@contexify/assistant-core";

/** Explicit, local-only simulation confirmation. No device effect is exposed. */
export function nativeSimulationConfirmation(installationId: string): NativeConfirmation {
  return {
    confirm: (payload) => deviceSecurity().confirmSimulation(installationId, payload),
    signStep: (payload) => deviceSecurity().signSimulationStep(installationId, payload),
  };
}
