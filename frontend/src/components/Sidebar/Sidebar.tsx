import React from 'react';
import { UserProfileCard } from './UserProfileCard';
import { SessionHistory } from './SessionHistory';
import { DocumentList } from './DocumentList';
import type { User, ChatSession, DocumentMetadata } from '../../types';

interface SidebarProps {
  currentUser: User | null;
  onOpenUserModal: () => void;
  onLogout: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  documents: DocumentMetadata[];
  onDeleteDocument: (documentId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  onOpenUserModal,
  onLogout,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  documents,
  onDeleteDocument,
}) => {
  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-icon">
            <i className="fa-solid fa-brain"></i>
          </div>
          <div className="brand-text">
            <h1>Contexify AI</h1>
            <span>Enterprise RAG & Search</span>
          </div>
        </div>
      </div>

      {/* User Profile Card */}
      <UserProfileCard
        currentUser={currentUser}
        onOpenModal={onOpenUserModal}
        onLogout={onLogout}
      />

      {/* New Conversation Button */}
      <div className="new-chat-wrapper">
        <button
          type="button"
          className="btn-new-conversation"
          onClick={onNewSession}
        >
          <i className="fa-solid fa-plus"></i> New Conversation
        </button>
      </div>

      {/* Conversation History */}
      <SessionHistory
        currentUser={currentUser}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
        onDeleteSession={onDeleteSession}
        onOpenUserModal={onOpenUserModal}
      />

      {/* Document List */}
      <DocumentList
        documents={documents}
        onDeleteDocument={onDeleteDocument}
      />

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="system-status">
          <span className="status-dot online"></span>
          <span className="status-text">Relational DB & Chroma Active</span>
        </div>
      </div>
    </aside>
  );
};
