import React from 'react';
import type { ChatMode } from '../../types';

interface ChatHeaderProps {
  currentMode: ChatMode;
  sessionId: string | null;
  onNewSession: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentMode,
  sessionId,
  onNewSession,
}) => {
  const isWeb = currentMode === 'WEB_SEARCH';

  return (
    <header className="workspace-header">
      <div className="header-mode-indicator">
        <span className={`mode-badge ${isWeb ? 'WEB' : 'RAG'}`}>
          <i className={`fa-solid ${isWeb ? 'fa-globe' : 'fa-shield-halved'}`}></i>{' '}
          {isWeb ? 'Live Web Search' : 'Document Grounded RAG'}
        </span>
        <span className="session-tag">
          Session: <code>{sessionId ? sessionId.substring(0, 8) : '...'}</code>
        </span>
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="action-btn"
          onClick={onNewSession}
          title="Start New Session"
        >
          <i className="fa-solid fa-plus"></i> New Chat
        </button>
      </div>
    </header>
  );
};
