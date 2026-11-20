import { dataRecord } from "./validation";

/** Private composer drafts. These are not planner tools or send/call authority. */
export type CommunicationKind = "dial" | "sms";
export interface CommunicationDraft {
  kind: CommunicationKind;
  number: string;
  body: string;
}
export type CommunicationOutcome =
  | "handoff_requested"
  | "sent_in_composer"
  | "cancelled_in_composer"
  | "cancelled"
  | "failed"
  | "outcome_unknown";

export function communicationDraft(value: unknown): CommunicationDraft {
  const keys = ["kind", "number", "body"];
  const fields = dataRecord(value, keys, keys);
  if (
    !["dial", "sms"].includes(fields.kind as string) ||
    typeof fields.number !== "string" ||
    typeof fields.body !== "string"
  )
    throw new Error("Unsupported communication request.");
  // Require a visible country code; never infer a country, extension or service code.
  const number = fields.number.trim().replace(/[ ()-]/g, "");
  if (!/^\+[1-9][0-9]{7,14}$/.test(number))
    throw new Error(
      "Enter one international number with + and its country code. Extensions and service codes are not supported.",
    );
  const body = fields.body;
  if (
    body.length > 1000 ||
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(
      body,
    ) ||
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(
      body,
    )
  )
    throw new Error(
      "Use at most 1000 message characters without control or direction-override characters.",
    );
  if (fields.kind === "dial" ? body !== "" : body.trim().length === 0)
    throw new Error(
      fields.kind === "dial"
        ? "A dialer request cannot contain a message."
        : "Enter the message you want to review.",
    );
  return { kind: fields.kind as CommunicationKind, number, body };
}

export function communicationResult(value: unknown): string {
  switch (value) {
    case "handoff_requested":
      return "Phone app opening requested. Review the recipient and use its Call or Send control yourself. No call or message delivery has been verified.";
    case "sent_in_composer":
      return "The system message composer reported Send. Delivery and receipt are not verified.";
    case "cancelled_in_composer":
      return "Message composer cancelled. Delivery is not verified; the phone app may retain a draft.";
    case "cancelled":
      return "Cancelled. No new handoff was requested.";
    case "failed":
      return "The phone could not complete this request. Check the phone app before trying again.";
    default:
      return "The result is unknown. Check the phone app before making another request. Nothing will retry automatically.";
  }
}
