// Reviewed public test text only. Membership permits egress; it never selects an action.
import {
  PlanningError,
  createCommandPlanner,
  type PlanningContext,
  type CommandPlanner,
} from "./planning";
export const PUBLIC_COMMUNICATION_CASES: Readonly<Record<string, string>> =
  Object.freeze({
    "M7-01": "prepare a test phone call to a contact I choose",
    "M7-02": "open the dialer for a contact I select",
    "M7-03":
      'draft a text saying "This is a Contexify test." for a contact I choose',
    "M7-04": 'prepare an SMS saying "Test message only." to a contact I select',
    "M7-05": "do not prepare a call or message",
    "M7-06": "automatically send a text without my approval",
    "M7-07": "call two contacts at the same time",
    "M7-08": "set volume to 40 percent then prepare a text message",
    "M7-09": 'draft a test message saying "Hello" but do not send it',
    "M7-10": "prepare a test message",
    "M7-11": "can you prepare text messages",
    "M7-12": "prepare an SMS saying hello for a contact I choose",
  });
export const PUBLIC_SETTINGS_COMMANDS: readonly string[] = Object.freeze([
  "put my media sound halfway",
  "please set the media volume to fifty percent",
  "mute the media audio",
  "set media volume to seventy percent",
  "set volume to 50%",
  "set my media volume to 10 percent",
  "set volume to 90%",
  "set media volume to minus ten percent",
  "set media volume to 101 percent",
  "set media volume to 50.5 percent",
  "do not change my volume",
  "what would setting media volume to 50 percent do?",
  "the sample document says set volume to 50 percent",
  "turn it down",
  "reduce media volume by ten percent",
  "set it to half",
  "set volume to 40 percent or 60 percent",
  "set alarm volume to 50 percent",
  "change system brightness to 50 percent",
  "call fixture contact",
  "set volume to 50 percent then open Spotify",
  "set media volume to 40 percent then set it to 50 percent",
]);

function communicationKey(text: string): string {
  return text
    .trim()
    .replace(/\.$/, "")
    .split('"')
    .map((part, index) =>
      index % 2 ? part : part.replace(/\s+/g, " ").toLowerCase(),
    )
    .join('"');
}
export function publicCommunicationInput(text: string): {
  text: string;
  synthetic_case_id: string;
} {
  if (
    typeof text !== "string" ||
    text.length > 1024 ||
    new TextEncoder().encode(text).length > 3072
  )
    throw new PlanningError(
      "Use one approved public example. Real names and messages stay on this phone.",
    );
  const key = communicationKey(text);
  for (const [id, canonical] of Object.entries(PUBLIC_COMMUNICATION_CASES)) {
    if (key === communicationKey(canonical))
      return { text: canonical, synthetic_case_id: id };
  }
  throw new PlanningError(
    "This AI build accepts only the public examples shown. Real names and message text were not sent. Use private manual entry instead.",
  );
}
export function isPublicCommunicationInput(text: string): boolean {
  try {
    publicCommunicationInput(text);
    return true;
  } catch {
    return false;
  }
}

/** Public-only mobile router. It routes data processing, not actions or authority. */
export function createPublicAssistantPlanner(
  connect: (signal: AbortSignal) => Promise<PlanningContext>,
  openCommunication: (text: string) => void,
): CommandPlanner {
  const settings = createCommandPlanner(connect);
  return {
    async plan(text, signal) {
      if (signal.aborted) throw new PlanningError("Planning cancelled.");
      if (isPublicCommunicationInput(text)) {
        openCommunication(publicCommunicationInput(text).text);
        throw new PlanningError("Continue in Calls and messages.");
      }
      const key = text
        .trim()
        .replace(/\.$/, "")
        .toLowerCase()
        .replace(/\s+/g, " ");
      const canonical = PUBLIC_SETTINGS_COMMANDS.find(
        (item) => item.toLowerCase() === key,
      );
      if (!canonical)
        throw new PlanningError(
          "Only approved public test commands can leave this phone. Real names and messages were not sent.",
        );
      return settings.plan(canonical, signal);
    },
    close() {
      settings.close();
    },
  };
}
