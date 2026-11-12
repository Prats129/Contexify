import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { deviceSecurity } from "../../modules/assistant-device-security";
import type { ChallengeResponse, DeviceResponse, DeviceSessionResponse } from "../types/api-contracts";

const BINDING_KEY = "contexify_assistant_binding_v1";
const storageOptions = {
  keychainService: "ai.contexify.assistant.v1",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
interface Binding {
  userId: string;
  host: string;
  installationId: string;
  deviceId: string;
}

export function createAssistantDeviceSecurity(
  getHost: () => Promise<string>,
  authHeaders: (url: string) => Promise<Record<string, string>>,
) {
  let busy = false;
  let version = 0;
  async function host(): Promise<string> {
    const selected = await getHost();
    const url = new URL(selected);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash)
      throw new Error("Assistant enrollment requires its HTTPS server origin.");
    if (Platform.OS !== "android" && Platform.OS !== "ios")
      throw new Error("Device enrollment requires the native app.");
    return url.origin;
  }

  async function post<T>(selectedHost: string, path: string, body: unknown): Promise<T> {
    if (selectedHost !== await host()) throw new Error("The server changed. Enroll again.");
    const url = `${selectedHost}/api/v1/assistant/security${path}`;
    const authorization = await authHeaders(url);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Device security request timed out. Review enrolled devices before trying again."));
      }, 15000);
    });
    let response: Response;
    try {
      response = await Promise.race([fetch(url, {
        method: "POST", headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify(body), redirect: "error", signal: controller.signal,
      }), timeout]);
    } finally { clearTimeout(timer!); }
    if (selectedHost !== await host()) throw new Error("The server changed. Enroll again.");
    if (!response.ok) throw new Error("Device security request was rejected. Sign in again or revoke the old device.");
    const result: T = await response.json();
    if ((await authHeaders(url)).Authorization !== authorization.Authorization)
      throw new Error("Your sign-in changed. Start device security again.");
    return result;
  }

  async function proof(selectedHost: string, installationId: string, challenge: ChallengeResponse) {
    const signature = await deviceSecurity().signChallenge(installationId, challenge.payload);
    if (selectedHost !== await host()) throw new Error("The server changed. Enroll again.");
    return { challenge_id: challenge.challenge_id, signature };
  }

  return {
    async enroll(userId: string): Promise<DeviceResponse> {
      if (busy) throw new Error("Device enrollment is already in progress.");
      busy = true;
      const generation = version;
      let created: string | null = null;
      try {
        const selectedHost = await host();
        const enrollmentUrl = `${selectedHost}/api/v1/assistant/security/enrollment`;
        const parentAuthorization = (await authHeaders(enrollmentUrl)).Authorization;
        if (await SecureStore.getItemAsync(BINDING_KEY, storageOptions))
          throw new Error("Disable the existing device binding before enrolling again.");
        const key = await deviceSecurity().createKey(selectedHost, userId);
        created = key.installation_id;
        const challenge = await post<ChallengeResponse>(selectedHost, "/enrollment/challenge", {
          ...key, platform: Platform.OS,
        });
        const device = await post<DeviceResponse>(selectedHost, "/enrollment",
          await proof(selectedHost, key.installation_id, challenge));
        if (generation !== version || parentAuthorization !== (await authHeaders(enrollmentUrl)).Authorization)
          throw new Error("Device enrollment was cancelled or your sign-in changed.");
        const binding: Binding = { userId, host: selectedHost, installationId: key.installation_id, deviceId: device.device_id };
        await SecureStore.setItemAsync(BINDING_KEY, JSON.stringify(binding), storageOptions);
        if (generation !== version || parentAuthorization !== (await authHeaders(enrollmentUrl)).Authorization) {
          await SecureStore.deleteItemAsync(BINDING_KEY, storageOptions);
          throw new Error("Device enrollment was cancelled.");
        }
        created = null;
        return device;
      } finally {
        try { if (created) await deviceSecurity().deleteKey(created); }
        finally { busy = false; }
      }
    },
    async openSession(userId: string): Promise<DeviceSessionResponse> {
      const generation = version;
      const selectedHost = await host();
      const sessionUrl = `${selectedHost}/api/v1/assistant/security/device-session`;
      const parentAuthorization = (await authHeaders(sessionUrl)).Authorization;
      const saved = await SecureStore.getItemAsync(BINDING_KEY, storageOptions);
      const binding: Binding | null = saved ? JSON.parse(saved) : null;
      if (!binding || binding.userId !== userId || binding.host !== selectedHost)
        throw new Error("Enroll this account and device first.");
      const challenge = await post<ChallengeResponse>(selectedHost, "/device-session/challenge", { device_id: binding.deviceId });
      const result = await post<DeviceSessionResponse>(selectedHost, "/device-session",
        await proof(selectedHost, binding.installationId, challenge));
      if (generation !== version || parentAuthorization !== (await authHeaders(sessionUrl)).Authorization)
        throw new Error("Your assistant session changed.");
      // Callers may hold this management-only token in memory, never AsyncStorage.
      return result;
    },
    async forget(): Promise<void> {
      version++;
      const saved = await SecureStore.getItemAsync(BINDING_KEY, storageOptions);
      const binding: Binding | null = saved ? JSON.parse(saved) : null;
      if (binding) await deviceSecurity().deleteKey(binding.installationId);
      await SecureStore.deleteItemAsync(BINDING_KEY, storageOptions);
    },
    cancel(): void { version++; },
  };
}
