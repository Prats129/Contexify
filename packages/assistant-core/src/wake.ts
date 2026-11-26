export interface ForegroundWakeAdapter {
  /** Resolve only after the microphone and inference resources are released. */
  listen(signal: AbortSignal, onListening: () => void): Promise<boolean>;
}

export class WakePermissionRequired extends Error {
  constructor() {
    super("Microphone access is needed. Use microphone once to grant access, then start wake listening.");
  }
}

export interface WakeState {
  phase: "idle" | "starting" | "listening" | "stopping" | "handoff";
  message: string;
}

/** One explicit, bounded foreground activation. Wake grants no action authority. */
export function createWakeSession(
  adapter: ForegroundWakeAdapter,
  allowed: () => boolean,
  captureCommand: () => Promise<void>,
) {
  let state: WakeState = { phase: "idle", message: "" };
  let pending: AbortController | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  function update(phase: WakeState["phase"], message: string) {
    if (disposed) return;
    state = { phase, message };
    listeners.forEach((listener) => listener());
  }
  const session = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async start() {
      if (disposed || pending || !allowed()) return;
      const request = new AbortController();
      pending = request;
      let expired = false;
      const deadline = setTimeout(() => {
        expired = true;
        request.abort();
      }, 45000); // Includes model loading; native capture independently stops at 30s.
      update("starting", "Preparing on-device wake listening…");
      try {
        const detected = await adapter.listen(request.signal, () => {
          if (pending === request && !request.signal.aborted && !disposed)
            update("listening", 'Say “Hey Contexify”, then pause. Listening for up to 30 seconds.');
        });
        clearTimeout(deadline);
        if (disposed || request.signal.aborted || !allowed()) return;
        if (!detected) {
          update("idle", "Wake listening ended. Tap Listen for Hey Contexify to start again.");
          return;
        }
        update("handoff", "Wake detected. Starting command microphone…");
        if (disposed || request.signal.aborted || !allowed()) return;
        // The adapter has released wake capture. The existing command session
        // independently checks speech/planning consent and native action policy.
        await captureCommand();
      } catch (error) {
        if (!disposed && !request.signal.aborted)
          update("idle", error instanceof WakePermissionRequired
            ? new WakePermissionRequired().message
            : "Wake listening is unavailable. Use microphone or type your command.");
      } finally {
        clearTimeout(deadline);
        pending = null;
        if (!disposed) update("idle", expired
          ? "Wake listening timed out. Use microphone or try again."
          : request.signal.aborted ? "Wake listening stopped."
          : state.phase === "handoff" ? "" : state.message);
      }
    },
    cancel() {
      if (pending && !pending.signal.aborted) {
        update("stopping", "Stopping wake listening…");
        pending.abort();
      }
    },
    dispose() {
      session.cancel();
      disposed = true;
      listeners.clear();
    },
  };
  return session;
}
