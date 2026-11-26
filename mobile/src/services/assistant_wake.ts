import { AppState, PermissionsAndroid, Platform } from "react-native";
import { WakePermissionRequired, type ForegroundWakeAdapter } from "@contexify/assistant-core";
import { assistantWake } from "../../modules/assistant-wake";

let sequence = 0;
let inferenceBusy = false;

/** Lazy load: no Sherpa import/native lookup on web, iOS or disabled builds. */
export function mobileWakeAvailable(enabled: boolean): boolean {
  if (!enabled || Platform.OS !== "android") return false;
  try { return assistantWake()?.available() === true; } catch { return false; }
}

export function createMobileWakeAdapter(): ForegroundWakeAdapter {
  return {
    async listen(signal, onListening) {
      if (inferenceBusy || signal.aborted || AppState.currentState !== "active")
        throw new Error("Wake unavailable");
      const native = assistantWake();
      if (!native?.available()) throw new Error("Wake unavailable");
      inferenceBusy = true;
      const id = `wake-${++sequence}-${Date.now()}`;
      const stop = () => { void native.stop(id).catch(() => {}); };
      signal.addEventListener("abort", stop, { once: true });
      let engine: typeof import("@siteed/sherpa-onnx.rn")["default"] | null = null;
      const current = () => !signal.aborted && AppState.currentState === "active";
      try {
        // Permission must already have been granted through explicit push-to-talk.
        // A system permission dialog must not resurrect a canceled wake session.
        if (!(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)))
          throw new WakePermissionRequired();
        if (!current()) return false;
        engine = (await import("@siteed/sherpa-onnx.rn")).default;
        const modelDir = await native.prepareModel();
        if (!current()) return false;
        const initialized = await engine.KWS.init({
          modelDir, modelType: "zipformer2", numThreads: 1, debug: false,
          modelFiles: { encoder: "encoder.onnx", decoder: "decoder.onnx", joiner: "joiner.onnx", tokens: "tokens.txt" },
          keywordsFile: "keywords.txt", keywordsScore: 1.5, keywordsThreshold: 0.25,
          maxActivePaths: 4, numTrailingBlanks: 2,
        });
        if (!initialized.success) throw new Error("Wake initialization unavailable");
        // Exercise the actual encoder before opening the microphone.
        const silence = new Array<number>(1600).fill(0);
        for (let frame = 0; frame < 20; frame++) {
          if (!current()) return false;
          const result = await engine.KWS.acceptWaveform(16000, silence);
          if (!result.success) throw new Error("Wake inference unavailable");
        }
        if (!(await engine.KWS.resetStream()).success) throw new Error("Wake reset unavailable");
        if (!current()) return false;
        await native.start(id);
        if (!current()) return false;
        onListening();
        while (current() && native.isRecording(id)) {
          const samples = await native.readSamples(id);
          if (!current()) return false;
          if (samples.length) {
            const result = await engine.KWS.acceptWaveform(16000, samples);
            if (!result.success) throw new Error("Wake inference unavailable");
            if (current() && result.detected && result.keyword === "HEY_CONTEXIFY") return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 70));
        }
        return false;
      } finally {
        signal.removeEventListener("abort", stop);
        try { await native.stop(id); }
        finally {
          try {
            if (engine && !(await engine.KWS.release()).released)
              throw new Error("Wake cleanup unavailable");
          }
          finally { inferenceBusy = false; }
        }
      }
    },
  };
}
