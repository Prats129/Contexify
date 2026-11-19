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
import {
  reminderDraft,
  reminderSnapshot,
  reminderResult,
  reminderId,
  savedReminderPage,
  type ReminderDraft,
  type ReminderKind,
  planningJson,
  planningPath,
  operationPlan,
  operationResult,
  supportedOperationPlan,
  type OperationPlan,
  type OperationResult,
  type PlanningContext,
} from "@contexify/assistant-core";
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
  onAuthenticationRejected?: (authorization: string) => Promise<void>,
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
        if (response.status === 401)
          await onAuthenticationRejected?.(authorization.Authorization);
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
    contextId?: string,
  ): Promise<VolumeExecutionResult> {
    const bridge = controlBridge(mode);
    if (
      contextId !== undefined &&
      (mode !== "volume" ||
        typeof bridge.executeVolumeFromContext !== "function" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          contextId,
        ))
    )
      throw new Error(
        "Relative control requires a fresh context and compatible Android build.",
      );
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
        contextId !== undefined
          ? await bridge.executeVolumeFromContext!(
              binding.host,
              userId,
              binding.installationId,
              management.access_token,
              percent,
              contextId,
            )
          : mode === "volume"
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
  function supportsPlan(plan: OperationPlan): boolean {
    try {
      const bridge = controlBridge("volume");
      const capabilities = bridge.operationCapabilitiesV2?.();
      if (capabilities === undefined) return supportedOperationPlan(plan);
      if (
        !Array.isArray(capabilities) ||
        capabilities.length > 3 ||
        capabilities.some(
          (value) =>
            ![
              "media_volume.set",
              "brightness.set_app",
              "application.open",
            ].includes(value),
        )
      )
        return false;
      return supportedOperationPlan(plan, capabilities);
    } catch {
      return false;
    }
  }
  async function planControl(
    userId: string,
    plan?: OperationPlan,
  ): Promise<OperationResult | OperationResult[]> {
    const bridge = controlBridge("volume");
    if (!bridge.executePlanV2 || !bridge.reconcilePlansV2)
      throw new Error(
        "Plan execution and recovery require an updated compatible Android build.",
      );
    if (controlBusy || busy)
      throw new Error("A device operation is already in progress.");
    controlBusy = true;
    const generation = version;
    try {
      const binding = await readBinding(userId);
      if (!binding) throw new Error("Enable device controls first.");
      const management = await api.openSession(userId);
      if (generation !== version || binding.host !== (await host()))
        throw new Error("Plan request cancelled.");
      const result = plan
        ? await bridge.executePlanV2(
            binding.host,
            userId,
            binding.installationId,
            management.access_token,
            JSON.stringify(plan),
          )
        : await bridge.reconcilePlansV2(
            binding.host,
            userId,
            binding.installationId,
            management.access_token,
          );
      if (generation !== version || binding.host !== (await host()))
        throw new Error(
          "The session changed. Check previous actions before making a new request.",
        );
      if (plan) return operationResult(result, plan);
      if (!Array.isArray(result) || result.length > 3)
        throw new Error("Invalid recovery evidence.");
      const rows = result.map((value) => operationResult(value));
      if (new Set(rows.map((row) => row.plan_id)).size !== rows.length)
        throw new Error("Duplicate recovery evidence.");
      return rows;
    } finally {
      controlBusy = false;
    }
  }
  function reminderBridge() {
    const bridge = controlBridge("volume");
    if (
      !bridge.reminderSupport?.() ||
      !bridge.readReminders ||
      !bridge.executeReminder ||
      !bridge.listSavedReminders
    )
      throw new Error(
        "Reminders require an updated compatible Android build (Android 8 or later).",
      );
    return bridge;
  }
  async function reminderRequest<T>(
    userId: string,
    action: (
      bridge: ReturnType<typeof reminderBridge>,
      binding: Binding,
      token: string,
    ) => Promise<unknown>,
    decode: (value: unknown) => T,
  ): Promise<T> {
    const bridge = reminderBridge();
    if (controlBusy || busy)
      throw new Error("A device operation is already in progress.");
    controlBusy = true;
    const generation = version;
    let authorization: string | undefined;
    try {
      const selectedHost = await host();
      authorization = (
        await authHeaders(
          selectedHost + "/api/v1/assistant/security/device-session",
        )
      ).Authorization;
      const selected = await readBinding(userId);
      if (!selected)
        throw new Error(
          "Enable device controls for this signed-in account first.",
        );
      const management = await api.openSession(userId);
      if (generation !== version)
        throw new Error("Reminder request cancelled.");
      const value = await action(bridge, selected, management.access_token);
      if (
        generation !== version ||
        selected.host !== (await host()) ||
        authorization !==
          (
            await authHeaders(
              selectedHost + "/api/v1/assistant/security/device-session",
            )
          ).Authorization
      )
        throw new Error(
          "Your session changed. Reminder details were discarded.",
        );
      return decode(value);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "ERR_REMINDER_AUTH" && authorization)
        await onAuthenticationRejected?.(authorization);
      const explanations: Record<string, string> = {
        ERR_REMINDER_DST_GAP:
          "That clock time does not exist when daylight saving time changes. Choose another time.",
        ERR_REMINDER_DST_OVERLAP:
          "That clock time occurs twice. Choose First or Second occurrence for repeated hours.",
        ERR_REMINDER_HORIZON:
          "Choose a future time at least one minute away and within 90 days.",
        ERR_REMINDER_UNTIL:
          "Choose a valid repetition end date within 90 days.",
        ERR_REMINDER_ZONE: "Choose a valid time zone, such as Asia/Kolkata.",
        ERR_REMINDER_DATE_TIME:
          "Enter a real date as YYYY-MM-DD and time as HH:mm.",
        ERR_REMINDER_TITLE:
          "Use a title of 1-120 characters without control characters.",
        ERR_REMINDER_REPEAT: "Review the reminder repetition and end date.",
        ERR_REMINDER_AUTH:
          "Your reminder session expired or was revoked. Local alerts were disabled. Sign in again.",
        ERR_REMINDER_SERVER:
          "The reminder server rejected the request. Refresh reminders and check storage availability before retrying.",
      };
      if (code && explanations[code]) throw new Error(explanations[code]);
      throw error;
    } finally {
      controlBusy = false;
    }
  }
  function changeReminder(
    userId: string,
    kind: ReminderKind,
    payload: unknown,
    expectedId?: string,
  ) {
    return reminderRequest(
      userId,
      (bridge, selected, token) =>
        bridge.executeReminder!(
          selected.host,
          userId,
          selected.installationId,
          token,
          kind,
          JSON.stringify(payload),
        ),
      (value) => reminderResult(value, kind, expectedId),
    );
  }
  const api = {
    reminderSupported(): boolean {
      try {
        reminderBridge();
        return true;
      } catch {
        return false;
      }
    },
    async readReminders(userId: string) {
      return reminderRequest(
        userId,
        (bridge, selected, token) =>
          bridge.readReminders!(
            selected.host,
            userId,
            selected.installationId,
            token,
          ),
        reminderSnapshot,
      );
    },
    async createReminder(userId: string, draft: ReminderDraft) {
      return changeReminder(userId, "create", reminderDraft(draft));
    },
    async cancelReminder(userId: string, id: string) {
      return changeReminder(
        userId,
        "cancel",
        { reminder_id: reminderId(id) },
        id,
      );
    },
    async setReminderStorage(
      userId: string,
      mode: "device_only" | "account",
      revision: number,
    ) {
      if (
        !["device_only", "account"].includes(mode) ||
        !Number.isInteger(revision) ||
        revision < 0 ||
        revision > 1000000
      )
        throw new Error("Invalid reminder storage choice.");
      return changeReminder(userId, "storage", { mode, revision });
    },
    async savedReminders(userId: string, after?: string) {
      return reminderRequest(
        userId,
        (bridge, selected, token) =>
          bridge.listSavedReminders!(
            selected.host,
            userId,
            selected.installationId,
            token,
            after ? reminderId(after) : null,
          ),
        savedReminderPage,
      );
    },
    async deleteSavedReminder(userId: string, id: string) {
      return changeReminder(
        userId,
        "delete_saved",
        { reminder_id: reminderId(id) },
        id,
      );
    },
    async saveReminderCopy(userId: string, id: string): Promise<void> {
      reminderId(id);
      await reminderRequest(
        userId,
        (bridge, selected, token) => {
          if (!bridge.saveReminderCopy)
            throw new Error("Updated reminder build required.");
          return bridge.saveReminderCopy(
            selected.host,
            userId,
            selected.installationId,
            token,
            id,
          );
        },
        (value) => {
          if (typeof value !== "string" || value.length > 512)
            throw new Error("Invalid saved reminder result.");
          let result: unknown;
          try {
            result = JSON.parse(value);
          } catch {
            throw new Error("Invalid saved reminder result.");
          }
          if (
            !result ||
            typeof result !== "object" ||
            !("reminder_id" in result) ||
            !("stored" in result) ||
            result.reminder_id !== id ||
            result.stored !== true ||
            Object.keys(result).length !== 2
          )
            throw new Error("Saved reminder result changed.");
        },
      );
    },
    async requestReminderNotifications(): Promise<boolean> {
      const bridge = reminderBridge();
      if (!bridge.requestReminderNotifications)
        throw new Error("Compatible reminder build required.");
      const result = await bridge.requestReminderNotifications();
      if (
        !result ||
        typeof result !== "object" ||
        typeof (result as { granted?: unknown }).granted !== "boolean"
      )
        throw new Error("Invalid notification permission result.");
      return (result as { granted: boolean }).granted;
    },
    async clearReminderData(): Promise<void> {
      api.cancel();
      if (Platform.OS !== "android") return;
      let bridge: ReturnType<typeof deviceSecurity>;
      try {
        bridge = deviceSecurity();
      } catch {
        return;
      }
      await bridge.clearReminders?.();
    },
    async matchReminderAccount(userId: string): Promise<void> {
      if (Platform.OS !== "android") return;
      api.cancel();
      const saved = await SecureStore.getItemAsync(BINDING_KEY, storageOptions);
      let selected: Binding | null = null;
      try {
        selected = saved ? (JSON.parse(saved) as Binding) : null;
      } catch {
        /* Corrupt ownership cannot retain local reminder authority. */
      }
      if (
        !selected ||
        selected.userId !== userId ||
        selected.host !== (await host())
      )
        await api.clearReminderData();
    },
    supportsPlan,
    async executePlan(
      userId: string,
      plan: OperationPlan,
    ): Promise<OperationResult> {
      const snapshot = operationPlan(
        plan.plan_id,
        plan.plan_revision,
        plan.expires_at * 1000,
        plan.steps.map((step) => ({
          action: step.action,
          depends_on: [...step.depends_on],
        })),
        plan.context_id,
      );
      if (!supportsPlan(snapshot))
        throw new Error(
          "The whole plan must be supported before any step can run.",
        );
      return planControl(userId, snapshot) as Promise<OperationResult>;
    },
    async reconcilePlans(userId: string): Promise<OperationResult[]> {
      return planControl(userId) as Promise<OperationResult[]>;
    },
    async readVolumeContext(
      userId: string,
      signal: AbortSignal,
    ): Promise<unknown> {
      const bridge = controlBridge("volume");
      if (
        !bridge.readVolumeContext ||
        !bridge.executeVolumeFromContext ||
        controlBusy ||
        busy ||
        signal.aborted
      )
        throw new Error(
          "Fresh context requires a compatible idle Android build.",
        );
      const generation = version;
      const binding = await readBinding(userId);
      const selectedHost = await host();
      const url = `${selectedHost}/api/v1/assistant/security/device-session`;
      const parent = (await authHeaders(url)).Authorization;
      if (
        !binding ||
        !parent ||
        generation !== version ||
        signal.aborted ||
        controlBusy ||
        busy
      )
        throw new Error("Context reading cancelled.");
      const result = await bridge.readVolumeContext(
        binding.host,
        userId,
        binding.installationId,
      );
      if (
        generation !== version ||
        signal.aborted ||
        selectedHost !== (await host()) ||
        parent !== (await authHeaders(url)).Authorization ||
        generation !== version ||
        signal.aborted
      )
        throw new Error("Context reading cancelled.");
      return result;
    },
    async changeVolumeFromContext(
      userId: string,
      percent: number,
      contextId: string,
    ): Promise<VolumeExecutionResult> {
      return changeControl("volume", userId, percent, contextId);
    },
    async planningContext(
      userId: string,
      signal: AbortSignal,
    ): Promise<PlanningContext> {
      const generation = version;
      const selectedHost = await host();
      const parentUrl = `${selectedHost}/api/v1/assistant/security/device-session`;
      const authorization = (await authHeaders(parentUrl)).Authorization;
      const binding = await readBinding(userId);
      if (
        !binding ||
        !authorization ||
        signal.aborted ||
        generation !== version
      )
        throw new Error(
          "Enroll this account and device before using AI planning.",
        );
      const abort = () => api.cancel();
      signal.addEventListener("abort", abort, { once: true });
      let management: DeviceSessionResponse;
      try {
        management = await api.openSession(userId);
      } finally {
        signal.removeEventListener("abort", abort);
      }
      if (
        signal.aborted ||
        generation !== version ||
        management.scope !== "security:manage" ||
        typeof management.access_token !== "string" ||
        !management.access_token ||
        !Number.isFinite(management.expires_at)
      )
        throw new Error("Planning sign-in changed.");
      async function current(requestSignal: AbortSignal, revoking = false) {
        if (
          requestSignal.aborted ||
          (!revoking && generation !== version) ||
          management.expires_at * 1000 <= Date.now() ||
          selectedHost !== (await host()) ||
          authorization !== (await authHeaders(parentUrl)).Authorization ||
          requestSignal.aborted ||
          (!revoking && generation !== version)
        )
          throw new Error("Planning sign-in changed.");
      }
      await current(signal);
      return {
        userId,
        deviceId: binding.deviceId,
        async request(path, body, parent) {
          const endpoint = planningPath(path);
          // Cancellation must still allow best-effort withdrawal of the old grant.
          // Host, parent login, expiry and the server's grant ownership remain checked.
          const revoking = path.endsWith("/revoke");
          await current(parent, revoking);
          const controller = new AbortController();
          const abort = () => controller.abort();
          parent.addEventListener("abort", abort, { once: true });
          requests.add(controller);
          if (parent.aborted) controller.abort();
          try {
            const result = await planningJson(
              selectedHost + endpoint,
              {
                method: "POST",
                credentials: "omit",
                headers: {
                  Authorization: `Bearer ${management.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
              },
              controller.signal,
            );
            await current(controller.signal, revoking);
            return result;
          } finally {
            parent.removeEventListener("abort", abort);
            requests.delete(controller);
            controller.abort();
          }
        },
      };
    },
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
      try {
        void deviceSecurity()
          .cancelReminders?.()
          .catch(() => {});
      } catch {
        /* Compatible older binaries have no reminder state. */
      }
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
