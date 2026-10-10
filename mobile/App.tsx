import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
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
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const isTempActive = Boolean(currentUser && isTemporaryChat);
  const [currentMode, setCurrentMode] = useState<ChatMode>("AUTO");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionSortOrder, setSessionSortOrder] =
    useState<SessionSortOrder>("last_created");
  const [totalSessions, setTotalSessions] = useState<number>(0);
  const [hasMoreSessions, setHasMoreSessions] = useState<boolean>(false);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] =
    useState<boolean>(false);
  const [isRefreshingSessions, setIsRefreshingSessions] =
    useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [attachedMedia, setAttachedMedia] = useState<MediaAttachment[]>([]);
  const [replyingTo, setReplyingTo] = useState<MessageReplyReference | null>(
    null,
  );

  // Interaction State
  const [query, setQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);
  const [streamingMessage, setStreamingMessage] =
    useState<StreamingMessageState | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const streamAbortRef = useRef<(() => void) | null>(null);

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

  const hasMessagesRef = useRef(
    messages.length > 0 || Boolean(streamingMessage),
  );
  useEffect(() => {
    hasMessagesRef.current = messages.length > 0 || Boolean(streamingMessage);
  }, [messages.length, streamingMessage]);

  const hasTriggeredEdgeDrawerRef = useRef(false);

  // Industry-standard left-edge gesture responder (Slack/Telegram pattern)
  // Transparent on touch-down to prevent tap blocking; intercepts rightward slides to open drawer.
  const edgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,

        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (drawerVisibleRef.current) return false;
          const isHorizontal =
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2;
          if (!isHorizontal || gestureState.dx <= 12) return false;

          // When messages are present, restrict trigger to edge (x0 <= 48)
          // to preserve WhatsApp-style swipe-to-reply on message cards.
          // On empty/welcome screen, allow swiping right anywhere.
          if (hasMessagesRef.current) {
            return gestureState.x0 <= 48;
          }
          return true;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (drawerVisibleRef.current) return false;
          const isHorizontal =
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2;
          if (!isHorizontal || gestureState.dx <= 12) return false;

          if (hasMessagesRef.current) {
            return gestureState.x0 <= 48;
          }
          return true;
        },

        onPanResponderGrant: () => {
          hasTriggeredEdgeDrawerRef.current = false;
        },

        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx > 25 && !hasTriggeredEdgeDrawerRef.current) {
            hasTriggeredEdgeDrawerRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            handleOpenDrawer();
          }
        },

        onPanResponderRelease: (_, gestureState) => {
          if (
            !hasTriggeredEdgeDrawerRef.current &&
            (gestureState.dx > 18 || gestureState.vx > 0.25)
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
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } =
        event.nativeEvent;
      const paddingToBottom = 60;
      const isClose =
        layoutMeasurement.height + contentOffset.y >=
        contentSize.height - paddingToBottom;
      isAtBottomRef.current = isClose;
    },
    [],
  );

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

      if (savedUserStr) {
        const user: User = JSON.parse(savedUserStr);
        currentUserRef.current = user;
        setCurrentUser(user);
        await loadUserSessions(user.id, user, initialSort);

        // Refresh profile in background to fetch latest avatar / settings from server
        apiService
          .getCurrentUser(user.id)
          .then((fresh) => {
            if (fresh) {
              currentUserRef.current = fresh;
              setCurrentUser(fresh);
              AsyncStorage.setItem(
                "contexify_mobile_user",
                JSON.stringify(fresh),
              );
            }
          })
          .catch(() => {});
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
    userOverride?: User | null,
    sortOverride?: SessionSortOrder,
  ) => {
    const activeSort = sortOverride || sessionSortOrder;
    try {
      const res = await apiService.getUserSessions(userId, {
        limit: SESSIONS_PAGE_SIZE,
        offset: 0,
        sort_by: activeSort,
      });
      const safeList = Array.isArray(res.sessions) ? res.sessions : [];
      setSessions(sortMobileSessions(safeList, activeSort));
      setTotalSessions(res.total ?? safeList.length);
      setHasMoreSessions(Boolean(res.has_more));
      // Always start in a fresh new chat on app launch
      handleNewChat(userOverride);
    } catch (err) {
      console.warn("Failed to load sessions:", err);
      setSessions([]);
      setTotalSessions(0);
      setHasMoreSessions(false);
      handleNewChat(userOverride);
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
    setIsTemporaryChat(false);
    setActiveSessionId(sessionId);
    setStreamingMessage(null);
    setAttachedMedia([]);
    setReplyingTo(null);
    setHighlightedMessageId(null);
    isAtBottomRef.current = true;
    if (sessionMode) setCurrentMode(sessionMode);

    try {
      const hist = await apiService.getSessionHistory(sessionId);
      if (hist?.session?.mode) setCurrentMode(hist.session.mode);
      setMessages(Array.isArray(hist?.messages) ? hist.messages : []);
      setDocuments(Array.isArray(hist?.documents) ? hist.documents : []);
    } catch {
      setMessages([]);
      setDocuments([]);
    }
  };

  const handleToggleTemporaryChat = () => {
    if (!currentUser) return;
    setIsTemporaryChat((prev) => !prev);
    setActiveSessionId(null);
    setMessages([]);
    setDocuments([]);
    setAttachedMedia([]);
    setReplyingTo(null);
    setHighlightedMessageId(null);
    setStreamingMessage(null);
    setQuery("");
  };

  // --- 3. New Chat ---
  const handleNewChat = (userOverride?: User | null) => {
    setIsTemporaryChat(false);
    isAtBottomRef.current = true;
    const effectiveUser =
      userOverride !== undefined
        ? userOverride
        : currentUserRef.current || currentUser;
    if (effectiveUser) {
      // Authenticated users start with null session ID (ready for new persistent thread)
      setActiveSessionId(null);
    } else {
      setActiveSessionId(generateGuestSessionId());
    }
    setMessages([]);
    setDocuments([]);
    setAttachedMedia([]);
    setReplyingTo(null);
    setHighlightedMessageId(null);
    setStreamingMessage(null);
    setQuery("");
  };

  const handleReplyMessage = useCallback(
    (msg: { id?: string; role: "user" | "assistant"; content: string }) => {
      setReplyingTo({
        id: msg.id || `msg_${Date.now()}`,
        role: msg.role,
        content: msg.content,
      });
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

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
      if (activeSessionId === sessionId) {
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
  const handleSendMessage = async (customQuery?: string) => {
    const textToSend = (customQuery || query).trim();
    if (
      (!textToSend && attachedMedia.length === 0) ||
      isSending ||
      isSendingRef.current
    )
      return;

    isSendingRef.current = true;
    setIsSending(true);
    setQuery("");
    const replyToPayload = replyingTo;
    setReplyingTo(null);
    let sessionId = activeSessionId;

    const mediaToSend = [...attachedMedia];
    setAttachedMedia([]);

    const prompt =
      textToSend ||
      (currentMode === "IMAGE_GENERATION"
        ? "Generate a creative variation of this image"
        : "Analyze this image and describe what you see in detail.");

    const userToUse = currentUserRef.current || currentUser;

    // Create session in backend if user is logged in and no session is active yet
    if (!sessionId && userToUse) {
      const clientSessionId = generateGuestSessionId();
      try {
        const newSession = await apiService.createSession(
          userToUse.id,
          prompt.slice(0, 40),
          currentMode,
          isTempActive,
          clientSessionId,
        );
        sessionId = newSession.id;
        setActiveSessionId(sessionId);
        if (!isTempActive) {
          setSessions((prev) => [newSession, ...prev]);
          setTotalSessions((prev) => prev + 1);
        }
      } catch (err) {
        console.warn(
          "Explicit createSession failed; relying on backend self-healing with user_id:",
          err,
        );
        sessionId = clientSessionId;
        setActiveSessionId(sessionId);
      }
    } else if (!sessionId) {
      sessionId = generateGuestSessionId();
      setActiveSessionId(sessionId);
    }

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
    isAtBottomRef.current = true;
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 60);

    // Stream SSE Response
    let streamedContent = "";
    let streamedCitations: Citation[] = [];
    let streamedMedia: MediaAttachment[] = [];
    let isStreamFinalized = false;

    const finalizeStream = (action: () => void) => {
      if (isStreamFinalized) return;
      isStreamFinalized = true;
      isSendingRef.current = false;
      setIsSending(false);
      setStreamingMessage(null);
      streamAbortRef.current = null;
      action();
    };

    const cancel = apiService.streamChat(
      sessionId,
      prompt,
      currentMode,
      {
        onToken: (token) => {
          if (isStreamFinalized) return;
          streamedContent += token;
          setStreamingMessage({
            content: streamedContent,
            citations: streamedCitations,
            attachments: streamedMedia,
          });
        },
        onCitations: (cits) => {
          if (isStreamFinalized) return;
          streamedCitations = cits;
          setStreamingMessage({
            content: streamedContent,
            citations: streamedCitations,
            attachments: streamedMedia,
          });
        },
        onMedia: (media: MediaAttachment) => {
          if (isStreamFinalized) return;
          streamedMedia = [...streamedMedia, media];
          setStreamingMessage({
            content: streamedContent,
            citations: streamedCitations,
            attachments: streamedMedia,
          });
        },
        onComplete: () => {
          finalizeStream(() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

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
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

            const errorMsg: Message = {
              id: "err_" + Date.now(),
              session_id: sessionId!,
              role: "assistant",
              content: `⚠️ ${errMsg}`,
              citations: [],
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
    );

    streamAbortRef.current = cancel;
  };

  const handleStopGeneration = () => {
    isSendingRef.current = false;
    if (streamAbortRef.current) {
      streamAbortRef.current();
      streamAbortRef.current = null;
    }
    setIsSending(false);
    if (streamingMessage && streamingMessage.content) {
      const partialMsg: Message = {
        id: "ai_partial_" + Date.now(),
        session_id: activeSessionId || "temp",
        role: "assistant",
        content: streamingMessage.content,
        citations: streamingMessage.citations,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, partialMsg]);
    }
    setStreamingMessage(null);
  };

  // --- 7. File Attachment & Upload ---
  const handleAttachFile = async (file: {
    uri: string;
    name: string;
    mimeType: string;
  }) => {
    const userToUse = currentUserRef.current || currentUser;
    let sessionId = activeSessionId;
    if (!sessionId) {
      if (userToUse) {
        const clientSessionId = generateGuestSessionId();
        try {
          const newSession = await apiService.createSession(
            userToUse.id,
            `File: ${file.name}`.slice(0, 40),
            "DOCUMENT_RAG",
            isTempActive,
            clientSessionId,
          );
          sessionId = newSession.id;
          setActiveSessionId(sessionId);
          if (!isTempActive) {
            setSessions((prev) => [newSession, ...prev]);
            setTotalSessions((prev) => prev + 1);
          }
        } catch (err) {
          console.warn(
            "Session creation on file attach failed; using clientSessionId for self-healing:",
            err,
          );
          sessionId = clientSessionId;
          setActiveSessionId(sessionId);
        }
      } else {
        sessionId = generateGuestSessionId();
        setActiveSessionId(sessionId);
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
        );
        setAttachedMedia((prev) => [...prev, media]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (currentMode !== "IMAGE_GENERATION" && currentMode !== "AUTO") {
          setCurrentMode("MULTIMODAL");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert("Image Upload Failed", msg);
      } finally {
        setIsUploading(false);
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
      );
      setDocuments((prev) => [...(Array.isArray(prev) ? prev : []), doc]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Auto-switch to Document RAG if uploaded and not in AUTO mode
      if (currentMode !== "DOCUMENT_RAG" && currentMode !== "AUTO") {
        setCurrentMode("DOCUMENT_RAG");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Upload Failed", msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await apiService.deleteDocument(docId, activeSessionId || "");
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

  const handleUseAsReference = useCallback((media: MediaAttachment) => {
    setAttachedMedia([media]);
    setCurrentMode("IMAGE_GENERATION");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

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
  const handleAuthSuccess = async (user: User) => {
    currentUserRef.current = user;
    setCurrentUser(user);
    await AsyncStorage.setItem("contexify_mobile_user", JSON.stringify(user));
    await loadUserSessions(user.id, user);
  };

  const handleLogout = async () => {
    currentUserRef.current = null;
    setCurrentUser(null);
    setIsTemporaryChat(false);
    await AsyncStorage.removeItem("contexify_mobile_user");
    setSessions([]);
    setTotalSessions(0);
    setHasMoreSessions(false);
    handleNewChat(null);
  };

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
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: theme.bgApp }]}
        edges={["top", "left", "right"]}
      >
        <StatusBar style={isDark ? "light" : "dark"} />

        {/* Top Native Header */}
        <Header
          onOpenDrawer={handleOpenDrawer}
          onNewChat={handleNewChat}
          onToggleTheme={handleToggleTheme}
          isDark={isDark}
          theme={theme}
          isTemporaryChat={isTempActive}
          onToggleTemporaryChat={
            currentUser ? handleToggleTemporaryChat : undefined
          }
          onOpenAttachments={
            currentUser ? () => setAttachmentsVisible(true) : undefined
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.workspace}
          keyboardVerticalOffset={Platform.OS === "ios" ? 54 : 0}
        >
          {/* Main Messages & Conversation Viewport with Left-to-Right Edge Swipe Responder */}
          <View style={styles.chatViewport} {...edgePanResponder.panHandlers}>
            {/* Welcome Screen or ChatGPT Temporary Chat Screen */}
            {messages.length === 0 && !streamingMessage ? (
              isTempActive ? (
                <TouchableWithoutFeedback
                  onPress={Keyboard.dismiss}
                  accessible={false}
                >
                  <View style={styles.welcomeContainer}>
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
                </TouchableWithoutFeedback>
              ) : (
                <TouchableWithoutFeedback
                  onPress={Keyboard.dismiss}
                  accessible={false}
                >
                  <View style={styles.welcomeContainer}>
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
                </TouchableWithoutFeedback>
              )
            ) : (
              <FlatList
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
          </View>

          {/* Bottom Chat Input Bar */}
          <ChatInput
            query={query}
            onChangeQuery={setQuery}
            onSend={() => handleSendMessage()}
            onStop={handleStopGeneration}
            isSending={isSending}
            onAttachFile={handleAttachFile}
            isUploading={isUploading}
            documents={documents}
            onDeleteDocument={handleDeleteDocument}
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
        </KeyboardAvoidingView>

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
});
