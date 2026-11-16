const messages = {
  unavailable: "Voice stopped or unavailable. Type or try again.",
  permission_denied:
    "Microphone permission was denied. Allow it in the app's Android permissions, or type your command.",
  no_speech:
    "No speech was detected. Tap Use microphone and speak after Listening appears.",
  no_match:
    "The recognizer could not understand the speech. Try again or type your command.",
  audio:
    "The recognizer could not capture audio. Check microphone access and close other recording apps, then try again.",
  busy: "The speech recognizer is busy. Wait a moment, then tap Use microphone again.",
  language_unavailable:
    "The phone's offline English recognizer is not ready. Your speech-recognition service may need language setup. You can still type.",
  language_unsupported:
    "This on-device recognizer cannot use the selected English language. You can still type your command.",
  service:
    "The on-device speech service stopped or failed. Try again or type your command.",
  connection:
    "The on-device recognizer reported a connection error. Online fallback is disabled. You can still type your command.",
  foreground:
    "Voice stopped because the app was interrupted or the phone was locked. Return to the preview and tap Use microphone again.",
  focus:
    "Voice stopped because audio focus was interrupted. Stop other audio and try again.",
  timeout:
    "Voice did not finish in time. Tap Use microphone to try again, or type your command.",
  cancelled:
    "Voice was cancelled. Tap Use microphone to try again, or type your command.",
} as const;

export type VoiceInputFailure = keyof typeof messages;

/** Only fixed public messages may cross from a platform failure into the preview. */
export class VoiceInputError extends Error {
  readonly androidCode?: number;
  constructor(
    readonly reason: VoiceInputFailure,
    androidCode?: number,
  ) {
    const code =
      typeof androidCode === "number" &&
      Number.isInteger(androidCode) &&
      androidCode >= 1 &&
      androidCode <= 13
        ? androidCode
        : undefined;
    super(
      (Object.prototype.hasOwnProperty.call(messages, reason)
        ? messages[reason]
        : messages.unavailable) +
        (code === undefined ? "" : ` (Android speech error ${code}.)`),
    );
    this.name = "VoiceInputError";
    this.androidCode = code;
  }
}
