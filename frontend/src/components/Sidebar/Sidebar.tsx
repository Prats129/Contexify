import React from 'react';
import { LuBrain, LuPlus } from 'react-icons/lu';
import { GoSidebarCollapse, GoSidebarExpand } from 'react-icons/go';
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
            <LuBrain size={20} />
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
          {isOpen ? <GoSidebarCollapse size={18} /> : <GoSidebarExpand size={18} />}
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
            <LuPlus size={18} />
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
