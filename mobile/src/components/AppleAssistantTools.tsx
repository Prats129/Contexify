import { useEffect, useRef, useState } from "react";
import { AppState, Text, TouchableOpacity, View } from "react-native";
import {
  companionFeatures,
  type VoiceAvailability,
} from "@contexify/assistant-core";
import { createAppleCompanion } from "../services/assistant_platform";
import type { AppTheme } from "../theme/colors";

export function AppleAssistantTools({
  theme,
  voice,
  signedIn,
  beforeOpen,
  scheduling,
}: {
  theme: AppTheme;
  voice: VoiceAvailability;
  signedIn: boolean;
  beforeOpen: () => void;
  scheduling?: { reminders: boolean; alarms: boolean; timers: boolean };
}) {
  const companion = useRef<ReturnType<typeof createAppleCompanion> | null>(
    null,
  );
  const [support, setSupport] = useState({
    calendar_editor: false,
    shortcuts: false,
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(0);
  useEffect(() => {
    const port = createAppleCompanion();
    companion.current = port;
    let mounted = true;
    void port.support().then((value) => {
      if (mounted) setSupport(value);
    });
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        operation.current++;
        port.cancel();
        setBusy(false);
        setMessage("");
      }
    });
    return () => {
      mounted = false;
      operation.current++;
      listener.remove();
      port.dispose();
      companion.current = null;
    };
  }, [signedIn]);
  return (
    <View style={{ gap: 10 }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.textMain, fontWeight: "600" }}
      >
        What works on this iPhone
      </Text>
      {companionFeatures(
        "ios",
        voice,
        support.calendar_editor,
        support.shortcuts,
        scheduling,
      ).map((feature) => (
        <View key={feature.id}>
          <Text style={{ color: theme.textMain }}>
            {feature.label}: {feature.status.replace(/_/g, " ")}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            {feature.detail}
          </Text>
        </View>
      ))}
      {signedIn && support.calendar_editor && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          style={{ minHeight: 44, justifyContent: "center" }}
          onPress={() => {
            if (busy || !companion.current) return;
            beforeOpen();
            const version = ++operation.current;
            setBusy(true);
            setMessage("");
            void companion.current.editCalendarEvent().then((result) => {
              if (version === operation.current) {
                setMessage(result);
                setBusy(false);
              }
            });
          }}
        >
          <Text style={{ color: theme.textMain }}>
            {busy ? "Calendar editor open…" : "Create event in Apple Calendar"}
          </Text>
        </TouchableOpacity>
      )}
      {!signedIn && (
        <Text style={{ color: theme.textMuted }}>
          Sign in before opening the Calendar editor here, or use Calendar
          directly.
        </Text>
      )}
      <Text accessibilityLiveRegion="polite" style={{ color: theme.textMain }}>
        {message}
      </Text>
    </View>
  );
}
