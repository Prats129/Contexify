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
  describeAlarmHandoff,
  type AlarmDraft,
} from "@contexify/assistant-core";
import type { DeviceControls } from "../services/assistant_device_controls";
import type { AppTheme } from "../theme/colors";

function emptyDraft(): AlarmDraft {
  const time = new Date(Date.now() + 10 * 60000);
  return {
    kind: "set_alarm",
    time: `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`,
    label: "",
    days: [],
    clock: "auto",
  };
}
const clocks = [
  ["auto", "Use the only available reviewed Clock"],
  ["samsung", "Samsung Clock"],
  ["google", "Google Clock"],
  ["android", "Android Clock"],
] as const;
const days = [
  [2, "Monday"],
  [3, "Tuesday"],
  [4, "Wednesday"],
  [5, "Thursday"],
  [6, "Friday"],
  [7, "Saturday"],
  [1, "Sunday"],
] as const;

/** Private inputs are sent only to the selected Clock after native exact approval. */
export function AlarmManager({
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
  const [draft, setDraft] = useState<AlarmDraft>(emptyDraft());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false),
    generation = useRef(0),
    pending = useRef(false);
  const supported = Boolean(
    controls.alarmHandoffSupported?.() && controls.requestAlarmHandoff,
  );
  useEffect(() => {
    mounted.current = true;
    setDraft(emptyDraft());
    setMessage("");
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        generation.current++;
        controls.cancel();
        setDraft(emptyDraft());
        setMessage(
          "Private fields cleared. Check Clock for any request you already approved. Nothing will be retried automatically.",
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
  async function run(work: () => Promise<string>) {
    if (pending.current || AppState.currentState !== "active") return;
    pending.current = true;
    setBusy(true);
    const ticket = generation.current;
    try {
      const text = await work();
      if (
        mounted.current &&
        ticket === generation.current &&
        AppState.currentState === "active"
      )
        setMessage(text);
    } catch (error) {
      if (
        mounted.current &&
        ticket === generation.current &&
        AppState.currentState === "active"
      )
        setMessage(
          error instanceof Error
            ? error.message
            : "Request unavailable. Check Clock before making another request.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function request(kind: AlarmDraft["kind"]) {
    if (!supported) return;
    const selected: AlarmDraft =
      kind === "show_alarms"
        ? { kind, clock: draft.clock, time: "", label: "", days: [] }
        : { ...draft, kind };
    void run(async () =>
      describeAlarmHandoff(
        await controls.requestAlarmHandoff!(userId, selected),
      ),
    );
  }
  function close() {
    generation.current++;
    controls.cancel();
    setDraft(emptyDraft());
    setMessage("");
    onClose();
  }
  function button(label: string, press: () => void, disabled = busy) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={press}
        style={{
          minHeight: 44,
          padding: 12,
          borderWidth: 1,
          borderRadius: 10,
          borderColor: theme.borderSubtle,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Text style={{ color: theme.textMain, fontWeight: "600" }}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.65)",
          padding: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <View
          style={{
            maxHeight: "100%",
            borderRadius: 18,
            padding: 18,
            gap: 12,
            backgroundColor: theme.bgCard,
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
              Alarms in Clock
            </Text>
            {button("Back", close, false)}
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={{ color: theme.textMuted }}>
              Send a reviewed request to Clock. Clock may create or reuse an
              alarm immediately and controls ringing, repeat days and sound.
              Check the result there. Contexify sign-out does not cancel Clock
              alarms.
            </Text>
            <Text style={{ color: theme.textMuted }}>
              Labels and times stay outside chat, Gemini and Contexify account
              storage. The selected Clock receives the details only after your
              approval.
            </Text>
            {!supported && (
              <Text accessibilityRole="alert" style={{ color: theme.textMain }}>
                Alarm handoffs require an updated compatible Android build.
              </Text>
            )}
            {Boolean(message) && (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={{ color: theme.textMain }}
              >
                {message}
              </Text>
            )}
            {button(
              "Enable assistant on this device",
              () => {
                void run(async () => {
                  await controls.enableVolume(userId);
                  return "Device setup checked. Review an alarm request when ready.";
                });
              },
              busy || !supported,
            )}
            <Text
              accessibilityRole="header"
              style={{ color: theme.textMain, fontWeight: "700" }}
            >
              Choose Clock
            </Text>
            {clocks.map(([value, label]) => (
              <TouchableOpacity
                key={value}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: draft.clock === value,
                  disabled: busy,
                }}
                disabled={busy}
                onPress={() => setDraft({ ...draft, clock: value })}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ color: theme.textMain }}>
                  {draft.clock === value ? "Selected: " : ""}
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
            <Text style={{ color: theme.textMain }}>
              Alarm time (HH:mm, 24-hour)
            </Text>
            <TextInput
              accessibilityLabel="Alarm time (HH:mm, 24-hour)"
              value={draft.time}
              editable={!busy}
              maxLength={5}
              onChangeText={(time) => setDraft({ ...draft, time })}
              style={{
                color: theme.textMain,
                borderColor: theme.borderSubtle,
                borderWidth: 1,
                borderRadius: 10,
                padding: 12,
                minHeight: 44,
              }}
            />
            <Text style={{ color: theme.textMuted }}>
              The next occurrence of this time in the phone's current time zone.
              The native confirmation shows the resolved date. For a specific
              future date or daylight-saving ambiguity, set it directly in
              Clock.
            </Text>
            <Text style={{ color: theme.textMain }}>Optional alarm label</Text>
            <TextInput
              accessibilityLabel="Optional alarm label"
              value={draft.label}
              editable={!busy}
              maxLength={120}
              onChangeText={(label) => setDraft({ ...draft, label })}
              style={{
                color: theme.textMain,
                borderColor: theme.borderSubtle,
                borderWidth: 1,
                borderRadius: 10,
                padding: 12,
                minHeight: 44,
              }}
            />
            <Text
              accessibilityRole="header"
              style={{ color: theme.textMain, fontWeight: "700" }}
            >
              Repeat days (none means once)
            </Text>
            {days.map(([day, label]) => (
              <TouchableOpacity
                key={day}
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: draft.days.includes(day),
                  disabled: busy,
                }}
                disabled={busy}
                onPress={() =>
                  setDraft({
                    ...draft,
                    days: draft.days.includes(day)
                      ? draft.days.filter((value) => value !== day)
                      : [...draft.days, day],
                  })
                }
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ color: theme.textMain }}>
                  {draft.days.includes(day) ? "Selected: " : ""}
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
            {button(
              "Review alarm request",
              () => request("set_alarm"),
              busy || !supported,
            )}
            {button(
              "Open Clock to view or cancel alarms",
              () => request("show_alarms"),
              busy || !supported,
            )}
            <Text style={{ color: theme.textMuted }}>
              Contexify cannot read Clock's alarm list or dismiss an
              unidentified alarm. Review, edit and delete Clock alarms inside
              Clock. A handoff result does not prove creation or ringing. No
              request is retried automatically.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
