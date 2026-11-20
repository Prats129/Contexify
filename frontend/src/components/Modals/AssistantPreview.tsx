import { useEffect, useRef, useState } from "react";
import {
  createCommandSession,
  createPublicAssistantPlanner,
  PlanningError,
  companionFeatures,
  type CommandSessionState,
  type PlanningAccess,
} from "@contexify/assistant-core";
import { createBrowserVoiceAdapter } from "../../services/assistant_voice";
import { ClarificationForm } from "./ClarificationForm";

export function AssistantPreview({
  onClose,
  voiceAllowed = false,
  planningAccess,
  planningUserId,
}: {
  onClose: () => void;
  voiceAllowed?: boolean;
  planningAccess?: PlanningAccess;
  planningUserId?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sessionRef = useRef<ReturnType<typeof createCommandSession> | null>(
    null,
  );
  const [state, setState] = useState<CommandSessionState | null>(null);
  useEffect(() => {
    const session = createCommandSession(
      createBrowserVoiceAdapter(
        voiceAllowed && import.meta.env.VITE_ASSISTANT_VOICE_ENABLED === "true",
      ),
      "web",
      planningAccess && planningUserId
        ? createPublicAssistantPlanner(
            (signal) => planningAccess.planningContext(planningUserId, signal),
            () => {
              throw new PlanningError(
                "Calls and messages require a supported native app. No phone action was performed.",
              );
            },
          )
        : undefined,
    );
    sessionRef.current = session;
    setState(session.getSnapshot());
    const unsubscribe = session.subscribe(() =>
      setState(session.getSnapshot()),
    );
    void session.refreshAvailability();
    const clear = () => session.clear();
    const hidden = () => {
      if (document.visibilityState !== "visible") clear();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", clear);
    window.addEventListener("blur", clear);
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      unsubscribe();
      session.dispose();
      sessionRef.current = null;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("blur", clear);
      dialog.close();
    };
  }, [voiceAllowed, planningAccess, planningUserId]);
  const busy = state?.phase !== "idle";
  const capturing = state?.phase === "starting" || state?.phase === "listening";
  function closePreview() {
    sessionRef.current?.clear();
    onClose();
  }
  const buttonClass =
    "rounded-lg border border-(--border-subtle) px-3 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="assistant-preview-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[85dvh] overflow-y-auto rounded-2xl border border-(--border-subtle) bg-(--bg-app) text-(--text-main) p-5 shadow-2xl backdrop:bg-black/60"
      onCancel={(event) => {
        event.preventDefault();
        closePreview();
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="assistant-preview-title" className="text-lg font-semibold">
          Assistant preview
        </h2>
        <button
          type="button"
          className={buttonClass}
          onClick={closePreview}
          aria-label="Close assistant preview"
        >
          Close
        </button>
      </div>
      {state?.clarification && (
        <ClarificationForm
          key={state.clarification.id}
          pending={state.clarification}
          busy={busy}
          onSubmit={(answer, consent) => {
            void sessionRef.current?.clarify(
              answer,
              consent,
              state.clarification!.id,
            );
          }}
        />
      )}
      <p className="text-sm text-(--text-muted) mb-4">
        Type or dictate a command, then review the steps. This preview cannot
        change your phone or open apps.
      </p>
      <details className="text-sm mb-4 rounded-lg border border-(--border-subtle) p-3">
        <summary className="cursor-pointer">
          What works in this browser?
        </summary>
        <ul className="space-y-3 mt-3">
          {state &&
            companionFeatures("web", state.availability).map((feature) => (
              <li key={feature.id}>
                <strong>
                  {feature.label}: {feature.status.replace(/_/g, " ")}
                </strong>
                <p className="text-(--text-muted)">{feature.detail}</p>
              </li>
            ))}
        </ul>
      </details>
      <label
        htmlFor="assistant-command"
        className="block text-sm font-medium mb-2"
      >
        Your command or transcript
      </label>
      <textarea
        id="assistant-command"
        autoFocus
        maxLength={1024}
        rows={3}
        disabled={
          capturing || (state?.phase === "processing" && !state.planningConsent)
        }
        className="w-full rounded-lg border border-(--border-subtle) bg-(--bg-card) p-3 text-sm resize-y"
        value={state?.transcript ?? ""}
        onChange={(event) =>
          sessionRef.current?.setTranscript(event.target.value)
        }
        placeholder="Set media volume to 50%"
      />
      {state?.partial && (
        <p className="text-sm my-2" role="status">
          Hearing: {state.partial}
        </p>
      )}
      <div className="flex flex-wrap gap-2 my-3">
        <button
          type="button"
          className={buttonClass}
          onClick={() => void sessionRef.current?.review()}
          disabled={busy || !state?.transcript.trim()}
        >
          {state?.planningConsent ? "Send command" : "Review command"}
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => sessionRef.current?.clear()}
        >
          Clear / cancel
        </button>
      </div>
      {planningAccess && planningUserId && (
        <label className="flex items-start gap-2 text-sm my-3">
          <input
            type="checkbox"
            checked={state?.planningConsent ?? false}
            onChange={(event) =>
              sessionRef.current?.setPlanningConsent(event.target.checked)
            }
          />
          <span>
            Allow AI planning in this session.
            <span className="block text-xs text-(--text-muted)">
              Currently limited to approved public test commands. Do not enter
              personal information. This browser only shows plans; it cannot
              change your phone. Voice transcripts are submitted after you
              finish speaking.
            </span>
          </span>
        </label>
      )}
      <p className="text-xs text-(--text-muted) mb-3">
        Examples: “open clock”, “brightness to 40 percent”, “set volume to 50%”.
        Preview ranges: media volume 0–70%, app brightness 10–100%. Nothing is
        saved to chat history.
      </p>
      {state?.preview && (
        <ol className="space-y-2 my-4 list-decimal pl-5">
          {state.preview.map((step, index) => (
            <li key={index} className="text-sm">
              {step.description}
              {!step.availableOnPlatform && (
                <span className="block text-xs text-(--text-muted)">
                  Device control is unavailable in this browser. This is a
                  preview only.
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      <p role="status" aria-live="polite" className="text-sm my-3">
        {state?.message}
      </p>
      <div className="border-t border-(--border-subtle) pt-3 space-y-3">
        <p className="text-xs text-(--text-muted)">
          {state?.availability.message}
        </p>
        {state?.availability.recognition && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.consent}
              onChange={(event) =>
                sessionRef.current?.setConsent(event.target.checked)
              }
            />
            Allow the microphone for on-device English speech in this session.
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {state?.availability.recognition && (
            <button
              type="button"
              className={buttonClass}
              disabled={!state.consent || (busy && !capturing)}
              onClick={() =>
                capturing
                  ? sessionRef.current?.stop()
                  : void sessionRef.current?.listen()
              }
            >
              {capturing ? "Stop microphone" : "Use microphone"}
            </button>
          )}
          {state?.availability.synthesis && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !state.preview}
              onClick={() => void sessionRef.current?.readPreview()}
            >
              Read preview aloud
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
