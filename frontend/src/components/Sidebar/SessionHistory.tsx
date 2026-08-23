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
          <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
            <LuMessageSquare size={13} /> Chat History
          </label>
          <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-gray-400">
            {isGuest ? 'Guest' : sessions.length}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto w-full">
        {isGuest ? (
          isOpen ? (
            <div className="p-3 border border-white/10 bg-white/5 rounded-xl text-center flex flex-col items-center gap-1.5">
              <LuCloudUpload size={20} className="text-blue-400" />
              <p className="text-xs font-semibold text-gray-200">Browsing as Guest</p>
              <span className="text-[11px] text-gray-400 leading-tight">
                Chats are temporary. Sign in to save and sync history.
              </span>
              <button
                type="button"
                className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-all cursor-pointer"
                onClick={onOpenUserModal}
              >
                <FaGoogle size={12} /> Sign In
              </button>
            </div>
          ) : (
            <div className="flex justify-center py-2 text-gray-500" title="Guest Mode - Temporary Chats">
              <LuCloudUpload size={18} />
            </div>
          )
        ) : sessions.length === 0 ? (
          isOpen ? (
            <div className="text-center py-4 text-gray-500 text-xs">
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
                className={`group flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer ${isOpen ? 'w-full' : 'w-10 h-10 justify-center mx-auto p-0'
                  } ${isActive
                    ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                    : 'bg-white/2 hover:bg-white/6 border-white/5 hover:border-white/15 text-gray-300'
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
                      <span className="text-xs font-medium text-gray-200 truncate">
                        {s.title}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                        <span className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] flex items-center gap-1">
                          {isWeb ? <LuGlobe size={10} /> : <LuFileText size={10} />}
                          {isWeb ? 'Web' : 'RAG'}
                        </span>
                        <span>{s.message_count || 0} msgs</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/15 rounded transition-all cursor-pointer"
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
