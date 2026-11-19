import { requireOptionalNativeModule } from "expo";

export interface DeviceKey {
  installation_id: string;
  public_key: string;
}

export interface PercentExecutionResult {
  outcome: "verified" | "failed" | "outcome_unknown" | "cancelled";
  requested_percent: number;
  observed_percent: number | null;
  receipt_recorded: boolean;
}

export type VolumeExecutionResult = PercentExecutionResult;

interface SecurityModule {
  reminderSupport?(): boolean;
  readReminders?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
  ): Promise<unknown>;
  executeReminder?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
    kind: string,
    payload: string,
  ): Promise<unknown>;
  listSavedReminders?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
    after: string | null,
  ): Promise<unknown>;
  saveReminderCopy?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
    id: string,
  ): Promise<unknown>;
  requestReminderNotifications?(): Promise<unknown>;
  cancelReminders?(): Promise<void>;
  clearReminders?(): Promise<void>;
  /** Compiled support only; never grants authority. Missing on older binaries. */
  operationCapabilitiesV2?(): unknown;
  executePlanV2?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
    planJson: string,
  ): Promise<unknown>;
  reconcilePlansV2?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
  ): Promise<unknown>;
  readVolumeContext?(
    origin: string,
    userId: string,
    installationId: string,
  ): Promise<unknown>;
  executeVolumeFromContext?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
    percent: number,
    contextId: string,
  ): Promise<unknown>;
  executeVolume?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
    percent: number,
  ): Promise<unknown>;
  cancelVolume?(): Promise<void>;
  executeBrightness?(
    origin: string,
    userId: string,
    installationId: string,
    managementToken: string,
    percent: number,
  ): Promise<unknown>;
  cancelBrightness?(): Promise<void>;
  /** Android-only, read-only hints. A report never grants execution authority. */
  deviceControlReadiness?(): Promise<unknown>;
  createKey(origin: string, userId: string): Promise<DeviceKey>;
  signChallenge(installationId: string, payload: string): Promise<string>;
  deleteKey(installationId: string): Promise<void>;
  confirmSimulation(
    installationId: string,
    payload: string,
  ): Promise<string | null>;
  signSimulationStep(installationId: string, payload: string): Promise<string>;
}

export function deviceSecurity(): SecurityModule {
  const native = requireOptionalNativeModule<SecurityModule>(
    "AssistantDeviceSecurity",
  );
  if (!native)
    throw new Error(
      "Device security requires an updated native development or release build.",
    );
  return native;
}
