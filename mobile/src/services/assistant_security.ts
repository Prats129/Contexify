import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { deviceSecurity } from "../../modules/assistant-device-security";
import type {
  ChallengeResponse,
  DeviceResponse,
  DeviceSessionResponse,
} from "../types/api-contracts";
import { volumeResult } from "./assistant_volume";
import { brightnessResult } from "./assistant_brightness";
import type { VolumeExecutionResult } from "../../modules/assistant-device-security";

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
  let controlBusy = false;
  const requests = new Set<AbortController>();
  async function host(): Promise<string> {
    const selected = await getHost();
    const url = new URL(selected);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Assistant enrollment requires its HTTPS server origin.");
    if (Platform.OS !== "android" && Platform.OS !== "ios")
      throw new Error("Device enrollment requires the native app.");
    return url.origin;
  }

  async function post<T>(
    selectedHost: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const generation = version;
    if (selectedHost !== (await host()))
      throw new Error("The server changed. Enroll again.");
    const url = `${selectedHost}/api/v1/assistant/security${path}`;
    const authorization = await authHeaders(url);
    if (generation !== version)
      throw new Error("Device security request was cancelled.");
    const controller = new AbortController();
    requests.add(controller);
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("Device security request was cancelled."));
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            "Device security request timed out. Review enrolled devices before trying again.",
          ),
        );
        controller.abort();
      }, 15000);
    });
    try {
      const operation = async (): Promise<T> => {
        const response = await fetch(url, {
          method: "POST",
          headers: { ...authorization, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "Device security request was rejected. Sign in again or revoke the old device.",
          );
        const result: T = await response.json();
        if (generation !== version)
          throw new Error("Device security request was cancelled.");
        if (selectedHost !== (await host()))
          throw new Error("The server changed. Enroll again.");
        if (
          (await authHeaders(url)).Authorization !== authorization.Authorization
        )
          throw new Error("Your sign-in changed. Start device security again.");
        return result;
      };
      // The deadline covers the response body and binding checks, not just headers.
      return await Promise.race([operation(), timeout, cancelled]);
    } finally {
      clearTimeout(timer!);
      controller.signal.removeEventListener("abort", abort);
      requests.delete(controller);
    }
  }

  async function proof(
    selectedHost: string,
    installationId: string,
    challenge: ChallengeResponse,
  ) {
    const signature = await deviceSecurity().signChallenge(
      installationId,
      challenge.payload,
    );
    if (selectedHost !== (await host()))
      throw new Error("The server changed. Enroll again.");
    return { challenge_id: challenge.challenge_id, signature };
  }

  function controlBridge(mode: "volume" | "brightness") {
    if (
      Platform.OS !== "android" ||
      process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED !== "true" ||
      process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST === "true" ||
      (mode === "volume"
        ? !deviceSecurity().executeVolume
        : !deviceSecurity().executeBrightness)
    )
      throw new Error(
        "Device control requires an explicitly enabled Android build.",
      );
    return deviceSecurity();
  }

  async function readBinding(userId: string): Promise<Binding | null> {
    const saved = await SecureStore.getItemAsync(BINDING_KEY, storageOptions);
    if (!saved) return null;
    const value: Binding = JSON.parse(saved);
    const identifier =
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    if (
      !value ||
      value.userId !== userId ||
      value.host !== (await host()) ||
      typeof value.installationId !== "string" ||
      !identifier.test(value.installationId) ||
      typeof value.deviceId !== "string" ||
      !identifier.test(value.deviceId)
    )
      throw new Error(
        "The device binding differs. Manage enrolled devices before continuing.",
      );
    return value;
  }

  async function changeControl(
    mode: "volume" | "brightness",
    userId: string,
    percent: number,
  ): Promise<VolumeExecutionResult> {
    const bridge = controlBridge(mode);
    if (
      !Number.isInteger(percent) ||
      percent < (mode === "volume" ? 0 : 10) ||
      percent > (mode === "volume" ? 70 : 100)
    )
      throw new Error("Requested percentage exceeds the capability limits.");
    if (controlBusy || busy)
      throw new Error("A device operation is already in progress.");
    controlBusy = true;
    const generation = version;
    try {
      const binding = await readBinding(userId);
      if (!binding)
        throw new Error(
          mode === "volume"
            ? "Enable volume control on this device first."
            : "Enable app brightness control on this device first.",
        );
      const management = await api.openSession(userId);
      const selectedHost = await host();
      if (generation !== version || binding.host !== selectedHost)
        throw new Error("Device control request was cancelled.");
      // The native module obtains its own real scope and owns every authorization/OS step.
      const result =
        mode === "volume"
          ? await bridge.executeVolume!(
              binding.host,
              userId,
              binding.installationId,
              management.access_token,
              percent,
            )
          : await bridge.executeBrightness!(
              binding.host,
              userId,
              binding.installationId,
              management.access_token,
              percent,
            );
      if (generation !== version)
        throw new Error(
          "The session changed. Check the device setting before trying again.",
        );
      return mode === "volume"
        ? volumeResult(result, percent)
        : brightnessResult(result, percent);
    } finally {
      controlBusy = false;
    }
  }
  const api = {
    async enableVolume(userId: string): Promise<void> {
      controlBridge("volume");
      const generation = version;
      const binding = await readBinding(userId);
      if (generation !== version)
        throw new Error("Device setup was cancelled.");
      if (!binding) await api.enroll(userId);
      if (generation !== version)
        throw new Error("Device setup was cancelled.");
    },
    async changeVolume(
      userId: string,
      percent: number,
    ): Promise<VolumeExecutionResult> {
      return changeControl("volume", userId, percent);
    },
    async enableBrightness(userId: string): Promise<void> {
      controlBridge("brightness");
      const generation = version;
      const binding = await readBinding(userId);
      if (generation !== version)
        throw new Error("Device setup was cancelled.");
      if (!binding) await api.enroll(userId);
      if (generation !== version)
        throw new Error("Device setup was cancelled.");
    },
    async changeBrightness(
      userId: string,
      percent: number,
    ): Promise<VolumeExecutionResult> {
      return changeControl("brightness", userId, percent);
    },
    async enroll(userId: string): Promise<DeviceResponse> {
      if (busy) throw new Error("Device enrollment is already in progress.");
      busy = true;
      const generation = version;
      let created: string | null = null;
      try {
        const selectedHost = await host();
        const enrollmentUrl = `${selectedHost}/api/v1/assistant/security/enrollment`;
        const parentAuthorization = (await authHeaders(enrollmentUrl))
          .Authorization;
        if (await SecureStore.getItemAsync(BINDING_KEY, storageOptions))
          throw new Error(
            "Disable the existing device binding before enrolling again.",
          );
        const key = await deviceSecurity().createKey(selectedHost, userId);
        created = key.installation_id;
        const challenge = await post<ChallengeResponse>(
          selectedHost,
          "/enrollment/challenge",
          {
            ...key,
            platform: Platform.OS,
          },
        );
        const device = await post<DeviceResponse>(
          selectedHost,
          "/enrollment",
          await proof(selectedHost, key.installation_id, challenge),
        );
        if (
          generation !== version ||
          parentAuthorization !==
            (await authHeaders(enrollmentUrl)).Authorization
        )
          throw new Error(
            "Device enrollment was cancelled or your sign-in changed.",
          );
        const binding: Binding = {
          userId,
          host: selectedHost,
          installationId: key.installation_id,
          deviceId: device.device_id,
        };
        await SecureStore.setItemAsync(
          BINDING_KEY,
          JSON.stringify(binding),
          storageOptions,
        );
        if (
          generation !== version ||
          parentAuthorization !==
            (await authHeaders(enrollmentUrl)).Authorization
        ) {
          await SecureStore.deleteItemAsync(BINDING_KEY, storageOptions);
          throw new Error("Device enrollment was cancelled.");
        }
        created = null;
        return device;
      } finally {
        try {
          if (created) await deviceSecurity().deleteKey(created);
        } finally {
          busy = false;
        }
      }
    },
    async openSession(userId: string): Promise<DeviceSessionResponse> {
      const generation = version;
      const selectedHost = await host();
      const sessionUrl = `${selectedHost}/api/v1/assistant/security/device-session`;
      const parentAuthorization = (await authHeaders(sessionUrl)).Authorization;
      const saved = await SecureStore.getItemAsync(BINDING_KEY, storageOptions);
      const binding: Binding | null = saved ? JSON.parse(saved) : null;
      if (
        !binding ||
        binding.userId !== userId ||
        binding.host !== selectedHost
      )
        throw new Error("Enroll this account and device first.");
      const challenge = await post<ChallengeResponse>(
        selectedHost,
        "/device-session/challenge",
        { device_id: binding.deviceId },
      );
      const result = await post<DeviceSessionResponse>(
        selectedHost,
        "/device-session",
        await proof(selectedHost, binding.installationId, challenge),
      );
      if (
        generation !== version ||
        parentAuthorization !== (await authHeaders(sessionUrl)).Authorization
      )
        throw new Error("Your assistant session changed.");
      // Callers may hold this management-only token in memory, never AsyncStorage.
      return result;
    },
    async forget(): Promise<void> {
      api.cancel();
      const saved = await SecureStore.getItemAsync(BINDING_KEY, storageOptions);
      const binding: Binding | null = saved ? JSON.parse(saved) : null;
      if (binding) await deviceSecurity().deleteKey(binding.installationId);
      await SecureStore.deleteItemAsync(BINDING_KEY, storageOptions);
    },
    cancel(): void {
      version++;
      for (const request of requests) request.abort();
      try {
        void deviceSecurity()
          .cancelVolume?.()
          .catch(() => {});
      } catch {
        /* Older binaries have no real executor. */
      }
      try {
        void deviceSecurity()
          .cancelBrightness?.()
          .catch(() => {});
      } catch {
        /* Older binaries have no brightness executor. */
      }
    },
  };
  return api;
}
