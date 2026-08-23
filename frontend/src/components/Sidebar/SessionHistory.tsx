import React from 'react';
import { LuMessageSquare, LuCloudUpload, LuGlobe, LuFileText, LuTrash2 } from 'react-icons/lu';
import { FaGoogle } from 'react-icons/fa';
import type { ChatSession, User } from '../../types';

interface SessionHistoryProps {
  isOpen?: boolean;
  currentUser: User | null;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenUserModal: () => void;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  isOpen = true,
  currentUser,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onOpenUserModal,
}) => {
  const isGuest = !currentUser;

  return (
    <div className="flex flex-col gap-2 w-full">
      {isOpen && (
        <div className="flex items-center justify-between px-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-(--text-muted) flex items-center gap-1.5">
            <LuMessageSquare size={13} /> Chat History
          </label>
          <span className="text-[10px] bg-(--border-subtle) px-2 py-0.5 rounded-full text-(--text-muted)">
            {isGuest ? 'Guest' : sessions.length}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto w-full">
        {isGuest ? (
          isOpen ? (
            <div className="p-3 border border-(--border-subtle) bg-(--border-subtle)/50 rounded-xl text-center flex flex-col items-center gap-1.5">
              <LuCloudUpload size={20} className="text-primary-theme" />
              <p className="text-xs font-semibold text-(--text-main)">Browsing as Guest</p>
              <span className="text-[11px] text-(--text-muted) leading-tight">
                Chats are temporary. Sign in to save and sync history.
              </span>
              <button
                type="button"
                className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-2 bg-primary-theme hover:opacity-90 text-white rounded-lg text-xs font-medium cursor-pointer"
                onClick={onOpenUserModal}
              >
                <FaGoogle size={12} /> Sign In
              </button>
            </div>
          ) : (
            <div className="flex justify-center py-2 text-(--text-muted)" title="Guest Mode - Temporary Chats">
              <LuCloudUpload size={18} />
            </div>
          )
        ) : sessions.length === 0 ? (
          isOpen ? (
            <div className="text-center py-4 text-(--text-muted) text-xs">
              <LuMessageSquare size={18} className="mx-auto mb-1 opacity-50" />
              <p>No conversations yet.</p>
            </div>
          ) : null
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            const isWeb = s.mode === 'WEB_SEARCH';
            return (
              <div
                key={s.id}
                className={`group flex items-center justify-between p-2 rounded-lg border cursor-pointer ${
                  isOpen ? 'w-full' : 'w-10 h-10 justify-center mx-auto p-0'
                } ${
                  isActive
                    ? 'bg-primary-light-theme border-primary-theme text-primary-theme font-semibold'
                    : 'bg-transparent hover:bg-(--border-subtle) border-(--border-subtle) text-(--text-main)'
                }`}
                onClick={() => onSelectSession(s.id)}
                title={`${s.title} (${isWeb ? 'Web Search' : 'Document RAG'})`}
              >
                {!isOpen ? (
                  <div className="flex items-center justify-center">
                    {isWeb ? <LuGlobe size={16} /> : <LuMessageSquare size={16} />}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col min-w-0 overflow-hidden mr-1">
                      <span className="text-xs truncate">
                        {s.title}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-(--text-muted)">
                        <span className="bg-(--border-subtle) px-1.5 py-0.5 rounded text-[9px] flex items-center gap-1">
                          {isWeb ? <LuGlobe size={10} /> : <LuFileText size={10} />}
                          {isWeb ? 'Web' : 'RAG'}
                        </span>
                        <span>{s.message_count || 0} msgs</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-1 text-(--text-muted) hover:text-red-500 hover:bg-red-500/15 rounded cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(s.id);
                      }}
                      title="Delete Conversation"
                    >
                      <LuTrash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
