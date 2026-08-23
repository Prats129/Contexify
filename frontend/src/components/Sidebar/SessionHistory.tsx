import React from 'react';
import { LuMessageSquare, LuCloudUpload, LuGlobe, LuFileText, LuTrash2 } from 'react-icons/lu';
import { FaGoogle } from 'react-icons/fa';
import type { ChatSession, User } from '../../types';

interface SessionHistoryProps {
  currentUser: User | null;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenUserModal: () => void;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  currentUser,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onOpenUserModal,
}) => {
  const isGuest = !currentUser;

  return (
    <div className="sidebar-section history-section">
      <div className="section-header">
        <label className="section-label">
          <LuMessageSquare /> Chat History
        </label>
        <span className="session-count-badge">
          {isGuest ? 'Guest' : sessions.length}
        </span>
      </div>

      <div className="session-list">
        {isGuest ? (
          <div className="guest-history-card">
            <LuCloudUpload />
            <p className="guest-title">Browsing as Guest</p>
            <span className="guest-desc">
              Chats are temporary in this browser tab. Sign in to save and sync history.
            </span>
            <button
              type="button"
              className="btn-guest-login"
              onClick={onOpenUserModal}
            >
              <FaGoogle /> Sign In / Create Account
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="empty-sessions-placeholder">
            <LuMessageSquare />
            <p>No conversations yet.</p>
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            const isWeb = s.mode === 'WEB_SEARCH';
            return (
              <div
                key={s.id}
                className={`session-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectSession(s.id)}
                title={`${s.title} (${isWeb ? 'Web Search' : 'Document RAG'})`}
              >
                <div className="session-mini-icon">
                  {isWeb ? <LuGlobe /> : <LuMessageSquare />}
                </div>
                <div className="session-item-content">
                  <span className="session-item-title" title={s.title}>
                    {s.title}
                  </span>
                  <div className="session-item-meta">
                    <span className="session-tag-mode">
                      {isWeb ? <LuGlobe /> : <LuFileText />}{' '}
                      {isWeb ? 'Web' : 'RAG'}
                    </span>
                    <span>{s.message_count || 0} msgs</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-delete-session"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                  title="Delete Conversation"
                >
                  <LuTrash2 />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
