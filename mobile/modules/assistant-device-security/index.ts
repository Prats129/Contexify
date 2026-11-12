import { requireOptionalNativeModule } from "expo";

export interface DeviceKey {
  installation_id: string;
  public_key: string;
}

interface SecurityModule {
  createKey(origin: string, userId: string): Promise<DeviceKey>;
  signChallenge(installationId: string, payload: string): Promise<string>;
  deleteKey(installationId: string): Promise<void>;
}

export function deviceSecurity(): SecurityModule {
  const native = requireOptionalNativeModule<SecurityModule>("AssistantDeviceSecurity");
  if (!native) throw new Error("Device security requires an updated native development or release build.");
  return native;
}
