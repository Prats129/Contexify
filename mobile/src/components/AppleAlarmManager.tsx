import { useEffect, useRef, useState } from "react";
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
  appleAlarmDraft,
  type AppleAlarmSnapshot,
} from "@contexify/assistant-core";
import type { DeviceControls } from "../services/assistant_device_controls";
import type { AppTheme } from "../theme/colors";

const initial = () => ({
  title: "",
  date: "",
  time: "",
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  repeat: "none" as "none" | "daily" | "weekly",
  until: "",
  overlap: "ask" as "ask" | "earlier" | "later",
  seconds: "300",
});

/** Private local form. No chat/model port, automatic retries or background restoration. */
export function AppleAlarmManager({
  controls,
  userId,
  theme,
  onClose,
}: {
  controls: DeviceControls;
  userId: string;
  theme: AppTheme;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(initial);
  const [kind, setKind] = useState<"alarm" | "timer">("alarm");
  const [snapshot, setSnapshot] = useState<AppleAlarmSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false),
    version = useRef(0),
    mounted = useRef(true);
  const supported = controls.appleAlarmSupported?.() === true;
  const timerSupported = controls.appleTimerSupported?.() === true;
  async function run(
    work: () => Promise<string | AppleAlarmSnapshot>,
    resetDraft = false,
  ) {
    if (running.current || AppState.currentState !== "active") return;
    running.current = true;
    setBusy(true);
    setMessage("");
    const ticket = ++version.current;
    try {
      const value = await work();
      if (
        mounted.current &&
        ticket === version.current &&
        AppState.currentState === "active"
      ) {
        if (typeof value === "string") setMessage(value);
        else setSnapshot(value);
        if (resetDraft) setDraft(initial());
      }
    } catch {
      if (mounted.current && ticket === version.current)
        setMessage(
          "The request is interrupted or unavailable. Check existing alerts and permissions before making another request; nothing will retry automatically.",
        );
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function clear() {
    version.current++;
    controls.cancel();
    setDraft(initial());
    setSnapshot(null);
    setMessage("");
    setBusy(running.current);
  }
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") clear();
    });
    return () => {
      mounted.current = false;
      version.current++;
      listener.remove();
      controls.cancel();
    };
  }, [controls, userId]);
  function button(label: string, action: () => void, disabled = busy) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={action}
        style={{
          minHeight: 44,
          justifyContent: "center",
          padding: 10,
          borderWidth: 1,
          borderRadius: 8,
          borderColor: theme.borderSubtle,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text style={{ color: theme.textMain }}>{label}</Text>
      </TouchableOpacity>
    );
  }
  function input(
    key: "title" | "date" | "time" | "zone" | "until" | "seconds",
    label: string,
  ) {
    return (
      <View style={{ gap: 4 }} key={key}>
        <Text style={{ color: theme.textMain }}>{label}</Text>
        <TextInput
          accessibilityLabel={label}
          value={draft[key]}
          editable={!busy}
          maxLength={key === "title" ? 120 : 64}
          autoCorrect={false}
          autoCapitalize="none"
          onChangeText={(value) =>
            setDraft((old) => ({ ...old, [key]: value }))
          }
          style={{
            color: theme.textMain,
            borderColor: theme.borderSubtle,
            borderWidth: 1,
            borderRadius: 8,
            padding: 10,
            fontSize: 16,
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
      onRequestClose={() => {
        clear();
        onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.7)",
          padding: 16,
          paddingTop: Math.max(16, insets.top),
          paddingBottom: Math.max(16, insets.bottom),
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: "95%",
            width: "100%",
            maxWidth: 520,
            alignSelf: "center",
            padding: 16,
            gap: 10,
            borderRadius: 16,
            backgroundColor: theme.bgCard,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: theme.textMain, fontSize: 21, fontWeight: "700" }}
          >
            iPhone alarms and timers
          </Text>
          {button(
            "Back",
            () => {
              clear();
              onClose();
            },
            false,
          )}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
          >
            <Text style={{ color: theme.textMuted }}>
              Ringing alerts use AlarmKit on iOS 26 or later and can sound
              through silent mode or Focus. Details stay encrypted on this phone
              and outside Gemini/account copies. The locked screen shows generic
              text. Each create/cancel requires online authority and exact
              iPhone approval. Approved alerts can ring offline. Signing out
              cancels this app's alerts; Apple's Clock alarms remain separate.
            </Text>
            {!supported && (
              <Text style={{ color: theme.textMuted }}>
                Use a compatible iOS 26+ build, or set an alarm directly in
                Clock. No ringing alert has been scheduled here.
              </Text>
            )}
            {supported && (
              <>
                {button("Enable assistant on this device", () => {
                  void run(async () => {
                    await controls.enableVolume(userId);
                    return "Device enrollment ready. Allow AlarmKit, then review your schedule.";
                  });
                })}
                {button("Allow AlarmKit alarms", () => {
                  void run(async () =>
                    (await controls.requestAppleAlarmPermission?.())
                      ? "AlarmKit permission granted. Review a schedule to create an alert."
                      : "AlarmKit permission unavailable or denied. Check iPhone Settings; no alert was created.",
                  );
                })}
                {button("Refresh this phone's alarms", () => {
                  void run(async () => controls.readAppleAlarms!(userId));
                })}
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {button(kind === "alarm" ? "Alarm selected" : "Alarm", () =>
                    setKind("alarm"),
                  )}
                  {button(
                    kind === "timer" ? "Timer selected" : "Timer",
                    () => setKind("timer"),
                    busy || !timerSupported,
                  )}
                </View>
                {input("title", "Private label")}
                {kind === "timer" ? (
                  input("seconds", "Duration in whole seconds (60–86400)")
                ) : (
                  <>
                    {input("date", "Date (YYYY-MM-DD)")}
                    {input("time", "Time (HH:mm, 24-hour)")}
                    {input("zone", "Time zone (for example Asia/Kolkata)")}
                    <Text style={{ color: theme.textMuted }}>
                      Repeats are bounded by the end date and use the selected
                      time zone. At most 32 pending occurrences fit on this
                      phone. Approved UTC times do not change when the phone's
                      display zone changes.
                    </Text>
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                    >
                      {(["none", "daily", "weekly"] as const).map((repeat) =>
                        button(
                          `${draft.repeat === repeat ? "Selected: " : ""}${repeat}`,
                          () => setDraft((old) => ({ ...old, repeat })),
                        ),
                      )}
                    </View>
                    {draft.repeat !== "none" &&
                      input("until", "Repeat through (YYYY-MM-DD)")}
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                    >
                      {(["ask", "earlier", "later"] as const).map((overlap) =>
                        button(
                          `${draft.overlap === overlap ? "Selected: " : ""}Repeated hour: ${overlap}`,
                          () => setDraft((old) => ({ ...old, overlap })),
                        ),
                      )}
                    </View>
                  </>
                )}
                {button("Review and schedule", () => {
                  try {
                    const request = appleAlarmDraft(
                      kind === "timer"
                        ? {
                            kind,
                            title: draft.title,
                            duration_seconds: Number(draft.seconds),
                          }
                        : {
                            kind,
                            schedule: {
                              title: draft.title,
                              date: draft.date,
                              time: draft.time,
                              zone: draft.zone,
                              repeat: draft.repeat,
                              until:
                                draft.repeat === "none" ? null : draft.until,
                              overlap: draft.overlap,
                            },
                          },
                    );
                    void run(async () => {
                      const result = await controls.createAppleAlarm!(
                        userId,
                        request,
                      );
                      if (result.outcome === "schedule_requested")
                        return (
                          "AlarmKit accepted the alert registration. Refresh to check it. This does not prove it rang." +
                          (result.receipt_recorded
                            ? ""
                            : " Server receipt unavailable; do not repeat the request.")
                        );
                      return result.outcome === "cancelled"
                        ? "Approval cancelled. No new alert was approved."
                        : "Outcome unknown or failed. Refresh and check the existing alert before trying again.";
                    }, true);
                  } catch {
                    setMessage(
                      "Review the private label, date/time/zone and duration. No schedule was submitted.",
                    );
                  }
                })}
              </>
            )}
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.textMain }}
            >
              {message}
            </Text>
            {snapshot?.items.map((row) => (
              <View key={row.reminder_id} style={{ gap: 6 }}>
                <Text style={{ color: theme.textMain }}>
                  {row.title} ({row.kind}): {row.state}
                </Text>
                <Text style={{ color: theme.textMuted }}>
                  Requested time: {new Date(row.next_at).toLocaleString()};{" "}
                  {row.remaining} OS registration(s) remain. System changes may
                  affect timer state; this is not proof of delivery.
                </Text>
                {button("Cancel " + row.title, () => {
                  void run(async () => {
                    const result = await controls.cancelAppleAlarm!(
                      userId,
                      row.reminder_id,
                    );
                    return result.outcome === "reminder_cancelled"
                      ? "This phone's future alert was cancelled. Refresh the list."
                      : "Cancellation was not confirmed. Refresh and check the alert before trying again.";
                  });
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
