import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
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
import * as Haptics from "expo-haptics";
import { getAppTheme, type AppTheme } from "../theme/colors";
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
  onNewChat: () => void;
  documents?: DocumentMetadata[];
  onDeleteDocument: (id: string) => void;
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
  onNewChat,
  documents = [],
  onDeleteDocument,
  onOpenAuth,
  onOpenProfile,
  onOpenServerConfig,
  onLogout,
  isDark = true,
  theme: customTheme,
}) => {
  const theme = customTheme || getAppTheme(isDark);
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const docList = Array.isArray(documents) ? documents : [];

  const [isChatsExpanded, setIsChatsExpanded] = useState(true);
  const [isDocsExpanded, setIsDocsExpanded] = useState(true);
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(null);

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
    if (currentUser?.avatar_url) {
      apiService
        .resolveAvatarUrl(currentUser.avatar_url)
        .then(setResolvedAvatar);
    } else {
      setResolvedAvatar(null);
    }
  }, [currentUser?.avatar_url]);

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

          {/* New Chat Button */}
          <TouchableOpacity
            style={[styles.newChatBtn, { backgroundColor: theme.primary }]}
            onPress={() => {
              handleClose(() => onNewChat());
            }}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={16} color="#ffffff" />
            <Text style={styles.newChatText}>New Conversation</Text>
          </TouchableOpacity>

          {/* Scrollable Collapsible Conversations and Documents */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Conversation History Section (Collapsible) */}
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => {
                Haptics.selectionAsync();
                setIsChatsExpanded(!isChatsExpanded);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.sectionHeaderLeft}>
                <Feather
                  name={isChatsExpanded ? "chevron-down" : "chevron-right"}
                  size={14}
                  color={theme.textMuted}
                />
                <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>
                  CHATS
                </Text>
              </View>
              <Text style={[styles.sectionCount, { color: theme.textMuted }]}>
                {currentUser ? sessionList.length : "Guest"}
              </Text>
            </TouchableOpacity>

            {isChatsExpanded &&
              (sessionList.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                  {currentUser
                    ? "No conversations yet."
                    : "Temporary guest chats."}
                </Text>
              ) : (
                sessionList.map((s) => {
                  const isActive = s.id === activeSessionId;
                  const isWeb = s.mode === "WEB_SEARCH";

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
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={isWeb ? "globe-outline" : "document-text-outline"}
                        size={14}
                        color={isActive ? theme.primary : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.sessionTitle,
                          {
                            color: isActive ? theme.primary : theme.textMain,
                            fontWeight: isActive ? "700" : "500",
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {s.title}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleDeletePress(s.id, s.title)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Feather
                          name="trash-2"
                          size={13}
                          color={theme.textMuted}
                        />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })
              ))}

            {/* Session Documents Section (Collapsible) */}
            {docList.length > 0 && (
              <>
                <TouchableOpacity
                  style={[styles.sectionHeader, { marginTop: 16 }]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setIsDocsExpanded(!isDocsExpanded);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.sectionHeaderLeft}>
                    <Feather
                      name={isDocsExpanded ? "chevron-down" : "chevron-right"}
                      size={14}
                      color={theme.textMuted}
                    />
                    <Text
                      style={[styles.sectionTitle, { color: theme.textMuted }]}
                    >
                      ATTACHED DOCUMENTS
                    </Text>
                  </View>
                  <Text
                    style={[styles.sectionCount, { color: theme.textMuted }]}
                  >
                    {docList.length}
                  </Text>
                </TouchableOpacity>

                {isDocsExpanded &&
                  docList.map((doc) => (
                    <View
                      key={doc.document_id}
                      style={[
                        styles.docItem,
                        {
                          backgroundColor: theme.bgInput,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Feather name="file" size={13} color={theme.primary} />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.docName, { color: theme.textMain }]}
                          numberOfLines={1}
                        >
                          {doc.filename}
                        </Text>
                        <Text
                          style={[styles.docMeta, { color: theme.textMuted }]}
                        >
                          {doc.total_chunks} chunks •{" "}
                          {(doc.file_size_bytes / 1024).toFixed(1)} KB
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => onDeleteDocument(doc.document_id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Feather name="x" size={13} color={theme.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
              </>
            )}
          </ScrollView>

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
                  {resolvedAvatar ? (
                    <Image
                      source={{ uri: resolvedAvatar }}
                      style={styles.userAvatarImage}
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
    paddingTop: Platform.OS === "ios" ? 24 : 10,
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
    fontSize: 14,
    fontWeight: "600",
  },
  scrollArea: {
    flex: 1,
    marginTop: 14,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 12,
    fontStyle: "italic",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 4,
  },
  sessionTitle: {
    flex: 1,
    fontSize: 13,
  },
  docItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  docName: {
    fontSize: 12,
    fontWeight: "500",
  },
  docMeta: {
    fontSize: 10,
    marginTop: 2,
  },
  bottomContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    gap: 10,
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
    fontSize: 13,
    fontWeight: "600",
  },
  userEmail: {
    fontSize: 11,
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
