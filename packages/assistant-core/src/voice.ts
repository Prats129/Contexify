import { planCommand } from "./planner";
import { VoiceInputError } from "./voice-errors";
import {
  supported,
  validateAction,
  type AssistantAction,
  type AssistantPlatform,
} from "./validation";

export interface VoiceAvailability {
  recognition: boolean;
  synthesis: boolean;
  message: string;
}

/** Implementations must use local processing, release resources on cancel and never retain audio. */
export interface ForegroundVoiceAdapter {
  availability(): Promise<VoiceAvailability>;
  listen(
    onPartial: (text: string) => void,
    onListening: () => void,
  ): Promise<string>;
  stop(): void;
  cancel(): void;
  speak(text: string): Promise<void>;
  dispose(): void;
}

export interface CommandPreview {
  description: string;
  availableOnPlatform: boolean;
}
export interface CommandSessionState {
  transcript: string;
  partial: string;
  phase: "idle" | "starting" | "listening" | "processing" | "speaking";
  consent: boolean;
  preview: readonly CommandPreview[] | null;
  message: string;
  availability: VoiceAvailability;
}

export function describeAction(value: AssistantAction): string {
  const action = validateAction(value);
  switch (action.capability_id) {
    case "media_volume.set":
      return `Set media volume to ${action.percent}%.`;
    case "brightness.set_app":
      return `Set app brightness to ${action.percent}%.`;
    case "application.open":
      return `Open ${action.application_id === "spotify" ? "Spotify" : "Clock"}.`;
  }
}

/** A memory-only input/review session. It has no transport, executor or storage port. */
export function createCommandSession(
  adapter: ForegroundVoiceAdapter,
  platform: AssistantPlatform,
) {
  let state: CommandSessionState = {
    transcript: "",
    partial: "",
    phase: "idle",
    consent: false,
    preview: null,
    message: "",
    availability: {
      recognition: false,
      synthesis: false,
      message: "Checking on-device voice support…",
    },
  };
  let generation = 0,
    disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectPending: ((error: Error) => void) | undefined;
  const subscribers = new Set<() => void>();
  function update(patch: Partial<CommandSessionState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    subscribers.forEach((listener) => listener());
  }
  function stopAdapter() {
    // Purging the transcript must still happen if a platform is already tearing down.
    try {
      adapter.cancel();
    } catch {
      /* Native lifetime/deadline guards are independent. */
    }
  }
  function invalidate() {
    generation++;
    rejectPending?.(new Error("Voice cancelled."));
    rejectPending = undefined;
    clearTimeout(timer);
    stopAdapter();
  }
  function deadline(milliseconds: number) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      rejectPending?.(new VoiceInputError("timeout"));
      stopAdapter();
    }, milliseconds);
  }
  async function bounded<T>(
    work: Promise<T>,
    milliseconds: number,
  ): Promise<T> {
    let rejectThis: (error: Error) => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectThis = reject;
      rejectPending = reject;
    });
    deadline(milliseconds);
    try {
      return await Promise.race([work, cancelled]);
    } finally {
      if (rejectPending === rejectThis!) {
        clearTimeout(timer);
        rejectPending = undefined;
      }
    }
  }
  const session = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    async refreshAvailability() {
      let probeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const availability = await Promise.race([
          adapter.availability(),
          new Promise<never>((_, reject) => {
            probeTimer = setTimeout(
              () => reject(new Error("Voice availability timed out.")),
              3000,
            );
          }),
        ]);
        if (!disposed)
          update({
            availability: {
              recognition: availability.recognition === true,
              synthesis: availability.synthesis === true,
              message:
                typeof availability.message === "string"
                  ? availability.message.slice(0, 240)
                  : "On-device voice is unavailable. You can still type.",
            },
          });
      } catch {
        if (!disposed)
          update({
            availability: {
              recognition: false,
              synthesis: false,
              message: "On-device voice is unavailable. You can still type.",
            },
          });
      } finally {
        clearTimeout(probeTimer);
      }
    },
    setConsent(consent: boolean) {
      if (disposed) return;
      if (consent !== true) {
        session.clear();
        return;
      }
      update({ consent: true });
    },
    setTranscript(text: string) {
      if (disposed) return;
      invalidate();
      if (typeof text !== "string" || text.length > 1024) {
        update({
          transcript: "",
          partial: "",
          phase: "idle",
          preview: null,
          message: "Use at most 1,024 characters.",
        });
        return;
      }
      update({
        transcript: text,
        partial: "",
        phase: "idle",
        preview: null,
        message: "",
      });
    },
    review() {
      if (disposed) return;
      invalidate();
      const result = planCommand(state.transcript, "user");
      update({
        phase: "idle",
        partial: "",
        preview:
          result.status === "proposed"
            ? result.proposal.steps.map((step) => ({
                description: describeAction(step.action),
                availableOnPlatform: supported(step.action, platform),
              }))
            : null,
        message:
          result.status === "proposed"
            ? "Preview only. No device action has been performed."
            : result.message,
      });
    },
    async listen() {
      if (disposed || state.phase !== "idle") return;
      if (!state.consent || !state.availability.recognition) {
        update({
          message: !state.consent
            ? 'Select "Allow the microphone" first, then tap Use microphone.'
            : state.availability.message,
        });
        return;
      }
      const version = ++generation;
      update({
        phase: "starting",
        partial: "",
        preview: null,
        message: "Starting microphone…",
      });
      try {
        const text = await bounded(
          adapter.listen(
            (partial) => {
              if (
                !disposed &&
                version === generation &&
                typeof partial === "string" &&
                partial.length <= 1024
              )
                update({ partial });
            },
            () => {
              if (
                !disposed &&
                version === generation &&
                state.phase === "starting"
              )
                update({
                  phase: "listening",
                  message: "Listening on this device…",
                });
            },
          ),
          30000,
        );
        if (disposed || version !== generation) return;
        if (typeof text !== "string" || !text.trim() || text.length > 1024)
          throw new Error("No usable transcript. Type or try again.");
        generation++;
        stopAdapter();
        update({
          transcript: text,
          partial: "",
          phase: "idle",
          message: "Check or edit the transcript, then choose Review command.",
        });
      } catch (error) {
        if (!disposed && version === generation) {
          generation++;
          stopAdapter();
          update({
            phase: "idle",
            partial: "",
            message:
              error instanceof VoiceInputError
                ? new VoiceInputError(error.reason, error.androidCode).message
                : "Voice stopped or unavailable. Type or try again.",
          });
        }
      }
    },
    stop() {
      if (
        disposed ||
        (state.phase !== "listening" && state.phase !== "starting")
      )
        return;
      update({ phase: "processing", message: "Finishing the transcript…" });
      deadline(5000);
      try {
        adapter.stop();
      } catch {
        session.clear();
      }
    },
    async readPreview() {
      if (
        disposed ||
        state.phase !== "idle" ||
        !state.preview ||
        !state.availability.synthesis
      )
        return;
      const version = ++generation;
      const text = `Preview only. ${state.preview.map((item) => item.description).join(" ")} No device action will be performed.`;
      update({
        phase: "speaking",
        message: "Reading the preview on this device…",
      });
      let message = "Preview only. No device action has been performed.";
      try {
        await bounded(adapter.speak(text), 30000);
      } catch {
        message =
          "Local speech playback stopped or unavailable. Read the preview on screen.";
      } finally {
        if (!disposed && version === generation)
          update({ phase: "idle", message });
      }
    },
    clear() {
      if (disposed) return;
      invalidate();
      update({
        transcript: "",
        partial: "",
        phase: "idle",
        preview: null,
        consent: false,
        message: "",
      });
    },
    dispose() {
      if (disposed) return;
      session.clear();
      disposed = true;
      subscribers.clear();
      adapter.dispose();
    },
  };
  return session;
}
