import { planCommand } from "./planner";
import {
  operationPlan,
  supportedOperationPlan,
  type OperationPlan,
} from "./operations";
import { VoiceInputError } from "./voice-errors";
import {
  resolveClarification,
  type PendingClarification,
  type PercentTarget,
  type VolumeContextReader,
} from "./clarification";
import {
  PlanningError,
  planningFeedback,
  reviewedCommand,
  reviewedPercent,
  type CommandPlanner,
  type ReviewedCommand,
} from "./planning";
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
  planningConsent: boolean;
  reviewed: ReviewedCommand | null;
  clarification: PendingClarification | null;
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

/** Memory-only review state. Its optional planner has no executor or storage port. */
export function createCommandSession(
  adapter: ForegroundVoiceAdapter,
  platform: AssistantPlatform,
  planner?: CommandPlanner,
  readVolumeContext?: VolumeContextReader,
  supportsPlan: (plan: OperationPlan) => boolean = supportedOperationPlan,
) {
  let state: CommandSessionState = {
    transcript: "",
    partial: "",
    phase: "idle",
    consent: false,
    planningConsent: false,
    reviewed: null,
    clarification: null,
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
  let planningRequest: AbortController | null = null;
  let previousTarget: { capability: PercentTarget; expiresAt: number } | null =
    null;
  function remember(review: ReviewedCommand | null) {
    const capability =
      review?.actions.length === 1 ? review.actions[0].capability_id : null;
    previousTarget =
      capability === "media_volume.set" || capability === "brightness.set_app"
        ? { capability, expiresAt: Date.now() + 60000 }
        : null;
  }
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
    planningRequest?.abort();
    planningRequest = null;
    rejectPending?.(new Error("Voice cancelled."));
    rejectPending = undefined;
    clearTimeout(timer);
    stopAdapter();
    update({ reviewed: null, clarification: null });
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
    setPlanningConsent(consent: boolean) {
      if (disposed) return;
      invalidate();
      if (!consent) {
        planner?.close();
        previousTarget = null;
      }
      update({
        planningConsent: consent === true && Boolean(planner),
        phase: "idle",
        partial: "",
        preview: null,
        message: "",
      });
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
    async review() {
      if (disposed || state.phase !== "idle") return;
      invalidate();
      if (state.planningConsent && planner) {
        const version = generation;
        const controller = new AbortController();
        planningRequest = controller;
        update({
          phase: "processing",
          preview: null,
          partial: "",
          message: "Understanding your command…",
        });
        try {
          const response = await planner.plan(
            state.transcript,
            controller.signal,
          );
          if (disposed || version !== generation || controller.signal.aborted)
            return;
          const proposal = response.proposal;
          const review =
            proposal.status === "proposed"
              ? reviewedCommand(
                  proposal.steps.map((step) => step.action),
                  "planner",
                  response.expires_at * 1000,
                  undefined,
                  operationPlan(
                    response.plan_id,
                    response.revision ?? 1,
                    response.expires_at * 1000,
                    proposal.steps,
                  ),
                )
              : null;
          if (review) remember(review);
          update({
            phase: "idle",
            reviewed: review,
            clarification:
              proposal.status === "needs_clarification" &&
              [
                "missing_target",
                "missing_value",
                "relative_value",
                "ambiguous_request",
              ].includes(proposal.reason)
                ? Object.freeze({
                    id: version,
                    planId: response.plan_id,
                    expiresAt: Date.now() + 60000,
                    previousTarget:
                      previousTarget && previousTarget.expiresAt > Date.now()
                        ? previousTarget.capability
                        : null,
                  })
                : null,
            preview: review
              ? review.actions.map((action) => ({
                  description: describeAction(action),
                  availableOnPlatform:
                    platform === "android" &&
                    Boolean(
                      review.operationPlan &&
                      supportsPlan(review.operationPlan),
                    ),
                }))
              : null,
            message:
              proposal.status !== "proposed"
                ? planningFeedback(proposal)
                : !supportsPlan(review!.operationPlan!)
                  ? "This whole plan is preview only because its actions or their order are unsupported on this build. No part of this plan will be executed."
                  : "Plan reviewed. No device action has been performed.",
          });
        } catch (error) {
          if (!disposed && version === generation && !controller.signal.aborted)
            update({
              phase: "idle",
              preview: null,
              reviewed: null,
              message:
                error instanceof PlanningError
                  ? error.message
                  : "AI planning is unavailable. No device action was performed.",
            });
        } finally {
          if (planningRequest === controller) planningRequest = null;
        }
        return;
      }
      const result = planCommand(state.transcript, "user");
      const localReview =
        result.status === "proposed"
          ? reviewedCommand(
              result.proposal.steps.map((step) => step.action),
              "local",
              Date.now() + 180000,
            )
          : null;
      if (localReview) remember(localReview);
      update({
        phase: "idle",
        partial: "",
        reviewed: localReview,
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
    takeReviewedPlan(): OperationPlan | null {
      const plan = state.reviewed?.operationPlan;
      if (
        disposed ||
        state.phase !== "idle" ||
        platform !== "android" ||
        !plan ||
        !supportsPlan(plan)
      )
        return null;
      update({ reviewed: null });
      return plan;
    },
    takeReviewedPercent(
      capability: "media_volume.set" | "brightness.set_app",
    ): number | null {
      if (state.reviewed?.contextId) return null; // Never discard a required native precondition.
      return session.takeReviewedControl(capability)?.percent ?? null;
    },
    takeReviewedControl(
      capability: "media_volume.set" | "brightness.set_app",
    ): { percent: number; contextId?: string } | null {
      if (disposed || state.phase !== "idle" || platform !== "android")
        return null;
      if (state.reviewed?.operationPlan) return null; // V2 plans must retain stable operation identity.
      const percent = reviewedPercent(state.reviewed, capability);
      if (percent === null) return null;
      const contextId = state.reviewed?.contextId;
      update({ reviewed: null });
      return { percent, ...(contextId ? { contextId } : {}) };
    },
    async clarify(
      answer: unknown,
      allowLocalRead: boolean,
      questionId: number,
    ) {
      const pending = state.clarification;
      if (
        disposed ||
        state.phase !== "idle" ||
        !state.planningConsent ||
        !pending
      )
        return;
      if (questionId !== pending.id) {
        update({
          message: "The clarification changed. Review the current question.",
        });
        return;
      }
      if (pending.expiresAt <= Date.now()) {
        update({
          clarification: null,
          message: "The clarification expired. Submit a new command.",
        });
        return;
      }
      invalidate();
      const version = generation;
      const controller = new AbortController();
      planningRequest = controller;
      update({
        phase: "processing",
        clarification: pending,
        preview: null,
        message: "Resolving the clarified command locally…",
      });
      try {
        const result = await resolveClarification(
          answer,
          platform === "android" ? readVolumeContext : undefined,
          allowLocalRead,
          controller.signal,
        );
        if (disposed || version !== generation || controller.signal.aborted)
          return;
        if (pending.expiresAt <= Date.now())
          throw new PlanningError(
            "The clarification expired. Submit a new command.",
          );
        const review =
          pending.planId &&
          result.review.actions[0].capability_id === "media_volume.set"
            ? reviewedCommand(
                [...result.review.actions],
                "clarification",
                result.review.expiresAt,
                result.review.contextId,
                operationPlan(
                  pending.planId,
                  2,
                  result.review.expiresAt,
                  result.review.actions.map((action) => ({ action })),
                  result.review.contextId,
                ),
              )
            : result.review;
        remember(review);
        update({
          phase: "idle",
          reviewed: review,
          clarification: null,
          preview: result.review.actions.map((action) => ({
            description: describeAction(action) + " " + result.summary,
            availableOnPlatform:
              platform === "android" &&
              action.capability_id === "media_volume.set",
          })),
          message: result.summary,
        });
      } catch (error) {
        if (!disposed && version === generation && !controller.signal.aborted)
          update({
            phase: "idle",
            reviewed: null,
            clarification: pending.expiresAt > Date.now() ? pending : null,
            message:
              error instanceof PlanningError
                ? error.message
                : "Local context is unavailable. Choose an exact percentage instead.",
          });
      } finally {
        if (planningRequest === controller) planningRequest = null;
      }
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
        reviewed: null,
        clarification: null,
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
        if (state.planningConsent) await session.review();
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
      planner?.close();
      previousTarget = null;
      update({
        transcript: "",
        partial: "",
        phase: "idle",
        preview: null,
        consent: false,
        planningConsent: false,
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
