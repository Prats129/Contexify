import { dataRecord } from "./validation";
import { reminderDraft, reminderId, type ReminderDraft } from "./reminders";

export type AppleAlarmDraft =
  | { kind: "alarm"; schedule: ReminderDraft }
  | { kind: "timer"; title: string; duration_seconds: number };
export interface AppleAlarmSnapshot {
  protocol_version: 1;
  alarms_allowed: boolean;
  items: Array<{
    reminder_id: string;
    kind: "alarm" | "timer";
    title: string;
    state: "scheduled" | "schedule_unknown" | "notification_unknown";
    next_at: number;
    remaining: number;
  }>;
}

export function appleAlarmDraft(value: unknown): AppleAlarmDraft {
  const base = dataRecord(
    value,
    ["kind", "schedule", "title", "duration_seconds"],
    ["kind"],
  );
  if (base.kind === "alarm") {
    dataRecord(value, ["kind", "schedule"], ["kind", "schedule"]);
    return { kind: "alarm", schedule: reminderDraft(base.schedule) };
  }
  dataRecord(
    value,
    ["kind", "title", "duration_seconds"],
    ["kind", "title", "duration_seconds"],
  );
  if (
    base.kind !== "timer" ||
    typeof base.title !== "string" ||
    !base.title.trim() ||
    Array.from(base.title).length > 120 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(base.title) ||
    !Number.isInteger(base.duration_seconds) ||
    (base.duration_seconds as number) < 60 ||
    (base.duration_seconds as number) > 86400
  )
    throw Error(
      "Use a title and a timer duration from 60 to 86400 whole seconds.",
    );
  return {
    kind: "timer",
    title: base.title.trim().normalize("NFC"),
    duration_seconds: base.duration_seconds as number,
  };
}
export function appleAlarmSnapshot(value: unknown): AppleAlarmSnapshot {
  if (typeof value !== "string" || value.length > 65536)
    throw Error("Invalid Apple alarm response.");
  const row = dataRecord(
    JSON.parse(value),
    ["protocol_version", "alarms_allowed", "items"],
    ["protocol_version", "alarms_allowed", "items"],
  );
  if (
    row.protocol_version !== 1 ||
    typeof row.alarms_allowed !== "boolean" ||
    !Array.isArray(row.items) ||
    row.items.length > 40
  )
    throw Error("Invalid Apple alarm state.");
  const ids = new Set<string>();
  for (const item of row.items) {
    const r = dataRecord(
      item,
      ["reminder_id", "kind", "title", "state", "next_at", "remaining"],
      ["reminder_id", "kind", "title", "state", "next_at", "remaining"],
    );
    const id = reminderId(r.reminder_id);
    if (
      ids.has(id) ||
      !["alarm", "timer"].includes(String(r.kind)) ||
      typeof r.title !== "string" ||
      !["scheduled", "schedule_unknown", "notification_unknown"].includes(
        String(r.state),
      ) ||
      !Number.isSafeInteger(r.next_at) ||
      (r.next_at as number) <= 0 ||
      !Number.isInteger(r.remaining) ||
      (r.remaining as number) < 0 ||
      (r.remaining as number) > 32
    )
      throw Error("Invalid Apple alarm record.");
    // Apply the same private-title bounds without interpreting it as a command.
    appleAlarmDraft({ kind: "timer", title: r.title, duration_seconds: 60 });
    ids.add(id);
  }
  return row as unknown as AppleAlarmSnapshot;
}
