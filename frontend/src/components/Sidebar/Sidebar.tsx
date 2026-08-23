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
    <aside
      className={`h-screen bg-gray-900 border-r border-white/10 flex flex-col gap-3 shrink-0 overflow-y-auto overflow-x-hidden transition-all duration-200 ${
        isOpen ? 'w-[290px] p-3.5' : 'w-[68px] p-2.5 items-center'
      }`}
    >
      {/* Brand & Toggle Sidebar Button */}
      <div
        className={`flex items-center pb-2.5 border-b border-white/10 w-full ${
          isOpen ? 'justify-between gap-2' : 'justify-center'
        }`}
      >
        {isOpen && (
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0">
              <LuBrain size={20} />
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="text-sm font-bold text-gray-100 truncate">Contexify AI</h1>
              <span className="text-[11px] text-gray-400 truncate">Enterprise RAG & Search</span>
            </div>
          </div>
        )}

        <button
          type="button"
          className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 border border-white/10 flex items-center justify-center transition-all cursor-pointer shrink-0"
          onClick={onToggleSidebar}
          title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isOpen ? <GoSidebarCollapse size={18} /> : <GoSidebarExpand size={18} />}
        </button>
      </div>

      {/* New Conversation Button (Logged-in users only) */}
      {currentUser && (
        <div className="w-full flex justify-center">
          <button
            type="button"
            className={`w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-lg shadow-sm shadow-blue-500/20 transition-all cursor-pointer ${
              isOpen ? 'py-2.5 px-4 text-xs' : 'w-10 h-10 p-0 text-sm'
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
