import { AppState, Platform } from "react-native";
import { assistantPlatform } from "../../modules/assistant-platform";

let editorSequence = 0;

function bridge() {
  if (Platform.OS !== "ios") return null;
  try {
    const native = assistantPlatform();
    return native &&
      [
        "support",
        "editCalendarEvent",
        "cancelCalendarEditor",
        "consumeAssistantEntry",
        "addListener",
      ].every((key) => typeof native[key as keyof typeof native] === "function")
      ? native
      : null;
  } catch {
    return null;
  }
}

/** Local presentation only. No planner, account storage, network, or device executor. */
export function createAppleCompanion() {
  const native = bridge();
  let generation = 0;
  let busy = false;
  let disposed = false;
  let activeId: string | null = null;
  return {
    async support() {
      if (!native || disposed)
        return { calendar_editor: false, shortcuts: false };
      try {
        const value = await native.support();
        return {
          calendar_editor: value?.calendar_editor === true,
          shortcuts: value?.shortcuts === true,
        };
      } catch {
        return { calendar_editor: false, shortcuts: false };
      }
    },
    async editCalendarEvent(): Promise<string> {
      if (!native || disposed || busy || AppState.currentState !== "active")
        return "Calendar editor unavailable. Open Calendar directly.";
      busy = true;
      const version = ++generation;
      activeId = `calendar-${++editorSequence}-${Date.now()}`;
      try {
        const result = await native.editCalendarEvent(activeId);
        if (
          version !== generation ||
          disposed ||
          AppState.currentState !== "active"
        )
          return "";
        if (result === "saved_in_editor")
          return "Apple's editor reported Save. Check the event in Calendar. It is managed there and may sync through your Apple account; Contexify sign-out does not delete it.";
        if (result === "cancelled") return "Calendar editor cancelled.";
        return "Calendar result is unknown. Check Calendar before creating another event; nothing will retry automatically.";
      } catch {
        return version === generation && !disposed
          ? "Calendar editor interrupted or unavailable. Check Calendar before trying again."
          : "";
      } finally {
        if (version === generation) {
          busy = false;
          activeId = null;
        }
      }
    },
    cancel() {
      generation++;
      const id = activeId;
      activeId = null;
      // The native editor also rejects concurrent opens. Do not replay interrupted drafts.
      busy = false;
      try {
        if (id) void native?.cancelCalendarEditor(id).catch(() => {});
      } catch {
        /* A disappearing native bridge must not crash lifecycle cleanup. */
      }
    },
    dispose() {
      this.cancel();
      disposed = true;
    },
  };
}

/** A Siri request opens an empty screen only, including after cold launch. */
export function subscribeAssistantEntry(open: () => void): () => void {
  const native = bridge();
  if (!native) return () => {};
  let disposed = false;
  let checking = false;
  const consume = async () => {
    if (disposed || checking || AppState.currentState !== "active") return;
    checking = true;
    try {
      const requested = await native.consumeAssistantEntry();
      if (requested === true && !disposed && AppState.currentState === "active")
        open();
    } catch {
      /* Older/missing native builds keep the in-app entry usable. */
    } finally {
      checking = false;
    }
  };
  let event: ReturnType<typeof native.addListener>;
  try {
    event = native.addListener("onAssistantEntry", () => {
      void consume();
    });
  } catch {
    return () => {};
  }
  const lifecycle = AppState.addEventListener("change", (state) => {
    if (state === "active") void consume();
  });
  void consume();
  return () => {
    disposed = true;
    event.remove();
    lifecycle.remove();
  };
}
