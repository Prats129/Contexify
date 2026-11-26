import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  Keyboard,
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
  createCommandSession,
  createPublicAssistantPlanner,
  createWakeSession,
  type WakeState,
  type CommandSessionState,
  describeOperationResult,
  supportedOperationPlan,
} from "@contexify/assistant-core";
import { createMobileVoiceAdapter } from "../services/assistant_voice";
import { createMobileWakeAdapter, mobileWakeAvailable } from "../services/assistant_wake";
import {
  readDeviceControlReadiness,
  describeDeviceControlReadiness,
} from "../services/assistant_device_readiness";
import type { AppTheme } from "../theme/colors";
import {
  describeVolumeResult,
  reviewedVolumePercent,
} from "../services/assistant_volume";
import type { DeviceControls } from "../services/assistant_device_controls";
import {
  describeBrightnessResult,
  reviewedBrightnessPercent,
} from "../services/assistant_brightness";
import { ReminderManager } from "./ReminderManager";
import { AlarmManager } from "./AlarmManager";
import { ClarificationForm } from "./ClarificationForm";
import { AppleAssistantTools } from "./AppleAssistantTools";
import { AppleAlarmManager } from "./AppleAlarmManager";
import { CommunicationManager } from "./CommunicationManager";

export function AssistantPreview({
  theme,
  onClose,
  voiceAllowed = false,
  deviceChecksAllowed = false,
  volumeControls,
  volumeUserId,
}: {
  theme: AppTheme;
  onClose: () => void;
  voiceAllowed?: boolean;
  deviceChecksAllowed?: boolean;
  volumeControls?: DeviceControls;
  volumeUserId?: string;
}) {
  const insets = useSafeAreaInsets();
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [alarmsOpen, setAlarmsOpen] = useState(false);
  const [appleToolsOpen, setAppleToolsOpen] = useState(false);
  const [appleAlarmsOpen, setAppleAlarmsOpen] = useState(false);
  const [communicationsOpen, setCommunicationsOpen] = useState(false);
  const [initialCommunicationRequest, setInitialCommunicationRequest] =
    useState<{
      text: string;
      consent: true;
      createdAt: number;
      ownerUserId: string;
    } | null>(null);
  const planningAllowed =
    Boolean(volumeUserId && volumeControls?.planningContext) &&
    (Platform.OS === "android" || Platform.OS === "ios") &&
    process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED === "true" &&
    process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST !== "true";
  const sessionRef = useRef<ReturnType<typeof createCommandSession> | null>(
    null,
  );
  const [state, setState] = useState<CommandSessionState | null>(null);
  const wakeRef = useRef<ReturnType<typeof createWakeSession> | null>(null);
  const [wakeState, setWakeState] = useState<WakeState>({ phase: "idle", message: "" });
  const readinessRequest = useRef<AbortController | null>(null);
  const [checkingDevice, setCheckingDevice] = useState(false);
  const [deviceMessage, setDeviceMessage] = useState("");
  const [controlMessage, setControlMessage] = useState("");
  const [controlBusy, setControlBusy] = useState(false);
  const controlOperation = useRef(0);
  const controlRunning = useRef(false);
  const volumeAllowed =
    Platform.OS === "android" &&
    Boolean(volumeUserId && volumeControls) &&
    process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED === "true" &&
    process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST !== "true";
  async function runPlan(recovery = false) {
    if (
      !volumeAllowed ||
      !volumeControls ||
      !volumeUserId ||
      controlRunning.current ||
      AppState.currentState !== "active"
    )
      return;
    const plan = recovery ? null : sessionRef.current?.takeReviewedPlan();
    if (!recovery && !plan) return;
    controlRunning.current = true;
    const operation = ++controlOperation.current;
    setControlBusy(true);
    setControlMessage(
      recovery
        ? "Checking saved action evidence. No actions will be retried."
        : "Review each exact change in Android confirmation. Cancel stops the remaining plan.",
    );
    try {
      if (!volumeControls.executePlan || !volumeControls.reconcilePlans)
        throw new Error("Compatible build required.");
      const results = recovery
        ? await volumeControls.reconcilePlans(volumeUserId)
        : [await volumeControls.executePlan(volumeUserId, plan!)];
      if (operation === controlOperation.current)
        setControlMessage(
          results.length
            ? (recovery
                ? "Recorded results, not current device readings. "
                : "") + results.map(describeOperationResult).join(" ")
            : "No saved plan evidence on this installation. No device action was performed.",
        );
    } catch (error) {
      if (operation === controlOperation.current)
        setControlMessage(
          (error as { code?: string } | null)?.code === "ERR_APP_UNAVAILABLE"
            ? "The required app has no single reviewed launcher. Install Spotify or use one reviewed Clock app; you can also open it manually. No part of this plan was started."
            : "Plan execution or recovery is unavailable. Use a compatible Android build and signed-in device. Check previous actions before making a new request; nothing will retry automatically.",
        );
    } finally {
      controlRunning.current = false;
      setControlBusy(false);
    }
  }
  useEffect(() => {
    function cancelVolume() {
      controlOperation.current++;
      volumeControls?.cancel();
      setControlMessage("");
    }
    const listener = AppState.addEventListener("change", (next) => {
      if (next !== "active") cancelVolume();
    });
    return () => {
      listener.remove();
      cancelVolume();
    };
  }, [volumeControls, volumeUserId]);
  const brightnessAllowed =
    volumeAllowed &&
    Boolean(
      volumeControls?.enableBrightness && volumeControls?.changeBrightness,
    );
  const remindersAllowed = Boolean(
    volumeUserId && volumeControls?.reminderSupported?.(),
  );
  async function runControl(
    setup: boolean,
    kind: "volume" | "brightness" = "volume",
  ) {
    if (kind === "brightness" && !brightnessAllowed) return;
    if (
      !volumeAllowed ||
      !volumeControls ||
      !volumeUserId ||
      controlRunning.current ||
      AppState.currentState !== "active"
    )
      return;
    const selected = setup
      ? null
      : (sessionRef.current?.takeReviewedControl(
          kind === "volume" ? "media_volume.set" : "brightness.set_app",
        ) ?? null);
    const percent = selected?.percent ?? null;
    if (!setup && percent === null) return;
    controlRunning.current = true;
    const operation = ++controlOperation.current;
    setControlBusy(true);
    setControlMessage(
      setup
        ? ""
        : "Review the exact volume or brightness change in Android confirmation.",
    );
    try {
      if (setup) {
        if (kind === "volume") await volumeControls.enableVolume(volumeUserId);
        else await volumeControls.enableBrightness!(volumeUserId);
        if (operation === controlOperation.current)
          setControlMessage(
            "Device enrollment is ready. Review one supported command, then request its confirmation.",
          );
      } else {
        const result = selected?.contextId
          ? await (volumeControls.changeVolumeFromContext
              ? volumeControls.changeVolumeFromContext(
                  volumeUserId,
                  percent!,
                  selected.contextId,
                )
              : Promise.reject(
                  new Error("A compatible context-aware build is required."),
                ))
          : kind === "volume"
            ? await volumeControls.changeVolume(volumeUserId, percent!)
            : await volumeControls.changeBrightness!(volumeUserId, percent!);
        if (operation === controlOperation.current)
          setControlMessage(
            kind === "volume"
              ? describeVolumeResult(result)
              : describeBrightnessResult(result),
          );
      }
    } catch {
      if (operation === controlOperation.current)
        setControlMessage(
          setup
            ? "Device setup is unavailable. Check the enabled test backend and sign in again if needed."
            : "The control request was interrupted or unavailable. Check the app/device setting before trying again.",
        );
    } finally {
      controlRunning.current = false;
      setControlBusy(false);
    }
  }
  useEffect(() => {
    if (volumeAllowed && state?.reviewed?.operationPlan) {
      if (
        (volumeControls?.supportsPlan ?? supportedOperationPlan)(
          state.reviewed.operationPlan,
        )
      )
        void runPlan();
      return; // Never substitute the legacy v1 bridge for a v2 plan, even on an old APK.
    }
    if (
      volumeAllowed &&
      state?.reviewed &&
      state.reviewed.source !== "local" &&
      reviewedVolumePercent(state.reviewed) !== null
    )
      void runControl(false);
  }, [state?.reviewed, volumeAllowed]);
  function clearCommand() {
    wakeRef.current?.cancel();
    controlOperation.current++;
    volumeControls?.cancel();
    setControlMessage("");
    sessionRef.current?.clear();
  }
  function closePreview() {
    clearCommand();
    onClose();
  }
  function clearDeviceCheck() {
    readinessRequest.current?.abort();
    readinessRequest.current = null;
    setCheckingDevice(false);
    setDeviceMessage("");
  }
  useEffect(() => {
    clearDeviceCheck();
    const lifecycle = AppState.addEventListener("change", (next) => {
      if (next !== "active") clearDeviceCheck();
    });
    return () => {
      readinessRequest.current?.abort();
      readinessRequest.current = null;
      lifecycle.remove();
    };
  }, [deviceChecksAllowed]);
  async function checkDevice() {
    if (
      !deviceChecksAllowed ||
      AppState.currentState !== "active" ||
      readinessRequest.current
    )
      return;
    const request = new AbortController();
    readinessRequest.current = request;
    setCheckingDevice(true);
    setDeviceMessage("");
    try {
      const report = await readDeviceControlReadiness(request.signal);
      if (!request.signal.aborted)
        setDeviceMessage(describeDeviceControlReadiness(report, volumeAllowed));
    } catch {
      if (!request.signal.aborted)
        setDeviceMessage(
          "Checks unavailable. Install a compatible Android build and try again. These checks do not authorize device actions.",
        );
    } finally {
      if (readinessRequest.current === request) {
        readinessRequest.current = null;
        setCheckingDevice(false);
      }
    }
  }
  useEffect(() => {
    const platform =
      Platform.OS === "android"
        ? "android"
        : Platform.OS === "ios"
          ? "ios"
          : "web";
    const session = createCommandSession(
      createMobileVoiceAdapter(
        voiceAllowed &&
          process.env.EXPO_PUBLIC_ASSISTANT_VOICE_ENABLED === "true",
      ),
      platform,
      volumeUserId && volumeControls?.planningContext && planningAllowed
        ? createPublicAssistantPlanner(
            (signal) => volumeControls.planningContext!(volumeUserId, signal),
            (text) => {
              sessionRef.current?.clear();
              setInitialCommunicationRequest({
                text,
                consent: true,
                createdAt: Date.now(),
                ownerUserId: volumeUserId,
              });
              setCommunicationsOpen(true);
            },
          )
        : undefined,
      volumeUserId && volumeControls?.readVolumeContext
        ? (signal) => volumeControls.readVolumeContext!(volumeUserId, signal)
        : undefined,
      volumeControls?.supportsPlan ?? supportedOperationPlan,
    );
    sessionRef.current = session;
    const wake = createWakeSession(
      createMobileWakeAdapter(),
      () => sessionRef.current === session &&
        AppState.currentState === "active" && !controlRunning.current &&
        session.getSnapshot().phase === "idle" && session.getSnapshot().consent,
      async () => { await session.listen(); },
    );
    wakeRef.current = wake;
    setWakeState(wake.getSnapshot());
    const unsubscribeWake = wake.subscribe(() => setWakeState(wake.getSnapshot()));
    setState(session.getSnapshot());
    const unsubscribe = session.subscribe(() =>
      setState(session.getSnapshot()),
    );
    const lifecycle = AppState.addEventListener("change", (next) => {
      if (next !== "active") { wake.cancel(); session.clear(); }
    });
    void session.refreshAvailability();
    return () => {
      unsubscribe();
      unsubscribeWake();
      wake.dispose();
      if (wakeRef.current === wake) wakeRef.current = null;
      lifecycle.remove();
      session.dispose();
      sessionRef.current = null;
    };
  }, [voiceAllowed, volumeUserId, volumeControls, planningAllowed]);
  const capturing = state?.phase === "starting" || state?.phase === "listening";
  const wakeBusy = wakeState.phase !== "idle";
  const wakeAllowed = mobileWakeAvailable(
    voiceAllowed && process.env.EXPO_PUBLIC_ASSISTANT_VOICE_ENABLED === "true",
  );
  const busy = state?.phase !== "idle" || controlBusy || wakeBusy;
  function button(label: string, action: () => void, disabled = false) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={action}
        style={{
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 12,
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
  if (communicationsOpen && volumeUserId)
    return (
      <CommunicationManager
        key={volumeUserId}
        userId={volumeUserId}
        theme={theme}
        initialRequest={initialCommunicationRequest}
        planningConnect={
          planningAllowed && volumeUserId && volumeControls?.planningContext
            ? (signal) => volumeControls.planningContext!(volumeUserId, signal)
            : undefined
        }
        onClose={() => {
          setInitialCommunicationRequest(null);
          setCommunicationsOpen(false);
        }}
      />
    );
  if (appleAlarmsOpen && volumeControls && volumeUserId)
    return (
      <AppleAlarmManager
        key={volumeUserId}
        userId={volumeUserId}
        controls={volumeControls}
        theme={theme}
        onClose={() => setAppleAlarmsOpen(false)}
      />
    );
  if (alarmsOpen && volumeControls && volumeUserId)
    return (
      <AlarmManager
        key={volumeUserId}
        userId={volumeUserId}
        controls={volumeControls}
        theme={theme}
        onClose={() => setAlarmsOpen(false)}
      />
    );
  if (remindersOpen && volumeControls && volumeUserId)
    return (
      <ReminderManager
        key={volumeUserId}
        userId={volumeUserId}
        controls={volumeControls}
        theme={theme}
        onClose={() => setRemindersOpen(false)}
      />
    );
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={closePreview}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.65)",
          justifyContent: "center",
          paddingHorizontal: 16,
          paddingTop: Math.max(16, insets.top),
          paddingBottom: Math.max(16, insets.bottom),
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            width: "100%",
            maxWidth: 520,
            maxHeight: "95%",
            alignSelf: "center",
            backgroundColor: theme.bgCard,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.borderSubtle,
            padding: 18,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{
                color: theme.textMain,
                fontSize: 20,
                fontWeight: "700",
                flex: 1,
              }}
            >
              Assistant preview
            </Text>
            {button("Close", closePreview)}
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12, paddingBottom: 8 }}
          >
            {Platform.OS === "ios" &&
              button(
                appleToolsOpen
                  ? "Hide iPhone tools"
                  : "iPhone tools and support",
                () => {
                  clearCommand();
                  setAppleToolsOpen((open) => !open);
                },
                Boolean(busy),
              )}
            {Platform.OS === "ios" && appleToolsOpen && state && (
              <AppleAssistantTools
                theme={theme}
                voice={state.availability}
                signedIn={Boolean(volumeUserId)}
                beforeOpen={clearCommand}
                scheduling={{
                  reminders: remindersAllowed,
                  alarms: volumeControls?.appleAlarmSupported?.() === true,
                  timers: volumeControls?.appleTimerSupported?.() === true,
                }}
              />
            )}
            {Platform.OS === "ios" &&
              volumeUserId &&
              volumeControls?.appleAlarmSupported?.() &&
              button(
                "iPhone alarms and timers",
                () => {
                  clearCommand();
                  setAppleAlarmsOpen(true);
                },
                Boolean(busy),
              )}
            {volumeAllowed &&
              button(
                "Alarms in Clock",
                () => {
                  clearCommand();
                  setAlarmsOpen(true);
                },
                Boolean(busy),
              )}
            {(volumeAllowed || remindersAllowed) &&
              button(
                "Reminders and settings",
                () => {
                  clearCommand();
                  setRemindersOpen(true);
                },
                Boolean(busy),
              )}
            <Text style={{ color: theme.textMuted }}>
              {state?.planningConsent
                ? volumeAllowed
                  ? "Send a supported command and approve each exact action in Android. App opening needs a compatible build and must be the last action. Unsupported plans stay previews."
                  : "Send a command to review its plan. Device actions are unavailable in this build."
                : volumeAllowed
                  ? "Review a command, then request confirmation for media volume or Contexify app-window brightness. Other actions remain previews."
                  : Platform.OS === "ios" && remindersAllowed
                    ? "Typed commands are previews here. Use Reminders and settings or iPhone alarms and timers to review private schedules."
                    : "Type or dictate a command, then review the steps. Device actions are unavailable here."}
            </Text>
            <Text style={{ color: theme.textMain, fontWeight: "600" }}>
              Your command or transcript
            </Text>
            <TextInput
              accessibilityLabel="Your command or transcript"
              multiline
              maxLength={1024}
              autoCorrect={false}
              editable={
                !wakeBusy &&
                !controlBusy &&
                !capturing &&
                (state?.phase !== "processing" || state.planningConsent)
              }
              value={state?.transcript ?? ""}
              onChangeText={(text) => {
                setControlMessage("");
                sessionRef.current?.setTranscript(text);
              }}
              placeholder="Set media volume to 50%"
              placeholderTextColor={theme.textMuted}
              textAlignVertical="top"
              style={{
                color: theme.textMain,
                backgroundColor: theme.bgInput,
                minHeight: 100,
                maxHeight: 190,
                borderWidth: 1,
                borderColor: theme.borderSubtle,
                borderRadius: 10,
                padding: 12,
                fontSize: 16,
              }}
            />
            {Boolean(state?.partial) && (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: theme.textMuted }}
              >
                Hearing: {state?.partial}
              </Text>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {button(
                state?.planningConsent ? "Send command" : "Review command",
                () => {
                  Keyboard.dismiss();
                  setControlMessage("");
                  void sessionRef.current?.review();
                },
                busy || !state?.transcript.trim(),
              )}
              {button("Clear / cancel", clearCommand)}
            </View>
            {state?.clarification && (
              <ClarificationForm
                key={state.clarification.id}
                pending={state.clarification}
                theme={theme}
                busy={busy}
                onSubmit={(answer, consent) => {
                  void sessionRef.current?.clarify(
                    answer,
                    consent,
                    state.clarification!.id,
                  );
                }}
              />
            )}
            {volumeUserId &&
              volumeControls?.planningContext &&
              planningAllowed && (
                <TouchableOpacity
                  accessibilityRole="checkbox"
                  disabled={wakeBusy && !state?.planningConsent}
                  accessibilityState={{
                    checked: state?.planningConsent ?? false,
                  }}
                  onPress={() => {
                    controlOperation.current++;
                    volumeControls.cancel();
                    setControlMessage("");
                    sessionRef.current?.setPlanningConsent(
                      !state?.planningConsent,
                    );
                  }}
                  style={{ minHeight: 44, justifyContent: "center", gap: 4 }}
                >
                  <Text style={{ color: theme.textMain }}>
                    {state?.planningConsent ? "☑" : "☐"} Allow AI planning in
                    this session.
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    Currently limited to approved public test commands. Do not
                    enter personal information. Enroll this device first.
                    Supported phone/message examples open local recipient
                    selection and native review. Android setting plans open
                    Android confirmations. App opening must be the final action
                    and needs a compatible Android build. Voice transcripts are
                    submitted after you finish speaking.
                  </Text>
                </TouchableOpacity>
              )}
            {state?.phase === "idle" &&
              state.preview === null &&
              Boolean(state.message) && (
                <Text style={{ color: theme.textMain }}>{state.message}</Text>
              )}
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>
              Examples: “open clock”, “brightness to 40 percent”, “set volume to
              50%”. Preview ranges: media volume 0–70%, app brightness 10–100%.
              Nothing is saved to chat history.
            </Text>
            {state?.preview?.map((step, index) => (
              <View
                key={index}
                style={{
                  borderRadius: 10,
                  backgroundColor: theme.bgInput,
                  padding: 12,
                  gap: 4,
                }}
              >
                <Text style={{ color: theme.textMain }}>
                  {index + 1}. {step.description}
                </Text>
                {!step.availableOnPlatform && (
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    This action is preview only in this flow.
                  </Text>
                )}
              </View>
            ))}
            {volumeUserId &&
              process.env.EXPO_PUBLIC_ASSISTANT_EXECUTION_ENABLED === "true" &&
              process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST !== "true" &&
              button(
                "Calls and messages",
                () => {
                  clearCommand();
                  setInitialCommunicationRequest(null);
                  setCommunicationsOpen(true);
                },
                busy,
              )}
            {Platform.OS === "android" && deviceChecksAllowed && (
              <View style={{ gap: 8 }}>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  Check media-volume support, the app window, Spotify and
                  reviewed Clock apps locally. Results stay in this screen. This
                  does not enable device actions.
                </Text>
                {button(
                  checkingDevice
                    ? "Checking Android support..."
                    : "Check Android support",
                  () => {
                    void checkDevice();
                  },
                  checkingDevice || busy,
                )}
                {Boolean(deviceMessage) && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={{ color: theme.textMuted, fontSize: 12 }}
                  >
                    {deviceMessage}
                  </Text>
                )}
              </View>
            )}
            {volumeAllowed && (
              <View style={{ gap: 8 }}>
                {volumeControls?.reconcilePlans &&
                  button(
                    "Check previous actions",
                    () => {
                      void runPlan(true);
                    },
                    busy,
                  )}
                <Text style={{ color: theme.textMuted }}>
                  Enroll this device first. Media volume and app brightness
                  changes need Android confirmation. Reviewed app opens also
                  require a compatible build and must be the final action.
                </Text>
                {button(
                  "Enable device controls on this device",
                  () => {
                    void runControl(true);
                  },
                  controlBusy || busy,
                )}
                {!state?.planningConsent &&
                  button(
                    controlBusy
                      ? "Waiting for volume result..."
                      : "Confirm volume change",
                    () => {
                      void runControl(false);
                    },
                    controlBusy ||
                      busy ||
                      !state?.preview ||
                      reviewedVolumePercent(state.reviewed) === null,
                  )}
              </View>
            )}
            {brightnessAllowed && (
              <View style={{ gap: 8 }}>
                <Text style={{ color: theme.textMuted }}>
                  Contexify app-window brightness only, 10-100%. System
                  brightness and other apps are unaffected. The previous
                  app-window setting returns when Contexify goes into the
                  background.
                </Text>
                {button(
                  "Enable app brightness control",
                  () => {
                    void runControl(true, "brightness");
                  },
                  controlBusy || busy,
                )}
                {button(
                  controlBusy
                    ? "Waiting for control result..."
                    : "Confirm app brightness change",
                  () => {
                    void runControl(false, "brightness");
                  },
                  controlBusy ||
                    busy ||
                    !state?.preview ||
                    reviewedBrightnessPercent(state.reviewed) === null,
                )}
              </View>
            )}
          </ScrollView>
          <View
            style={{
              gap: 8,
              paddingTop: 12,
              borderTopWidth: 1,
              borderColor: theme.borderSubtle,
            }}
          >
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.textMain }}
            >
              {!voiceAllowed
                ? "Sign in to use assistant voice and device controls. You can still review typed commands."
                : (wakeBusy && wakeState.phase !== "handoff" && wakeState.message) || controlMessage ||
                  state?.message || wakeState.message ||
                  state?.availability.message}
            </Text>
            {state?.availability.recognition && (
              <TouchableOpacity
                accessibilityRole="checkbox"
                accessibilityState={{ checked: state.consent }}
                onPress={() => {
                  wakeRef.current?.cancel();
                  sessionRef.current?.setConsent(!state.consent);
                }}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ color: theme.textMain }}>
                  {state.consent ? "☑" : "☐"} Allow the microphone for on-device
                  English speech in this session.
                </Text>
              </TouchableOpacity>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {wakeAllowed && state?.availability.recognition && button(
                wakeBusy ? "Stop wake listening" : "Listen for Hey Contexify",
                () => {
                  if (wakeBusy) { wakeRef.current?.cancel(); sessionRef.current?.clear(); }
                  else {
                    setControlMessage("");
                    sessionRef.current?.setTranscript("");
                    void wakeRef.current?.start();
                  }
                },
                wakeBusy ? wakeState.phase === "stopping" : busy || !state.consent,
              )}
              {state?.availability.recognition &&
                button(
                  capturing ? "Stop microphone" : "Use microphone",
                  () => {
                    setControlMessage("");
                    if (capturing) sessionRef.current?.stop();
                    else void sessionRef.current?.listen();
                  },
                  busy && !capturing,
                )}
              {state?.availability.synthesis &&
                button(
                  "Read preview aloud",
                  () => {
                    setControlMessage("");
                    void sessionRef.current?.readPreview();
                  },
                  busy || !state.preview,
                )}
            </View>
            {wakeAllowed && (
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                Wake listening is optional and stays on this phone for up to 30 seconds while Assistant is open.
                Say “Hey Contexify”, pause, then speak when the command microphone is ready.
                It stops after one command or when you leave. AI planning still needs its own consent;
                actions still need their existing confirmation.
              </Text>
            )}
            {state?.availability.recognition && !state.consent && (
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                Select "Allow the microphone" above before starting voice.
              </Text>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
