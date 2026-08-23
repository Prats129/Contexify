import React from 'react';
import {
  LuGlobe,
  LuShieldCheck,
  LuLogIn,
  LuUserPlus,
} from 'react-icons/lu';
import type { ChatMode, User } from '../../types';

interface ChatHeaderProps {
  currentMode: ChatMode;
  sessionId: string | null;
  currentUser: User | null;
  onOpenUserModal: (tab?: 'login' | 'register') => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentMode,
  sessionId,
  currentUser,
  onOpenUserModal,
}) => {
  const isWeb = currentMode === 'WEB_SEARCH';

  return (
    <header className="h-14 border-b border-white/10 flex items-center justify-between px-5 bg-gray-900/50 backdrop-blur-md shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition-colors ${isWeb
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
              }`}
          >
            {isWeb ? <LuGlobe size={14} /> : <LuShieldCheck size={14} />}
            {isWeb ? 'Live Web Search' : 'Document Grounded RAG'}
          </span>
          <span className="text-xs text-gray-500 hidden sm:inline-block">
            Session: <code className="font-mono text-gray-300">{sessionId ? sessionId.substring(0, 8) : '...'}</code>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {/* If user is a Guest, show Log In and Sign Up buttons */}
        {!currentUser && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-all cursor-pointer"
              onClick={() => onOpenUserModal('login')}
            >
              <LuLogIn size={14} /> Log in
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-sm shadow-blue-500/30 rounded-md transition-all cursor-pointer"
              onClick={() => onOpenUserModal('register')}
            >
              <LuUserPlus size={14} /> Sign up
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
