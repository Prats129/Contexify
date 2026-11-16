import type {
  ForegroundVoiceAdapter,
  VoiceAvailability,
} from "@contexify/assistant-core";

interface LocalRecognition {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult:
    | ((event: {
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface LocalRecognitionConstructor {
  new (): LocalRecognition;
  available?: (options: {
    langs: string[];
    processLocally: true;
  }) => Promise<string>;
}
export interface BrowserVoiceEnvironment {
  secure: boolean;
  active(): boolean;
  Recognition?: LocalRecognitionConstructor;
  synthesis?: SpeechSynthesis;
  Utterance?: typeof SpeechSynthesisUtterance;
}
function environment(): BrowserVoiceEnvironment {
  const browser = window as unknown as {
    SpeechRecognition?: LocalRecognitionConstructor;
  };
  return {
    secure: window.isSecureContext,
    active: () => document.visibilityState === "visible" && document.hasFocus(),
    Recognition: browser.SpeechRecognition,
    synthesis: window.speechSynthesis,
    Utterance: window.SpeechSynthesisUtterance,
  };
}

/** Never uses the legacy/server-backed recognition path or downloads a language pack. */
export function createBrowserVoiceAdapter(
  enabled: boolean,
  host: BrowserVoiceEnvironment = environment(),
): ForegroundVoiceAdapter {
  let generation = 0,
    disposed = false;
  let recognition: LocalRecognition | undefined;
  let cancelCapture: (() => void) | undefined,
    cancelSpeech: (() => void) | undefined;
  async function localRecognition(): Promise<boolean> {
    const Constructor = host.Recognition;
    if (!enabled || disposed || !host.secure || !Constructor?.available)
      return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const probe = new Constructor();
      if (!("processLocally" in probe)) return false;
      return await Promise.race([
        Constructor.available({ langs: ["en-US"], processLocally: true }).then(
          (value) => value === "available",
        ),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 2500);
        }),
      ]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  const localVoice = () =>
    host.synthesis
      ?.getVoices()
      .find(
        (voice) =>
          voice.localService === true && /^en(?:-|$)/i.test(voice.lang),
      );
  const adapter: ForegroundVoiceAdapter = {
    async availability(): Promise<VoiceAvailability> {
      if (!enabled || disposed)
        return {
          recognition: false,
          synthesis: false,
          message: "Voice is not enabled in this build. You can still type.",
        };
      const available = await localRecognition();
      return {
        recognition: available,
        synthesis: host.secure && Boolean(host.Utterance && localVoice()),
        message: available
          ? "On-device English voice is available."
          : "On-device English speech is unavailable in this browser. You can still type.",
      };
    },
    async listen(onPartial, onListening) {
      const version = ++generation;
      if (
        disposed ||
        cancelCapture ||
        cancelSpeech ||
        !host.active() ||
        !(await localRecognition()) ||
        version !== generation
      )
        throw new Error("Local microphone capture is unavailable.");
      const Constructor = host.Recognition!;
      const current = new Constructor();
      current.processLocally = true;
      if (current.processLocally !== true)
        throw new Error("Local processing is required.");
      current.lang = "en-US";
      current.continuous = false;
      current.interimResults = true;
      recognition = current;
      return new Promise<string>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(undefined), 30000);
        function finish(text: string | undefined) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          current.onstart = null;
          current.onresult = null;
          current.onerror = null;
          current.onend = null;
          recognition = undefined;
          cancelCapture = undefined;
          try {
            current.abort();
          } catch {
            /* Recognition may already have ended. */
          }
          if (text === undefined)
            reject(new Error("Voice stopped or unavailable."));
          else resolve(text);
        }
        cancelCapture = () => finish(undefined);
        current.onstart = () => {
          if (host.active() && version === generation) onListening();
          else finish(undefined);
        };
        current.onerror = () => finish(undefined);
        current.onend = () => finish(undefined);
        current.onresult = (event) => {
          if (
            !host.active() ||
            version !== generation ||
            event.results.length > 32
          ) {
            finish(undefined);
            return;
          }
          let final = "",
            partial = "";
          for (const result of Array.from(event.results)) {
            const text = result[0]?.transcript;
            if (typeof text !== "string" || text.length > 1024) {
              finish(undefined);
              return;
            }
            if (result.isFinal) final += text;
            else partial += text;
          }
          if ((final + partial).length > 1024) {
            finish(undefined);
            return;
          }
          if (final.trim() && !partial.trim()) finish(final);
          else onPartial(final + partial);
        };
        try {
          if (!host.active()) throw new Error("Foreground required.");
          current.start();
        } catch {
          finish(undefined);
        }
      });
    },
    stop() {
      if (recognition) recognition.stop();
      else adapter.cancel();
    },
    cancel() {
      generation++;
      cancelCapture?.();
      cancelSpeech?.();
    },
    async speak(text) {
      if (
        !enabled ||
        disposed ||
        !host.secure ||
        !host.active() ||
        typeof text !== "string" ||
        text.length > 1000 ||
        cancelCapture ||
        cancelSpeech
      )
        throw new Error("Local speech playback unavailable.");
      const voice = localVoice(),
        Constructor = host.Utterance,
        synthesis = host.synthesis;
      if (!voice || !Constructor || !synthesis)
        throw new Error("No installed local English voice.");
      const utterance = new Constructor(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(false), 30000);
        function finish(success: boolean) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cancelSpeech = undefined;
          utterance.onend = null;
          utterance.onerror = null;
          synthesis!.cancel();
          if (success) resolve();
          else reject(new Error("Speech playback stopped."));
        }
        cancelSpeech = () => finish(false);
        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(false);
        try {
          synthesis.speak(utterance);
        } catch {
          finish(false);
        }
      });
    },
    dispose() {
      adapter.cancel();
      disposed = true;
    },
  };
  return adapter;
}
