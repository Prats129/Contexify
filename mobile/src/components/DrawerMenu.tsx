import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Pressable,
  Alert,
  Image,
  Animated,
  PanResponder,
  Platform,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors, getAppTheme, type AppTheme } from "../theme/colors";
import { apiService } from "../services/api";
import type { ChatSession, DocumentMetadata, User } from "../types";

interface DrawerMenuProps {
  visible: boolean;
  onClose: () => void;
  currentUser: User | null;
  sessions?: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession?: (id: string, newTitle: string) => Promise<void> | void;
  onNewChat: () => void;
  documents?: DocumentMetadata[];
  onDeleteDocument?: (id: string) => void;
  onOpenAttachments?: () => void;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  onOpenServerConfig: () => void;
  onLogout: () => void;
  isDark?: boolean;
  theme?: AppTheme;
}

export const DrawerMenu: React.FC<DrawerMenuProps> = ({
  visible,
  onClose,
  currentUser,
  sessions = [],
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onNewChat,
  documents = [],
  onDeleteDocument,
  onOpenAttachments,
  onOpenAuth,
  onOpenProfile,
  onOpenServerConfig,
  onLogout,
  isDark = true,
  theme: customTheme,
}) => {
  const insets = useSafeAreaInsets();
  const theme = customTheme || getAppTheme(isDark);
  const sessionList = Array.isArray(sessions) ? sessions : [];

  const [isChatsExpanded, setIsChatsExpanded] = useState(true);
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(null);
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  // --- Collapsible Search State ---
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchTextInputRef = useRef<TextInput | null>(null);

  // --- Rename State ---
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isSavingSessionId, setIsSavingSessionId] = useState<string | null>(
    null,
  );
  const editInputRef = useRef<TextInput | null>(null);

  const translateX = useRef(new Animated.Value(-340)).current;

  useEffect(() => {
    if (visible) {
      translateX.setValue(-340);
      Animated.spring(translateX, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleClose = (callback?: () => void) => {
    Animated.timing(translateX, {
      toValue: -340,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      onClose();
      if (callback) callback();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return (
          gestureState.dx < -10 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
        );
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -45 || gestureState.vx < -0.35) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Animated.timing(translateX, {
            toValue: -340,
            duration: 160,
            useNativeDriver: true,
          }).start(() => {
            onClose();
          });
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            velocity: gestureState.vx,
            tension: 65,
            friction: 10,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  useEffect(() => {
    setAvatarLoadError(false);
    if (currentUser?.avatar_url) {
      apiService
        .resolveAvatarUrl(currentUser.avatar_url)
        .then(setResolvedAvatar);
    } else {
      setResolvedAvatar(null);
    }
  }, [currentUser?.avatar_url, visible]);

  // --- Search and Filter Logic ---
  const filteredSessions = sessionList.filter((s) => {
    if (!searchQuery.trim()) return true;
    return s.title.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });

  const handleToggleSearch = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isSearchOpen) {
      setIsSearchOpen(false);
      setSearchQuery("");
    } else {
      setIsSearchOpen(true);
      if (!isChatsExpanded) {
        setIsChatsExpanded(true);
      }
      setTimeout(() => {
        searchTextInputRef.current?.focus();
      }, 100);
    }
  };

  const handleSearchBlur = () => {
    if (searchQuery.trim() === "") {
      setIsSearchOpen(false);
    }
  };

  // --- Session Rename Handlers ---
  const handleStartRename = (session: ChatSession) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingSessionId(session.id);
    setEditTitle(session.title);
    setTimeout(() => {
      editInputRef.current?.focus();
    }, 100);
  };

  const handleCancelRename = () => {
    setEditingSessionId(null);
    setEditTitle("");
  };

  const handleSaveRename = async (sessionId: string) => {
    const trimmed = editTitle.trim();
    const currentSession = sessionList.find((s) => s.id === sessionId);

    if (!trimmed || trimmed === currentSession?.title) {
      handleCancelRename();
      return;
    }

    if (trimmed.length > 100) {
      Alert.alert(
        "Title Too Long",
        "Session title must be 100 characters or fewer.",
      );
      return;
    }

    if (!onRenameSession) {
      handleCancelRename();
      return;
    }

    try {
      setIsSavingSessionId(sessionId);
      await onRenameSession(sessionId, trimmed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditingSessionId(null);
      setEditTitle("");
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Rename Failed",
        err?.message || "Could not update conversation name.",
      );
    } finally {
      setIsSavingSessionId(null);
    }
  };

  const handleSessionLongPress = (session: ChatSession) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Conversation Options", session.title, [
      {
        text: "Rename",
        onPress: () => handleStartRename(session),
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => handleDeletePress(session.id, session.title),
      },
      {
        text: "Cancel",
        style: "cancel",
      },
    ]);
  };

  const handleSelect = (id: string) => {
    Haptics.selectionAsync();
    onSelectSession(id);
    handleClose();
  };

  const handleDeletePress = (id: string, title: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      "Delete Conversation",
      `Delete "${title}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => onDeleteSession(id),
        },
      ],
    );
  };

  const handleProfilePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleClose(() => {
      if (currentUser) {
        onOpenProfile();
      } else {
        onOpenAuth();
      }
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={() => handleClose()}
    >
      <View style={styles.overlay}>
        {/* Backdrop overlay */}
        <Pressable style={styles.backdrop} onPress={() => handleClose()} />

        {/* Slide-over Drawer Panel */}
        <Animated.View
          style={[
            styles.drawer,
            {
              backgroundColor: theme.bgSidebar,
              borderColor: theme.borderSubtle,
              paddingTop:
                Math.max(insets.top, Platform.OS === "ios" ? 20 : 16) + 4,
              paddingBottom: Math.max(insets.bottom, 6),
              transform: [{ translateX }],
            },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Brand Header with Official Logo */}
          <View
            style={[styles.brandRow, { borderBottomColor: theme.borderSubtle }]}
          >
            <View style={styles.brandLeft}>
              <Image
                source={require("../../assets/logo.png")}
                style={styles.brandLogo}
                resizeMode="contain"
              />
              <View>
                <Text style={[styles.brandTitle, { color: theme.textMain }]}>
                  Contexify AI
                </Text>
                <Text
                  style={[styles.brandSubtitle, { color: theme.textMuted }]}
                >
                  Enterprise RAG & Search
                </Text>
              </View>
            </View>
          </View>

          {/* New Chat Button (Consistent Contexify Brand Blue) */}
          <TouchableOpacity
            style={[styles.newChatBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              handleClose(() => onNewChat());
            }}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={16} color="#ffffff" />
            <Text style={styles.newChatText}>New Conversation</Text>
          </TouchableOpacity>

          {/* Media & Files Library Button (Logged-in users only) */}
          {currentUser && onOpenAttachments && (
            <TouchableOpacity
              style={[
                styles.mediaFilesBtn,
                {
                  backgroundColor: theme.bgInput,
                  borderColor: theme.borderSubtle,
                },
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                handleClose(() => onOpenAttachments());
              }}
              activeOpacity={0.7}
              accessibilityLabel="Media and Files Library"
            >
              <Feather name="paperclip" size={15} color={colors.primary} />
              <Text
                style={[styles.mediaFilesBtnText, { color: theme.textMain }]}
              >
                Media & Files
              </Text>
              <Feather
                name="chevron-right"
                size={14}
                color={theme.textMuted}
                style={{ marginLeft: "auto" }}
              />
            </TouchableOpacity>
          )}

          {/* Fixed Pinned Conversation History Section Header & Search */}
          <View style={styles.sectionHeaderPinned}>
            <View style={styles.sectionHeader}>
              <TouchableOpacity
                style={styles.sectionHeaderLeft}
                onPress={() => {
                  Haptics.selectionAsync();
                  setIsChatsExpanded(!isChatsExpanded);
                }}
                activeOpacity={0.7}
              >
                <Feather
                  name={isChatsExpanded ? "chevron-down" : "chevron-right"}
                  size={14}
                  color={theme.textMuted}
                />
                <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>
                  CHATS
                </Text>
              </TouchableOpacity>

              {currentUser ? (
                <TouchableOpacity
                  style={[
                    styles.searchToggleBtn,
                    isSearchOpen && { backgroundColor: theme.primaryLight },
                  ]}
                  onPress={handleToggleSearch}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Search conversations"
                >
                  <Feather
                    name={isSearchOpen ? "x" : "search"}
                    size={14}
                    color={isSearchOpen ? colors.primary : theme.textMuted}
                  />
                </TouchableOpacity>
              ) : (
                <Text style={[styles.sectionCount, { color: theme.textMuted }]}>
                  Guest
                </Text>
              )}
            </View>

            {/* Collapsible Real-Time Search Bar */}
            {isChatsExpanded && currentUser && isSearchOpen && (
              <View
                style={[
                  styles.searchContainer,
                  {
                    backgroundColor: theme.bgInput,
                    borderColor: theme.borderSubtle,
                  },
                ]}
              >
                <Feather
                  name="search"
                  size={13}
                  color={theme.textMuted}
                  style={styles.searchIcon}
                />
                <TextInput
                  ref={searchTextInputRef}
                  style={[styles.searchInput, { color: theme.textMain }]}
                  placeholder="Search chats..."
                  placeholderTextColor={theme.textMuted}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onBlur={handleSearchBlur}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchQuery("");
                      searchTextInputRef.current?.focus();
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={13} color={theme.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Scrollable Conversation History (Only the chats scroll) */}
          {isChatsExpanded ? (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {sessionList.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                  {currentUser
                    ? "No conversations yet."
                    : "Sign in to save chat history."}
                </Text>
              ) : filteredSessions.length === 0 ? (
                <View style={styles.searchEmptyContainer}>
                  <Text
                    style={[
                      styles.emptyText,
                      { color: theme.textMuted, textAlign: "center" },
                    ]}
                  >
                    No conversations matching "{searchQuery}"
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSearchQuery("")}
                    style={styles.clearSearchBtn}
                  >
                    <Text
                      style={[
                        styles.clearSearchText,
                        { color: colors.primary },
                      ]}
                    >
                      Clear Search
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                filteredSessions.map((s) => {
                  const isActive = s.id === activeSessionId;
                  const isWeb = s.mode === "WEB_SEARCH";
                  const isEditing = editingSessionId === s.id;
                  const isSaving = isSavingSessionId === s.id;

                  if (isEditing) {
                    return (
                      <View
                        key={s.id}
                        style={[
                          styles.sessionItem,
                          styles.sessionItemEditing,
                          {
                            backgroundColor: theme.bgInput,
                            borderColor: colors.primary,
                          },
                        ]}
                      >
                        <Ionicons
                          name={
                            isWeb ? "globe-outline" : "document-text-outline"
                          }
                          size={14}
                          color={colors.primary}
                        />
                        <TextInput
                          ref={editInputRef}
                          style={[
                            styles.editSessionInput,
                            { color: theme.textMain },
                          ]}
                          value={editTitle}
                          onChangeText={setEditTitle}
                          maxLength={100}
                          autoFocus
                          selectTextOnFocus
                          returnKeyType="done"
                          onSubmitEditing={() => handleSaveRename(s.id)}
                          editable={!isSaving}
                        />
                        <View style={styles.editActionButtons}>
                          {isSaving ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.primary}
                            />
                          ) : (
                            <>
                              <TouchableOpacity
                                onPress={() => handleSaveRename(s.id)}
                                hitSlop={{
                                  top: 8,
                                  bottom: 8,
                                  left: 6,
                                  right: 6,
                                }}
                                style={styles.inlineActionBtn}
                              >
                                <Feather
                                  name="check"
                                  size={14}
                                  color={colors.primary}
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={handleCancelRename}
                                hitSlop={{
                                  top: 8,
                                  bottom: 8,
                                  left: 6,
                                  right: 6,
                                }}
                                style={styles.inlineActionBtn}
                              >
                                <Feather
                                  name="x"
                                  size={14}
                                  color={theme.textMuted}
                                />
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      </View>
                    );
                  }

                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[
                        styles.sessionItem,
                        {
                          backgroundColor: isActive
                            ? theme.primaryLight
                            : "transparent",
                          borderColor: isActive
                            ? theme.primaryBorder
                            : "transparent",
                        },
                      ]}
                      onPress={() => handleSelect(s.id)}
                      onLongPress={() => handleSessionLongPress(s)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={isWeb ? "globe-outline" : "document-text-outline"}
                        size={14}
                        color={isActive ? colors.primary : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.sessionTitle,
                          {
                            color: isActive ? colors.primary : theme.textMain,
                            fontWeight: isActive ? "700" : "500",
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {s.title}
                      </Text>
                      <View style={styles.sessionItemActions}>
                        <TouchableOpacity
                          onPress={() => handleStartRename(s)}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                          style={styles.inlineActionBtn}
                          accessibilityLabel="Rename conversation"
                        >
                          <Feather
                            name="edit-2"
                            size={12}
                            color={isActive ? colors.primary : theme.textMuted}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDeletePress(s.id, s.title)}
                          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                          style={styles.inlineActionBtn}
                          accessibilityLabel="Delete conversation"
                        >
                          <Feather
                            name="trash-2"
                            size={12}
                            color={theme.textMuted}
                          />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          ) : (
            <View style={styles.collapsedSpacer} />
          )}

          {/* Bottom Pinned Area: User Profile & Server Config */}
          <View
            style={[
              styles.bottomContainer,
              { borderTopColor: theme.borderSubtle },
            ]}
          >
            {/* User Profile Pill or Sign In Trigger */}
            {currentUser ? (
              <TouchableOpacity
                style={[
                  styles.userPill,
                  {
                    backgroundColor: theme.bgInput,
                    borderColor: theme.borderSubtle,
                  },
                ]}
                onPress={handleProfilePress}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.userAvatar,
                    {
                      backgroundColor:
                        currentUser.avatar_color || theme.primary,
                    },
                  ]}
                >
                  {resolvedAvatar && !avatarLoadError ? (
                    <Image
                      key={resolvedAvatar}
                      source={{ uri: resolvedAvatar }}
                      style={styles.userAvatarImage}
                      resizeMode="cover"
                      onError={() => {
                        console.warn(
                          "Drawer avatar image failed to load:",
                          resolvedAvatar,
                        );
                        setAvatarLoadError(true);
                      }}
                    />
                  ) : (
                    <Text style={styles.userAvatarText}>
                      {(currentUser.display_name || currentUser.username || "U")
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  )}
                </View>

                <View style={styles.userInfo}>
                  <Text
                    style={[styles.userName, { color: theme.textMain }]}
                    numberOfLines={1}
                  >
                    {currentUser.display_name}
                  </Text>
                  <Text
                    style={[styles.userEmail, { color: theme.textMuted }]}
                    numberOfLines={1}
                  >
                    @{currentUser.username}
                  </Text>
                </View>

                <Feather name="settings" size={16} color={theme.textMuted} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.guestPill,
                  {
                    backgroundColor: theme.primaryLight,
                    borderColor: theme.primaryBorder,
                  },
                ]}
                onPress={handleProfilePress}
                activeOpacity={0.8}
              >
                <View style={styles.guestLeft}>
                  <Ionicons
                    name="person-circle-outline"
                    size={22}
                    color={theme.primary}
                  />
                  <View>
                    <Text style={[styles.guestTitle, { color: theme.primary }]}>
                      Sign In / Register
                    </Text>
                    <Text
                      style={[styles.guestSubtitle, { color: theme.textMuted }]}
                    >
                      Sync history & documents
                    </Text>
                  </View>
                </View>
                <Feather name="arrow-right" size={14} color={theme.primary} />
              </TouchableOpacity>
            )}

            {/* Server IP / Wi-Fi Config Button */}
            <TouchableOpacity
              style={[
                styles.serverConfigBtn,
                { backgroundColor: theme.borderSubtle },
              ]}
              onPress={() => {
                handleClose(() => onOpenServerConfig());
              }}
              activeOpacity={0.7}
            >
              <Feather name="server" size={13} color={theme.textMuted} />
              <Text
                style={[styles.serverConfigText, { color: theme.textMuted }]}
              >
                Backend Server IP / Wi-Fi
              </Text>
              <Feather
                name="sliders"
                size={12}
                color={theme.textMuted}
                style={{ marginLeft: "auto" }}
              />
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    position: "absolute",
    inset: 0,
    backgroundColor: "transparent",
  },
  drawer: {
    width: "82%",
    maxWidth: 320,
    height: "100%",
    borderRightWidth: 1,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  brandLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandLogo: {
    width: 32,
    height: 32,
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  brandSubtitle: {
    fontSize: 11,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  newChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    height: 42,
    borderRadius: 12,
  },
  newChatText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  mediaFilesBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  mediaFilesBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  sectionHeaderPinned: {
    paddingHorizontal: 12,
    marginTop: 10,
    marginBottom: 2,
  },
  scrollArea: {
    flex: 1,
    marginTop: 4,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  sectionHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: "600",
  },
  searchToggleBtn: {
    padding: 4,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: Platform.OS === "ios" ? 6 : 2,
    marginBottom: 8,
    marginTop: 2,
    gap: 6,
  },
  searchIcon: {
    marginRight: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  searchEmptyContainer: {
    paddingVertical: 12,
    alignItems: "center",
    gap: 6,
  },
  clearSearchBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearSearchText: {
    fontSize: 12,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 13,
    fontStyle: "italic",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6.5,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 2,
  },
  sessionItemEditing: {
    paddingVertical: 3,
  },
  sessionTitle: {
    flex: 1,
    fontSize: 14.5,
  },
  editSessionInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  editActionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sessionItemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inlineActionBtn: {
    padding: 4,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  docItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 3,
  },
  docName: {
    fontSize: 13.5,
    fontWeight: "500",
  },
  docMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  collapsedSpacer: {
    flex: 1,
  },
  bottomContainer: {
    marginTop: "auto",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    borderTopWidth: 1,
    gap: 8,
  },
  userPill: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  userAvatarImage: {
    width: "100%",
    height: "100%",
  },
  userAvatarText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 14.5,
    fontWeight: "600",
  },
  userEmail: {
    fontSize: 12,
  },
  guestPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  guestLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  guestTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  guestSubtitle: {
    fontSize: 11,
  },
  serverConfigBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  serverConfigText: {
    fontSize: 11,
    fontWeight: "500",
  },
});
