import { AppState, Platform } from "react-native";
import { assistantPlatform } from "../../modules/assistant-platform";
import {
  communicationDraft,
  communicationResult,
  type CommunicationDraft,
} from "@contexify/assistant-core";

let sequence = 0;
const unavailable = { picker: false, dial: false, sms: false };

/** Foreground OS presentation only: no auth signer, provider, HTTP or persistence. */
export function createCommunicationCompanion() {
  let native: ReturnType<typeof assistantPlatform> = null;
  if (Platform.OS === "android" || Platform.OS === "ios") {
    try {
      native = assistantPlatform();
    } catch {
      /* Old binaries use the manual alternative. */
    }
  }
  const port = native;
  let generation = 0;
  let active: {
    id: string;
    kind: "picker" | "composer";
    version: number;
  } | null = null;
  let disposed = false;
  const available = Boolean(
    port &&
    [
      "communicationSupport",
      "pickPhoneNumber",
      "openCommunication",
      "cancelCommunicationRequest",
    ].every((key) => typeof port[key as keyof typeof port] === "function"),
  );
  function begin(kind: "picker" | "composer") {
    if (!available || disposed || active || AppState.currentState !== "active")
      throw new Error(
        "This phone feature is unavailable or already open. Use the phone's Contacts, Phone or Messages app directly.",
      );
    const operation = {
      id: `communication-${++sequence}-${Date.now()}`,
      kind,
      version: ++generation,
    };
    active = operation;
    return operation;
  }
  function cancel() {
    generation++;
    const request = active;
    active = null;
    if (request) {
      try {
        void port?.cancelCommunicationRequest?.(request.id).catch(() => {});
      } catch {
        /* Cleanup cannot revive a disappearing native bridge. */
      }
    }
  }
  return {
    planningSupported() {
      return available && typeof port?.openPlannedCommunication === "function";
    },
    async support() {
      if (!available || disposed) return { ...unavailable };
      try {
        const value = await port!.communicationSupport!();
        if (disposed) return { ...unavailable };
        return {
          picker: value?.picker === true,
          dial: value?.dial === true,
          sms: value?.sms === true,
        };
      } catch {
        return { ...unavailable };
      }
    },
    isPicking() {
      return active?.kind === "picker";
    },
    background() {
      // Android's OS picker is a separate activity. Only that explicitly requested
      // selection may return; it grants no call/send authority and has a native timeout.
      if (!(Platform.OS === "android" && active?.kind === "picker")) cancel();
    },
    async pickNumber(): Promise<string | null> {
      const operation = begin("picker");
      try {
        const value = await port!.pickPhoneNumber!(operation.id);
        if (
          disposed ||
          generation !== operation.version ||
          AppState.currentState !== "active"
        )
          return null;
        if (value?.outcome === "cancelled") return null;
        if (
          value?.outcome !== "selected" ||
          typeof value.number !== "string" ||
          value.number.length > 64 ||
          !/^[+0-9 ()-]+$/.test(value.number)
        )
          throw new Error(
            "The selected number is unavailable or contains an extension. Enter an international number manually.",
          );
        return value.number;
      } finally {
        if (active === operation) active = null;
      }
    },
    async open(value: CommunicationDraft, expiresAt?: number): Promise<string> {
      const draft = communicationDraft(value); // Freeze a fresh copy before any await.
      if (
        expiresAt !== undefined &&
        (!Number.isFinite(expiresAt) ||
          expiresAt <= Date.now() ||
          expiresAt > Date.now() + 185000 ||
          typeof port?.openPlannedCommunication !== "function")
      )
        throw new Error(
          "The AI proposal expired or needs an updated native build. Review a fresh command.",
        );
      const operation = begin("composer");
      try {
        const result =
          expiresAt === undefined
            ? await port!.openCommunication!(
                operation.id,
                JSON.stringify(draft),
              )
            : await port!.openPlannedCommunication!(
                operation.id,
                JSON.stringify(draft),
                expiresAt,
              );
        if (
          disposed ||
          generation !== operation.version ||
          AppState.currentState !== "active"
        )
          return "";
        return communicationResult(result);
      } finally {
        if (active === operation) active = null;
      }
    },
    cancel,
    dispose() {
      cancel();
      disposed = true;
    },
  };
}
