import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from './services/api';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatWorkspace } from './components/Chat/ChatWorkspace';
import { UserModal } from './components/Modals/UserModal';
import type {
  User,
  ChatSession,
  ChatMode,
  DocumentMetadata,
  Message,
  StreamingMessageState,
  Citation,
  GoogleAuthRequest,
} from './types';
import './styles/main.css';

function generateGuestSessionId(): string {
  return crypto.randomUUID();
}

interface UrlRouteInfo {
  sessionId: string | null;
  isUnauthenticated: boolean;
}

function getUrlRouteInfo(): UrlRouteInfo {
  const path = window.location.pathname;
  // Authenticated chat: /c/:id
  const authMatch = path.match(/^\/c\/([^/]+)/);
  if (authMatch && authMatch[1]) {
    return { sessionId: decodeURIComponent(authMatch[1]), isUnauthenticated: false };
  }
  // Unauthenticated guest temp chat: /uc/:id
  const guestMatch = path.match(/^\/uc\/([^/]+)/);
  if (guestMatch && guestMatch[1]) {
    return { sessionId: decodeURIComponent(guestMatch[1]), isUnauthenticated: true };
  }
  // Query parameters fallback
  const params = new URLSearchParams(window.location.search);
  const ucParam = params.get('uc');
  if (ucParam) {
    return { sessionId: ucParam, isUnauthenticated: true };
  }
  const cParam = params.get('c');
  if (cParam) {
    return { sessionId: cParam, isUnauthenticated: false };
  }
  return { sessionId: null, isUnauthenticated: false };
}

function updateUrlForSession(sessionId: string | null, isUnauthenticated: boolean = false) {
  if (sessionId) {
    const prefix = isUnauthenticated ? '/uc' : '/c';
    const targetPath = `${prefix}/${encodeURIComponent(sessionId)}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ sessionId, isUnauthenticated }, '', targetPath);
    }
  } else {
    if (window.location.pathname !== '/' && window.location.pathname !== '') {
      window.history.pushState({}, '', '/');
    }
  }
}

export const App: React.FC = () => {
  // --- Global State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<ChatMode>('WEB_SEARCH');
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // --- Interaction States ---
  const [inputQuery, setInputQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingMessage, setStreamingMessage] =
    useState<StreamingMessageState | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userModalTab, setUserModalTab] = useState<'login' | 'register'>('login');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('contexify_sidebar_open');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const handleOpenUserModal = (tab: 'login' | 'register' = 'login') => {
    setUserModalTab(tab);
    setIsUserModalOpen(true);
  };

  const handleToggleSidebar = () => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('contexify_sidebar_open', JSON.stringify(next));
      return next;
    });
  };

  // --- 1. Select / Switch Active Session ---
  const selectSession = useCallback(
    async (sessionId: string, pushUrl: boolean = true, isUnauthenticated: boolean = false) => {
      if (!sessionId) return;
      setActiveSessionId(sessionId);
      setStreamingMessage(null);

      if (currentUser?.id && !isUnauthenticated) {
        localStorage.setItem('contexify_active_session', sessionId);
        if (pushUrl) {
          updateUrlForSession(sessionId, false);
        }
        try {
          const history = await apiService.getSessionHistory(sessionId);
          if (history.session?.mode) {
            setCurrentMode(history.session.mode);
          }
          setDocuments(history.documents || []);
          setMessages(history.messages || []);
        } catch (e) {
          console.error('Failed to load session history:', e);
        }
      } else {
        if (pushUrl) {
          updateUrlForSession(sessionId, true);
        }
      }
    },
    [currentUser]
  );

  // --- 2. User Initialization (Guest vs Logged In) ---
  useEffect(() => {
    initUser();
  }, []);

  const initUser = async () => {
    try {
      const savedUserStr = localStorage.getItem('contexify_user');
      let user: User | null = null;
      if (savedUserStr) {
        const parsed = JSON.parse(savedUserStr);
        user = await apiService.getCurrentUser(parsed.id).catch(() => null);
      }

      if (user) {
        // Logged-in user found
        setCurrentUser(user);
        localStorage.setItem('contexify_user', JSON.stringify(user));
      } else {
        // Ephemeral Guest Mode (No DB Save)
        setCurrentUser(null);
        localStorage.removeItem('contexify_user');
        localStorage.removeItem('contexify_active_session');
        setSessions([]);
        setMessages([]);
        setDocuments([]);
        
        const { sessionId: urlSessionId, isUnauthenticated } = getUrlRouteInfo();
        if (urlSessionId) {
          if (isUnauthenticated) {
            // Guest active temp chat from URL
            setActiveSessionId(urlSessionId);
          } else {
            // User attempting to open private /c/:id without session
            setIsUserModalOpen(true);
            setUserModalTab('login');
          }
        } else {
          setActiveSessionId(null);
          updateUrlForSession(null);
        }
      }
    } catch (e) {
      console.error('Failed to initialize user:', e);
      setCurrentUser(null);
      setActiveSessionId(null);
    }
  };

  // --- 3. Load Sessions when Logged In ---
  const loadSessions = useCallback(async (userId: string) => {
    try {
      const sessionList = await apiService.listSessions(userId);
      setSessions(sessionList || []);

      const { sessionId: urlSessionId, isUnauthenticated } = getUrlRouteInfo();

      // If URL explicitly specifies a session ID (/c/:id or ?c=:id), select it
      if (urlSessionId && !isUnauthenticated) {
        const matchingUrlSession = sessionList.find((s) => s.id === urlSessionId);
        if (matchingUrlSession) {
          await selectSession(matchingUrlSession.id, false, false);
          return;
        }
        // If not directly in list, attempt to fetch history directly (e.g. valid session)
        try {
          const hist = await apiService.getSessionHistory(urlSessionId);
          if (hist.session) {
            setSessions((prev) => [hist.session, ...prev.filter(s => s.id !== hist.session.id)]);
            await selectSession(hist.session.id, false, false);
            return;
          }
        } catch {
          // If session doesn't exist, ignore and fallback to root new chat
        }
      }

      // If on root '/', start on clean new chat (no ID in URL)
      setActiveSessionId(null);
      setMessages([]);
      setDocuments([]);
      updateUrlForSession(null);
    } catch (e) {
      console.error('Failed to load user sessions:', e);
    }
  }, [selectSession]);

  useEffect(() => {
    if (currentUser?.id) {
      loadSessions(currentUser.id);
    }
  }, [currentUser, loadSessions]);

  // --- 4. Listen to Browser Back / Forward History Navigation ---
  useEffect(() => {
    const handlePopState = () => {
      const { sessionId: targetSessionId, isUnauthenticated } = getUrlRouteInfo();
      if (targetSessionId) {
        if (currentUser?.id && !isUnauthenticated) {
          selectSession(targetSessionId, false, false);
        } else if (isUnauthenticated) {
          setActiveSessionId(targetSessionId);
        }
      } else {
        // Navigated back to root '/'
        setActiveSessionId(null);
        setMessages([]);
        setDocuments([]);
        setStreamingMessage(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentUser, sessions, selectSession]);

  // --- 5. Start New Chat / Conversation ---
  const handleNewSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setDocuments([]);
    setStreamingMessage(null);
    setInputQuery('');
    updateUrlForSession(null);
    localStorage.removeItem('contexify_active_session');
  };

  // --- 5. Delete Session ---
  const handleDeleteSession = async (sessionId: string) => {
    if (!currentUser?.id) return;
    if (
      !window.confirm('Are you sure you want to delete this conversation thread?')
    ) {
      return;
    }
    try {
      await apiService.deleteSession(sessionId);
      const updated = sessions.filter((s) => s.id !== sessionId);
      setSessions(updated);

      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
        setDocuments([]);
        setStreamingMessage(null);
        updateUrlForSession(null);
        localStorage.removeItem('contexify_active_session');
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      alert(`Failed to delete session: ${err}`);
    }
  };

  // --- 6. Mode Switch ---
  const handleModeChange = async (mode: ChatMode) => {
    setCurrentMode(mode);
    if (activeSessionId && currentUser?.id) {
      try {
        await apiService.updateSessionMode(activeSessionId, mode);
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSessionId ? { ...s, mode } : s))
        );
      } catch (err) {
        console.error('Failed to persist session mode switch:', err);
      }
    }
  };

  // --- 7. Document Upload & Delete ---
  const handleFileUpload = async (file: File) => {
    let targetSessionId = activeSessionId;
    if (!targetSessionId) {
      if (currentUser?.id) {
        try {
          const newSess = await apiService.createSession(
            currentUser.id,
            'New Conversation',
            currentMode
          );
          targetSessionId = newSess.id;
          setActiveSessionId(newSess.id);
          setSessions((prev) => [newSess, ...prev]);
          updateUrlForSession(newSess.id, false);
          localStorage.setItem('contexify_active_session', newSess.id);
        } catch (err) {
          console.error('Failed to create session on file upload:', err);
          return;
        }
      } else {
        targetSessionId = generateGuestSessionId();
        setActiveSessionId(targetSessionId);
        updateUrlForSession(targetSessionId, true);
      }
    }

    setIsUploading(true);
    setUploadStatusText(`Vectorizing '${file.name}'...`);

    try {
      const res = await apiService.uploadDocument(file, targetSessionId, currentUser?.id);
      // Update local document state
      setDocuments((prev) => {
        const exists = prev.some(
          (d) => d.document_id === res.document.document_id
        );
        return exists ? prev : [res.document, ...prev];
      });
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      alert(`Upload failed: ${err}`);
    } finally {
      setIsUploading(false);
      setUploadStatusText('');
    }
  };


  const handleDeleteDocument = async (documentId: string) => {
    if (!activeSessionId) return;
    if (
      !window.confirm(
        'Are you sure you want to remove this document and purge its vectors?'
      )
    ) {
      return;
    }
    try {
      await apiService.deleteDocument(documentId, activeSessionId);
      setDocuments((prev) => prev.filter((d) => d.document_id !== documentId));
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      alert(`Deletion failed: ${err}`);
    }
  };

  // --- Clear Messages in Active Conversation (Authenticated Users Only) ---
  const handleClearMessages = async () => {
    if (!currentUser || !activeSessionId || (messages.length === 0 && !streamingMessage)) return;
    if (!window.confirm('Clear all messages in this conversation? Attached documents and vectors will remain intact.')) {
      return;
    }
    try {
      await apiService.clearSessionMessages(activeSessionId);
      setMessages([]);
      setStreamingMessage(null);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      alert(`Failed to clear messages: ${err}`);
    }
  };


  // --- 8. Send Chat Message & SSE Stream ---
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputQuery.trim();
    if (!query || isSending) return;

    let targetSessionId = activeSessionId;
    if (!targetSessionId) {
      if (currentUser?.id) {
        try {
          const newSess = await apiService.createSession(
            currentUser.id,
            'New Conversation',
            currentMode
          );
          targetSessionId = newSess.id;
          setActiveSessionId(newSess.id);
          setSessions((prev) => [newSess, ...prev]);
          updateUrlForSession(newSess.id, false);
          localStorage.setItem('contexify_active_session', newSess.id);
        } catch (err) {
          console.error('Failed to create session on message send:', err);
          return;
        }
      } else {
        targetSessionId = generateGuestSessionId();
        setActiveSessionId(targetSessionId);
        updateUrlForSession(targetSessionId, true);
      }
    }

    // Reset input
    setInputQuery('');
    setIsSending(true);

    // Append optimistic user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      session_id: targetSessionId,
      role: 'user',
      content: query,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Setup streaming placeholder
    let accumulatedText = '';
    let receivedCitations: Citation[] | null = null;

    setStreamingMessage({
      role: 'assistant',
      content: '',
      citations: null,
      isStreaming: true,
      isError: false,
    });

    await apiService.streamChat(targetSessionId, query, currentMode, {
      onCitations: (citations) => {
        receivedCitations = citations;
        setStreamingMessage((prev) =>
          prev
            ? {
              ...prev,
              citations,
            }
            : null
        );
      },
      onToken: (token) => {
        accumulatedText += token;
        setStreamingMessage((prev) =>
          prev
            ? {
              ...prev,
              content: accumulatedText,
              citations: receivedCitations,
              isStreaming: true,
            }
            : null
        );
      },
      onError: (errMsg) => {
        setStreamingMessage({
          role: 'assistant',
          content: `Error: ${errMsg}`,
          citations: null,
          isStreaming: false,
          isError: true,
        });
        setIsSending(false);
      },
      onDone: async () => {
        setIsSending(false);
        const finishedAssistantMsg: Message = {
          id: `asst-${Date.now()}`,
          session_id: targetSessionId,
          role: 'assistant',
          content: accumulatedText,
          citations: receivedCitations,
          created_at: new Date().toISOString(),
        };

        // Append to state
        setMessages((prev) => [...prev, finishedAssistantMsg]);
        setStreamingMessage(null);

        // If logged-in user, refresh sessions list for auto-generated title
        if (currentUser?.id) {
          try {
            const freshSessions = await apiService.listSessions(
              currentUser.id
            );
            setSessions(freshSessions || []);
          } catch (err) {
            console.error('Failed to sync sessions list:', err);
          }
        }
      },
    });
  };

  // Quick Prompt click
  const handleSelectPrompt = (promptText: string) => {
    setInputQuery(promptText);
  };

  // --- 9. User Authentication & Guest Handlers ---
  const handleLogin = async (usernameOrEmail: string, password: string) => {
    const user = await apiService.login(usernameOrEmail, password);
    setCurrentUser(user);
    localStorage.setItem('contexify_user', JSON.stringify(user));
    setIsUserModalOpen(false);
    setActiveSessionId(null);
    await loadSessions(user.id);
  };

  const handleLoginWithOtp = async (usernameOrEmail: string, otp: string) => {
    const user = await apiService.loginWithOtp(usernameOrEmail, otp);
    setCurrentUser(user);
    localStorage.setItem('contexify_user', JSON.stringify(user));
    setIsUserModalOpen(false);
    setActiveSessionId(null);
    await loadSessions(user.id);
  };

  const handleGoogleAuth = async (data: GoogleAuthRequest) => {
    const user = await apiService.loginWithGoogle(data);
    setCurrentUser(user);
    localStorage.setItem('contexify_user', JSON.stringify(user));
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
    newPassword: string
  ) => {
    return await apiService.resetPasswordWithOtp(usernameOrEmail, otp, newPassword);
  };

  const handleRegister = async (
    displayName: string,
    username: string,
    email: string,
    password: string
  ) => {
    const user = await apiService.register(
      displayName,
      username,
      email,
      password
    );
    setCurrentUser(user);
    localStorage.setItem('contexify_user', JSON.stringify(user));
    setIsUserModalOpen(false);
    setActiveSessionId(null);
    await loadSessions(user.id);
  };

  const handleUpdateProfile = async (displayName: string, avatarColor: string) => {
    if (!currentUser?.id) return;
    const updated = await apiService.updateUserProfile(
      currentUser.id,
      displayName,
      avatarColor
    );
    setCurrentUser(updated);
    localStorage.setItem('contexify_user', JSON.stringify(updated));
  };

  const handleChangePassword = async (oldPassword: string, newPassword: string) => {
    if (!currentUser?.id) return;
    await apiService.changePassword(currentUser.id, oldPassword, newPassword);
  };

  const handleUploadAvatar = async (file: File) => {
    if (!currentUser?.id) return;
    const updated = await apiService.uploadAvatar(currentUser.id, file);
    setCurrentUser(updated);
    localStorage.setItem('contexify_user', JSON.stringify(updated));
  };

  const handleDeleteAvatar = async () => {
    if (!currentUser?.id) return;
    const updated = await apiService.deleteAvatar(currentUser.id);
    setCurrentUser(updated);
    localStorage.setItem('contexify_user', JSON.stringify(updated));
  };

  const handleLogout = () => {
    localStorage.removeItem('contexify_user');
    localStorage.removeItem('contexify_active_session');
    setCurrentUser(null);
    setSessions([]);
    setMessages([]);
    setDocuments([]);
    setActiveSessionId(generateGuestSessionId());
    setIsUserModalOpen(false);
  };

  const handleContinueAsGuest = () => {
    handleLogout();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950 text-gray-100 font-sans">
      <Sidebar
        isOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
        currentUser={currentUser}
        onOpenUserModal={() => handleOpenUserModal('login')}
        onLogout={handleLogout}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={selectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        documents={documents}
        onDeleteDocument={handleDeleteDocument}
      />

      <ChatWorkspace
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
        isSending={isSending}
        onFileUpload={handleFileUpload}
        isUploading={isUploading}
        uploadStatusText={uploadStatusText}
        documents={documents}
        onDeleteDocument={handleDeleteDocument}
        onClearChat={handleClearMessages}
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
    </div>
  );
};

export default App;


