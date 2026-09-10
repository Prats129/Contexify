import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import type { ChatMode, User } from '../types';

interface HeaderProps {
  currentMode: ChatMode;
  onToggleMode: () => void;
  onOpenDrawer: () => void;
  onNewChat: () => void;
  onOpenAuth: () => void;
  currentUser: User | null;
  isDark?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentMode,
  onToggleMode,
  onOpenDrawer,
  onNewChat,
  onOpenAuth,
  currentUser,
  isDark = true,
}) => {
  const theme = isDark ? colors.dark : colors.light;
  const isWeb = currentMode === 'WEB_SEARCH';

  const handleModePress = () => {
    Haptics.selectionAsync();
    onToggleMode();
  };

  const handleNewChatPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onNewChat();
  };

  const handleDrawerPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenDrawer();
  };

  const handleAuthPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenAuth();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgApp, borderBottomColor: theme.borderSubtle }]}>
      {/* Left: Drawer Hamburger Menu */}
      <TouchableOpacity
        style={[styles.iconButton, { backgroundColor: theme.borderSubtle }]}
        onPress={handleDrawerPress}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.7}
      >
        <Feather name="menu" size={20} color={theme.textMain} />
      </TouchableOpacity>

      {/* Center: Interactive Mode Switcher Pill */}
      <TouchableOpacity
        style={[
          styles.modePill,
          {
            backgroundColor: isWeb ? colors.emeraldLight : colors.primaryLight,
            borderColor: isWeb ? colors.emeraldBorder : colors.primaryBorder,
          },
        ]}
        onPress={handleModePress}
        activeOpacity={0.8}
      >
        <Ionicons
          name={isWeb ? 'globe-outline' : 'document-text-outline'}
          size={14}
          color={isWeb ? colors.emerald : colors.primary}
        />
        <Text
          style={[
            styles.modeText,
            { color: isWeb ? colors.emerald : colors.primary },
          ]}
        >
          {isWeb ? 'Live Web' : 'Doc RAG'}
        </Text>
        <Feather name="repeat" size={11} color={isWeb ? colors.emerald : colors.primary} style={{ opacity: 0.7 }} />
      </TouchableOpacity>

      {/* Right: New Chat (+) and User Avatar */}
      <View style={styles.rightActions}>
        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: theme.borderSubtle }]}
          onPress={handleNewChatPress}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
          accessibilityLabel="New Conversation"
        >
          <Feather name="edit" size={17} color={theme.textMain} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.avatarButton,
            {
              backgroundColor: currentUser?.avatar_color || (currentUser ? colors.primary : theme.borderSubtle),
            },
          ]}
          onPress={handleAuthPress}
          activeOpacity={0.7}
        >
          {currentUser ? (
            <Text style={styles.avatarText}>
              {(currentUser.display_name || currentUser.username || 'U').charAt(0).toUpperCase()}
            </Text>
          ) : (
            <Feather name="user" size={15} color={theme.textMuted} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  modeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
