import { requireOptionalNativeModule, type EventSubscription } from "expo";
import type { CommunicationOutcome } from "@contexify/assistant-core";

export interface AssistantPlatformModule {
  communicationSupport?(): Promise<{
    picker: boolean;
    dial: boolean;
    sms: boolean;
  }>;
  pickPhoneNumber?(requestId: string): Promise<{
    outcome: "selected" | "cancelled" | "outcome_unknown";
    number: string | null;
  }>;
  openCommunication?(
    requestId: string,
    draft: string,
  ): Promise<CommunicationOutcome>;
  openPlannedCommunication?(
    requestId: string,
    draft: string,
    expiresAt: number,
  ): Promise<CommunicationOutcome>;
  cancelCommunicationRequest?(requestId: string): Promise<void>;
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
