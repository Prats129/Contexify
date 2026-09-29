import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { getAppTheme, type AppTheme } from "../theme/colors";

interface HeaderProps {
  onOpenDrawer: () => void;
  onNewChat: () => void;
  onToggleTheme: () => void;
  isDark?: boolean;
  theme?: AppTheme;
  isTemporaryChat?: boolean;
  onToggleTemporaryChat?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenDrawer,
  onNewChat,
  onToggleTheme,
  isDark = true,
  theme: customTheme,
  isTemporaryChat = false,
  onToggleTemporaryChat,
}) => {
  const theme = customTheme || getAppTheme(isDark);

  const handleTemporaryChatPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (onToggleTemporaryChat) {
      onToggleTemporaryChat();
    }
  };

  const handleNewChatPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onNewChat();
  };

  const handleDrawerPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenDrawer();
  };

  const handleThemePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggleTheme();
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.bgApp, borderBottomColor: theme.borderSubtle },
      ]}
    >
      {/* Left: Hamburger Menu & Logo Branding */}
      <View style={styles.leftGroup}>
        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: theme.borderSubtle }]}
          onPress={handleDrawerPress}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
          accessibilityLabel="Open Menu"
        >
          <Feather name="menu" size={19} color={theme.textMain} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.brandRow}
          onPress={handleNewChatPress}
          activeOpacity={0.8}
        >
          <Image
            source={require("../../assets/logo.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={[styles.brandTitle, { color: theme.textMain }]}>
            Contexify
          </Text>
        </TouchableOpacity>
      </View>

      {/* Right: Temporary Chat, New Chat & Theme Toggle */}
      <View style={styles.rightActions}>
        {/* Temporary Chat Toggle (ChatGPT style ghost) */}
        {onToggleTemporaryChat && (
          <TouchableOpacity
            style={[
              styles.iconButton,
              isTemporaryChat
                ? {
                    flexDirection: "row",
                    gap: 4,
                    paddingHorizontal: 8,
                    width: "auto",
                    backgroundColor: "rgba(245, 158, 11, 0.18)",
                    borderColor: "#f59e0b",
                    borderWidth: 1,
                  }
                : { backgroundColor: theme.borderSubtle },
            ]}
            onPress={handleTemporaryChatPress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            accessibilityLabel={
              isTemporaryChat
                ? "Temporary Chat is active. Tap to exit."
                : "Turn on Temporary Chat"
            }
          >
            <MaterialCommunityIcons
              name={isTemporaryChat ? "ghost" : "ghost-outline"}
              size={17}
              color={isTemporaryChat ? "#f59e0b" : theme.textMuted}
            />
            {isTemporaryChat && (
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  color: isDark ? "#fcd34d" : "#b45309",
                }}
              >
                Temp
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* New Chat Button (Hidden during temporary chat) */}
        {!isTemporaryChat && (
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: theme.borderSubtle }]}
            onPress={handleNewChatPress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            accessibilityLabel="New Conversation"
          >
            <Feather name="edit" size={16} color={theme.textMain} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: theme.borderSubtle }]}
          onPress={handleThemePress}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
          accessibilityLabel={
            isDark ? "Switch to Light Mode" : "Switch to Dark Mode"
          }
        >
          <Feather
            name={isDark ? "sun" : "moon"}
            size={17}
            color={isDark ? "#fbbf24" : theme.textMain}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderBottomWidth: 1,
  },
  leftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoImage: {
    width: 30,
    height: 30,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});
