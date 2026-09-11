import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { getAppTheme, type AppTheme } from "../theme/colors";
import {
  getApiBaseUrl,
  setApiBaseUrl,
  resetApiBaseUrl,
  apiService,
} from "../services/api";

interface ServerConfigModalProps {
  visible: boolean;
  onClose: () => void;
  isDark?: boolean;
  theme?: AppTheme;
}

export const ServerConfigModal: React.FC<ServerConfigModalProps> = ({
  visible,
  onClose,
  isDark = true,
  theme: customTheme,
}) => {
  const theme = customTheme || getAppTheme(isDark);
  const [currentUrl, setCurrentUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [pingStatus, setPingStatus] = useState<
    "idle" | "testing" | "online" | "offline"
  >("idle");

  useEffect(() => {
    if (visible) {
      getApiBaseUrl().then((url) => {
        setCurrentUrl(url);
        setInputUrl(url);
        setPingStatus("idle");
      });
    }
  }, [visible]);

  const handleTestPing = async () => {
    setPingStatus("testing");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const isOnline = await apiService.pingHealth();
      setPingStatus(isOnline ? "online" : "offline");
      Haptics.notificationAsync(
        isOnline
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
    } catch {
      setPingStatus("offline");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleSave = async () => {
    if (!inputUrl.trim()) return;
    await setApiBaseUrl(inputUrl.trim());
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  const handleReset = async () => {
    await resetApiBaseUrl();
    const def = await getApiBaseUrl();
    setCurrentUrl(def);
    setInputUrl(def);
    setPingStatus("idle");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[
              styles.dialog,
              { backgroundColor: theme.bgCard, borderColor: theme.borderHover },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Feather name="server" size={17} color={theme.primary} />
                <Text style={[styles.title, { color: theme.textMain }]}>
                  Backend Server Config
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.closeBtn,
                  { backgroundColor: theme.borderSubtle },
                ]}
                onPress={onClose}
              >
                <Feather name="x" size={16} color={theme.textMain} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.description, { color: theme.textMuted }]}>
              Enter your computer's local Wi-Fi IP and port (default is port
              8001) so your phone can reach FastAPI.
            </Text>

            {/* Input URL */}
            <View
              style={[
                styles.inputBox,
                {
                  backgroundColor: theme.bgInput,
                  borderColor: theme.borderSubtle,
                },
              ]}
            >
              <TextInput
                style={[styles.input, { color: theme.textMain }]}
                value={inputUrl}
                onChangeText={(t) => {
                  setInputUrl(t);
                  setPingStatus("idle");
                }}
                placeholder="http://192.168.1.10:8001"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Live Ping Status Indicator */}
            <View style={styles.pingRow}>
              <TouchableOpacity
                style={[
                  styles.pingBtn,
                  { backgroundColor: theme.borderSubtle },
                ]}
                onPress={handleTestPing}
                disabled={pingStatus === "testing"}
              >
                {pingStatus === "testing" ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <>
                    <Feather name="activity" size={13} color={theme.primary} />
                    <Text
                      style={[styles.pingBtnText, { color: theme.primary }]}
                    >
                      Test Connection
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {pingStatus === "online" && (
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: theme.emerald },
                    ]}
                  />
                  <Text style={[styles.statusText, { color: theme.emerald }]}>
                    Connected
                  </Text>
                </View>
              )}

              {pingStatus === "offline" && (
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: theme.danger },
                    ]}
                  />
                  <Text style={[styles.statusText, { color: theme.danger }]}>
                    Cannot Reach
                  </Text>
                </View>
              )}
            </View>

            {/* Actions */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.resetBtn,
                  { backgroundColor: theme.borderSubtle },
                ]}
                onPress={handleReset}
              >
                <Text style={[styles.resetText, { color: theme.textMuted }]}>
                  Reset Default
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: theme.primary }]}
                onPress={handleSave}
              >
                <Text style={styles.saveText}>Save URL</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  dialog: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
  },
  inputBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    justifyContent: "center",
  },
  input: {
    fontSize: 14,
  },
  pingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  pingBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  resetBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  resetText: {
    fontSize: 13,
    fontWeight: "600",
  },
  saveBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
});
