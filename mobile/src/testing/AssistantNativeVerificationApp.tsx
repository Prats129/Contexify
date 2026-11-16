import React, { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AssistantPreview } from "../components/AssistantPreview";
import { getAppTheme } from "../theme/colors";
import appConfig from "../../app.json";

/** Standalone local test host: no account, chat, API transport or private storage imports. */
export default function AssistantNativeVerificationApp() {
  const [open, setOpen] = useState(false);
  const theme = getAppTheme(false, "blue");
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bgApp }}>
        <View
          style={{ flex: 1, justifyContent: "center", padding: 24, gap: 18 }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: theme.textMain, fontSize: 26, fontWeight: "700" }}
          >
            Contexify Assistant Test
          </Text>
          <Text style={{ color: theme.textMuted }}>
            Test build {appConfig.expo.version}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 16 }}>
            Offline native testing. This app has no login or backend connection.
            It cannot change your phone or open apps.
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 16 }}>
            Open the preview to check Android support or try voice after giving
            microphone consent. There is no wake phrase or background listening.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => setOpen(true)}
            style={{
              minHeight: 48,
              justifyContent: "center",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.borderSubtle,
              padding: 14,
            }}
          >
            <Text
              style={{ color: theme.textMain, fontSize: 16, fontWeight: "600" }}
            >
              Open assistant test
            </Text>
          </TouchableOpacity>
        </View>
        {open && (
          <AssistantPreview
            theme={theme}
            onClose={() => setOpen(false)}
            voiceAllowed
            deviceChecksAllowed
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
