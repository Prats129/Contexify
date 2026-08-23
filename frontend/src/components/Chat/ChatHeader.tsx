import React from 'react';
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
  isSidebarOpen,
  onToggleSidebar,
  currentUser,
  onOpenUserModal,
}) => {
  const isWeb = currentMode === 'WEB_SEARCH';

  return (
    <header className="workspace-header">
      <div className="header-left">
        <button
          type="button"
          className="btn-toggle-sidebar-header"
          onClick={onToggleSidebar}
          title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <i className={`fa-solid ${isSidebarOpen ? 'fa-bars-staggered' : 'fa-bars'}`}></i>
        </button>

        <div className="header-mode-indicator">
          <span className={`mode-badge ${isWeb ? 'WEB' : 'RAG'}`}>
            <i className={`fa-solid ${isWeb ? 'fa-globe' : 'fa-shield-halved'}`}></i>{' '}
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
              <i className="fa-solid fa-right-to-bracket"></i> Log in
            </button>
            <button
              type="button"
              className="btn-header-signup"
              onClick={() => onOpenUserModal('register')}
            >
              <i className="fa-solid fa-user-plus"></i> Sign up
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
            <i className="fa-solid fa-plus"></i> New Chat
          </button>
        )}
      </div>
    </header>
  );
};
