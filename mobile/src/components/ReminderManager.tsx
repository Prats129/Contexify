import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  describeReminderResult,
  type ReminderDraft,
  type ReminderSnapshot,
  type ReminderCopyPage,
} from "@contexify/assistant-core";
import type { DeviceControls } from "../services/assistant_device_controls";
import type { AppTheme } from "../theme/colors";

function emptyDraft(): ReminderDraft {
  const date = new Date(Date.now() + 10 * 60000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    title: "",
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    repeat: "none",
    until: null,
    overlap: "ask",
  };
}
interface Packet {
  message?: string;
  snapshot?: ReminderSnapshot;
  page?: ReminderCopyPage;
  reset?: boolean;
  append?: boolean;
  removeSaved?: string;
  clearSaved?: boolean;
}

/** Private form/list state exists only while this foreground screen is open. */
export function ReminderManager({
  userId,
  controls,
  theme,
  onClose,
}: {
  userId: string;
  controls: DeviceControls;
  theme: AppTheme;
  onClose(): void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ReminderDraft>(emptyDraft());
  const [snapshot, setSnapshot] = useState<ReminderSnapshot | null>(null);
  const [saved, setSaved] = useState<ReminderCopyPage | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0),
    pending = useRef(false),
    mounted = useRef(false);
  async function run(work: () => Promise<Packet>, refresh = false) {
    if (pending.current || AppState.currentState !== "active") return;
    pending.current = true;
    setBusy(true);
    const ticket = generation.current;
    try {
      const packet = await work();
      if (refresh && mounted.current && ticket === generation.current) {
        try {
          packet.snapshot = await controls.readReminders!(userId);
        } catch {
          packet.message =
            (packet.message || "") +
            " Refresh is unavailable. Check saved reminders before making another request.";
        }
      }
      if (
        !mounted.current ||
        ticket !== generation.current ||
        AppState.currentState !== "active"
      )
        return;
      if (packet.snapshot) setSnapshot(packet.snapshot);
      if (packet.clearSaved) setSaved(null);
      if (packet.removeSaved)
        setSaved((previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.filter(
                  (item) => item.details.reminder_id !== packet.removeSaved,
                ),
              }
            : null,
        );
      if (packet.page) {
        if (packet.append)
          setSaved((previous) => {
            const existing = previous?.items ?? [];
            const ids = new Set(
              existing.map((item) => item.details.reminder_id),
            );
            return {
              ...packet.page!,
              items: [
                ...existing,
                ...packet.page!.items.filter(
                  (item) => !ids.has(item.details.reminder_id),
                ),
              ].slice(0, 512),
            };
          });
        else setSaved(packet.page);
      }
      if (packet.reset) setDraft(emptyDraft());
      setMessage(packet.message || "");
    } catch (error) {
      if (mounted.current && ticket === generation.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "Reminder request is unavailable. Refresh before trying again.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function refresh() {
    void run(async () => ({ snapshot: await controls.readReminders!(userId) }));
  }
  useEffect(() => {
    mounted.current = true;
    setSnapshot(null);
    setSaved(null);
    setDraft(emptyDraft());
    setMessage("");
    if (controls.reminderSupported?.() && controls.readReminders) refresh();
    else
      setMessage(
        "Reminders require an updated compatible Android build. No reminder action was performed.",
      );
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        generation.current++;
        controls.cancel();
        setDraft(emptyDraft());
        setSnapshot(null);
        setSaved(null);
        setMessage(
          "Private reminder details cleared. Tap Refresh reminders after returning.",
        );
      }
    });
    return () => {
      mounted.current = false;
      generation.current++;
      controls.cancel();
      listener.remove();
    };
  }, [userId, controls]);
  function close() {
    generation.current++;
    controls.cancel();
    setSnapshot(null);
    setSaved(null);
    setDraft(emptyDraft());
    onClose();
  }
  const supported = Boolean(controls.reminderSupported?.());
  function button(label: string, action: () => void, disabled = busy) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={action}
        style={{
          minHeight: 44,
          padding: 12,
          justifyContent: "center",
          borderWidth: 1,
          borderColor: theme.borderSubtle,
          borderRadius: 10,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text style={{ color: theme.textMain }}>{label}</Text>
      </TouchableOpacity>
    );
  }
  function input(
    label: string,
    value: string,
    change: (value: string) => void,
    maxLength = 64,
  ) {
    return (
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.textMain }}>{label}</Text>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={change}
          editable={!busy}
          maxLength={maxLength}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            minHeight: 44,
            color: theme.textMain,
            backgroundColor: theme.bgInput,
            padding: 10,
            borderWidth: 1,
            borderColor: theme.borderSubtle,
            borderRadius: 8,
          }}
        />
      </View>
    );
  }
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.6)",
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
          paddingHorizontal: 16,
        }}
      >
        <View
          style={{
            flexShrink: 1,
            maxHeight: "95%",
            backgroundColor: theme.bgCard,
            padding: 18,
            borderRadius: 16,
            gap: 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: theme.textMain, fontSize: 21, fontWeight: "700" }}
            >
              Reminders
            </Text>
            {button("Back", close, false)}
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
          >
            <Text style={{ color: theme.textMuted }}>
              Create and cancel Contexify reminders on this phone. Titles stay
              outside chat and Gemini. Scheduling, cancellation and private
              viewing need a connection; alerts you already approved can notify
              offline. Android may delay alerts. Signing out stops local alerts
              and deletes local details. Encrypted reminder history becomes
              eligible for cleanup seven days after the final scheduled time;
              cleanup runs when the app next runs.
            </Text>
            {button("Refresh reminders", refresh, busy || !supported)}
            {supported &&
              !snapshot &&
              button("Enable assistant on this device", () => {
                void run(async () => {
                  await controls.enableVolume(userId); // Shared enrollment only; no volume change.
                  return {
                    message:
                      "Device setup checked. Allow notifications before creating a reminder.",
                  };
                }, true);
              })}
            {Boolean(message) && (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={{ color: theme.textMain }}
              >
                {message}
              </Text>
            )}
            {supported && (
              <>
                <Text
                  accessibilityRole="header"
                  style={{ color: theme.textMain, fontWeight: "700" }}
                >
                  Reminder settings
                </Text>
                <TouchableOpacity
                  accessibilityRole="switch"
                  accessibilityLabel="Encrypted account storage"
                  accessibilityState={{
                    checked: snapshot?.storage.mode === "account",
                    disabled:
                      busy ||
                      !snapshot ||
                      (!snapshot.storage.account_storage_available &&
                        snapshot.storage.mode !== "account"),
                  }}
                  disabled={
                    busy ||
                    !snapshot ||
                    (!snapshot.storage.account_storage_available &&
                      snapshot.storage.mode !== "account")
                  }
                  onPress={() => {
                    if (snapshot)
                      void run(async () => {
                        const result = await controls.setReminderStorage!(
                          userId,
                          snapshot.storage.mode === "account"
                            ? "device_only"
                            : "account",
                          snapshot.storage.revision,
                        );
                        return {
                          message: describeReminderResult(result),
                          clearSaved: result.outcome === "storage_updated",
                        };
                      }, true);
                  }}
                  style={{
                    minHeight: 44,
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: 10,
                    borderColor: theme.borderSubtle,
                  }}
                >
                  <Text style={{ color: theme.textMain }}>
                    Encrypted account storage:{" "}
                    {snapshot?.storage.mode === "account"
                      ? "On"
                      : "Off (device only)"}
                  </Text>
                </TouchableOpacity>
                <Text style={{ color: theme.textMuted }}>
                  Optional server storage applies to new reminders. Your
                  authenticated server can decrypt the encrypted account copy;
                  Gemini cannot access it through this setting. Turning it off
                  deletes this device's saved copies. Restoring a copy never
                  schedules it automatically.
                </Text>
                {snapshot && !snapshot.storage.account_storage_available && (
                  <Text style={{ color: theme.textMuted }}>
                    Encrypted account storage is not configured on this server.
                    Device-only reminders remain available.
                  </Text>
                )}
                {!snapshot?.notifications_allowed &&
                  button(
                    "Allow reminder notifications",
                    () => {
                      void run(
                        async () => ({
                          message:
                            (await controls.requestReminderNotifications!())
                              ? "Notification permission granted."
                              : "Notifications remain unavailable. Check this app's notification permission and reminder channel in Android settings.",
                        }),
                        true,
                      );
                    },
                    busy || !snapshot,
                  )}
                <Text
                  accessibilityRole="header"
                  style={{ color: theme.textMain, fontWeight: "700" }}
                >
                  New reminder
                </Text>
                {input(
                  "Reminder title",
                  draft.title,
                  (value) => setDraft({ ...draft, title: value }),
                  240,
                )}
                {input(
                  "Date (YYYY-MM-DD)",
                  draft.date,
                  (value) => setDraft({ ...draft, date: value }),
                  10,
                )}
                {input(
                  "Time (HH:mm, 24-hour)",
                  draft.time,
                  (value) => setDraft({ ...draft, time: value }),
                  5,
                )}
                {input("Time zone", draft.zone, (value) =>
                  setDraft({ ...draft, zone: value }),
                )}
                <Text style={{ color: theme.textMuted }}>
                  The selected time zone is fixed. Travelling does not move the
                  approved times. Choose a time at least one minute away and
                  within 90 days.
                </Text>
                <View style={{ gap: 6 }}>
                  {(["none", "daily", "weekly"] as const).map((repeat) => (
                    <TouchableOpacity
                      key={repeat}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: draft.repeat === repeat,
                        disabled: busy,
                      }}
                      disabled={busy}
                      onPress={() =>
                        setDraft({
                          ...draft,
                          repeat,
                          until:
                            repeat === "none"
                              ? null
                              : draft.until || draft.date,
                        })
                      }
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <Text style={{ color: theme.textMain }}>
                        {draft.repeat === repeat ? "Selected: " : ""}
                        {repeat === "none"
                          ? "Once"
                          : repeat === "daily"
                            ? "Daily"
                            : "Weekly"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {draft.repeat !== "none" &&
                  input(
                    "Repeat through (YYYY-MM-DD)",
                    draft.until || "",
                    (value) => setDraft({ ...draft, until: value }),
                    10,
                  )}
                <Text style={{ color: theme.textMuted }}>
                  If daylight-saving time repeats a clock hour, choose which
                  occurrence. Nonexistent future occurrences in a repeating
                  schedule are skipped.
                </Text>
                <View style={{ gap: 6 }}>
                  {(["ask", "earlier", "later"] as const).map((overlap) => (
                    <TouchableOpacity
                      key={overlap}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: draft.overlap === overlap,
                        disabled: busy,
                      }}
                      disabled={busy}
                      onPress={() => setDraft({ ...draft, overlap })}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <Text style={{ color: theme.textMain }}>
                        {draft.overlap === overlap ? "Selected: " : ""}
                        {overlap === "ask"
                          ? "Ask if a clock hour repeats"
                          : overlap === "earlier"
                            ? "First occurrence of a repeated hour"
                            : "Second occurrence of a repeated hour"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {button(
                  "Review and create reminder",
                  () => {
                    void run(async () => {
                      const result = await controls.createReminder!(
                        userId,
                        draft,
                      );
                      return {
                        message: describeReminderResult(result),
                        reset: result.outcome === "schedule_requested",
                      };
                    }, true);
                  },
                  busy ||
                    !snapshot?.notifications_allowed ||
                    !draft.title.trim(),
                )}
                <Text
                  accessibilityRole="header"
                  style={{ color: theme.textMain, fontWeight: "700" }}
                >
                  On this phone
                </Text>
                {snapshot?.items.length === 0 && (
                  <Text style={{ color: theme.textMuted }}>
                    No reminder records on this phone.
                  </Text>
                )}
                {snapshot?.items.map((item) => (
                  <View
                    key={item.reminder_id}
                    style={{
                      gap: 6,
                      padding: 10,
                      borderWidth: 1,
                      borderColor: theme.borderSubtle,
                      borderRadius: 10,
                    }}
                  >
                    <Text style={{ color: theme.textMain }}>
                      {item.details?.title || "Reminder record"}
                    </Text>
                    <Text style={{ color: theme.textMuted }}>
                      {item.state === "scheduled"
                        ? `Scheduled: ${new Date(item.next_at).toLocaleString()} (phone display time); ${item.remaining} occurrence(s) remaining.`
                        : item.state === "notification_requested"
                          ? "Notification requested; actual delivery is not verified. Open this screen to read its details."
                          : item.state === "notification_unknown" ||
                              item.state === "schedule_unknown"
                            ? "Outcome unknown. This occurrence will not be retried automatically."
                            : item.state === "cancelled"
                              ? "Cancelled. Private details removed."
                              : `${item.state}.`}
                    </Text>
                    {item.last_outcome && (
                      <Text style={{ color: theme.textMuted }}>
                        Previous occurrence:{" "}
                        {item.last_outcome.replaceAll("_", " ")}. This is
                        recorded evidence, not delivery proof.
                      </Text>
                    )}
                    {item.details &&
                      button("Remove reminder and cancel alerts", () => {
                        void run(
                          async () => ({
                            message: describeReminderResult(
                              await controls.cancelReminder!(
                                userId,
                                item.reminder_id,
                              ),
                            ),
                          }),
                          true,
                        );
                      })}
                    {item.state === "scheduled" &&
                      item.details &&
                      snapshot.storage.mode === "account" &&
                      button("Save encrypted account copy", () => {
                        void run(async () => {
                          await controls.saveReminderCopy!(
                            userId,
                            item.reminder_id,
                          );
                          return {
                            message:
                              "Encrypted account copy saved. No new reminder was scheduled.",
                          };
                        });
                      })}
                  </View>
                ))}
                {snapshot?.storage.account_storage_available &&
                  button("Show saved account reminders", () => {
                    void run(async () => ({
                      page: await controls.savedReminders!(userId),
                    }));
                  })}
                {saved?.items.length === 0 && (
                  <Text style={{ color: theme.textMuted }}>
                    No saved account reminders.
                  </Text>
                )}
                {saved?.items.map((item) => (
                  <View
                    key={item.details.reminder_id}
                    style={{
                      gap: 6,
                      padding: 10,
                      borderWidth: 1,
                      borderColor: theme.borderSubtle,
                      borderRadius: 10,
                    }}
                  >
                    <Text style={{ color: theme.textMain }}>
                      {item.details.title}
                    </Text>
                    <Text style={{ color: theme.textMuted }}>
                      Saved copy: {item.details.date} {item.details.time} (
                      {item.details.zone}). Alerts on another phone are not
                      controlled here.
                    </Text>
                    {button("Use as new draft", () => {
                      const {
                        reminder_id: _id,
                        occurrences: _times,
                        ...copy
                      } = item.details;
                      setDraft(copy);
                      setMessage(
                        "Saved draft loaded. Review or update its date and time, then approve a new reminder. Nothing was scheduled.",
                      );
                    })}
                    {button("Delete saved copy", () => {
                      void run(async () => {
                        const result = await controls.deleteSavedReminder!(
                          userId,
                          item.details.reminder_id,
                        );
                        return {
                          message: describeReminderResult(result),
                          removeSaved:
                            result.outcome === "saved_copy_deleted"
                              ? item.details.reminder_id
                              : undefined,
                        };
                      });
                    })}
                  </View>
                ))}
                {saved?.next_after &&
                  button(
                    "Load more saved reminders",
                    () => {
                      void run(async () => ({
                        page: await controls.savedReminders!(
                          userId,
                          saved.next_after!,
                        ),
                        append: true,
                      }));
                    },
                    busy || saved.items.length >= 512,
                  )}
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
