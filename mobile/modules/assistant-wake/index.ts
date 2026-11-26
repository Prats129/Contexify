import { requireOptionalNativeModule } from "expo";

export interface AssistantWakeModule {
  available(): boolean;
  prepareModel(): Promise<string>;
  start(requestId: string): Promise<void>;
  readSamples(requestId: string): Promise<number[]>;
  stop(requestId: string): Promise<void>;
  isRecording(requestId: string): boolean;
}

export function assistantWake(): AssistantWakeModule | null {
  return requireOptionalNativeModule<AssistantWakeModule>("AssistantWake");
}
