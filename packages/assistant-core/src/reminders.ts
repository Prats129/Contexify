import { dataRecord } from "./validation";
import type {
  ReminderDetails,
  ReminderStorageView,
  ReminderCopyPage,
} from "./contracts";

export type ReminderDraft = Pick<
  ReminderDetails,
  "title" | "date" | "time" | "zone" | "repeat" | "until" | "overlap"
>;
export type ReminderKind = "create" | "cancel" | "storage" | "delete_saved";
export interface LocalReminder {
  reminder_id: string;
  state:
    | "schedule_unknown"
    | "scheduled"
    | "notification_unknown"
    | "notification_requested"
    | "cancelled"
    | "missed"
    | "blocked"
    | "expired";
  next_at: number;
  remaining: number;
  last_outcome: "notification_requested" | "missed" | "blocked" | null;
  details: ReminderDetails | null;
}
export interface ReminderSnapshot {
  protocol_version: 1;
  storage: ReminderStorageView;
  items: LocalReminder[];
  time_zone: string;
  notifications_allowed: boolean;
}
export interface ReminderResult {
  protocol_version: 1;
  outcome:
    | "schedule_requested"
    | "reminder_cancelled"
    | "storage_updated"
    | "saved_copy_deleted"
    | "failed"
    | "outcome_unknown"
    | "cancelled";
  reminder_id: string | null;
  receipt_recorded: boolean;
  account_copy: "stored" | "not_requested" | "unavailable";
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function reminderId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value))
    throw Error("Invalid reminder identity.");
  return value;
}
function decode(value: unknown): unknown {
  if (typeof value !== "string" || value.length > 262144)
    throw Error("Invalid reminder bridge response.");
  try {
    return JSON.parse(value);
  } catch {
    throw Error("Invalid reminder bridge JSON.");
  }
}
function record(value: unknown, fields: string[]) {
  return dataRecord(value, fields, fields);
}
export function reminderDraft(value: unknown): ReminderDraft {
  const row = record(value, [
    "title",
    "date",
    "time",
    "zone",
    "repeat",
    "until",
    "overlap",
  ]);
  if (
    typeof row.title !== "string" ||
    Array.from(row.title.trim().normalize("NFC")).length < 1 ||
    Array.from(row.title).length > 120 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(row.title) ||
    typeof row.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
    typeof row.time !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time) ||
    typeof row.zone !== "string" ||
    row.zone.length < 1 ||
    row.zone.length > 64 ||
    !["none", "daily", "weekly"].includes(String(row.repeat)) ||
    !["ask", "earlier", "later"].includes(String(row.overlap)) ||
    (row.until !== null &&
      (typeof row.until !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.until))) ||
    (row.repeat === "none" ? row.until !== null : row.until === null)
  )
    throw Error("Review the reminder title, date, time and repetition.");
  return { ...row, title: row.title.trim().normalize("NFC") } as ReminderDraft;
}
export function reminderDetails(value: unknown): ReminderDetails {
  const row = record(value, [
    "reminder_id",
    "title",
    "date",
    "time",
    "zone",
    "repeat",
    "until",
    "overlap",
    "occurrences",
  ]);
  reminderId(row.reminder_id);
  const { reminder_id: _id, occurrences: times, ...draft } = row;
  reminderDraft(draft);
  if (
    !Array.isArray(times) ||
    times.length < 1 ||
    times.length > 91 ||
    times.some(
      (time, i) =>
        !Number.isSafeInteger(time) ||
        time <= 0 ||
        time > 4102444800000 ||
        (i > 0 && time <= times[i - 1]),
    )
  )
    throw Error("Invalid approved reminder times.");
  return row as unknown as ReminderDetails;
}
export function reminderSnapshot(value: unknown): ReminderSnapshot {
  const row = record(decode(value), [
    "protocol_version",
    "storage",
    "items",
    "time_zone",
    "notifications_allowed",
  ]);
  const storage = record(row.storage, [
    "revision",
    "mode",
    "account_storage_available",
    "consent_policy_version",
  ]);
  if (
    row.protocol_version !== 1 ||
    !Number.isInteger(storage.revision) ||
    (storage.revision as number) < 0 ||
    (storage.revision as number) > 1000000 ||
    !["device_only", "account"].includes(String(storage.mode)) ||
    storage.consent_policy_version !== 1 ||
    typeof storage.account_storage_available !== "boolean" ||
    typeof row.time_zone !== "string" ||
    row.time_zone.length > 64 ||
    typeof row.notifications_allowed !== "boolean" ||
    !Array.isArray(row.items) ||
    row.items.length > 72
  )
    throw Error("Invalid reminder state.");
  const ids = new Set<string>();
  const items = row.items.map((value: unknown) => {
    const item = record(value, [
      "reminder_id",
      "state",
      "next_at",
      "remaining",
      "last_outcome",
      "details",
    ]);
    const id = reminderId(item.reminder_id);
    if (ids.has(id)) throw Error("Duplicate reminder identity.");
    ids.add(id);
    if (
      ![
        "schedule_unknown",
        "scheduled",
        "notification_unknown",
        "notification_requested",
        "cancelled",
        "missed",
        "blocked",
        "expired",
      ].includes(String(item.state)) ||
      !Number.isSafeInteger(item.next_at) ||
      (item.next_at as number) <= 0 ||
      !Number.isInteger(item.remaining) ||
      (item.remaining as number) < 0 ||
      (item.remaining as number) > 91 ||
      ![null, "notification_requested", "missed", "blocked"].includes(
        item.last_outcome as null | string,
      )
    )
      throw Error("Invalid local reminder record.");
    if (
      item.details !== null &&
      reminderDetails(item.details).reminder_id !== id
    )
      throw Error("Reminder details changed identity.");
    return item;
  });
  return { ...row, storage, items } as unknown as ReminderSnapshot;
}
export function savedReminderPage(value: unknown): ReminderCopyPage {
  const row = record(decode(value), ["items", "next_after"]);
  if (!Array.isArray(row.items) || row.items.length > 6)
    throw Error("Invalid saved reminder page.");
  if (row.next_after !== null) reminderId(row.next_after);
  const ids = new Set<string>();
  for (const value of row.items) {
    const item = record(value, ["details", "source_device_id", "created_at"]);
    const details = reminderDetails(item.details);
    reminderId(item.source_device_id);
    if (
      ids.has(details.reminder_id) ||
      typeof item.created_at !== "number" ||
      !Number.isFinite(item.created_at) ||
      item.created_at <= 0
    )
      throw Error("Invalid saved reminder.");
    ids.add(details.reminder_id);
  }
  return row as unknown as ReminderCopyPage;
}
export function reminderResult(
  value: unknown,
  kind: ReminderKind,
  expectedId?: string,
): ReminderResult {
  const row = record(decode(value), [
    "protocol_version",
    "outcome",
    "reminder_id",
    "receipt_recorded",
    "account_copy",
  ]);
  const success = {
    create: "schedule_requested",
    cancel: "reminder_cancelled",
    storage: "storage_updated",
    delete_saved: "saved_copy_deleted",
  }[kind];
  if (
    row.protocol_version !== 1 ||
    ![success, "failed", "outcome_unknown", "cancelled"].includes(
      String(row.outcome),
    ) ||
    typeof row.receipt_recorded !== "boolean" ||
    !["stored", "not_requested", "unavailable"].includes(
      String(row.account_copy),
    ) ||
    (kind === "storage"
      ? row.reminder_id !== null
      : !reminderId(row.reminder_id)) ||
    (expectedId && row.reminder_id !== expectedId) ||
    (row.outcome === "cancelled" && row.receipt_recorded) ||
    (row.account_copy === "stored" &&
      (kind !== "create" ||
        row.outcome !== success ||
        !row.receipt_recorded)) ||
    (["storage_updated", "saved_copy_deleted"].includes(String(row.outcome)) &&
      !row.receipt_recorded)
  )
    throw Error("Invalid reminder result.");
  return row as unknown as ReminderResult;
}
export function describeReminderResult(value: ReminderResult): string {
  switch (value.outcome) {
    case "schedule_requested":
      return (
        "Reminder scheduled on this phone. The operating system may delay the alert." +
        (value.receipt_recorded
          ? ""
          : " Server receipt unavailable; check saved reminders before making another request.") +
        (value.account_copy === "unavailable"
          ? " The account copy could not be saved; it will not upload automatically."
          : value.account_copy === "stored"
            ? " Encrypted account copy saved."
            : "")
      );
    case "reminder_cancelled":
      return (
        "Future alerts cancelled on this phone." +
        (value.receipt_recorded
          ? ""
          : " Server receipt unavailable; a saved account copy may remain.")
      );
    case "storage_updated":
      return "Reminder storage preference saved. Existing local reminders are not uploaded automatically.";
    case "saved_copy_deleted":
      return "Saved account copy deleted. This does not cancel alerts on another phone.";
    case "cancelled":
      return "Request cancelled. No new action was approved.";
    case "outcome_unknown":
      return "Outcome unknown. Refresh your reminders before trying again; this request will not retry automatically.";
    default:
      return "Reminder request failed. Refresh your reminders before trying again.";
  }
}
