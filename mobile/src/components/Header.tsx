import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  useWindowDimensions,
  type ViewInstance,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { getAppTheme, type AppTheme } from "../theme/colors";

interface HeaderProps {
  onOpenDrawer: () => void;
  onNewChat: () => void;
  isDark?: boolean;
  theme?: AppTheme;
  isTemporaryChat?: boolean;
  onToggleTemporaryChat?: () => void;
  onClearChat?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenDrawer,
  onNewChat,
  isDark = true,
  theme: customTheme,
  isTemporaryChat = false,
  onToggleTemporaryChat,
  onClearChat,
}) => {
  const theme = customTheme || getAppTheme(isDark);
  const { width, height } = useWindowDimensions();
  const menuAnchorRef = useRef<ViewInstance>(null);
  const pendingActionRef = useRef<(() => void) | undefined>(undefined);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);

  useEffect(() => setMenuPosition(null), [width, height]);

  const handleNewChatPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onNewChat();
  };

  const handleDrawerPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenDrawer();
  };

  const handleTemporaryChatPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggleTemporaryChat?.();
  };

  const handleConversationActions = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    menuAnchorRef.current?.measureInWindow(
      (x, y, anchorWidth, anchorHeight) => {
        setMenuPosition({
          top: Math.max(8, Math.min(y + anchorHeight + 6, height - 180)),
          right: Math.max(8, width - x - anchorWidth),
        });
      },
    );
  };

  const selectMenuAction = (action?: () => void) => {
    if (!action) return;
    pendingActionRef.current = action;
    setMenuPosition(null);
    // iOS must finish dismissing this presentation before opening another one.
    if (Platform.OS !== "ios") {
      pendingActionRef.current = undefined;
      action();
    }
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
          accessibilityRole="button"
          accessibilityLabel="Contexify, new conversation"
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

      {/* Right: Temporary Chat & Conversation Options */}
      <View style={styles.rightActions}>
        {onToggleTemporaryChat && (
          <TouchableOpacity
            style={[
              styles.iconButton,
              {
                backgroundColor: isTemporaryChat
                  ? "rgba(245, 158, 11, 0.18)"
                  : theme.borderSubtle,
              },
            ]}
            onPress={handleTemporaryChatPress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            accessibilityLabel={
              isTemporaryChat
                ? "Turn off Temporary Chat"
                : "Turn on Temporary Chat"
            }
            accessibilityRole="switch"
            accessibilityState={{ checked: isTemporaryChat }}
          >
            <MaterialCommunityIcons
              name={isTemporaryChat ? "ghost" : "ghost-outline"}
              size={19}
              color={isTemporaryChat ? "#f59e0b" : theme.textMain}
            />
          </TouchableOpacity>
        )}
        <View ref={menuAnchorRef} collapsable={false}>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: theme.borderSubtle }]}
            onPress={handleConversationActions}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Conversation options"
            accessibilityState={{ expanded: menuPosition !== null }}
          >
            <Feather name="more-vertical" size={18} color={theme.textMain} />
          </TouchableOpacity>
        </View>
      </View>
      <Modal
        visible={menuPosition !== null}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setMenuPosition(null)}
        onDismiss={() => {
          const action = pendingActionRef.current;
          pendingActionRef.current = undefined;
          action?.();
        }}
      >
        <View style={styles.menuOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuPosition(null)}
            accessibilityRole="button"
            accessibilityLabel="Close conversation options"
          />
          <View
            accessibilityViewIsModal
            accessibilityRole="menu"
            style={[
              styles.dropdown,
              {
                backgroundColor: theme.bgCard,
                borderColor: theme.borderSubtle,
              },
              menuPosition,
              { maxWidth: width - 16 },
            ]}
          >
            <TouchableOpacity
              style={[styles.menuItem, !onClearChat && styles.disabledItem]}
              disabled={!onClearChat}
              accessibilityRole="menuitem"
              accessibilityState={{ disabled: !onClearChat }}
              onPress={() => selectMenuAction(onClearChat)}
            >
              <Feather name="trash-2" size={18} color={theme.danger} />
              <Text style={[styles.menuText, { color: theme.danger }]}>
                Clear chat
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  menuOverlay: { flex: 1 },
  dropdown: {
    position: "absolute",
    minWidth: 190,
    padding: 6,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 8,
  },
  menuText: { fontSize: 14, flexShrink: 1 },
  disabledItem: { opacity: 0.4 },
});
