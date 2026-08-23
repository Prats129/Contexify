import React from 'react';
import {
  LuGlobe,
  LuShieldCheck,
  LuLogIn,
  LuUserPlus,
  LuSun,
  LuMoon,
} from 'react-icons/lu';
import { useTheme } from '../../context/ThemeContext';
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
  const { mode, toggleMode } = useTheme();

  return (
    <header className="h-14 border-b border-(--border-subtle) flex items-center justify-between px-5 bg-(--bg-app)/80 backdrop-blur-md shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border ${
              isWeb
                ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-primary-light-theme text-primary-theme border-primary-theme'
            }`}
          >
            {isWeb ? <LuGlobe size={14} /> : <LuShieldCheck size={14} />}
            {isWeb ? 'Live Web Search' : 'Document Grounded RAG'}
          </span>
          <span className="text-xs text-(--text-muted) hidden sm:inline-block">
            Session: <code className="font-mono text-(--text-main) font-semibold">{sessionId ? sessionId.substring(0, 8) : '...'}</code>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Quick Light / Dark Mode Toggle Button */}
        <button
          type="button"
          onClick={toggleMode}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--text-main) bg-(--border-subtle) hover:bg-(--border-hover) cursor-pointer border border-(--border-subtle)"
          title={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {mode === 'dark' ? <LuSun size={16} /> : <LuMoon size={16} />}
        </button>

        {/* If user is a Guest, show Log In and Sign Up buttons */}
        {!currentUser && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-(--text-main) bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) rounded-lg cursor-pointer"
              onClick={() => onOpenUserModal('login')}
            >
              <LuLogIn size={14} /> Log in
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-primary-theme hover:opacity-90 rounded-lg cursor-pointer"
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
