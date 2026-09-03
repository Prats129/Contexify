import React from 'react';
import { LuBrain, LuPlus } from 'react-icons/lu';
import { FiSidebar } from 'react-icons/fi';
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
    <aside
      className={`h-screen bg-(--bg-sidebar) border-r border-(--border-subtle) flex flex-col gap-3 shrink-0 overflow-y-auto overflow-x-hidden ${
        isOpen ? 'w-72 p-3.5' : 'w-16 p-2.5 items-center'
      }`}
    >
      {/* Brand & Toggle Sidebar Button */}
      <div
        className={`flex items-center pb-2.5 border-b border-(--border-subtle) w-full ${
          isOpen ? 'justify-between gap-2' : 'justify-center'
        }`}
      >
        {isOpen ? (
          <>
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-9 h-9 rounded-lg bg-primary-theme flex items-center justify-center text-white shrink-0">
                <LuBrain size={20} />
              </div>
              <div className="flex flex-col min-w-0">
                <h1 className="text-sm font-bold text-(--text-main) truncate">Contexify AI</h1>
                <span className="text-[11px] text-(--text-muted) truncate">Enterprise RAG & Search</span>
              </div>
            </div>

            <button
              type="button"
              className="w-8 h-8 rounded-lg bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-muted) hover:text-(--text-main) border border-(--border-subtle) flex items-center justify-center cursor-pointer shrink-0"
              onClick={onToggleSidebar}
              title="Collapse sidebar"
            >
              <FiSidebar size={18} />
            </button>
          </>
        ) : (
          /* Collapsed State: Shows Brand Icon normally, reveals Expand icon on hover */
          <button
            type="button"
            className="group relative w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer"
            onClick={onToggleSidebar}
            title="Expand sidebar"
          >
            <div className="w-9 h-9 rounded-lg bg-primary-theme flex items-center justify-center text-white group-hover:hidden">
              <LuBrain size={20} />
            </div>
            <div className="hidden group-hover:flex w-9 h-9 rounded-lg items-center justify-center text-(--text-main) border border-(--border-subtle) bg-(--border-hover)">
              <FiSidebar size={18} />
            </div>
          </button>
        )}
      </div>

      {/* New Conversation Button (Logged-in users only) */}
      {currentUser && (
        <div className={`${isOpen ? 'w-full' : 'w-10'} flex justify-center`}>
          <button
            type="button"
            className={`w-full flex items-center justify-center gap-2 bg-primary-theme hover:opacity-90 text-white font-semibold rounded-lg cursor-pointer ${
              isOpen ? 'py-2.5 px-3 text-xs' : 'h-10 w-10 p-0 text-sm'
            }`}
            onClick={onNewSession}
            title="New Conversation"
          >
            <LuPlus size={18} />
            {isOpen && <span>New Conversation</span>}
          </button>
        </div>
      )}

      {/* Conversation History */}
      <SessionHistory
        isOpen={isOpen}
        currentUser={currentUser}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
        onDeleteSession={onDeleteSession}
        onOpenUserModal={onOpenUserModal}
      />

      {/* Document List */}
      <DocumentList
        isOpen={isOpen}
        documents={documents}
        onDeleteDocument={onDeleteDocument}
      />

      {/* Bottom Section: Logged in User Profile Card */}
      {currentUser && (
        <div className="mt-auto pt-2 w-full">
          <UserProfileCard
            isOpen={isOpen}
            currentUser={currentUser}
            onOpenModal={onOpenUserModal}
            onLogout={onLogout}
          />
        </div>
      )}
    </aside>
  );
};
