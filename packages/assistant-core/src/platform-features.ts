import type { VoiceAvailability } from "./voice";

export interface PlatformFeature {
  id: string;
  label: string;
  status: "available" | "permission_required" | "preview" | "unavailable";
  detail: string;
}

/** Presentation hints only: never a permission, execution catalog or authorization. */
export function companionFeatures(
  platform: "web" | "ios",
  voice: VoiceAvailability,
  calendarEditor = false,
  shortcuts = false,
  scheduling: { reminders: boolean; alarms: boolean; timers: boolean } = {
    reminders: false,
    alarms: false,
    timers: false,
  },
): readonly PlatformFeature[] {
  return [
    {
      id: "text",
      label: "Typed commands",
      status: "available",
      detail:
        platform === "web"
          ? "Review supported commands. AI planning needs separate consent and a signed-in connection."
          : "Review supported commands locally. AI planning is not enabled in this iPhone flow.",
    },
    {
      id: "speech",
      label: "On-device English microphone",
      status: voice.recognition ? "permission_required" : "unavailable",
      detail: voice.recognition
        ? "Start it explicitly and allow microphone access. Audio is not sent to a speech service."
        : voice.message,
    },
    {
      id: "playback",
      label: "Read preview aloud",
      status: voice.synthesis ? "available" : "unavailable",
      detail: voice.synthesis
        ? "Starts only when requested. Avoid reading private information aloud."
        : "Type and read the result instead; no remote voice fallback.",
    },
    {
      id: "controls",
      label: "Phone volume, brightness and app opening",
      status: "preview",
      detail:
        platform === "web"
          ? "This browser cannot control your phone. Use the supported Android app or the phone's own controls."
          : "These commands remain previews on iPhone. Use the phone's controls or open the app yourself.",
    },
    {
      id: "calendar",
      label: "Calendar event editor",
      status:
        platform === "ios" && calendarEditor ? "available" : "unavailable",
      detail:
        platform === "ios" && calendarEditor
          ? "Review and save in Apple's editor. Contexify does not read your calendars. Calendar may sync through your Apple account."
          : "Create the event in your Calendar app. No calendar access is requested here.",
    },
    {
      id: "reminders",
      label: "Scheduled reminders",
      status:
        platform === "ios" && scheduling.reminders
          ? "permission_required"
          : "unavailable",
      detail:
        platform === "web"
          ? "Use the supported Android reminder flow or your phone's Clock/Reminders app. A closed browser tab cannot provide reliable alerts."
          : scheduling.reminders
            ? "Open Reminders and settings below. Enroll this phone, allow notifications and approve each private schedule. Encrypted account copies are a separate opt-in."
            : "Use Apple's Reminders. Android schedules are not copied to this phone; reminder scheduling needs a compatible native build.",
    },
    {
      id: "alarms",
      label: "Ringing alarms and timers",
      status:
        platform === "ios" && scheduling.alarms
          ? "permission_required"
          : "unavailable",
      detail:
        platform === "ios" && scheduling.alarms
          ? `Use iPhone alarms and timers below. AlarmKit permission and exact approval are required. ${scheduling.timers ? "Countdown widget support is included." : "Timers require an updated countdown-widget build."} Approved alerts can ring offline; signing out cancels this app's alerts.`
          : "Set alarms in your phone's Clock app. Ringing alerts need the supported iOS 26+ native build; a browser cannot schedule them.",
    },
    {
      id: "shortcuts",
      label: "Siri / Shortcuts entry",
      status: platform === "ios" && shortcuts ? "available" : "unavailable",
      detail:
        platform === "ios" && shortcuts
          ? "Open Assistant through Shortcuts after unlocking. This opens the screen; it does not start the microphone or approve an action."
          : "Open Assistant from the app. There is no background wake listener.",
    },
  ];
}
