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
} from './types';
import './styles/main.css';

function generateGuestSessionId(): string {
  return `guest-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

export const App: React.FC = () => {
  // --- Global State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<ChatMode>('DOCUMENT_RAG');
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

  // --- 1. User Initialization (Guest vs Logged In) ---
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
        const ephemeralGuestId = generateGuestSessionId();
        setActiveSessionId(ephemeralGuestId);
        setSessions([]);
        setMessages([]);
        setDocuments([]);
      }
    } catch (e) {
      console.error('Failed to initialize user:', e);
      setCurrentUser(null);
      setActiveSessionId(generateGuestSessionId());
    }
  };

  // --- 2. Load Sessions when Logged In ---
  useEffect(() => {
    if (currentUser?.id) {
      loadSessions(currentUser.id);
    }
  }, [currentUser]);

  const loadSessions = async (userId: string) => {
    try {
      const sessionList = await apiService.listSessions(userId);
      setSessions(sessionList || []);

      const savedActiveSessionId = localStorage.getItem(
        'contexify_active_session'
      );
      const matchingSession = sessionList.find(
        (s) => s.id === savedActiveSessionId
      );

      if (matchingSession) {
        selectSession(matchingSession.id);
      } else if (sessionList.length > 0) {
        selectSession(sessionList[0].id);
      } else {
        // Create initial session for logged-in user
        const newSess = await apiService.createSession(
          userId,
          'New Conversation',
          currentMode
        );
        setSessions([newSess]);
        selectSession(newSess.id);
      }
    } catch (e) {
      console.error('Failed to load user sessions:', e);
    }
  };

  // --- 3. Select / Switch Active Session ---
  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return;
      setActiveSessionId(sessionId);
      setStreamingMessage(null);

      // Only save active session in localStorage if user is logged in
      if (currentUser?.id) {
        localStorage.setItem('contexify_active_session', sessionId);
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
      }
    },
    [currentUser]
  );

  // --- 4. Create New Session ---
  const handleNewSession = async () => {
    if (!currentUser?.id) {
      setIsUserModalOpen(true);
      return;
    }
    // Persistent session for logged in user
    try {
      const newSess = await apiService.createSession(
        currentUser.id,
        'New Conversation',
        currentMode
      );
      setSessions((prev) => [newSess, ...prev]);
      await selectSession(newSess.id);
      setInputQuery('');
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      alert(`Failed to create new conversation: ${err}`);
    }
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
        if (updated.length > 0) {
          selectSession(updated[0].id);
        } else {
          const newSess = await apiService.createSession(
            currentUser.id,
            'New Conversation',
            currentMode
          );
          setSessions([newSess]);
          selectSession(newSess.id);
        }
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      alert(`Failed to delete session: ${err}`);
    }
  };

  // --- 6. Mode Switch ---
  const handleModeChange = (mode: ChatMode) => {
    setCurrentMode(mode);
  };

  // --- 7. Document Upload & Delete ---
  const handleFileUpload = async (file: File) => {
    if (!activeSessionId) return;
    setIsUploading(true);
    setUploadStatusText(`Vectorizing '${file.name}'...`);

    try {
      const res = await apiService.uploadDocument(file, activeSessionId);
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
    if (
      !window.confirm(
        'Are you sure you want to remove this document and purge its vectors?'
      )
    ) {
      return;
    }
    try {
      await apiService.deleteDocument(documentId, activeSessionId!);
      setDocuments((prev) => prev.filter((d) => d.document_id !== documentId));
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      alert(`Deletion failed: ${err}`);
    }
  };

  // --- 8. Send Chat Message & SSE Stream ---
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputQuery.trim();
    if (!query || !activeSessionId || isSending) return;

    // Reset input
    setInputQuery('');
    setIsSending(true);

    // Append optimistic user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      session_id: activeSessionId,
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

    await apiService.streamChat(activeSessionId, query, currentMode, {
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
          session_id: activeSessionId,
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
        activeSessionId={activeSessionId}
        onNewSession={handleNewSession}
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
      />

      <UserModal
        isOpen={isUserModalOpen}
        initialTab={userModalTab}
        onClose={() => setIsUserModalOpen(false)}
        currentUser={currentUser}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onLogout={handleLogout}
        onContinueAsGuest={handleContinueAsGuest}
      />
    </div>
  );
};

export default App;

