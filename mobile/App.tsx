import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  useMemo,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
  Image,
  Keyboard,
  TouchableWithoutFeedback,
  PanResponder,
  Animated,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import {
  colors,
  getAppTheme,
  ACCENT_PALETTES,
  type AccentColor,
  type ThemeMode,
} from "./src/theme/colors";
import { ConversationStore } from "./src/services/conversation_store";
import { apiService } from "./src/services/api";
import type {
  User,
  ChatSession,
  ChatMode,
  Message,
  Citation,
  StreamingMessageState,
  DocumentMetadata,
  MediaAttachment,
  MessageReplyReference,
  SessionSortOrder,
} from "./src/types";

import { Header } from "./src/components/Header";
import { MessageItem } from "./src/components/MessageItem";
import { ChatInput } from "./src/components/ChatInput";
import { DrawerMenu } from "./src/components/DrawerMenu";
import { CitationsSheet } from "./src/components/CitationsSheet";
import { AuthModal } from "./src/components/AuthModal";
import { ProfileModal } from "./src/components/ProfileModal";
import { ServerConfigModal } from "./src/components/ServerConfigModal";
import { AttachmentsModal } from "./src/components/AttachmentsModal";

function generateGuestSessionId(): string {
  return (
    "guest_" +
    Math.random().toString(36).substring(2, 11) +
    Date.now().toString(36)
  );
}

const sortMobileSessions = (
  list: ChatSession[],
  order: SessionSortOrder,
): ChatSession[] => {
  return [...list].sort((a, b) => {
    const aPinned = Boolean(a.is_pinned);
    const bPinned = Boolean(b.is_pinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    const aTime = new Date(a.created_at).getTime() || 0;
    const bTime = new Date(b.created_at).getTime() || 0;
    return order === "first_created" ? aTime - bTime : bTime - aTime;
  });
};

export default function App() {
  // Theme & Appearance State
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [accentColor, setAccentColor] = useState<AccentColor>("blue");
  const isDark = themeMode === "dark";
  const theme = useMemo(
    () => getAppTheme(isDark, accentColor),
    [isDark, accentColor],
  );

  // Global State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const authVersionRef = useRef(0);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  const [conversationStore] = useState(
    () =>
      new ConversationStore(() => ({
        isTemporaryChat: false,
        currentMode: "AUTO" as ChatMode,
        documents: [] as DocumentMetadata[],
        pendingDocumentIds: [] as string[],
        attachedMedia: [] as MediaAttachment[],
        messages: [] as Message[],
        replyingTo: null as MessageReplyReference | null,
        isSending: false,
        isClearingHistory: false,
        streamingMessage: null as StreamingMessageState | null,
        isUploading: false,
        isLoadingHistory: false,
        historyError: null as string | null,
        operationError: null as string | null,
        query: "",
      })),
  );
  useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
    conversationStore.getSnapshot,
  );
  const conversation = conversationStore.active;
  const activeSessionId = conversation.sessionId;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const setActiveSessionId = useCallback(
    (sessionId: string | null) => {
      conversationStore.select(sessionId);
      activeSessionIdRef.current = sessionId;
    },
    [conversationStore],
  );
  const {
    isTemporaryChat,
    currentMode,
    documents,
    pendingDocumentIds,
    attachedMedia,
    messages,
    replyingTo,
    isSending,
    streamingMessage,
    isUploading,
    query,
    operationError,
    isLoadingHistory,
    historyError,
  } = conversation.state;
  const setIsTemporaryChat = conversationStore.setter(
    conversation,
    "isTemporaryChat",
  );
  const setCurrentMode = conversationStore.setter(conversation, "currentMode");
  const setDocuments = conversationStore.setter(conversation, "documents");
  const setPendingDocumentIds = conversationStore.setter(
    conversation,
    "pendingDocumentIds",
  );
  const setAttachedMedia = conversationStore.setter(
    conversation,
    "attachedMedia",
  );
  const setMessages = conversationStore.setter(conversation, "messages");
  const setReplyingTo = conversationStore.setter(conversation, "replyingTo");
  const setIsSending = conversationStore.setter(conversation, "isSending");
  const setStreamingMessage = conversationStore.setter(
    conversation,
    "streamingMessage",
  );
  const setIsUploading = conversationStore.setter(conversation, "isUploading");
  const setOperationError = conversationStore.setter(
    conversation,
    "operationError",
  );
  const setQuery = conversationStore.setter(conversation, "query");

  const [clearedChats, setClearedChats] = useState<Record<string, string>>({});
  const isClearingChat = conversation.state.isClearingHistory;
  const isTempActive = Boolean(currentUser && isTemporaryChat);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionSortOrder, setSessionSortOrder] =
    useState<SessionSortOrder>("last_created");
  const [totalSessions, setTotalSessions] = useState<number>(0);
  const [hasMoreSessions, setHasMoreSessions] = useState<boolean>(false);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] =
    useState<boolean>(false);
  const [isRefreshingSessions, setIsRefreshingSessions] =
    useState<boolean>(false);

  // Interaction State
  const isSendingRef = useRef(false);
  isSendingRef.current = isSending;

  useEffect(() => () => conversationStore.cancelAll(), [conversationStore]);

  // Modals & Navigation
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [citationsVisible, setCitationsVisible] = useState(false);
  const [activeCitations, setActiveCitations] = useState<Citation[]>([]);
  const [serverConfigVisible, setServerConfigVisible] = useState(false);
  const [attachmentsVisible, setAttachmentsVisible] = useState(false);

  const handleOpenDrawer = useCallback(() => {
    Keyboard.dismiss();
    setDrawerVisible(true);
  }, []);

  const drawerVisibleRef = useRef(drawerVisible);
  useEffect(() => {
    drawerVisibleRef.current = drawerVisible;
  }, [drawerVisible]);

  const hasTriggeredEdgeDrawerRef = useRef(false);

  // Industry-standard left-bezel edge gesture responder (Slack/Telegram pattern)
  // Attached exclusively to a narrow 20px bezel edge overlay strip, leaving all message items
  // completely unhindered for horizontal WhatsApp-style swipe-to-reply.
  const edgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,

        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (drawerVisibleRef.current) return false;
          const isHorizontal =
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2;
          return isHorizontal && gestureState.dx > 10;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (drawerVisibleRef.current) return false;
          const isHorizontal =
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2;
          return isHorizontal && gestureState.dx > 10;
        },

        onPanResponderGrant: () => {
          hasTriggeredEdgeDrawerRef.current = false;
        },

        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx > 15 && !hasTriggeredEdgeDrawerRef.current) {
            hasTriggeredEdgeDrawerRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            handleOpenDrawer();
          }
        },

        onPanResponderRelease: (_, gestureState) => {
          if (
            !hasTriggeredEdgeDrawerRef.current &&
            (gestureState.dx > 15 || gestureState.vx > 0.25)
          ) {
            hasTriggeredEdgeDrawerRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            handleOpenDrawer();
          }
          hasTriggeredEdgeDrawerRef.current = false;
        },

        onPanResponderTerminate: () => {
          hasTriggeredEdgeDrawerRef.current = false;
        },
      }),
    [handleOpenDrawer],
  );

  // Dedicated swipe responder for empty/welcome screens where there are no messages to swipe
  const welcomePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,

        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (drawerVisibleRef.current) return false;
          const isHorizontal =
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2;
          return isHorizontal && gestureState.dx > 12;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (drawerVisibleRef.current) return false;
          const isHorizontal =
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2;
          return isHorizontal && gestureState.dx > 12;
        },

        onPanResponderGrant: () => {
          hasTriggeredEdgeDrawerRef.current = false;
        },

        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx > 20 && !hasTriggeredEdgeDrawerRef.current) {
            hasTriggeredEdgeDrawerRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            handleOpenDrawer();
          }
        },

        onPanResponderRelease: (_, gestureState) => {
          if (
            !hasTriggeredEdgeDrawerRef.current &&
            (gestureState.dx > 16 || gestureState.vx > 0.25)
          ) {
            hasTriggeredEdgeDrawerRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            handleOpenDrawer();
          }
          hasTriggeredEdgeDrawerRef.current = false;
        },

        onPanResponderTerminate: () => {
          hasTriggeredEdgeDrawerRef.current = false;
        },
      }),
    [handleOpenDrawer],
  );

  const flatListRef = useRef<FlatList<Message>>(null);
  const isAtBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const showScrollToBottomRef = useRef(false);
  const scrollBtnAnim = useRef(new Animated.Value(0)).current;

  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Smooth entrance/exit spring animation for scroll to bottom floating button
  useEffect(() => {
    Animated.spring(scrollBtnAnim, {
      toValue: showScrollToBottom ? 1 : 0,
      tension: 75,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [showScrollToBottom, scrollBtnAnim]);

  // Reset scroll-to-bottom button when switching sessions
  useEffect(() => {
    setShowScrollToBottom(false);
    showScrollToBottomRef.current = false;
    isAtBottomRef.current = true;
  }, [activeSessionId]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } =
        event.nativeEvent;
      const paddingToBottom = 60;
      const isClose =
        layoutMeasurement.height + contentOffset.y >=
        contentSize.height - paddingToBottom;
      isAtBottomRef.current = isClose;

      // Show button if content is tall enough to scroll and user is not near the bottom
      const canScroll = contentSize.height > layoutMeasurement.height + 80;
      const shouldShow = !isClose && canScroll;

      // Senior optimization: Only update state when boolean actually flips to prevent unnecessary re-renders
      if (shouldShow !== showScrollToBottomRef.current) {
        showScrollToBottomRef.current = shouldShow;
        setShowScrollToBottom(shouldShow);
      }
    },
    [],
  );

  const handleScrollToBottom = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    isAtBottomRef.current = true;
    showScrollToBottomRef.current = false;
    setShowScrollToBottom(false);
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  // --- 1. App Initialization ---
  useEffect(() => {
    initApp();
  }, []);

  // --- Keyboard Auto-scroll (Preserves reading position if scrolled up) ---
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(showEvent, () => {
      // Only auto-scroll to bottom if the user was already at/near the bottom.
      // If the user scrolled up to read earlier messages, do not force them down!
      if (isAtBottomRef.current) {
        setTimeout(() => {
          if (isAtBottomRef.current) {
            flatListRef.current?.scrollToEnd({ animated: true });
          }
        }, 100);
      }
    });
    return () => sub.remove();
  }, []);

  const initApp = async () => {
    try {
      // Load Theme preferences
      const savedMode = await AsyncStorage.getItem("contexify_theme_mode");
      if (savedMode === "light" || savedMode === "dark") {
        setThemeMode(savedMode);
      }

      const savedAccent = await AsyncStorage.getItem("contexify_theme_accent");
      if (savedAccent && savedAccent in ACCENT_PALETTES) {
        setAccentColor(savedAccent as AccentColor);
      }

      const savedUserStr = await AsyncStorage.getItem("contexify_mobile_user");
      const savedSort = await AsyncStorage.getItem(
        "contexify_mobile_sort_order",
      );
      let initialSort: SessionSortOrder = "last_created";
      if (savedSort === "first_created" || savedSort === "last_created") {
        initialSort = savedSort;
        setSessionSortOrder(savedSort);
      }

      if (savedUserStr && (await apiService.hasUserSession())) {
        const cached: User = JSON.parse(savedUserStr);
        const user = await apiService.getCurrentUser(cached.id);
        if (!user) throw new Error("Please sign in again.");
        currentUserRef.current = user;
        setCurrentUser(user);
        await AsyncStorage.setItem(
          "contexify_mobile_user",
          JSON.stringify(user),
        );
        await loadUserSessions(user.id, initialSort);
      } else {
        currentUserRef.current = null;
        setCurrentUser(null);
        handleNewChat(null);
      }
    } catch {
      currentUserRef.current = null;
      setCurrentUser(null);
      handleNewChat(null);
    } finally {
      setIsAuthReady(true);
    }
  };

  const handleToggleTheme = () => {
    const next: ThemeMode = themeMode === "dark" ? "light" : "dark";
    setThemeMode(next);
    AsyncStorage.setItem("contexify_theme_mode", next);
  };

  const handleSelectAccent = (nextAccent: AccentColor) => {
    setAccentColor(nextAccent);
    AsyncStorage.setItem("contexify_theme_accent", nextAccent);
  };

  const SESSIONS_PAGE_SIZE = 15;

  const loadUserSessions = async (
    userId: string,
    sortOverride?: SessionSortOrder,
  ) => {
    const activeSort = sortOverride || sessionSortOrder;
    const authVersion = authVersionRef.current;
    try {
      const res = await apiService.getUserSessions(userId, {
        limit: SESSIONS_PAGE_SIZE,
        offset: 0,
        sort_by: activeSort,
      });
      const safeList = Array.isArray(res.sessions) ? res.sessions : [];
      if (authVersion !== authVersionRef.current) return;
      setSessions(sortMobileSessions(safeList, activeSort));
      setTotalSessions(res.total ?? safeList.length);
      setHasMoreSessions(Boolean(res.has_more));
    } catch (err) {
      if (authVersion !== authVersionRef.current) return;
      console.warn("Failed to load sessions:", err);
      setSessions([]);
      setTotalSessions(0);
      setHasMoreSessions(false);
    }
  };

  const handleLoadMoreSessions = async () => {
    if (!currentUser || isLoadingMoreSessions || !hasMoreSessions) return;
    setIsLoadingMoreSessions(true);
    try {
      const res = await apiService.getUserSessions(currentUser.id, {
        limit: SESSIONS_PAGE_SIZE,
        offset: sessions.length,
        sort_by: sessionSortOrder,
      });
      const newSessions = Array.isArray(res.sessions) ? res.sessions : [];
      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        const filtered = newSessions.filter((s) => !existingIds.has(s.id));
        return sortMobileSessions([...prev, ...filtered], sessionSortOrder);
      });
      setTotalSessions(res.total ?? sessions.length + newSessions.length);
      setHasMoreSessions(Boolean(res.has_more));
    } catch (err) {
      console.warn("Failed to load more sessions:", err);
    } finally {
      setIsLoadingMoreSessions(false);
    }
  };

  const handleRefreshSessions = async () => {
    if (!currentUser || isRefreshingSessions) return;
    setIsRefreshingSessions(true);
    try {
      const res = await apiService.getUserSessions(currentUser.id, {
        limit: SESSIONS_PAGE_SIZE,
        offset: 0,
        sort_by: sessionSortOrder,
      });
      const safeList = Array.isArray(res.sessions) ? res.sessions : [];
      setSessions(sortMobileSessions(safeList, sessionSortOrder));
      setTotalSessions(res.total ?? safeList.length);
      setHasMoreSessions(Boolean(res.has_more));
    } catch (err) {
      console.warn("Failed to refresh sessions:", err);
    } finally {
      setIsRefreshingSessions(false);
    }
  };

  const handleToggleSortOrder = async () => {
    const nextOrder: SessionSortOrder =
      sessionSortOrder === "first_created" ? "last_created" : "first_created";
    setSessionSortOrder(nextOrder);
    await AsyncStorage.setItem("contexify_mobile_sort_order", nextOrder);
    if (currentUser) {
      setIsRefreshingSessions(true);
      try {
        const res = await apiService.getUserSessions(currentUser.id, {
          limit: SESSIONS_PAGE_SIZE,
          offset: 0,
          sort_by: nextOrder,
        });
        const safeList = Array.isArray(res.sessions) ? res.sessions : [];
        setSessions(sortMobileSessions(safeList, nextOrder));
        setTotalSessions(res.total ?? safeList.length);
        setHasMoreSessions(Boolean(res.has_more));
      } finally {
        setIsRefreshingSessions(false);
      }
    } else {
      setSessions((prev) => sortMobileSessions(prev, nextOrder));
    }
  };

  const handleTogglePinSession = async (sessionId: string) => {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    const nextPinned = !target.is_pinned;

    // Optimistic update
    setSessions((prev) => {
      const updated = prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              is_pinned: nextPinned,
              pinned_at: nextPinned ? new Date().toISOString() : null,
            }
          : s,
      );
      return sortMobileSessions(updated, sessionSortOrder);
    });

    try {
      await apiService.togglePinSession(sessionId, nextPinned);
    } catch (err) {
      console.warn("Failed to toggle pin session:", err);
      // Rollback on failure
      setSessions((prev) => {
        const rolledBack = prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                is_pinned: target.is_pinned,
                pinned_at: target.pinned_at,
              }
            : s,
        );
        return sortMobileSessions(rolledBack, sessionSortOrder);
      });
    }
  };

  // --- 2. Switch Conversation ---
  const selectSession = async (sessionId: string, sessionMode?: ChatMode) => {
    const authVersion = authVersionRef.current;
    setActiveSessionId(sessionId);
    setCitationsVisible(false);
    setActiveCitations([]);
    setAttachmentsVisible(false);
    setHighlightedMessageId(null);
    setShowScrollToBottom(false);
    isAtBottomRef.current = true;
    const entry = conversationStore.active;
    const request = ++entry.historyRequest;
    const before = entry.state;
    if (sessionMode)
      conversationStore.patch(entry, { currentMode: sessionMode });
    if (entry.state.isSending || entry.preserveHistory) return;
    conversationStore.patch(entry, {
      isLoadingHistory: true,
      historyError: null,
    });
    try {
      const hist = await apiService.getSessionHistory(sessionId);
      if (
        authVersion !== authVersionRef.current ||
        !conversationStore.live(entry) ||
        request !== entry.historyRequest
      )
        return;
      conversationStore.patch(entry, {
        isTemporaryChat: Boolean(hist?.session?.is_temporary),
        ...(entry.state.currentMode === (sessionMode || before.currentMode) &&
        hist?.session?.mode
          ? { currentMode: hist.session.mode }
          : {}),
        ...(entry.state.documents === before.documents
          ? {
              documents: [
                ...(Array.isArray(hist?.documents) ? hist.documents : []),
                ...entry.state.documents.filter(
                  (doc) =>
                    entry.state.pendingDocumentIds.includes(doc.document_id) &&
                    !(hist?.documents || []).some(
                      (saved) => saved.document_id === doc.document_id,
                    ),
                ),
              ],
            }
          : {}),
        ...(entry.state.messages === before.messages &&
        !entry.state.isSending &&
        !entry.preserveHistory
          ? { messages: Array.isArray(hist?.messages) ? hist.messages : [] }
          : {}),
      });
    } catch {
      if (
        authVersion === authVersionRef.current &&
        conversationStore.live(entry) &&
        request === entry.historyRequest
      )
        conversationStore.patch(entry, {
          historyError:
            "Could not refresh this chat. Your current messages have been kept.",
        });
      if (
        authVersion === authVersionRef.current &&
        conversationStore.active === entry &&
        request === entry.historyRequest
      ) {
        Alert.alert(
          "History unavailable",
          "Could not refresh this chat. Your current messages have been kept. Please try again.",
        );
      }
    } finally {
      if (conversationStore.live(entry) && request === entry.historyRequest)
        conversationStore.patch(entry, { isLoadingHistory: false });
    }
  };

  const handleToggleTemporaryChat = () => {
    if (!currentUser) return;
    const next = !isTemporaryChat;
    setActiveSessionId(null);
    conversationStore.patch(conversationStore.active, {
      isTemporaryChat: next,
    });
    setCitationsVisible(false);
    setAttachmentsVisible(false);
    setHighlightedMessageId(null);
  };

  // --- 3. New Chat ---
  const handleNewChat = (userOverride?: User | null) => {
    const effectiveUser =
      userOverride !== undefined
        ? userOverride
        : currentUserRef.current || currentUser;
    setActiveSessionId(effectiveUser ? null : generateGuestSessionId());
    isAtBottomRef.current = true;
    setHighlightedMessageId(null);
    setCitationsVisible(false);
    setActiveCitations([]);
    setAttachmentsVisible(false);
  };

  const handleReplyMessage = useCallback(
    (msg: { id?: string; role: "user" | "assistant"; content: string }) => {
      setReplyingTo({
        id: msg.id || `msg_${Date.now()}`,
        role: msg.role,
        content: msg.content,
      });
    },
    [setReplyingTo],
  );

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [setReplyingTo]);

  const handleJumpToMessage = useCallback(
    (targetMessageId: string) => {
      if (!targetMessageId) return;
      const cleanTargetId = targetMessageId.replace(/^msg[-_]/, "");
      const index = messages.findIndex(
        (m) =>
          m.id === targetMessageId ||
          m.id === cleanTargetId ||
          m.id.replace(/^msg[-_]/, "") === cleanTargetId,
      );

      if (index >= 0 && flatListRef.current) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        isAtBottomRef.current = false;
        try {
          flatListRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.5,
          });
        } catch {
          flatListRef.current.scrollToOffset({
            offset: Math.max(0, index * 95),
            animated: true,
          });
        }

        const foundId = messages[index].id;
        if (highlightTimerRef.current) {
          clearTimeout(highlightTimerRef.current);
        }
        setHighlightedMessageId(foundId);
        highlightTimerRef.current = setTimeout(() => {
          setHighlightedMessageId(null);
        }, 1800);
      }
    },
    [messages],
  );

  // --- 4. Delete Session ---
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await apiService.deleteSession(sessionId);
      const currentList = Array.isArray(sessions) ? sessions : [];
      const updated = currentList.filter((s) => s.id !== sessionId);
      setSessions(updated);
      setTotalSessions((prev) => Math.max(0, prev - 1));
      const wasActive = activeSessionIdRef.current === sessionId;
      conversationStore.drop(sessionId);
      if (wasActive) {
        isSendingRef.current = false;
        if (updated.length > 0) {
          selectSession(updated[0].id, updated[0].mode);
        } else {
          handleNewChat();
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Error", msg);
    }
  };

  // --- 4.1 Rename Session ---
  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const currentList = Array.isArray(sessions) ? sessions : [];
    const current = currentList.find((s) => s.id === sessionId);
    if (!current || current.title === trimmed) return;

    const prevTitle = current.title;
    // Optimistic update
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s)),
    );

    try {
      await apiService.updateSessionTitle(sessionId, trimmed);
    } catch (err: unknown) {
      // Revert on error
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: prevTitle } : s)),
      );
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Rename Failed", msg);
    }
  };

  // --- 5. Toggle Mode ---
  const handleToggleMode = () => {
    const modes: ChatMode[] = [
      "AUTO",
      "WEB_SEARCH",
      "DOCUMENT_RAG",
      "MULTIMODAL",
      "IMAGE_GENERATION",
    ];
    const idx = modes.indexOf(currentMode);
    const nextMode = modes[(idx + 1) % modes.length];
    setCurrentMode(nextMode);
    if (activeSessionId && currentUser) {
      apiService.updateSessionMode(activeSessionId, nextMode).catch(() => {});
    }
  };

  // --- 6. Send Message & Streaming ---
  const handleClearMessages = () => {
    if (
      !currentUser ||
      !activeSessionId ||
      messages.length === 0 ||
      isSendingRef.current ||
      conversation.state.isClearingHistory
    )
      return;
    const sessionId = activeSessionId;
    const authVersion = authVersionRef.current;
    Alert.alert(
      "Clear conversation?",
      "Clear all messages in this conversation? Attached documents will remain available.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            if (
              authVersion !== authVersionRef.current ||
              sessionId !== activeSessionIdRef.current ||
              isSendingRef.current ||
              conversation.state.isClearingHistory
            )
              return;
            conversationStore.patch(conversation, { isClearingHistory: true });
            try {
              await apiService.clearSessionMessages(sessionId);
              if (authVersion !== authVersionRef.current) return;
              setClearedChats((previous) => ({
                ...previous,
                [sessionId]: new Date().toISOString(),
              }));
              conversation.historyRequest++;
              conversationStore.patch(conversation, {
                isLoadingHistory: false,
                operationError: null,
                historyError: null,
              });
              conversation.preserveHistory = false;
              setMessages([]);
              setStreamingMessage(null);
              setReplyingTo(null);
              if (sessionId !== activeSessionIdRef.current) return;
              setActiveCitations([]);
              setCitationsVisible(false);
            } catch (error: unknown) {
              if (
                authVersion === authVersionRef.current &&
                sessionId === activeSessionIdRef.current
              ) {
                Alert.alert(
                  "Clear Failed",
                  error instanceof Error ? error.message : String(error),
                );
              }
            } finally {
              conversationStore.patch(conversation, {
                isClearingHistory: false,
              });
            }
          },
        },
      ],
    );
  };

  const handleSendMessage = async (customQuery?: string) => {
    const authVersion = authVersionRef.current;
    if (conversationStore.active !== conversation) return;
    const textToSend = (customQuery || query).trim();
    if (
      (!textToSend &&
        attachedMedia.length === 0 &&
        pendingDocumentIds.length === 0) ||
      conversation.state.isSending ||
      conversation.state.isLoadingHistory ||
      conversation.state.isUploading ||
      isSendingRef.current ||
      conversation.state.isClearingHistory
    )
      return;

    isSendingRef.current = true;
    setIsSending(true);
    setQuery("");
    const replyToPayload = replyingTo;
    setReplyingTo(null);
    let stoppedBeforeStreaming = false;
    conversation.cancel = () => {
      stoppedBeforeStreaming = true;
    };

    const mediaToSend: MediaAttachment[] = [
      ...attachedMedia,
      ...documents
        .filter((doc) => pendingDocumentIds.includes(doc.document_id))
        .map(
          (doc): MediaAttachment => ({
            id: doc.document_id,
            url: doc.storage_url || "",
            file_type: "document",
            file_name: doc.filename,
            file_size_bytes: doc.file_size_bytes,
          }),
        ),
    ];
    setPendingDocumentIds([]);
    setAttachedMedia([]);

    const prompt =
      textToSend ||
      (mediaToSend.some((item) => item.file_type === "document")
        ? "Review the attached documents."
        : currentMode === "IMAGE_GENERATION"
          ? "Generate a creative variation of this image"
          : "Analyze this image and describe what you see in detail.");

    const userToUse = currentUserRef.current || currentUser;

    const needsCreation = !conversation.sessionId;
    const sessionId = conversation.sessionId || generateGuestSessionId();
    conversationStore.adopt(conversation, sessionId);
    conversation.preparing = needsCreation;
    if (conversationStore.active === conversation)
      activeSessionIdRef.current = sessionId;

    // Append User Message to UI
    const userMsg: Message = {
      id: "usr_" + Date.now(),
      session_id: sessionId,
      role: "user",
      content: prompt,
      reply_to: replyToPayload,
      attachments: mediaToSend.length > 0 ? mediaToSend : undefined,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setStreamingMessage({ content: "", citations: [], attachments: [] });
    if (conversationStore.active === conversation) {
      isAtBottomRef.current = true;
      setTimeout(() => {
        if (conversationStore.active === conversation)
          flatListRef.current?.scrollToEnd({ animated: true });
      }, 60);
    }

    // Stream SSE Response
    let streamedContent = "";
    let streamedCitations: Citation[] = [];
    let streamedMedia: MediaAttachment[] = [];
    let isStreamFinalized = false;

    const finalizeStream = (action: () => void) => {
      if (
        isStreamFinalized ||
        authVersion !== authVersionRef.current ||
        !conversationStore.live(conversation)
      )
        return;
      isStreamFinalized = true;
      if (conversationStore.active === conversation)
        isSendingRef.current = false;
      setIsSending(false);
      setStreamingMessage(null);
      conversation.cancel = null;
      action();
    };

    if (needsCreation && userToUse) {
      try {
        const created = await apiService.createSession(
          userToUse.id,
          prompt.slice(0, 40),
          currentMode,
          isTempActive,
          sessionId,
        );
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(conversation) ||
          stoppedBeforeStreaming
        )
          return;
        if (!isTempActive) {
          setSessions((previous) => [created, ...previous]);
          setTotalSessions((previous) => previous + 1);
        }
      } catch (error) {
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(conversation) ||
          stoppedBeforeStreaming
        )
          return;
        console.warn(
          "Explicit session creation failed; the chat request will ensure the same session.",
          error,
        );
      }
    }
    conversation.preparing = false;
    if (
      authVersion !== authVersionRef.current ||
      !conversationStore.live(conversation) ||
      stoppedBeforeStreaming
    )
      return;

    const cancel = apiService.streamChat(
      sessionId,
      prompt,
      currentMode,
      {
        onToken: (token) => {
          if (
            isStreamFinalized ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          streamedContent += token;
          setStreamingMessage({
            content: streamedContent,
            citations: streamedCitations,
            attachments: streamedMedia,
          });
        },
        onCitations: (cits) => {
          if (
            isStreamFinalized ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          streamedCitations = cits;
          setStreamingMessage({
            content: streamedContent,
            citations: streamedCitations,
            attachments: streamedMedia,
          });
        },
        onMedia: (media: MediaAttachment) => {
          if (
            isStreamFinalized ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          streamedMedia = [...streamedMedia, media];
          setStreamingMessage({
            content: streamedContent,
            citations: streamedCitations,
            attachments: streamedMedia,
          });
        },
        onComplete: () => {
          finalizeStream(() => {
            if (conversationStore.active === conversation)
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );

            conversation.preserveHistory ||= !userToUse;
            const aiMsg: Message = {
              id: "ai_" + Date.now(),
              session_id: sessionId!,
              role: "assistant",
              content:
                streamedContent ||
                (streamedMedia.length > 0
                  ? "Here is your generated image:"
                  : "No response generated."),
              citations: streamedCitations,
              attachments: streamedMedia.length > 0 ? streamedMedia : undefined,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, aiMsg]);
          });
        },
        onError: (errMsg) => {
          finalizeStream(() => {
            if (conversationStore.active === conversation)
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

            conversation.preserveHistory = true;
            const errorMsg: Message = {
              id: "err_" + Date.now(),
              session_id: sessionId!,
              role: "assistant",
              content: [streamedContent, `Response interrupted: ${errMsg}`]
                .filter(Boolean)
                .join("\n\n"),
              citations: streamedCitations,
              attachments: streamedMedia.length > 0 ? streamedMedia : undefined,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, errorMsg]);
          });
        },
      },
      mediaToSend.length > 0 ? mediaToSend : undefined,
      userToUse ? userToUse.id : null,
      replyToPayload,
      isTempActive,
    );

    if (!isStreamFinalized)
      conversation.cancel = () => {
        isStreamFinalized = true;
        cancel();
      };
  };

  const handleStopGeneration = () => {
    conversation.cancel?.();
    conversation.cancel = null;
    isSendingRef.current = false;
    setIsSending(false);
    if (conversation.preparing) {
      conversation.preparing = false;
      const unsent = conversation.state.messages.at(-1);
      if (unsent?.role === "user") {
        setQuery(unsent.content);
        setReplyingTo(unsent.reply_to || null);
        setAttachedMedia(
          (unsent.attachments || []).filter(
            (item) => item.file_type !== "document",
          ),
        );
        setPendingDocumentIds(
          (unsent.attachments || [])
            .filter((item) => item.file_type === "document")
            .map((item) => item.id || "")
            .filter(Boolean),
        );
        setMessages((previous) => previous.filter((item) => item !== unsent));
      }
    }
    const partial = conversation.state.streamingMessage;
    if (partial && (partial.content || partial.attachments?.length)) {
      conversation.preserveHistory = true;
      setMessages((previous) => [
        ...previous,
        {
          id: `stopped-${Date.now()}`,
          session_id: conversation.sessionId || "",
          role: "assistant",
          content: partial.content,
          citations: partial.citations,
          attachments: partial.attachments,
          created_at: new Date().toISOString(),
        },
      ]);
    }
    setStreamingMessage(null);
  };

  // --- 7. File Attachment & Upload ---
  const handleAttachFile = async (file: {
    uri: string;
    name: string;
    mimeType: string;
  }) => {
    const authVersion = authVersionRef.current;
    if (conversationStore.active !== conversation) return;
    conversation.uploads++;
    setIsUploading(true);
    setOperationError(null);
    const userToUse = currentUserRef.current || currentUser;
    let sessionId = conversation.sessionId;
    if (!sessionId) {
      if (userToUse) {
        const clientSessionId = generateGuestSessionId();
        conversationStore.adopt(conversation, clientSessionId);
        if (conversationStore.active === conversation)
          activeSessionIdRef.current = clientSessionId;
        try {
          const newSession = await apiService.createSession(
            userToUse.id,
            `File: ${file.name}`.slice(0, 40),
            "DOCUMENT_RAG",
            isTempActive,
            clientSessionId,
          );
          if (
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          sessionId = newSession.id;
          conversationStore.adopt(conversation, sessionId);
          if (conversationStore.active === conversation)
            activeSessionIdRef.current = sessionId;
          if (!isTempActive) {
            setSessions((prev) => [newSession, ...prev]);
            setTotalSessions((prev) => prev + 1);
          }
        } catch (err) {
          if (
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          console.warn(
            "Session creation on file attach failed; using clientSessionId for self-healing:",
            err,
          );
          sessionId = clientSessionId;
          conversationStore.adopt(conversation, sessionId);
          if (conversationStore.active === conversation)
            activeSessionIdRef.current = sessionId;
        }
      } else {
        sessionId = generateGuestSessionId();
        conversationStore.adopt(conversation, sessionId);
        if (conversationStore.active === conversation)
          activeSessionIdRef.current = sessionId;
      }
    }

    const isImage =
      file.mimeType.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file.name);

    if (isImage) {
      setIsUploading(true);
      try {
        const media = await apiService.uploadMedia(
          sessionId,
          file.uri,
          file.name,
          file.mimeType,
          currentUser?.id,
          isTempActive,
        );
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(conversation)
        )
          return;
        setAttachedMedia((prev) => [...prev, media]);
        if (conversationStore.active === conversation)
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (currentMode !== "IMAGE_GENERATION" && currentMode !== "AUTO") {
          setCurrentMode("MULTIMODAL");
        }
      } catch (err: unknown) {
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(conversation)
        )
          return;
        const msg = err instanceof Error ? err.message : String(err);
        setOperationError(`Image upload failed: ${msg}`);
        if (conversationStore.active === conversation)
          Alert.alert("Image Upload Failed", msg);
      } finally {
        if (authVersion === authVersionRef.current) {
          conversation.uploads = Math.max(0, conversation.uploads - 1);
          setIsUploading(conversation.uploads > 0);
        }
      }
      return;
    }

    setIsUploading(true);
    try {
      const doc = await apiService.uploadDocument(
        sessionId,
        file.uri,
        file.name,
        file.mimeType,
        currentUser?.id,
        isTempActive,
      );
      if (
        authVersion !== authVersionRef.current ||
        !conversationStore.live(conversation)
      )
        return;
      setDocuments((prev) => [...(Array.isArray(prev) ? prev : []), doc]);
      setPendingDocumentIds((prev) => [...prev, doc.document_id]);
      if (conversationStore.active === conversation)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Auto-switch to Document RAG if uploaded and not in AUTO mode
      if (currentMode !== "DOCUMENT_RAG" && currentMode !== "AUTO") {
        setCurrentMode("DOCUMENT_RAG");
      }
    } catch (err: unknown) {
      if (
        authVersion !== authVersionRef.current ||
        !conversationStore.live(conversation)
      )
        return;
      const msg = err instanceof Error ? err.message : String(err);
      setOperationError(`Upload failed: ${msg}`);
      if (conversationStore.active === conversation)
        Alert.alert("Upload Failed", msg);
    } finally {
      if (authVersion === authVersionRef.current) {
        conversation.uploads = Math.max(0, conversation.uploads - 1);
        setIsUploading(conversation.uploads > 0);
      }
    }
  };

  const handleDetachDocument = (documentId: string) => {
    setPendingDocumentIds((prev) => prev.filter((id) => id !== documentId));
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await apiService.deleteDocument(docId, activeSessionId || "");
      setPendingDocumentIds((prev) => prev.filter((id) => id !== docId));
      setDocuments((prev) =>
        (Array.isArray(prev) ? prev : []).filter(
          (d) => d.document_id !== docId,
        ),
      );
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Delete Failed", msg);
    }
  };

  const handleDeleteMedia = (index: number) => {
    setAttachedMedia((prev) => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleUseAsReference = useCallback(
    (media: MediaAttachment) => {
      setAttachedMedia([media]);
      setCurrentMode("IMAGE_GENERATION");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    [setAttachedMedia, setCurrentMode],
  );

  // --- 8. Citations Sheet ---
  const handleOpenCitations = useCallback((citations: Citation[]) => {
    setActiveCitations(citations);
    setCitationsVisible(true);
  }, []);

  // --- 9. Attachments & Media Handlers ---
  const activeSessionTitle = useMemo(() => {
    return sessions.find((s) => s.id === activeSessionId)?.title;
  }, [sessions, activeSessionId]);

  const handleAttachMediaFromModal = (media: MediaAttachment) => {
    setAttachedMedia((prev) => {
      const matchId = media.id || media.media_id;
      if (
        prev.some(
          (m) =>
            (matchId && (m.id === matchId || m.media_id === matchId)) ||
            m.url === media.url,
        )
      ) {
        return prev;
      }
      return [...prev, media];
    });
    if (currentMode !== "IMAGE_GENERATION" && currentMode !== "AUTO") {
      setCurrentMode("MULTIMODAL");
    }
  };

  const handleAttachDocumentFromModal = (doc: DocumentMetadata) => {
    setPendingDocumentIds((prev) =>
      prev.includes(doc.document_id) ? prev : [...prev, doc.document_id],
    );
    setDocuments((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      if (arr.some((d) => d.document_id === doc.document_id)) {
        return arr;
      }
      return [...arr, doc];
    });
    if (currentMode !== "DOCUMENT_RAG" && currentMode !== "AUTO") {
      setCurrentMode("DOCUMENT_RAG");
    }
  };

  const handleAssetDeletedFromModal = (assetId: string) => {
    setPendingDocumentIds((prev) => prev.filter((id) => id !== assetId));
    setDocuments((prev) =>
      (Array.isArray(prev) ? prev : []).filter(
        (d) => d.document_id !== assetId,
      ),
    );
    setAttachedMedia((prev) =>
      prev.filter((m) => m.id !== assetId && m.media_id !== assetId),
    );
  };

  // --- 10. Auth Success / Logout ---
  const cancelStreamForAuthChange = () => {
    authVersionRef.current++;
    setClearedChats({});
    isSendingRef.current = false;
    conversationStore.reset();
    setIsSending(false);
    setIsUploading(false);
    setStreamingMessage(null);
  };

  const handleAuthSuccess = async (user: User) => {
    cancelStreamForAuthChange();
    handleNewChat(user);
    currentUserRef.current = user;
    setCurrentUser(user);
    await AsyncStorage.setItem("contexify_mobile_user", JSON.stringify(user));
    await loadUserSessions(user.id);
  };

  const handleLogout = async () => {
    cancelStreamForAuthChange();
    handleNewChat(null);
    void apiService.logout();
    currentUserRef.current = null;
    setCurrentUser(null);
    setIsTemporaryChat(false);
    await AsyncStorage.removeItem("contexify_mobile_user");
    setSessions([]);
    setTotalSessions(0);
    setHasMoreSessions(false);
  };

  useEffect(
    () =>
      apiService.onSessionExpired(() => {
        void handleLogout();
      }),
    [],
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const renderMessageItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageItem
        id={item.id}
        role={item.role}
        content={item.content}
        citations={item.citations}
        attachments={item.attachments}
        reply_to={item.reply_to}
        isHighlighted={highlightedMessageId === item.id}
        onOpenCitations={handleOpenCitations}
        onUseAsReference={handleUseAsReference}
        onReply={handleReplyMessage}
        onJumpToMessage={handleJumpToMessage}
        isDark={isDark}
        theme={theme}
      />
    ),
    [
      highlightedMessageId,
      handleOpenCitations,
      handleUseAsReference,
      handleReplyMessage,
      handleJumpToMessage,
      isDark,
      theme,
    ],
  );

  return (
    <SafeAreaProvider>
      {/* Android uses native resize (app.json); only iOS needs JS keyboard avoidance. */}
      <KeyboardAvoidingView
        enabled={Platform.OS === "ios"}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.safeArea}
      >
        <SafeAreaView
          style={[styles.safeArea, { backgroundColor: theme.bgApp }]}
          edges={["top", "left", "right"]}
        >
          <StatusBar style={isDark ? "light" : "dark"} />

          {/* Top Native Header */}
          <Header
            onOpenDrawer={handleOpenDrawer}
            onNewChat={handleNewChat}
            isDark={isDark}
            theme={theme}
            isTemporaryChat={isTempActive}
            onToggleTemporaryChat={
              currentUser ? handleToggleTemporaryChat : undefined
            }
            onClearChat={
              currentUser &&
              messages.length > 0 &&
              !isSending &&
              !isUploading &&
              !isClearingChat
                ? handleClearMessages
                : undefined
            }
          />

          {/* Temporary Chat Notice Banner (shown only for logged-in users with temporary chat active) */}
          {isTempActive && messages.length > 0 && (
            <View
              style={[
                styles.temporaryBanner,
                {
                  backgroundColor: isDark
                    ? "rgba(245, 158, 11, 0.14)"
                    : "rgba(245, 158, 11, 0.10)",
                  borderBottomColor: isDark
                    ? "rgba(245, 158, 11, 0.3)"
                    : "rgba(245, 158, 11, 0.2)",
                },
              ]}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flex: 1,
                  marginRight: 8,
                }}
              >
                <MaterialCommunityIcons
                  name="ghost"
                  size={16}
                  color="#f59e0b"
                  style={{ marginRight: 6 }}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.temporaryBannerText,
                    { color: isDark ? "#fcd34d" : "#b45309", flex: 1 },
                  ]}
                >
                  Temporary Chat • Not saved to history
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleToggleTemporaryChat}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "700",
                    textDecorationLine: "underline",
                    color: isDark ? "#fcd34d" : "#b45309",
                  }}
                >
                  Turn off
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Main Chat Workspace */}
          <View style={styles.workspace}>
            {/* Main Messages & Conversation Viewport */}
            <View style={styles.chatViewport}>
              {(operationError || historyError) && (
                <Text
                  accessibilityRole="alert"
                  style={{ color: theme.danger, padding: 12 }}
                >
                  {operationError || historyError}
                </Text>
              )}
              {activeSessionId &&
                (isClearingChat || clearedChats[activeSessionId]) && (
                  <View
                    accessibilityLiveRegion="polite"
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: theme.textMain, fontWeight: "600" }}>
                      {isClearingChat ? "Clearing chat…" : "Chat cleared"}
                    </Text>
                    {!isClearingChat && (
                      <>
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                          {new Date(
                            clearedChats[activeSessionId],
                          ).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </Text>
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                          Your documents are still available.
                        </Text>
                      </>
                    )}
                  </View>
                )}
              {/* Welcome Screen or ChatGPT Temporary Chat Screen */}
              {messages.length === 0 && !streamingMessage ? (
                isTempActive ? (
                  <View
                    style={styles.welcomeContainer}
                    onTouchStart={() => Keyboard.dismiss()}
                    {...welcomePanResponder.panHandlers}
                  >
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        backgroundColor: "rgba(245, 158, 11, 0.16)",
                        borderWidth: 1.5,
                        borderColor: "rgba(245, 158, 11, 0.35)",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 16,
                      }}
                    >
                      <MaterialCommunityIcons
                        name="ghost"
                        size={32}
                        color="#f59e0b"
                      />
                    </View>
                    <Text
                      style={[styles.welcomeTitle, { color: theme.textMain }]}
                    >
                      Temporary Chat
                    </Text>
                    <Text
                      style={[
                        styles.welcomeSubtitle,
                        { color: theme.textMuted, marginTop: 4 },
                      ]}
                    >
                      Chats in this mode won&apos;t be saved in your chat
                      history and will be permanently deleted after 3 days.
                    </Text>

                    <TouchableOpacity
                      style={{
                        marginTop: 10,
                        marginBottom: 16,
                        paddingHorizontal: 18,
                        paddingVertical: 9,
                        borderRadius: 20,
                        backgroundColor: theme.bgCard,
                        borderWidth: 1,
                        borderColor: theme.borderSubtle,
                      }}
                      onPress={handleToggleTemporaryChat}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={{
                          fontSize: 12.5,
                          fontWeight: "600",
                          color: theme.textMain,
                        }}
                      >
                        Turn off Temporary Chat
                      </Text>
                    </TouchableOpacity>

                    {/* Temporary Starter Prompt Chips */}
                    <View style={styles.starterChipsRow}>
                      <TouchableOpacity
                        style={[
                          styles.starterChip,
                          {
                            backgroundColor: theme.bgCard,
                            borderColor: "rgba(245, 158, 11, 0.3)",
                          },
                        ]}
                        onPress={() =>
                          handleSendMessage(
                            "Explain how zero-trust security architecture works.",
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="shield-checkmark-outline"
                          size={14}
                          color="#f59e0b"
                        />
                        <Text
                          style={[
                            styles.starterChipText,
                            { color: theme.textMain },
                          ]}
                        >
                          Quick Research
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.starterChip,
                          {
                            backgroundColor: theme.bgCard,
                            borderColor: "rgba(245, 158, 11, 0.3)",
                          },
                        ]}
                        onPress={() =>
                          handleSendMessage(
                            "Check this confidential snippet for potential bugs or security risks.",
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="code-slash-outline"
                          size={14}
                          color="#f59e0b"
                        />
                        <Text
                          style={[
                            styles.starterChipText,
                            { color: theme.textMain },
                          ]}
                        >
                          Confidential Review
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View
                    style={styles.welcomeContainer}
                    onTouchStart={() => Keyboard.dismiss()}
                    {...welcomePanResponder.panHandlers}
                  >
                    <View style={styles.welcomeBrandGroup}>
                      <Image
                        source={require("./assets/logo.png")}
                        style={styles.welcomeLogo}
                        resizeMode="contain"
                      />
                      <Text
                        style={[styles.welcomeTitle, { color: theme.textMain }]}
                      >
                        Contexify AI
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.welcomeSubtitle,
                        { color: theme.textMuted },
                      ]}
                    >
                      Ask grounded questions with real-time web search or attach
                      files for instant document RAG.
                    </Text>

                    {/* Starter Prompt Chips */}
                    <View style={styles.starterChipsRow}>
                      <TouchableOpacity
                        style={[
                          styles.starterChip,
                          {
                            backgroundColor: theme.bgCard,
                            borderColor: theme.borderSubtle,
                          },
                        ]}
                        onPress={() =>
                          handleSendMessage(
                            "Summarize key points covered in the document.",
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <Ionicons name="list" size={14} color={theme.primary} />
                        <Text
                          style={[
                            styles.starterChipText,
                            { color: theme.textMain },
                          ]}
                        >
                          Summarize Document
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.starterChip,
                          {
                            backgroundColor: theme.bgCard,
                            borderColor: theme.borderSubtle,
                          },
                        ]}
                        onPress={() =>
                          handleSendMessage(
                            "Explain the main technical concepts.",
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="hardware-chip-outline"
                          size={14}
                          color={theme.primary}
                        />
                        <Text
                          style={[
                            styles.starterChipText,
                            { color: theme.textMain },
                          ]}
                        >
                          Key Concepts
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.starterChip,
                          {
                            backgroundColor: theme.bgCard,
                            borderColor: theme.borderSubtle,
                          },
                        ]}
                        onPress={() =>
                          handleSendMessage(
                            "Search the web for the latest updates on this topic.",
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="globe-outline"
                          size={14}
                          color={theme.emerald}
                        />
                        <Text
                          style={[
                            styles.starterChipText,
                            { color: theme.textMain },
                          ]}
                        >
                          Search Live Web
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              ) : (
                <FlatList
                  key={conversation.viewId}
                  ref={flatListRef}
                  data={messages}
                  keyExtractor={keyExtractor}
                  contentContainerStyle={styles.messageListContent}
                  keyboardDismissMode={
                    Platform.OS === "ios" ? "interactive" : "none"
                  }
                  keyboardShouldPersistTaps="handled"
                  onScroll={handleScroll}
                  scrollEventThrottle={16}
                  onScrollToIndexFailed={(info) => {
                    flatListRef.current?.scrollToOffset({
                      offset: Math.max(0, info.averageItemLength * info.index),
                      animated: true,
                    });
                  }}
                  onContentSizeChange={() => {
                    if (isAtBottomRef.current) {
                      flatListRef.current?.scrollToEnd({ animated: true });
                    }
                  }}
                  showsVerticalScrollIndicator={false}
                  renderItem={renderMessageItem}
                  ListFooterComponent={
                    streamingMessage ? (
                      <MessageItem
                        role="assistant"
                        content={streamingMessage.content}
                        citations={streamingMessage.citations}
                        attachments={streamingMessage.attachments}
                        isStreaming={true}
                        onOpenCitations={handleOpenCitations}
                        onUseAsReference={handleUseAsReference}
                        isDark={isDark}
                        theme={theme}
                      />
                    ) : null
                  }
                />
              )}

              {/* Scroll to Bottom / Jump to Latest Message Floating Button */}
              {messages.length > 0 && (
                <Animated.View
                  pointerEvents={showScrollToBottom ? "auto" : "none"}
                  style={[
                    styles.scrollToBottomBtnContainer,
                    {
                      opacity: scrollBtnAnim,
                      transform: [
                        {
                          scale: scrollBtnAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.65, 1],
                          }),
                        },
                        {
                          translateY: scrollBtnAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [8, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <TouchableOpacity
                    style={[
                      styles.scrollToBottomBtn,
                      {
                        backgroundColor: theme.primary,
                        borderColor: isDark
                          ? "rgba(255,255,255,0.18)"
                          : "rgba(0,0,0,0.08)",
                      },
                    ]}
                    onPress={handleScrollToBottom}
                    activeOpacity={0.85}
                    accessibilityLabel="Scroll to latest message"
                    accessibilityRole="button"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="arrow-down" size={17} color="#ffffff" />
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Dedicated Left-Edge Bezel Swipe Detector (Mounted on top of FlatList in z-order) */}
              {!drawerVisible && (
                <View
                  style={styles.edgeDrawerSwipeStrip}
                  {...edgePanResponder.panHandlers}
                />
              )}
            </View>

            {/* Bottom Chat Input Bar */}
            <ChatInput
              key={conversation.viewId}
              query={query}
              onChangeQuery={setQuery}
              onSend={() => handleSendMessage()}
              onStop={handleStopGeneration}
              isSending={isSending}
              isBusy={isLoadingHistory || isClearingChat}
              onAttachFile={handleAttachFile}
              isUploading={isUploading}
              documents={documents.filter((doc) =>
                pendingDocumentIds.includes(doc.document_id),
              )}
              onDeleteDocument={handleDetachDocument}
              attachedMedia={attachedMedia}
              onDeleteMedia={handleDeleteMedia}
              currentMode={currentMode}
              onToggleMode={handleToggleMode}
              isDark={isDark}
              theme={theme}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              onJumpToReply={
                replyingTo?.id
                  ? () => handleJumpToMessage(replyingTo.id)
                  : undefined
              }
            />
          </View>

          {/* Drawer Menu Modal */}
          <DrawerMenu
            visible={drawerVisible}
            onClose={() => setDrawerVisible(false)}
            currentUser={currentUser}
            sessions={sessions}
            totalSessions={totalSessions}
            hasMoreSessions={hasMoreSessions}
            isLoadingMoreSessions={isLoadingMoreSessions}
            onLoadMoreSessions={handleLoadMoreSessions}
            onRefreshSessions={handleRefreshSessions}
            isRefreshingSessions={isRefreshingSessions}
            activeSessionId={activeSessionId}
            onSelectSession={selectSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            sortOrder={sessionSortOrder}
            onToggleSortOrder={handleToggleSortOrder}
            onTogglePinSession={handleTogglePinSession}
            onNewChat={handleNewChat}
            documents={documents}
            onDeleteDocument={handleDeleteDocument}
            onOpenAttachments={
              currentUser ? () => setAttachmentsVisible(true) : undefined
            }
            onOpenAuth={() => setAuthVisible(true)}
            onOpenProfile={() => setProfileVisible(true)}
            onToggleTheme={handleToggleTheme}
            onOpenServerConfig={() => setServerConfigVisible(true)}
            onLogout={handleLogout}
            isDark={isDark}
            theme={theme}
          />

          {/* Citations Bottom Sheet Modal */}
          <CitationsSheet
            visible={citationsVisible}
            citations={activeCitations}
            onClose={() => setCitationsVisible(false)}
            isDark={isDark}
            theme={theme}
          />

          {/* Auth Modal */}
          <AuthModal
            visible={authVisible}
            onClose={() => setAuthVisible(false)}
            onSuccess={handleAuthSuccess}
            isDark={isDark}
            theme={theme}
          />

          {/* Profile & Settings Modal */}
          <ProfileModal
            visible={profileVisible}
            onClose={() => setProfileVisible(false)}
            currentUser={currentUser}
            currentAccent={accentColor}
            onSelectAccent={handleSelectAccent}
            themeMode={themeMode}
            onToggleThemeMode={(mode) => {
              setThemeMode(mode);
              AsyncStorage.setItem("contexify_theme_mode", mode);
            }}
            onProfileUpdated={(updated) => {
              setCurrentUser(updated);
              AsyncStorage.setItem(
                "contexify_mobile_user",
                JSON.stringify(updated),
              );
            }}
            onLogout={handleLogout}
            theme={theme}
          />

          {/* Server Config Modal */}
          <ServerConfigModal
            visible={serverConfigVisible}
            onClose={() => setServerConfigVisible(false)}
            isDark={isDark}
            theme={theme}
          />

          {/* Attachments & Media Library Modal */}
          <AttachmentsModal
            visible={attachmentsVisible}
            onClose={() => setAttachmentsVisible(false)}
            currentUser={currentUser}
            activeSessionId={activeSessionId}
            activeSessionTitle={activeSessionTitle}
            onAttachMedia={handleAttachMediaFromModal}
            onAttachDocument={handleAttachDocumentFromModal}
            onAssetDeleted={handleAssetDeletedFromModal}
            isDark={isDark}
            theme={theme}
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  workspace: {
    flex: 1,
  },
  chatViewport: {
    flex: 1,
  },
  edgeDrawerSwipeStrip: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 44,
    zIndex: 999,
    elevation: 999,
    backgroundColor: "transparent",
  },
  welcomeContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 10,
  },
  welcomeBrandGroup: {
    alignItems: "center",
    marginBottom: 0,
  },
  welcomeLogo: {
    width: 72,
    height: 72,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  welcomeSubtitle: {
    fontSize: 14.5,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 300,
  },
  starterChipsRow: {
    gap: 8,
    width: "100%",
    maxWidth: 300,
    marginTop: 12,
  },
  starterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  starterChipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  messageListContent: {
    paddingVertical: 12,
    flexGrow: 1,
  },
  temporaryBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  temporaryBannerText: {
    fontSize: 12,
    fontWeight: "600",
  },
  scrollToBottomBtnContainer: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    zIndex: 35,
  },
  scrollToBottomBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 6,
  },
});
