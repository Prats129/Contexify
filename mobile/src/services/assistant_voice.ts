import { Platform } from "react-native";
import {
  VoiceInputError,
  type VoiceInputFailure,
  type ForegroundVoiceAdapter,
} from "@contexify/assistant-core";
import {
  assistantVoice,
  type AssistantVoiceModule,
  type VoiceEvent,
} from "../../modules/assistant-voice";

let requestSequence = 0;

const nativeFailures: Readonly<Record<string, VoiceInputFailure>> = {
  ERR_SPEECH_1: "connection",
  ERR_SPEECH_2: "connection",
  ERR_SPEECH_3: "audio",
  ERR_SPEECH_4: "service",
  ERR_SPEECH_5: "service",
  ERR_SPEECH_6: "no_speech",
  ERR_SPEECH_7: "no_match",
  ERR_SPEECH_8: "busy",
  ERR_SPEECH_9: "permission_denied",
  ERR_SPEECH_10: "busy",
  ERR_SPEECH_11: "service",
  ERR_SPEECH_12: "language_unsupported",
  ERR_SPEECH_13: "language_unavailable",
  ERR_VOICE_PERMISSION: "permission_denied",
  ERR_VOICE_FOREGROUND: "foreground",
  ERR_VOICE_FOCUS: "focus",
  ERR_VOICE_TIMEOUT: "timeout",
  ERR_VOICE_CANCELLED: "cancelled",
};

function inputFailure(error: unknown): VoiceInputError {
  // Do not display native exception messages, transcripts, or accessor values.
  const code =
    error && typeof error === "object"
      ? Object.getOwnPropertyDescriptor(error, "code")?.value
      : undefined;
  const match =
    typeof code === "string" ? /^ERR_SPEECH_([1-9]|1[0-3])$/.exec(code) : null;
  return new VoiceInputError(
    typeof code === "string" &&
      Object.prototype.hasOwnProperty.call(nativeFailures, code)
      ? nativeFailures[code]
      : "unavailable",
    match ? Number(match[1]) : undefined,
  );
}

/** Missing native builds and iOS use text; there is no cloud or software fallback. */
export function createMobileVoiceAdapter(
  enabled: boolean,
): ForegroundVoiceAdapter {
  let native: AssistantVoiceModule | null = null;
  if (enabled && Platform.OS === "android") {
    try {
      native = assistantVoice();
    } catch {
      /* Missing or incompatible native bridge keeps text available. */
    }
  }
  let generation = 0,
    disposed = false,
    busy = false;
  let activeId: string | null = null;
  let subscriptions: Array<{ remove(): void }> = [];
  const removeSubscriptions = () => {
    subscriptions.forEach((subscription) => subscription.remove());
    subscriptions = [];
  };
  const adapter: ForegroundVoiceAdapter = {
    async availability() {
      if (!native || disposed)
        return {
          recognition: false,
          synthesis: false,
          message: !enabled
            ? "Voice is not enabled in this build. You can still type."
            : "On-device voice requires a compatible Android build. You can still type.",
        };
      return native.availability();
    },
    async listen(onPartial, onListening) {
      if (!native || disposed || busy)
        throw new Error("On-device voice unavailable.");
      busy = true;
      const version = ++generation,
        id = `listen-${++requestSequence}-${Date.now()}`;
      activeId = id;
      try {
        subscriptions.push(
          native.addListener("onListening", (event: VoiceEvent) => {
            if (!disposed && generation === version && event.request_id === id)
              onListening();
          }),
        );
        subscriptions.push(
          native.addListener("onPartial", (event: VoiceEvent) => {
            if (
              !disposed &&
              generation === version &&
              event.request_id === id &&
              typeof event.text === "string" &&
              event.text.length <= 1024
            )
              onPartial(event.text);
          }),
        );
        const text = await native.listen(id, true);
        if (
          disposed ||
          generation !== version ||
          typeof text !== "string" ||
          text.length > 1024
        )
          throw new Error("Voice session changed.");
        return text;
      } catch (error) {
        if (generation === version) {
          // Also stop an engine if the bridge fails before native cleanup settles.
          try {
            void native.cancel(id).catch(() => {});
          } catch {
            /* Bridge may already be unavailable. */
          }
        }
        throw inputFailure(error);
      } finally {
        if (generation === version) {
          removeSubscriptions();
          busy = false;
          activeId = null;
        }
      }
    },
    stop() {
      const version = generation,
        id = activeId;
      if (native && id)
        void native.stop(id).catch(() => {
          if (generation === version) adapter.cancel();
        });
    },
    cancel() {
      const id = activeId;
      generation++;
      busy = false;
      activeId = null;
      removeSubscriptions();
      if (native && id)
        void native.cancel(id).catch(() => {
          /* Native lifecycle/timeout cleanup remains independent. */
        });
    },
    async speak(text) {
      if (
        !native ||
        disposed ||
        busy ||
        typeof text !== "string" ||
        text.length > 1000
      )
        throw new Error("Local speech playback unavailable.");
      busy = true;
      const version = ++generation;
      const id = `speak-${++requestSequence}-${Date.now()}`;
      activeId = id;
      try {
        await native.speak(id, text);
      } finally {
        if (generation === version) {
          busy = false;
          activeId = null;
        }
      }
    },
    dispose() {
      adapter.cancel();
      disposed = true;
    },
  };
  return adapter;
}
