import { dataRecord } from "./validation";

export interface AlarmDraft {
  kind: "set_alarm" | "show_alarms";
  time: string;
  label: string;
  days: number[];
  clock: "auto" | "samsung" | "google" | "android";
}
export interface AlarmHandoffResult {
  protocol_version: 1;
  request_kind: AlarmDraft["kind"];
  outcome: "handoff_requested" | "failed" | "outcome_unknown" | "cancelled";
  package_id: string;
  receipt_recorded: boolean;
}
export function alarmDraft(value: unknown): AlarmDraft {
  const fields = ["kind", "time", "label", "days", "clock"];
  const row = dataRecord(value, fields, fields);
  if (
    !["set_alarm", "show_alarms"].includes(String(row.kind)) ||
    !["auto", "samsung", "google", "android"].includes(String(row.clock)) ||
    typeof row.time !== "string" ||
    typeof row.label !== "string" ||
    Array.from(row.label).length > 120 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(row.label) ||
    !Array.isArray(row.days) ||
    row.days.length > 7 ||
    new Set(row.days).size !== row.days.length ||
    row.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    (row.kind === "set_alarm"
      ? !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time)
      : row.time !== "" || row.label !== "" || row.days.length !== 0)
  )
    throw Error("Review the alarm time, label, days and selected Clock.");
  return {
    ...row,
    label: row.label.trim().normalize("NFC"),
    days: [...row.days].sort(),
  } as AlarmDraft;
}
export function alarmHandoffResult(
  value: unknown,
  kind: AlarmDraft["kind"],
  clock: AlarmDraft["clock"] = "auto",
): AlarmHandoffResult {
  const fields = [
    "protocol_version",
    "request_kind",
    "outcome",
    "package_id",
    "receipt_recorded",
  ];
  const row = dataRecord(value, fields, fields);
  const selected = {
    auto: null,
    samsung: "com.sec.android.app.clockpackage",
    google: "com.google.android.deskclock",
    android: "com.android.deskclock",
  }[clock];
  if (
    row.protocol_version !== 1 ||
    row.request_kind !== kind ||
    (selected !== null && row.package_id !== selected) ||
    !["handoff_requested", "failed", "outcome_unknown", "cancelled"].includes(
      String(row.outcome),
    ) ||
    ![
      "com.google.android.deskclock",
      "com.android.deskclock",
      "com.sec.android.app.clockpackage",
    ].includes(String(row.package_id)) ||
    typeof row.receipt_recorded !== "boolean" ||
    (row.outcome === "cancelled" && row.receipt_recorded)
  )
    throw Error(
      "Invalid Clock handoff evidence. Check Clock before making a new request.",
    );
  return row as unknown as AlarmHandoffResult;
}
export function describeAlarmHandoff(result: AlarmHandoffResult): string {
  switch (result.outcome) {
    case "handoff_requested":
      return (
        (result.request_kind === "show_alarms"
          ? "Clock alarm-list handoff requested. Review, change or cancel alarms in Clock."
          : "Clock handoff requested. Check the time, sound and enabled state in Clock. Contexify cannot verify that an alarm was created.") +
        (result.receipt_recorded
          ? ""
          : " The server receipt is unavailable. Do not repeat the request automatically.")
      );
    case "cancelled":
      return "Request cancelled before sending to Clock.";
    case "outcome_unknown":
      return "Outcome unknown. Clock may have received this request. Check Clock before making another request.";
    default:
      return "Clock handoff failed. Check the selected Clock and app settings before trying a new request.";
  }
}
