import React from 'react';
import { UserProfileCard } from './UserProfileCard';
import { SessionHistory } from './SessionHistory';
import { ModeSelector } from './ModeSelector';
import { DocumentDropzone } from './DocumentDropzone';
import { DocumentList } from './DocumentList';
import type { User, ChatSession, ChatMode, DocumentMetadata } from '../../types';

interface SidebarProps {
  currentUser: User | null;
  onOpenUserModal: () => void;
  onLogout: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  documents: DocumentMetadata[];
  onFileUpload: (file: File) => void;
  onDeleteDocument: (documentId: string) => void;
  isUploading: boolean;
  uploadStatusText?: string;
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
  currentMode,
  onModeChange,
  documents,
  onFileUpload,
  onDeleteDocument,
  isUploading,
  uploadStatusText,
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

      {/* Engine Mode */}
      <ModeSelector
        currentMode={currentMode}
        onModeChange={onModeChange}
      />

      {/* Document Upload & List */}
      <DocumentDropzone
        onFileUpload={onFileUpload}
        isUploading={isUploading}
        uploadStatusText={uploadStatusText}
      />

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
