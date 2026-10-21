import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { ConversationStore } from "./services/conversation_store";
import { apiService } from "./services/api";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { ChatWorkspace } from "./components/Chat/ChatWorkspace";
import { UserModal } from "./components/Modals/UserModal";
import { AttachmentsModal } from "./components/Modals/AttachmentsModal";
import { useChatSessions } from "./hooks/useChatSessions";
import type {
  User,
  ChatMode,
  DocumentMetadata,
  Message,
  StreamingMessageState,
  Citation,
  GoogleAuthRequest,
  MediaAttachment,
  MessageReplyReference,
} from "./types";
import { useTheme } from "./context/ThemeContext";
import { useConfirm } from "./context/ConfirmContext";
import "./styles/main.css";

function generateGuestSessionId(): string {
  return crypto.randomUUID();
}

interface UrlRouteInfo {
  sessionId: string | null;
  isUnauthenticated: boolean;
}

function getUrlRouteInfo(): UrlRouteInfo {
  const path = window.location.pathname;
  // Route /c/:id (authenticated) or /uc/:id (guest temp chat)
  const authMatch = path.match(/^\/c\/([^/]+)/);
  if (authMatch) {
    return {
      sessionId: decodeURIComponent(authMatch[1]),
      isUnauthenticated: false,
    };
  }
  const unauthMatch = path.match(/^\/uc\/([^/]+)/);
  if (unauthMatch) {
    return {
      sessionId: decodeURIComponent(unauthMatch[1]),
      isUnauthenticated: true,
    };
  }

  // Legacy fallback ?c=:id query param
  if (typeof window !== "undefined" && window.location.search) {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    if (c) {
      return { sessionId: c, isUnauthenticated: false };
    }
  }

  return { sessionId: null, isUnauthenticated: false };
}

function updateUrlForSession(
  sessionId: string | null,
  isUnauthenticated: boolean = false,
) {
  if (sessionId) {
    const prefix = isUnauthenticated ? "/uc" : "/c";
    const targetPath = `${prefix}/${encodeURIComponent(sessionId)}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState(
        { sessionId, isUnauthenticated },
        "",
        targetPath,
      );
    }
  } else {
    if (window.location.pathname !== "/" && window.location.pathname !== "") {
      window.history.pushState({}, "", "/");
    }
  }
}

export const App: React.FC = () => {
  const { setMode } = useTheme();
  const { confirm, showAlert } = useConfirm();

  // --- Global State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const authVersionRef = useRef(0);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);

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
        inputQuery: "",
        uploadStatusText: "",
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
    isClearingHistory,
    streamingMessage,
    isUploading,
    inputQuery,
    uploadStatusText,
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
  const setInputQuery = conversationStore.setter(conversation, "inputQuery");
  const setUploadStatusText = conversationStore.setter(
    conversation,
    "uploadStatusText",
  );

  const [clearedChats, setClearedChats] = useState<Record<string, string>>({});

  // --- Sessions Management (Pagination, Server-side Debounced Search, Optimistic Updates) ---
  const {
    sessions,
    total: totalSessions,
    hasMore: hasMoreSessions,
    isLoadingInitial: isLoadingInitialSessions,
    isLoadingMore: isLoadingMoreSessions,
    isSearching: isSearchingSessions,
    searchQuery: sessionSearchQuery,
    setSearchQuery: setSessionSearchQuery,
    sortOrder: sessionSortOrder,
    setSortOrder: setSessionSortOrder,
    togglePinSession,
    loadMore: loadMoreSessions,
    prependSession,
    updateSessionTitle,
    updateSessionMode,
    removeSession,
    ensureSessionInList,
    setSessionsDirect,
  } = useChatSessions({
    userId: currentUser?.id ?? null,
    activeSessionId,
  });

  // --- Interaction States ---
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userModalTab, setUserModalTab] = useState<"login" | "register">(
    "login",
  );
  const [isAttachmentsModalOpen, setIsAttachmentsModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return false;
    }
    const saved = localStorage.getItem("contexify_sidebar_open");
    return saved !== null ? JSON.parse(saved) : true;
  });

  const handleOpenUserModal = (tab: "login" | "register" = "login") => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
    setUserModalTab(tab);
    setIsUserModalOpen(true);
  };

  const handleOpenAttachmentsModal = useCallback(() => {
    if (!currentUser) return;
    setIsAttachmentsModalOpen(true);
  }, [currentUser]);

  const handleAttachMediaFromModal = useCallback(
    (media: MediaAttachment) => {
      setAttachedMedia((prev) => {
        if (
          prev.some((m) => (m.id && m.id === media.id) || m.url === media.url)
        ) {
          return prev;
        }
        return [...prev, media];
      });
    },
    [setAttachedMedia],
  );

  const handleAttachDocumentFromModal = useCallback(
    (doc: DocumentMetadata) => {
      setPendingDocumentIds((prev) =>
        prev.includes(doc.document_id) ? prev : [...prev, doc.document_id],
      );
      setDocuments((prev) => {
        if (prev.some((d) => d.document_id === doc.document_id)) {
          return prev;
        }
        return [...prev, doc];
      });
      if (currentMode !== "DOCUMENT_RAG" && currentMode !== "AUTO") {
        setCurrentMode("DOCUMENT_RAG");
      }
    },
    [setPendingDocumentIds, setDocuments, currentMode, setCurrentMode],
  );

  const handleAssetDeletedFromModal = useCallback(
    (assetId: string) => {
      setPendingDocumentIds((prev) => prev.filter((id) => id !== assetId));
      setAttachedMedia((prev) => prev.filter((m) => m.id !== assetId));
      setDocuments((prev) => prev.filter((d) => d.document_id !== assetId));
    },
    [setPendingDocumentIds, setAttachedMedia, setDocuments],
  );

  const handleToggleSidebar = () => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem("contexify_sidebar_open", JSON.stringify(next));
      return next;
    });
  };

  const handleToggleTemporaryChat = () => {
    if (!currentUser) return;
    const next = !isTemporaryChat;
    setActiveSessionId(null);
    conversationStore.patch(conversationStore.active, {
      isTemporaryChat: next,
    });
    setIsAttachmentsModalOpen(false);
    updateUrlForSession(null);
    localStorage.removeItem("contexify_active_session");
  };

  // --- 1. Select / Switch Active Session ---
  const selectSession = useCallback(
    async (sessionId: string, pushUrl = true, isUnauthenticated = false) => {
      if (!sessionId) return;
      const authVersion = authVersionRef.current;
      setActiveSessionId(sessionId);
      setIsAttachmentsModalOpen(false);
      const entry = conversationStore.active;
      const request = ++entry.historyRequest;
      const before = entry.state;
      if (typeof window !== "undefined" && window.innerWidth < 768)
        setIsSidebarOpen(false);
      if (pushUrl) updateUrlForSession(sessionId, isUnauthenticated);
      if (!currentUser?.id || isUnauthenticated) return;
      localStorage.setItem("contexify_active_session", sessionId);
      if (entry.state.isSending || entry.preserveHistory) return;
      conversationStore.patch(entry, {
        isLoadingHistory: true,
        historyError: null,
      });
      try {
        const history = await apiService.getSessionHistory(sessionId);
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(entry) ||
          request !== entry.historyRequest
        )
          return;
        conversationStore.patch(entry, {
          isTemporaryChat: Boolean(history.session?.is_temporary),
          ...(entry.state.currentMode === before.currentMode &&
          history.session?.mode
            ? { currentMode: history.session.mode }
            : {}),
          ...(entry.state.documents === before.documents
            ? {
                documents: [
                  ...(history.documents || []),
                  ...entry.state.documents.filter(
                    (doc) =>
                      entry.state.pendingDocumentIds.includes(
                        doc.document_id,
                      ) &&
                      !(history.documents || []).some(
                        (saved) => saved.document_id === doc.document_id,
                      ),
                  ),
                ],
              }
            : {}),
          ...(entry.state.messages === before.messages &&
          !entry.state.isSending &&
          !entry.preserveHistory
            ? { messages: history.messages || [] }
            : {}),
        });
      } catch (error) {
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
          await showAlert({
            title: "History unavailable",
            message:
              "Could not refresh this chat. Your current messages have been kept. Please try again.",
          });
        }
        console.error("Failed to load session history:", error);
      } finally {
        if (conversationStore.live(entry) && request === entry.historyRequest)
          conversationStore.patch(entry, { isLoadingHistory: false });
      }
    },
    [currentUser, conversationStore, setActiveSessionId, showAlert],
  );

  // --- 2. User Initialization (Guest vs Logged In) ---
  useEffect(() => {
    initUser();
  }, []);

  const initUser = async () => {
    try {
      const savedUserStr = localStorage.getItem("contexify_user");
      let user: User | null = null;
      let parsedUser: User | null = null;
      if (savedUserStr) {
        try {
          parsedUser = JSON.parse(savedUserStr);
          if (parsedUser?.id && (await apiService.hasUserSession())) {
            user = await apiService
              .getCurrentUser(parsedUser.id)
              .catch(() => null);
          }
        } catch {
          user = null;
        }
      }

      if (user) {
        // Logged-in user found
        currentUserRef.current = user;
        setCurrentUser(user);
        localStorage.setItem("contexify_user", JSON.stringify(user));
      } else {
        // Ephemeral Guest Mode (No DB Save)
        currentUserRef.current = null;
        setCurrentUser(null);
        setIsTemporaryChat(false);
        localStorage.removeItem("contexify_user");
        localStorage.removeItem("contexify_active_session");
        setMode("light");

        const { sessionId: urlSessionId, isUnauthenticated } =
          getUrlRouteInfo();
        if (urlSessionId) {
          if (isUnauthenticated) {
            // Guest active temp chat from URL
            setActiveSessionId(urlSessionId);
          } else {
            // User attempting to open private /c/:id without session
            setIsUserModalOpen(true);
            setUserModalTab("login");
          }
        } else {
          setActiveSessionId(null);
          updateUrlForSession(null);
        }
      }
    } catch (e) {
      console.error("Failed to initialize user:", e);
      currentUserRef.current = null;
      setCurrentUser(null);
      setActiveSessionId(null);
    } finally {
      setIsAuthReady(true);
    }
  };

  // --- 3. Load Sessions when Logged In ---
  const loadSessions = useCallback(
    async (userId: string) => {
      const authVersion = authVersionRef.current;
      const origin = conversationStore.active;
      const originId = origin.sessionId;
      try {
        const paginated = await apiService.listSessions(userId, {
          limit: 12,
          offset: 0,
        });
        const sessionList = paginated.sessions || [];
        if (authVersion !== authVersionRef.current) return;
        setSessionsDirect(sessionList);
        if (
          conversationStore.active !== origin ||
          origin.sessionId !== originId
        )
          return;

        const { sessionId: urlSessionId, isUnauthenticated } =
          getUrlRouteInfo();

        // If URL explicitly specifies a session ID (/c/:id or ?c=:id), select it
        if (urlSessionId && !isUnauthenticated) {
          const matchingUrlSession = sessionList.find(
            (s) => s.id === urlSessionId,
          );
          if (matchingUrlSession) {
            await selectSession(matchingUrlSession.id, false, false);
            return;
          }
          // If not directly in list, attempt to fetch history directly (e.g. valid session)
          try {
            const hist = await apiService.getSessionHistory(urlSessionId);
            if (
              authVersion !== authVersionRef.current ||
              conversationStore.active !== origin ||
              origin.sessionId !== originId
            )
              return;
            if (hist.session) {
              ensureSessionInList(hist.session);
              await selectSession(hist.session.id, false, false);
              return;
            }
          } catch {
            // If session doesn't exist, ignore and fallback to root new chat
          }
        }

        // If on root '/', start on clean new chat (no ID in URL)
        setActiveSessionId(null);
        updateUrlForSession(null);
      } catch (e) {
        console.error("Failed to load user sessions:", e);
      }
    },
    [selectSession, ensureSessionInList, setSessionsDirect],
  );

  useEffect(() => {
    if (currentUser?.id) {
      loadSessions(currentUser.id);
    }
  }, [currentUser, loadSessions]);

  // --- 4. Listen to Browser Back / Forward History Navigation ---
  useEffect(() => {
    const handlePopState = () => {
      const { sessionId: targetSessionId, isUnauthenticated } =
        getUrlRouteInfo();
      if (targetSessionId) {
        if (currentUser?.id && !isUnauthenticated) {
          selectSession(targetSessionId, false, false);
        } else if (isUnauthenticated) {
          setActiveSessionId(targetSessionId);
        }
      } else {
        // Navigated back to root '/'
        setActiveSessionId(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [currentUser, sessions, selectSession]);

  // --- 5. Start New Chat / Conversation ---
  const handleNewSession = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768)
      setIsSidebarOpen(false);
    setActiveSessionId(null);
    setIsAttachmentsModalOpen(false);
    updateUrlForSession(null);
    localStorage.removeItem("contexify_active_session");
  };

  const handleReplyMessage = useCallback(
    (msg: { id?: string; role: "user" | "assistant"; content: string }) => {
      setReplyingTo({
        id: msg.id || `msg-${Date.now()}`,
        role: msg.role,
        content: msg.content,
      });
    },
    [setReplyingTo],
  );

  // --- 5. Delete Session ---
  const handleDeleteSession = async (sessionId: string) => {
    if (!currentUser?.id) return;
    const targetSession = sessions.find((s) => s.id === sessionId);
    const sessionTitle = targetSession?.title || "this chat";

    const confirmed = await confirm({
      type: "delete-chat",
      title: "Delete chat?",
      chatTitle: sessionTitle,
      confirmText: "Delete",
      cancelText: "Cancel",
    });
    if (!confirmed) return;

    try {
      await apiService.deleteSession(sessionId);
      removeSession(sessionId);

      const wasActive = activeSessionIdRef.current === sessionId;
      conversationStore.drop(sessionId);
      if (wasActive) {
        activeSessionIdRef.current = null;
        updateUrlForSession(null);
        localStorage.removeItem("contexify_active_session");
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      await showAlert({
        title: "Delete Failed",
        message: `Failed to delete session: ${err}`,
      });
    }
  };

  // --- 6. Rename Session ---
  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    if (!currentUser?.id) return;
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    const currentSession = sessions.find((s) => s.id === sessionId);
    if (!currentSession || currentSession.title === trimmed) return;

    const prevTitle = currentSession.title;
    updateSessionTitle(sessionId, trimmed);

    try {
      await apiService.updateSessionTitle(sessionId, trimmed);
    } catch (e: unknown) {
      updateSessionTitle(sessionId, prevTitle);
      const err = e instanceof Error ? e.message : String(e);
      await showAlert({
        title: "Rename Failed",
        message: `Failed to rename conversation: ${err}`,
      });
    }
  };

  // --- 7. Mode Switch ---
  const handleModeChange = async (mode: ChatMode) => {
    setCurrentMode(mode);
    if (activeSessionId && currentUser?.id) {
      try {
        await apiService.updateSessionMode(activeSessionId, mode);
        updateSessionMode(activeSessionId, mode);
      } catch (err) {
        console.error("Failed to persist session mode switch:", err);
      }
    }
  };

  // --- 7. Document & Media Upload / Delete ---
  const handleFileUpload = async (file: File) => {
    const authVersion = authVersionRef.current;
    if (conversationStore.active !== conversation) return;
    conversation.uploads++;
    setIsUploading(true);
    setOperationError(null);
    const userToUse = currentUserRef.current || currentUser;
    let targetSessionId = conversation.sessionId;
    if (!targetSessionId) {
      if (userToUse?.id) {
        const clientSessionId = generateGuestSessionId();
        conversationStore.adopt(conversation, clientSessionId);
        if (conversationStore.active === conversation)
          activeSessionIdRef.current = clientSessionId;
        try {
          const newSess = await apiService.createSession(
            userToUse.id,
            "New Conversation",
            currentMode,
            isTemporaryChat,
            clientSessionId,
          );
          if (
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          targetSessionId = newSess.id;
          conversationStore.adopt(conversation, newSess.id);
          if (conversationStore.active === conversation)
            activeSessionIdRef.current = newSess.id;
          if (!isTemporaryChat) {
            prependSession(newSess);
            if (conversationStore.active === conversation)
              localStorage.setItem("contexify_active_session", newSess.id);
          }
          if (conversationStore.active === conversation)
            updateUrlForSession(newSess.id, false);
        } catch (err) {
          if (
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          console.warn(
            "Failed to create session explicitly on file upload, using clientSessionId for self-healing:",
            err,
          );
          targetSessionId = clientSessionId;
          conversationStore.adopt(conversation, targetSessionId);
          if (conversationStore.active === conversation)
            activeSessionIdRef.current = targetSessionId;
          if (conversationStore.active === conversation)
            updateUrlForSession(targetSessionId, false);
        }
      } else {
        targetSessionId = generateGuestSessionId();
        conversationStore.adopt(conversation, targetSessionId);
        if (conversationStore.active === conversation)
          activeSessionIdRef.current = targetSessionId;
        if (conversationStore.active === conversation)
          updateUrlForSession(targetSessionId, true);
      }
    }

    const isImage =
      file.type.startsWith("image/") ||
      [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"].some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );

    if (isImage) {
      setIsUploading(true);
      setUploadStatusText(`Uploading image '${file.name}'...`);
      try {
        const mediaRes = await apiService.uploadMedia(
          file,
          targetSessionId,
          currentUser?.id,
          isTemporaryChat,
        );
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(conversation)
        )
          return;
        setAttachedMedia((prev) => [...prev, mediaRes]);
      } catch (e: unknown) {
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(conversation)
        )
          return;
        const err = e instanceof Error ? e.message : String(e);
        setOperationError(`Image upload failed: ${err}`);
        if (conversationStore.active === conversation)
          await showAlert({ title: "Image Upload Failed", message: err });
      } finally {
        if (authVersion === authVersionRef.current) {
          conversation.uploads = Math.max(0, conversation.uploads - 1);
          setIsUploading(conversation.uploads > 0);
          if (conversation.uploads === 0) setUploadStatusText("");
        }
      }
      return;
    }

    setIsUploading(true);
    setUploadStatusText(`Vectorizing '${file.name}'...`);

    try {
      const res = await apiService.uploadDocument(
        file,
        targetSessionId,
        currentUser?.id,
        isTemporaryChat,
      );
      if (
        authVersion !== authVersionRef.current ||
        !conversationStore.live(conversation)
      )
        return;
      setPendingDocumentIds((prev) => [...prev, res.document.document_id]);
      // Update local document state
      setDocuments((prev) => {
        const exists = prev.some(
          (d) => d.document_id === res.document.document_id,
        );
        return exists ? prev : [res.document, ...prev];
      });
    } catch (e: unknown) {
      if (
        authVersion !== authVersionRef.current ||
        !conversationStore.live(conversation)
      )
        return;
      const err = e instanceof Error ? e.message : String(e);
      setOperationError(`Upload failed: ${err}`);
      if (conversationStore.active === conversation)
        await showAlert({ title: "Upload Failed", message: err });
    } finally {
      if (authVersion === authVersionRef.current) {
        conversation.uploads = Math.max(0, conversation.uploads - 1);
        setIsUploading(conversation.uploads > 0);
        setUploadStatusText("");
      }
    }
  };

  const handleDeleteMedia = (index: number) => {
    setAttachedMedia((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUseAsReference = (media: MediaAttachment) => {
    setAttachedMedia([media]);
    setCurrentMode("IMAGE_GENERATION");
    if (!inputQuery.trim()) {
      setInputQuery("Recreate this image with ");
    }
  };

  const handleDetachDocument = (documentId: string) => {
    setPendingDocumentIds((prev) => prev.filter((id) => id !== documentId));
  };

  // --- Clear Messages in Active Conversation (Authenticated Users Only) ---
  const handleClearMessages = async () => {
    if (
      conversation.state.isClearingHistory ||
      conversation.state.isSending ||
      conversation.state.isLoadingHistory ||
      !currentUser ||
      !activeSessionId ||
      (messages.length === 0 && !streamingMessage)
    )
      return;
    const sessionId = activeSessionId;
    const authVersion = authVersionRef.current;
    const confirmed = await confirm({
      type: "default",
      title: "Clear conversation?",
      message:
        "Clear all messages in this conversation? Attached documents will remain available.",
      confirmText: "Clear",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (
      !confirmed ||
      conversation.state.isSending ||
      conversation.state.isClearingHistory ||
      authVersion !== authVersionRef.current ||
      sessionId !== activeSessionIdRef.current
    ) {
      return;
    }

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
    } catch (e: unknown) {
      if (
        authVersion !== authVersionRef.current ||
        sessionId !== activeSessionIdRef.current
      ) {
        return;
      }
      const err = e instanceof Error ? e.message : String(e);
      await showAlert({
        title: "Clear Failed",
        message: `Failed to clear messages: ${err}`,
      });
    } finally {
      conversationStore.patch(conversation, { isClearingHistory: false });
    }
  };

  // Stop generating response (like ChatGPT)
  const handleStopGeneration = () => {
    conversation.cancel?.();
    conversation.cancel = null;
    if (conversation.preparing) {
      conversation.preparing = false;
      const unsent =
        conversation.state.messages[conversation.state.messages.length - 1];
      if (unsent?.role === "user") {
        setInputQuery(unsent.content);
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
          id: partial.id || `stopped-${Date.now()}`,
          session_id: conversation.sessionId || "",
          role: "assistant",
          content: partial.content,
          citations: partial.citations,
          attachments: partial.attachments,
          created_at: partial.created_at || new Date().toISOString(),
        },
      ]);
    }
    setStreamingMessage(null);
    setIsSending(false);
  };

  useEffect(() => () => conversationStore.cancelAll(), [conversationStore]);

  // --- 8. Send Chat Message & SSE Stream ---
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const authVersion = authVersionRef.current;
    if (conversationStore.active !== conversation) return;

    if (!isAuthReady) return;
    const query =
      inputQuery.trim() ||
      (pendingDocumentIds.length > 0 ? "Review the attached documents." : "");
    if (
      (!query &&
        attachedMedia.length === 0 &&
        pendingDocumentIds.length === 0) ||
      conversation.state.isSending ||
      conversation.state.isClearingHistory ||
      conversation.state.isLoadingHistory ||
      conversation.state.isUploading
    )
      return;

    setIsSending(true);
    const abortController = new AbortController();
    conversation.cancel = () => abortController.abort();

    // Capture media to send & reset input
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
    const replyToPayload = replyingTo;
    setInputQuery("");
    setAttachedMedia([]);
    setReplyingTo(null);

    const userToUse = currentUserRef.current || currentUser;

    const needsCreation = !conversation.sessionId;
    const targetSessionId = conversation.sessionId || generateGuestSessionId();
    conversationStore.adopt(conversation, targetSessionId);
    conversation.preparing = needsCreation;
    if (conversationStore.active === conversation) {
      activeSessionIdRef.current = targetSessionId;
      updateUrlForSession(targetSessionId, !userToUse);
      if (userToUse && !isTemporaryChat)
        localStorage.setItem("contexify_active_session", targetSessionId);
    }

    // Append optimistic user message with attachments
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      session_id: targetSessionId,
      role: "user",
      content:
        query || (mediaToSend.length > 0 ? "Analyze attached media" : ""),
      reply_to: replyToPayload,
      attachments: mediaToSend.length > 0 ? mediaToSend : null,
      created_at: new Date().toISOString(),
    };
    let userMessageId = userMsg.id;
    let assistantMessageId = `asst-${Date.now()}`;
    let assistantCreatedAt = new Date().toISOString();
    setMessages((prev) => [...prev, userMsg]);

    // Setup streaming placeholder
    let finalized = false;
    let accumulatedText = "";
    let receivedCitations: Citation[] | null = null;
    let receivedMedia: MediaAttachment[] = [];

    setStreamingMessage({
      role: "assistant",
      content: "",
      citations: null,
      attachments: null,
      isStreaming: true,
      isError: false,
    });

    if (needsCreation && userToUse?.id) {
      try {
        const created = await apiService.createSession(
          userToUse.id,
          "New Conversation",
          currentMode,
          isTemporaryChat,
          targetSessionId,
        );
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(conversation) ||
          abortController.signal.aborted
        )
          return;
        if (!isTemporaryChat) prependSession(created);
      } catch (error) {
        if (
          authVersion !== authVersionRef.current ||
          !conversationStore.live(conversation) ||
          abortController.signal.aborted
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
      abortController.signal.aborted
    )
      return;

    await apiService.streamChat(
      targetSessionId,
      query,
      currentMode,
      {
        onMessage: (saved) => {
          if (
            finalized ||
            abortController.signal.aborted ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation) ||
            saved.session_id !== targetSessionId
          )
            return;
          const previousId =
            saved.role === "user" ? userMessageId : assistantMessageId;
          if (saved.id === previousId) return;
          if (saved.role === "user") userMessageId = saved.id;
          else {
            assistantMessageId = saved.id;
            assistantCreatedAt = saved.created_at;
            setStreamingMessage((previous) =>
              previous
                ? { ...previous, id: saved.id, created_at: saved.created_at }
                : previous,
            );
          }
          setMessages((previous) =>
            previous.map((message) => {
              if (message.id === previousId)
                return {
                  ...message,
                  id: saved.id,
                  created_at: saved.created_at,
                };
              if (message.reply_to?.id === previousId)
                return {
                  ...message,
                  reply_to: { ...message.reply_to, id: saved.id },
                };
              return message;
            }),
          );
          setReplyingTo((previous) =>
            previous?.id === previousId
              ? { ...previous, id: saved.id }
              : previous,
          );
        },
        onCitations: (citations) => {
          if (
            finalized ||
            abortController.signal.aborted ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          receivedCitations = citations;
          setStreamingMessage((prev) =>
            prev
              ? {
                  ...prev,
                  citations,
                }
              : null,
          );
        },
        onMedia: (media) => {
          if (
            finalized ||
            abortController.signal.aborted ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          receivedMedia = [...receivedMedia, media];
          setStreamingMessage((prev) =>
            prev
              ? {
                  ...prev,
                  attachments: receivedMedia,
                }
              : null,
          );
        },
        onToken: (token) => {
          if (
            finalized ||
            abortController.signal.aborted ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          accumulatedText += token;
          setStreamingMessage((prev) =>
            prev
              ? {
                  ...prev,
                  content: accumulatedText,
                  citations: receivedCitations,
                  attachments: receivedMedia.length > 0 ? receivedMedia : null,
                  isStreaming: true,
                }
              : null,
          );
        },
        onError: (errMsg) => {
          if (
            finalized ||
            abortController.signal.aborted ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          finalized = true;
          conversation.cancel = null;
          conversation.preserveHistory = true;
          setMessages((previous) => [
            ...previous,
            {
              id: assistantMessageId,
              session_id: targetSessionId,
              role: "assistant",
              content: [accumulatedText, `Response interrupted: ${errMsg}`]
                .filter(Boolean)
                .join("\n\n"),
              citations: receivedCitations,
              attachments: receivedMedia.length ? receivedMedia : null,
              created_at: assistantCreatedAt,
            },
          ]);
          setStreamingMessage(null);
          setIsSending(false);
        },
        onDone: async () => {
          if (
            finalized ||
            abortController.signal.aborted ||
            authVersion !== authVersionRef.current ||
            !conversationStore.live(conversation)
          )
            return;
          finalized = true;
          conversation.cancel = null;
          setIsSending(false);

          conversation.preserveHistory ||= !userToUse;
          const finishedAssistantMsg: Message = {
            id: assistantMessageId,
            session_id: targetSessionId,
            role: "assistant",
            content: accumulatedText,
            citations: receivedCitations,
            attachments: receivedMedia.length > 0 ? receivedMedia : null,
            created_at: assistantCreatedAt,
          };

          // Append to state
          setMessages((prev) => [...prev, finishedAssistantMsg]);
          setStreamingMessage(null);

          // If logged-in user, refresh active session title if it was generated
          if (currentUser?.id && targetSessionId) {
            try {
              const hist = await apiService.getSessionHistory(targetSessionId);
              if (
                authVersion === authVersionRef.current &&
                conversationStore.live(conversation) &&
                hist?.session?.title
              ) {
                updateSessionTitle(targetSessionId, hist.session.title);
              }
            } catch (err) {
              console.error("Failed to sync session title:", err);
            }
          }
        },
      },
      abortController.signal,
      mediaToSend,
      userToUse?.id,
      replyToPayload,
      isTemporaryChat,
    );
  };

  // Quick Prompt click
  const handleSelectPrompt = (promptText: string) => {
    setInputQuery(promptText);
  };

  // --- 9. User Authentication & Guest Handlers ---
  const resetConversationForAuthChange = () => {
    authVersionRef.current++;
    setClearedChats({});
    conversationStore.reset();
    setIsSending(false);
    setIsUploading(false);
    setUploadStatusText("");
    setStreamingMessage(null);
    setMessages([]);
    setDocuments([]);
    setPendingDocumentIds([]);
    setAttachedMedia([]);
    setReplyingTo(null);
    setInputQuery("");
    setIsTemporaryChat(false);
    setActiveSessionId(null);
  };

  const handleLogin = async (usernameOrEmail: string, password: string) => {
    const user = await apiService.login(usernameOrEmail, password);
    resetConversationForAuthChange();
    currentUserRef.current = user;
    setCurrentUser(user);
    localStorage.setItem("contexify_user", JSON.stringify(user));
    setIsUserModalOpen(false);
    setActiveSessionId(null);
    await loadSessions(user.id);
  };

  const handleLoginWithOtp = async (usernameOrEmail: string, otp: string) => {
    const user = await apiService.loginWithOtp(usernameOrEmail, otp);
    resetConversationForAuthChange();
    currentUserRef.current = user;
    setCurrentUser(user);
    localStorage.setItem("contexify_user", JSON.stringify(user));
    setIsUserModalOpen(false);
    setActiveSessionId(null);
    await loadSessions(user.id);
  };

  const handleGoogleAuth = async (data: GoogleAuthRequest) => {
    const user = await apiService.loginWithGoogle(data);
    resetConversationForAuthChange();
    currentUserRef.current = user;
    setCurrentUser(user);
    localStorage.setItem("contexify_user", JSON.stringify(user));
    setIsUserModalOpen(false);
    setActiveSessionId(null);
    await loadSessions(user.id);
  };

  const handleSendOtp = async (usernameOrEmail: string) => {
    return await apiService.sendLoginOtp(usernameOrEmail);
  };

  const handleSendPasswordResetOtp = async (usernameOrEmail: string) => {
    return await apiService.sendPasswordResetOtp(usernameOrEmail);
  };

  const handleResetPasswordWithOtp = async (
    usernameOrEmail: string,
    otp: string,
    newPassword: string,
  ) => {
    return await apiService.resetPasswordWithOtp(
      usernameOrEmail,
      otp,
      newPassword,
    );
  };

  const handleRegister = async (
    displayName: string,
    username: string,
    email: string,
    password: string,
  ) => {
    const user = await apiService.register(
      displayName,
      username,
      email,
      password,
    );
    resetConversationForAuthChange();
    currentUserRef.current = user;
    setCurrentUser(user);
    localStorage.setItem("contexify_user", JSON.stringify(user));
    setIsUserModalOpen(false);
    setActiveSessionId(null);
    await loadSessions(user.id);
  };

  const handleUpdateProfile = async (
    displayName: string,
    avatarColor: string,
  ) => {
    if (!currentUser?.id) return;
    const updated = await apiService.updateUserProfile(
      currentUser.id,
      displayName,
      avatarColor,
    );
    currentUserRef.current = updated;
    setCurrentUser(updated);
    localStorage.setItem("contexify_user", JSON.stringify(updated));
  };

  const handleChangePassword = async (
    oldPassword: string,
    newPassword: string,
  ) => {
    if (!currentUser?.id) return;
    await apiService.changePassword(currentUser.id, oldPassword, newPassword);
  };

  const handleUploadAvatar = async (file: File) => {
    if (!currentUser?.id) return;
    const updated = await apiService.uploadAvatar(currentUser.id, file);
    currentUserRef.current = updated;
    setCurrentUser(updated);
    localStorage.setItem("contexify_user", JSON.stringify(updated));
  };

  const handleDeleteAvatar = async () => {
    if (!currentUser?.id) return;
    const updated = await apiService.deleteAvatar(currentUser.id);
    currentUserRef.current = updated;
    setCurrentUser(updated);
    localStorage.setItem("contexify_user", JSON.stringify(updated));
  };

  const handleLogout = () => {
    resetConversationForAuthChange();
    void apiService.logout();
    localStorage.removeItem("contexify_user");
    localStorage.removeItem("contexify_active_session");
    currentUserRef.current = null;
    setCurrentUser(null);
    setActiveSessionId(generateGuestSessionId());
    updateUrlForSession(null);
    setIsUserModalOpen(false);
    setMode("light");
  };

  useEffect(() => apiService.onSessionExpired(handleLogout), []);

  const handleContinueAsGuest = () => {
    handleLogout();
  };

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-(--bg-app) text-(--text-main) font-sans relative">
      {/* Mobile Drawer Backdrop Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden animate-[fadeIn_0.15s_ease-out]"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        isOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        onCloseMobile={() => setIsSidebarOpen(false)}
        currentUser={currentUser}
        onOpenUserModal={() => handleOpenUserModal("login")}
        onLogout={handleLogout}
        sessions={sessions}
        totalSessions={totalSessions}
        hasMore={hasMoreSessions}
        isLoadingInitial={isLoadingInitialSessions}
        isLoadingMore={isLoadingMoreSessions}
        isSearching={isSearchingSessions}
        searchQuery={sessionSearchQuery}
        onSearchChange={setSessionSearchQuery}
        sortOrder={sessionSortOrder}
        onSortChange={setSessionSortOrder}
        onTogglePinSession={togglePinSession}
        onLoadMore={loadMoreSessions}
        activeSessionId={activeSessionId}
        onSelectSession={selectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onOpenAttachmentsModal={
          currentUser ? handleOpenAttachmentsModal : undefined
        }
      />

      <ChatWorkspace
        conversationError={operationError || historyError}
        isBusy={isLoadingHistory || isClearingHistory}
        key={conversation.viewId}
        currentUser={currentUser}
        onOpenUserModal={handleOpenUserModal}
        currentMode={currentMode}
        onModeChange={handleModeChange}
        messages={messages}
        streamingMessage={streamingMessage}
        onSelectPrompt={handleSelectPrompt}
        inputQuery={inputQuery}
        setInputQuery={setInputQuery}
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        isSending={isSending}
        onFileUpload={handleFileUpload}
        isUploading={isUploading}
        uploadStatusText={uploadStatusText}
        documents={documents.filter((doc) =>
          pendingDocumentIds.includes(doc.document_id),
        )}
        onDeleteDocument={handleDetachDocument}
        attachedMedia={attachedMedia}
        onDeleteMedia={handleDeleteMedia}
        onUseAsReference={handleUseAsReference}
        onClearChat={
          isSending || isClearingHistory || isLoadingHistory
            ? undefined
            : handleClearMessages
        }
        chatClearedAt={
          activeSessionId ? clearedChats[activeSessionId] : undefined
        }
        onToggleSidebar={handleToggleSidebar}
        isTemporaryChat={Boolean(currentUser && isTemporaryChat)}
        onToggleTemporaryChat={
          currentUser ? handleToggleTemporaryChat : undefined
        }
        onOpenAttachmentsModal={
          currentUser ? handleOpenAttachmentsModal : undefined
        }
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onReply={handleReplyMessage}
      />

      <UserModal
        isOpen={isUserModalOpen}
        initialTab={userModalTab}
        onClose={() => setIsUserModalOpen(false)}
        currentUser={currentUser}
        onLogin={handleLogin}
        onLoginWithOtp={handleLoginWithOtp}
        onGoogleAuth={handleGoogleAuth}
        onSendOtp={handleSendOtp}
        onSendPasswordResetOtp={handleSendPasswordResetOtp}
        onResetPasswordWithOtp={handleResetPasswordWithOtp}
        onRegister={handleRegister}
        onLogout={handleLogout}
        onContinueAsGuest={handleContinueAsGuest}
        onUpdateProfile={handleUpdateProfile}
        onChangePassword={handleChangePassword}
        onUploadAvatar={handleUploadAvatar}
        onDeleteAvatar={handleDeleteAvatar}
      />

      <AttachmentsModal
        isOpen={isAttachmentsModalOpen}
        onClose={() => setIsAttachmentsModalOpen(false)}
        currentUser={currentUser}
        activeSessionId={activeSessionId}
        activeSessionTitle={
          sessions.find((s) => s.id === activeSessionId)?.title || undefined
        }
        onAttachMedia={handleAttachMediaFromModal}
        onAttachDocument={handleAttachDocumentFromModal}
        onAssetDeleted={handleAssetDeletedFromModal}
      />
    </div>
  );
};

export default App;
