import React from 'react';
import {
  LuGlobe,
  LuShieldCheck,
  LuLogIn,
  LuUserPlus,
  LuPlus,
} from 'react-icons/lu';
import type { ChatMode, User } from '../../types';

interface ChatHeaderProps {
  currentMode: ChatMode;
  sessionId: string | null;
  onNewSession: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  currentUser: User | null;
  onOpenUserModal: (tab?: 'login' | 'register') => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentMode,
  sessionId,
  onNewSession,
  currentUser,
  onOpenUserModal,
}) => {
  const isWeb = currentMode === 'WEB_SEARCH';

  return (
    <header className="workspace-header">
      <div className="header-left">
        <div className="header-mode-indicator">
          <span className={`mode-badge ${isWeb ? 'WEB' : 'RAG'}`}>
            {isWeb ? <LuGlobe size={15} /> : <LuShieldCheck size={15} />}
            {isWeb ? 'Live Web Search' : 'Document Grounded RAG'}
          </span>
          <span className="session-tag">
            Session: <code>{sessionId ? sessionId.substring(0, 8) : '...'}</code>
          </span>
        </div>
      </div>

      <div className="header-actions">
        {/* If user is a Guest, show Log In and Sign Up buttons at top right of chat header */}
        {!currentUser && (
          <div className="header-auth-buttons">
            <button
              type="button"
              className="btn-header-login"
              onClick={() => onOpenUserModal('login')}
            >
              <LuLogIn size={15} /> Log in
            </button>
            <button
              type="button"
              className="btn-header-signup"
              onClick={() => onOpenUserModal('register')}
            >
              <LuUserPlus size={15} /> Sign up
            </button>
          </div>
        )}

        {/* New Chat Button (Logged-in users only) */}
        {currentUser && (
          <button
            type="button"
            className="action-btn"
            onClick={onNewSession}
            title="Start New Session"
          >
            <LuPlus size={15} /> New Chat
          </button>
        )}
      </div>
    </header>
  );
};
