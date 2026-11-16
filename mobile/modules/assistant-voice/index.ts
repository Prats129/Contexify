import { requireOptionalNativeModule, type EventSubscription } from "expo";

export interface VoiceEvent {
  request_id: string;
  text?: string;
}
export interface AssistantVoiceModule {
  availability(): Promise<{
    recognition: boolean;
    synthesis: boolean;
    message: string;
  }>;
  listen(requestId: string, consent: boolean): Promise<string>;
  stop(requestId: string): Promise<void>;
  cancel(requestId: string): Promise<void>;
  speak(requestId: string, text: string): Promise<void>;
  addListener(
    name: "onListening" | "onPartial",
    callback: (event: VoiceEvent) => void,
  ): EventSubscription;
}

export function assistantVoice(): AssistantVoiceModule | null {
  return requireOptionalNativeModule<AssistantVoiceModule>("AssistantVoice");
}
