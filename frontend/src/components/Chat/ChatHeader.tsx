import React from 'react';
import {
  LuGlobe,
  LuShieldCheck,
  LuLogIn,
  LuUserPlus,
  LuSun,
  LuMoon,
  LuEraser,
  LuMenu,
} from 'react-icons/lu';
import { useTheme } from '../../context/ThemeContext';
import type { ChatMode, User } from '../../types';

interface ChatHeaderProps {
  currentMode: ChatMode;
  currentUser: User | null;
  onOpenUserModal: (tab?: 'login' | 'register') => void;
  onClearChat?: () => void;
  hasMessages?: boolean;
  onToggleSidebar?: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentMode,
  currentUser,
  onOpenUserModal,
  onClearChat,
  hasMessages = false,
  onToggleSidebar,
}) => {
  const isWeb = currentMode === 'WEB_SEARCH';
  const { mode, toggleMode } = useTheme();

  return (
    <header className="h-14 border-b border-(--border-subtle) flex items-center justify-between px-3 sm:px-5 bg-(--bg-app)/80 backdrop-blur-md shrink-0 gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {onToggleSidebar && (
          <button
            type="button"
            className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--text-main) bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) cursor-pointer shrink-0 transition-colors"
            onClick={onToggleSidebar}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <LuMenu size={18} />
          </button>
        )}

        <span
          className={`px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border truncate ${
            isWeb
              ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-primary-light-theme text-primary-theme border-primary-theme'
          }`}
        >
          {isWeb ? <LuGlobe size={14} className="shrink-0" /> : <LuShieldCheck size={14} className="shrink-0" />}
          <span className="hidden sm:inline">{isWeb ? 'Live Web Search' : 'Document Grounded RAG'}</span>
          <span className="sm:hidden">{isWeb ? 'Web Search' : 'Doc RAG'}</span>
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Clear Chat Button (only available for authenticated account holders) */}
        {Boolean(currentUser && hasMessages && onClearChat) && (
          <button
            type="button"
            onClick={onClearChat}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-(--text-muted) hover:text-red-500 hover:bg-red-500/10 rounded-lg cursor-pointer transition-colors"
            title="Clear message history (keeps documents)"
          >
            <LuEraser size={14} />
            <span className="hidden sm:inline">Clear Chat</span>
          </button>
        )}

        {/* Quick Light / Dark Mode Toggle Button (Authenticated Users Only) */}
        {currentUser && (
          <button
            type="button"
            onClick={toggleMode}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--text-main) bg-(--border-subtle) hover:bg-(--border-hover) cursor-pointer border border-(--border-subtle)"
            title={mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {mode === 'dark' ? <LuSun size={16} /> : <LuMoon size={16} />}
          </button>
        )}

        {/* If user is a Guest, show Sign In and Sign Up buttons */}
        {!currentUser && (
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium text-(--text-main) bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) rounded-lg cursor-pointer transition-colors"
              onClick={() => onOpenUserModal('login')}
            >
              <LuLogIn size={13} />
              <span className="hidden sm:inline">Sign in</span>
              <span className="sm:hidden">Login</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold text-white bg-primary-theme hover:opacity-90 rounded-lg cursor-pointer transition-opacity shadow-xs"
              onClick={() => onOpenUserModal('register')}
            >
              <LuUserPlus size={13} />
              <span className="hidden sm:inline">Sign up</span>
              <span className="sm:hidden">Join</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

