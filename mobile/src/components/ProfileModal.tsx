import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  Image,
  Animated,
  PanResponder,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import {
  ACCENT_PALETTES,
  type AccentColor,
  type ThemeMode,
} from "../theme/colors";
import { apiService } from "../services/api";
import type { User } from "../types";

interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
  currentUser: User | null;
  currentAccent: AccentColor;
  onSelectAccent: (accent: AccentColor) => void;
  themeMode: ThemeMode;
  onToggleThemeMode: (mode: ThemeMode) => void;
  onProfileUpdated: (user: User) => void;
  onLogout: () => void;
  theme: any;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  visible,
  onClose,
  currentUser,
  currentAccent,
  onSelectAccent,
  themeMode,
  onToggleThemeMode,
  onProfileUpdated,
  onLogout,
  theme,
}) => {
  // Display name state
  const [displayName, setDisplayName] = useState("");
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  // Avatar states
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isRemovingAvatar, setIsRemovingAvatar] = useState(false);

  // Password change states
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  const translateY = useRef(new Animated.Value(700)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(700);
      Animated.spring(translateY, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleClose = () => {
    Animated.timing(translateY, {
      toValue: 700,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 4,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 65 || gestureState.vy > 0.45) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Animated.timing(translateY, {
            toValue: 700,
            duration: 160,
            useNativeDriver: true,
          }).start(() => {
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            velocity: gestureState.vy,
            tension: 65,
            friction: 10,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.display_name || "");
      setStatusMessage(null);
      setOldPassword("");
      setNewPassword("");
      setShowPasswordSection(false);

      if (currentUser.avatar_url) {
        apiService
          .resolveAvatarUrl(currentUser.avatar_url)
          .then(setResolvedAvatar);
      } else {
        setResolvedAvatar(null);
      }
    }
  }, [currentUser, visible]);

  if (!currentUser) return null;

  // --- 1. Instant Accent Color Selection (No Save button needed) ---
  const handleAccentClick = (accentId: AccentColor) => {
    Haptics.selectionAsync();
    onSelectAccent(accentId);
    const pal = ACCENT_PALETTES[accentId];

    // Persist to user account in background
    apiService
      .updateUserProfile(currentUser.id, undefined, pal.primary)
      .then((updated) => {
        onProfileUpdated(updated);
      })
      .catch(() => {});
  };

  // --- 2. Instant Theme Mode Toggle ---
  const handleThemeModeClick = (mode: ThemeMode) => {
    Haptics.selectionAsync();
    onToggleThemeMode(mode);
  };

  // --- 3. Save Display Name ---
  const handleSaveDisplayName = async () => {
    if (!displayName.trim()) {
      setStatusMessage({ text: "Display name cannot be empty", isError: true });
      return;
    }

    setIsUpdatingName(true);
    setStatusMessage(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const updated = await apiService.updateUserProfile(
        currentUser.id,
        displayName.trim(),
      );
      onProfileUpdated(updated);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatusMessage({
        text: "Display name saved successfully!",
        isError: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ text: msg, isError: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUpdatingName(false);
    }
  };

  // --- 4. Upload Avatar Image ---
  const handlePickAvatar = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "image/png",
          "image/jpeg",
          "image/jpg",
          "image/webp",
          "image/gif",
        ],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets.length > 0) {
        const file = res.assets[0];
        setIsUploadingAvatar(true);
        setStatusMessage(null);

        const updated = await apiService.uploadAvatar(
          currentUser.id,
          file.uri,
          file.name,
          file.mimeType || "image/png",
        );
        onProfileUpdated(updated);
        if (updated.avatar_url) {
          const resolved = await apiService.resolveAvatarUrl(
            updated.avatar_url,
          );
          setResolvedAvatar(resolved);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStatusMessage({
          text: "Profile picture updated successfully!",
          isError: false,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ text: msg, isError: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // --- 5. Remove Avatar Image ---
  const handleRemoveAvatar = async () => {
    setIsRemovingAvatar(true);
    setStatusMessage(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const updated = await apiService.deleteAvatar(currentUser.id);
      onProfileUpdated(updated);
      setResolvedAvatar(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatusMessage({ text: "Profile picture removed.", isError: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ text: msg, isError: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsRemovingAvatar(false);
    }
  };

  // --- 6. Change Password ---
  const handleChangePassword = async () => {
    if (!oldPassword.trim() || !newPassword.trim()) {
      setStatusMessage({
        text: "Please fill in both password fields.",
        isError: true,
      });
      return;
    }
    if (newPassword.length < 6) {
      setStatusMessage({
        text: "New password must be at least 6 characters long.",
        isError: true,
      });
      return;
    }

    setIsChangingPass(true);
    setStatusMessage(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await apiService.changePassword(currentUser.id, oldPassword, newPassword);
      setOldPassword("");
      setNewPassword("");
      setShowPasswordSection(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatusMessage({
        text: "Password changed successfully!",
        isError: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ text: msg, isError: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsChangingPass(false);
    }
  };

  // --- 7. Log Out ---
  const handleLogoutPress = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      "Log Out",
      "Are you sure you want to sign out of Contexify AI?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: () => {
            onLogout();
            onClose();
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: theme.bgApp,
              borderColor: theme.borderSubtle,
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Grabber Handle & Header (Draggable to close) */}
          <View {...panResponder.panHandlers}>
            <View style={styles.handleContainer}>
              <View
                style={[
                  styles.handleBar,
                  { backgroundColor: theme.borderSubtle },
                ]}
              />
            </View>

            {/* Header */}
            <View
              style={[styles.header, { borderBottomColor: theme.borderSubtle }]}
            >
              <View style={styles.headerLeft}>
                <Feather name="user-check" size={18} color={theme.primary} />
                <Text style={[styles.title, { color: theme.textMain }]}>
                  Account & Settings
                </Text>
              </View>
            </View>
          </View>

          {/* Notification Banner */}
          {statusMessage && (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: statusMessage.isError
                    ? theme.dangerLight
                    : theme.emeraldLight,
                  borderColor: statusMessage.isError
                    ? theme.dangerBorder
                    : theme.emeraldBorder,
                },
              ]}
            >
              <Feather
                name={statusMessage.isError ? "alert-circle" : "check-circle"}
                size={14}
                color={statusMessage.isError ? theme.danger : theme.emerald}
              />
              <Text
                style={[
                  styles.bannerText,
                  {
                    color: statusMessage.isError ? theme.danger : theme.emerald,
                  },
                ]}
              >
                {statusMessage.text}
              </Text>
            </View>
          )}

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={true}
          >
            {/* User Hero Badge with Profile Photo Upload */}
            <View
              style={[
                styles.heroCard,
                {
                  backgroundColor: theme.bgCard,
                  borderColor: theme.borderSubtle,
                },
              ]}
            >
              <View style={styles.avatarSection}>
                <View
                  style={[
                    styles.largeAvatar,
                    {
                      backgroundColor:
                        currentUser.avatar_color || theme.primary,
                    },
                  ]}
                >
                  {resolvedAvatar ? (
                    <Image
                      source={{ uri: resolvedAvatar }}
                      style={styles.largeAvatarImg}
                    />
                  ) : (
                    <Text style={styles.largeAvatarText}>
                      {(displayName || currentUser.username || "U")
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  )}
                </View>

                {/* Photo Actions */}
                <View style={styles.avatarBtnRow}>
                  <TouchableOpacity
                    style={[
                      styles.avatarActionBtn,
                      {
                        backgroundColor: theme.primaryLight,
                        borderColor: theme.primaryBorder,
                      },
                    ]}
                    onPress={handlePickAvatar}
                    disabled={isUploadingAvatar}
                    activeOpacity={0.7}
                  >
                    {isUploadingAvatar ? (
                      <ActivityIndicator size="small" color={theme.primary} />
                    ) : (
                      <>
                        <Feather
                          name="camera"
                          size={12}
                          color={theme.primary}
                        />
                        <Text
                          style={[
                            styles.avatarActionText,
                            { color: theme.primary },
                          ]}
                        >
                          {resolvedAvatar ? "Change" : "Upload"}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {resolvedAvatar && (
                    <TouchableOpacity
                      style={[
                        styles.avatarActionBtn,
                        {
                          backgroundColor: theme.dangerLight,
                          borderColor: theme.dangerBorder,
                        },
                      ]}
                      onPress={handleRemoveAvatar}
                      disabled={isRemovingAvatar}
                      activeOpacity={0.7}
                    >
                      {isRemovingAvatar ? (
                        <ActivityIndicator size="small" color={theme.danger} />
                      ) : (
                        <>
                          <Feather
                            name="trash-2"
                            size={12}
                            color={theme.danger}
                          />
                          <Text
                            style={[
                              styles.avatarActionText,
                              { color: theme.danger },
                            ]}
                          >
                            Remove
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.heroMeta}>
                <Text
                  style={[styles.heroName, { color: theme.textMain }]}
                  numberOfLines={1}
                >
                  {displayName || currentUser.display_name}
                </Text>
                <Text style={[styles.heroUsername, { color: theme.textMuted }]}>
                  @{currentUser.username}
                </Text>
                <Text style={[styles.heroEmail, { color: theme.textMuted }]}>
                  {currentUser.email}
                </Text>
              </View>
            </View>

            {/* Theme & Appearance Section (Matches Website with instant updates) */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.bgCard,
                  borderColor: theme.borderSubtle,
                },
              ]}
            >
              <View style={styles.sectionCardHeader}>
                <Feather name="sliders" size={14} color={theme.primary} />
                <Text style={[styles.sectionTitle, { color: theme.textMain }]}>
                  Theme & Accent Preferences
                </Text>
              </View>

              {/* Dark vs Light Mode Toggle */}
              <View style={styles.themeModeGrid}>
                <TouchableOpacity
                  style={[
                    styles.themeModeBtn,
                    {
                      backgroundColor:
                        themeMode === "dark"
                          ? theme.primaryLight
                          : theme.bgInput,
                      borderColor:
                        themeMode === "dark"
                          ? theme.primary
                          : theme.borderSubtle,
                    },
                  ]}
                  onPress={() => handleThemeModeClick("dark")}
                  activeOpacity={0.7}
                >
                  <Feather
                    name="moon"
                    size={14}
                    color={
                      themeMode === "dark" ? theme.primary : theme.textMuted
                    }
                  />
                  <Text
                    style={[
                      styles.themeModeText,
                      {
                        color:
                          themeMode === "dark" ? theme.primary : theme.textMain,
                      },
                    ]}
                  >
                    Dark Mode
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.themeModeBtn,
                    {
                      backgroundColor:
                        themeMode === "light"
                          ? theme.primaryLight
                          : theme.bgInput,
                      borderColor:
                        themeMode === "light"
                          ? theme.primary
                          : theme.borderSubtle,
                    },
                  ]}
                  onPress={() => handleThemeModeClick("light")}
                  activeOpacity={0.7}
                >
                  <Feather
                    name="sun"
                    size={14}
                    color={
                      themeMode === "light" ? theme.primary : theme.textMuted
                    }
                  />
                  <Text
                    style={[
                      styles.themeModeText,
                      {
                        color:
                          themeMode === "light"
                            ? theme.primary
                            : theme.textMain,
                      },
                    ]}
                  >
                    Light Mode
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Accent Color Palette Selector (Instant Click, No Save Button Required) */}
              <View style={styles.accentContainer}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  Accent Color:{" "}
                  {ACCENT_PALETTES[currentAccent]?.label || "Blue"}
                </Text>
                <View style={styles.colorsRow}>
                  {(Object.keys(ACCENT_PALETTES) as AccentColor[]).map(
                    (key) => {
                      const pal = ACCENT_PALETTES[key];
                      const isSelected = currentAccent === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[
                            styles.colorCircle,
                            { backgroundColor: pal.primary },
                            isSelected && styles.colorCircleSelected,
                          ]}
                          onPress={() => handleAccentClick(key)}
                          activeOpacity={0.8}
                        >
                          {isSelected && (
                            <Feather name="check" size={14} color="#ffffff" />
                          )}
                        </TouchableOpacity>
                      );
                    },
                  )}
                </View>
              </View>
            </View>

            {/* Edit Display Name */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.bgCard,
                  borderColor: theme.borderSubtle,
                },
              ]}
            >
              <View style={styles.sectionCardHeader}>
                <Feather name="edit-2" size={14} color={theme.primary} />
                <Text style={[styles.sectionTitle, { color: theme.textMain }]}>
                  Display Name
                </Text>
              </View>
              <View style={styles.nameRow}>
                <View
                  style={[
                    styles.inputBox,
                    {
                      backgroundColor: theme.bgInput,
                      borderColor: theme.borderSubtle,
                      flex: 1,
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.input, { color: theme.textMain }]}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Your Full Name"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
                <TouchableOpacity
                  style={[
                    styles.saveNameBtn,
                    { backgroundColor: theme.primary },
                  ]}
                  onPress={handleSaveDisplayName}
                  disabled={isUpdatingName}
                  activeOpacity={0.8}
                >
                  {isUpdatingName ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.saveNameBtnText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Change Password Collapsible Section */}
            <TouchableOpacity
              style={[
                styles.togglePassBtn,
                {
                  backgroundColor: theme.bgCard,
                  borderColor: theme.borderSubtle,
                },
              ]}
              onPress={() => setShowPasswordSection(!showPasswordSection)}
              activeOpacity={0.7}
            >
              <View style={styles.togglePassLeft}>
                <Feather name="lock" size={15} color={theme.primary} />
                <Text
                  style={[styles.togglePassTitle, { color: theme.textMain }]}
                >
                  Change Password
                </Text>
              </View>
              <Feather
                name={showPasswordSection ? "chevron-up" : "chevron-down"}
                size={15}
                color={theme.textMuted}
              />
            </TouchableOpacity>

            {showPasswordSection && (
              <View
                style={[
                  styles.passwordBox,
                  {
                    backgroundColor: theme.bgInput,
                    borderColor: theme.borderSubtle,
                  },
                ]}
              >
                {/* Current Password */}
                <View style={styles.passInputWrapper}>
                  <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                    Current Password
                  </Text>
                  <View
                    style={[
                      styles.inputBox,
                      {
                        backgroundColor: theme.bgApp,
                        borderColor: theme.borderSubtle,
                      },
                    ]}
                  >
                    <Feather
                      name="key"
                      size={14}
                      color={theme.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: theme.textMain }]}
                      secureTextEntry={!showOldPass}
                      value={oldPassword}
                      onChangeText={setOldPassword}
                      placeholder="••••••••"
                      placeholderTextColor={theme.textMuted}
                    />
                    <TouchableOpacity
                      onPress={() => setShowOldPass(!showOldPass)}
                      style={styles.eyeBtn}
                    >
                      <Feather
                        name={showOldPass ? "eye-off" : "eye"}
                        size={15}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* New Password */}
                <View style={styles.passInputWrapper}>
                  <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                    New Password (min 6 characters)
                  </Text>
                  <View
                    style={[
                      styles.inputBox,
                      {
                        backgroundColor: theme.bgApp,
                        borderColor: theme.borderSubtle,
                      },
                    ]}
                  >
                    <Feather
                      name="shield"
                      size={14}
                      color={theme.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: theme.textMain }]}
                      secureTextEntry={!showNewPass}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      placeholder="••••••••"
                      placeholderTextColor={theme.textMuted}
                    />
                    <TouchableOpacity
                      onPress={() => setShowNewPass(!showNewPass)}
                      style={styles.eyeBtn}
                    >
                      <Feather
                        name={showNewPass ? "eye-off" : "eye"}
                        size={15}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.updatePassBtn,
                    { backgroundColor: theme.emerald },
                  ]}
                  onPress={handleChangePassword}
                  disabled={isChangingPass}
                  activeOpacity={0.8}
                >
                  {isChangingPass ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <Feather name="check" size={14} color="#ffffff" />
                      <Text style={styles.updatePassBtnText}>
                        Update Password
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Log Out Action */}
            <TouchableOpacity
              style={[
                styles.logoutBtn,
                {
                  borderColor: theme.dangerBorder,
                  backgroundColor: theme.dangerLight,
                },
              ]}
              onPress={handleLogoutPress}
              activeOpacity={0.8}
            >
              <Feather name="log-out" size={15} color={theme.danger} />
              <Text style={[styles.logoutBtnText, { color: theme.danger }]}>
                Sign Out of Contexify
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  sheetContainer: {
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingBottom: 24,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 10,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  bodyScroll: {
    paddingHorizontal: 20,
    marginTop: 12,
  },
  bodyContent: {
    flexGrow: 1,
    paddingBottom: 36,
    gap: 14,
  },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
  },
  avatarSection: {
    alignItems: "center",
    gap: 6,
  },
  largeAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  largeAvatarImg: {
    width: "100%",
    height: "100%",
  },
  largeAvatarText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },
  avatarBtnRow: {
    flexDirection: "row",
    gap: 6,
  },
  avatarActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  avatarActionText: {
    fontSize: 11,
    fontWeight: "600",
  },
  heroMeta: {
    flex: 1,
  },
  heroName: {
    fontSize: 16,
    fontWeight: "700",
  },
  heroUsername: {
    fontSize: 13,
    marginTop: 1,
  },
  heroEmail: {
    fontSize: 12,
    marginTop: 2,
  },
  sectionCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  sectionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  themeModeGrid: {
    flexDirection: "row",
    gap: 10,
  },
  themeModeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
  },
  themeModeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  accentContainer: {
    gap: 8,
    marginTop: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  colorsRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  colorCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  colorCircleSelected: {
    borderWidth: 3,
    borderColor: "#ffffff",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  nameRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
  },
  saveNameBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  saveNameBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  eyeBtn: {
    padding: 6,
  },
  togglePassBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  togglePassLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  togglePassTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  passwordBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  passInputWrapper: {
    gap: 6,
  },
  updatePassBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 40,
    borderRadius: 10,
    marginTop: 4,
  },
  updatePassBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  logoutBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
