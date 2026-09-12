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
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, Ionicons } from "@expo/vector-icons";
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
} from "./src/types";

import { Header } from "./src/components/Header";
import { MessageItem } from "./src/components/MessageItem";
import { ChatInput } from "./src/components/ChatInput";
import { DrawerMenu } from "./src/components/DrawerMenu";
import { CitationsSheet } from "./src/components/CitationsSheet";
import { AuthModal } from "./src/components/AuthModal";
import { ProfileModal } from "./src/components/ProfileModal";
import { ServerConfigModal } from "./src/components/ServerConfigModal";

function generateGuestSessionId(): string {
  return (
    "guest_" +
    Math.random().toString(36).substring(2, 11) +
    Date.now().toString(36)
  );
}

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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<ChatMode>("WEB_SEARCH");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);

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

  const flatListRef = useRef<FlatList<Message>>(null);

  // --- 1. App Initialization ---
  useEffect(() => {
    initApp();
  }, []);

  // --- Keyboard Auto-scroll (ChatGPT behavior: scroll messages when keyboard appears) ---
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(showEvent, () => {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
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
      if (savedUserStr) {
        const user: User = JSON.parse(savedUserStr);
        setCurrentUser(user);
        await loadUserSessions(user.id);

        // Refresh profile in background to fetch latest avatar / settings from server
        apiService
          .getCurrentUser(user.id)
          .then((fresh) => {
            if (fresh) {
              setCurrentUser(fresh);
              AsyncStorage.setItem(
                "contexify_mobile_user",
                JSON.stringify(fresh),
              );
            }
          })
          .catch(() => {});
      } else {
        // Guest mode default session
        setActiveSessionId(generateGuestSessionId());
      }
    } catch {
      setActiveSessionId(generateGuestSessionId());
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

  const loadUserSessions = async (userId: string) => {
    try {
      const list = await apiService.getUserSessions(userId);
      const safeList = Array.isArray(list) ? list : [];
      setSessions(safeList);
      // Always start in a fresh new chat on app launch
      handleNewChat();
    } catch (err) {
      console.warn("Failed to load sessions:", err);
      setSessions([]);
      handleNewChat();
    }
  };

  // --- 2. Switch Conversation ---
  const selectSession = async (sessionId: string, sessionMode?: ChatMode) => {
    setActiveSessionId(sessionId);
    setStreamingMessage(null);
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

  // --- 3. New Chat ---
  const handleNewChat = () => {
    if (currentUser) {
      setActiveSessionId(null);
    } else {
      setActiveSessionId(generateGuestSessionId());
    }
    setMessages([]);
    setDocuments([]);
    setStreamingMessage(null);
    setQuery("");
  };

  // --- 4. Delete Session ---
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await apiService.deleteSession(sessionId);
      const currentList = Array.isArray(sessions) ? sessions : [];
      const updated = currentList.filter((s) => s.id !== sessionId);
      setSessions(updated);
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

  // --- 5. Toggle Mode ---
  const handleToggleMode = () => {
    const nextMode: ChatMode =
      currentMode === "WEB_SEARCH" ? "DOCUMENT_RAG" : "WEB_SEARCH";
    setCurrentMode(nextMode);
    if (activeSessionId && currentUser) {
      apiService.updateSessionMode(activeSessionId, nextMode).catch(() => {});
    }
  };

  // --- 6. Send Message & Streaming ---
  const handleSendMessage = async (customQuery?: string) => {
    const textToSend = (customQuery || query).trim();
    if (!textToSend || isSending || isSendingRef.current) return;

    isSendingRef.current = true;
    setIsSending(true);
    setQuery("");
    let sessionId = activeSessionId;

    // Create session in backend if user is logged in and no session is active yet
    if (!sessionId && currentUser) {
      try {
        const newSession = await apiService.createSession(
          currentUser.id,
          textToSend.slice(0, 40),
          currentMode,
        );
        sessionId = newSession.id;
        setActiveSessionId(sessionId);
        setSessions((prev) => [newSession, ...prev]);
      } catch {
        sessionId = generateGuestSessionId();
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
      content: textToSend,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setStreamingMessage({ content: "", citations: [] });

    // Stream SSE Response
    let streamedContent = "";
    let streamedCitations: Citation[] = [];
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

    const cancel = apiService.streamChat(sessionId, textToSend, currentMode, {
      onToken: (token) => {
        if (isStreamFinalized) return;
        streamedContent += token;
        setStreamingMessage({
          content: streamedContent,
          citations: streamedCitations,
        });
      },
      onCitations: (cits) => {
        if (isStreamFinalized) return;
        streamedCitations = cits;
        setStreamingMessage({
          content: streamedContent,
          citations: streamedCitations,
        });
      },
      onComplete: () => {
        finalizeStream(() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

          const aiMsg: Message = {
            id: "ai_" + Date.now(),
            session_id: sessionId!,
            role: "assistant",
            content: streamedContent || "No response generated.",
            citations: streamedCitations,
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
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        });
      },
    });

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
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = generateGuestSessionId();
      setActiveSessionId(sessionId);
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
      // Auto-switch to Document RAG if uploaded
      if (currentMode !== "DOCUMENT_RAG") {
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

  // --- 8. Citations Sheet Open ---
  const handleOpenCitations = (cits: Citation[]) => {
    setActiveCitations(cits);
    setCitationsVisible(true);
  };

  // --- 9. Auth Success / Logout ---
  const handleAuthSuccess = async (user: User) => {
    setCurrentUser(user);
    await AsyncStorage.setItem("contexify_mobile_user", JSON.stringify(user));
    await loadUserSessions(user.id);
  };

  const handleLogout = async () => {
    setCurrentUser(null);
    await AsyncStorage.removeItem("contexify_mobile_user");
    setSessions([]);
    handleNewChat();
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: theme.bgApp }]}
        edges={["top", "left", "right"]}
      >
        <StatusBar style={isDark ? "light" : "dark"} />

        {/* Top Native Header */}
        <Header
          onOpenDrawer={() => setDrawerVisible(true)}
          onNewChat={handleNewChat}
          onToggleTheme={handleToggleTheme}
          isDark={isDark}
          theme={theme}
        />

        {/* Main Chat Workspace */}
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.workspace}
          keyboardVerticalOffset={Platform.OS === "ios" ? 54 : 0}
        >
          {/* Welcome Screen if empty */}
          {messages.length === 0 && !streamingMessage ? (
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
                  style={[styles.welcomeSubtitle, { color: theme.textMuted }]}
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
                      handleSendMessage("Explain the main technical concepts.")
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
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messageListContent}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() =>
                flatListRef.current?.scrollToEnd({ animated: true })
              }
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <MessageItem
                  id={item.id}
                  role={item.role}
                  content={item.content}
                  citations={item.citations}
                  onOpenCitations={handleOpenCitations}
                  isDark={isDark}
                  theme={theme}
                />
              )}
              ListFooterComponent={
                streamingMessage ? (
                  <MessageItem
                    role="assistant"
                    content={streamingMessage.content}
                    citations={streamingMessage.citations}
                    isStreaming={true}
                    onOpenCitations={handleOpenCitations}
                    isDark={isDark}
                    theme={theme}
                  />
                ) : null
              }
            />
          )}

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
            currentMode={currentMode}
            onToggleMode={handleToggleMode}
            isDark={isDark}
            theme={theme}
          />
        </KeyboardAvoidingView>

        {/* Drawer Menu Modal */}
        <DrawerMenu
          visible={drawerVisible}
          onClose={() => setDrawerVisible(false)}
          currentUser={currentUser}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={selectSession}
          onDeleteSession={handleDeleteSession}
          onNewChat={handleNewChat}
          documents={documents}
          onDeleteDocument={handleDeleteDocument}
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
});
