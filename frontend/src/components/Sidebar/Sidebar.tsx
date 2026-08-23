import React from 'react';
import { UserProfileCard } from './UserProfileCard';
import { SessionHistory } from './SessionHistory';
import { DocumentList } from './DocumentList';
import type { User, ChatSession, DocumentMetadata } from '../../types';

interface SidebarProps {
  isOpen: boolean;
  onToggleSidebar: () => void;
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
  isOpen,
  onToggleSidebar,
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
    <aside className={`sidebar ${!isOpen ? 'collapsed' : ''}`}>
      {/* Brand & Collapse / Expand Button */}
      <div className="sidebar-header">
        <div
          className="brand"
          onClick={!isOpen ? onToggleSidebar : undefined}
          style={{ cursor: !isOpen ? 'pointer' : 'default' }}
          title={!isOpen ? 'Contexify AI - Click to expand' : undefined}
        >
          <div className="brand-icon">
            <i className="fa-solid fa-brain"></i>
          </div>
          <div className="brand-text">
            <h1>Contexify AI</h1>
            <span>Enterprise RAG & Search</span>
          </div>
        </div>
        <button
          type="button"
          className="btn-toggle-sidebar"
          onClick={onToggleSidebar}
          title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <i className={`fa-solid ${isOpen ? 'fa-angles-left' : 'fa-angles-right'}`}></i>
        </button>
      </div>

      {/* New Conversation Button (Logged-in users only) */}
      {currentUser && (
        <div className="new-chat-wrapper">
          <button
            type="button"
            className="btn-new-conversation"
            onClick={onNewSession}
            title="New Conversation"
          >
            <i className="fa-solid fa-plus"></i>
            <span>New Conversation</span>
          </button>
        </div>
      )}

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

      {/* Bottom Section: Logged in User Profile Card */}
      {currentUser && (
        <div className="sidebar-bottom">
          <UserProfileCard
            currentUser={currentUser}
            onOpenModal={onOpenUserModal}
            onLogout={onLogout}
          />
        </div>
      )}
    </aside>
  );
};
