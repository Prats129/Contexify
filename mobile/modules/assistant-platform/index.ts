import { requireOptionalNativeModule, type EventSubscription } from "expo";

export interface AssistantPlatformModule {
  support(): Promise<{ calendar_editor: boolean; shortcuts: boolean }>;
  editCalendarEvent(
    requestId: string,
  ): Promise<"saved_in_editor" | "cancelled" | "outcome_unknown">;
  cancelCalendarEditor(requestId: string): Promise<void>;
  consumeAssistantEntry(): Promise<boolean>;
  addListener(
    name: "onAssistantEntry",
    callback: () => void,
  ): EventSubscription;
}

export function assistantPlatform(): AssistantPlatformModule | null {
  return requireOptionalNativeModule<AssistantPlatformModule>(
    "AssistantPlatform",
  );
}
