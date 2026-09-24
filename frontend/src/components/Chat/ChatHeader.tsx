import React from "react";
import {
  LuGlobe,
  LuLogIn,
  LuUserPlus,
  LuSun,
  LuMoon,
  LuEraser,
  LuMenu,
  LuGhost,
  LuSparkles,
  LuFileText,
  LuImage,
  LuPalette,
} from "react-icons/lu";
import { useTheme } from "../../context/ThemeContext";
import type { ChatMode, User } from "../../types";

interface ChatHeaderProps {
  currentMode: ChatMode;
  currentUser: User | null;
  onOpenUserModal: (tab?: "login" | "register") => void;
  onClearChat?: () => void;
  hasMessages?: boolean;
  onToggleSidebar?: () => void;
  isTemporaryChat?: boolean;
  onToggleTemporaryChat?: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentMode,
  currentUser,
  onOpenUserModal,
  onClearChat,
  hasMessages = false,
  onToggleSidebar,
  isTemporaryChat = false,
  onToggleTemporaryChat,
}) => {
  const { mode, toggleMode } = useTheme();

  const getHeaderBadge = () => {
    switch (currentMode) {
      case "AUTO":
        return {
          icon: <LuSparkles size={14} className="shrink-0 text-amber-500" />,
          title: "Auto (Smart AI)",
          short: "Auto",
          style:
            "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
        };
      case "WEB_SEARCH":
        return {
          icon: (
            <LuGlobe size={14} className="shrink-0 dark:text-emerald-400" />
          ),
          title: "Live Web Search",
          short: "Web Search",
          style:
            "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
        };
      case "DOCUMENT_RAG":
        return {
          icon: (
            <LuFileText size={14} className="shrink-0 text-primary-theme" />
          ),
          title: "Document Grounded RAG",
          short: "Doc RAG",
          style:
            "bg-primary-light-theme text-primary-theme border-primary-theme",
        };
      case "MULTIMODAL":
        return {
          icon: <LuImage size={14} className="shrink-0 text-purple-600" />,
          title: "Vision & OCR",
          short: "Vision",
          style:
            "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
        };
      case "IMAGE_GENERATION":
        return {
          icon: <LuPalette size={14} className="shrink-0 text-pink-600" />,
          title: "Image Studio",
          short: "Image Gen",
          style:
            "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30",
        };
      default:
        return {
          icon: <LuSparkles size={14} className="shrink-0 text-amber-500" />,
          title: "Auto (Smart AI)",
          short: "Auto",
          style:
            "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
        };
    }
  };

  const badge = getHeaderBadge();

  return (
    <header className="h-14 border-b border-(--border-subtle) flex items-center justify-between px-3 sm:px-5 bg-(--bg-app)/80 backdrop-blur-md shrink-0 gap-2">
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
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
          className={`px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border truncate ${badge.style}`}
        >
          {badge.icon}
          <span className="hidden sm:inline">{badge.title}</span>
          <span className="sm:hidden">{badge.short}</span>
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Temporary Chat Toggle Button */}
        {onToggleTemporaryChat && (
          <button
            type="button"
            onClick={onToggleTemporaryChat}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-all border ${
              isTemporaryChat
                ? "bg-amber-500/15 hover:bg-amber-500/25 dark:text-amber-200 border-amber-500/40 shadow-xs font-semibold"
                : "text-(--text-muted) hover:text-(--text-main) bg-(--border-subtle) hover:bg-(--border-hover) border-(--border-subtle)"
            }`}
            title={
              isTemporaryChat
                ? "Temporary Chat is ON. Click to turn off and return to normal chat."
                : "Turn on Temporary Chat (Won't be saved in history, deleted after 3 days)"
            }
          >
            <LuGhost
              size={15}
              className={
                isTemporaryChat
                  ? "dark:text-amber-400 animate-pulse"
                  : "opacity-70"
              }
            />
            <span className="hidden sm:inline">
              {isTemporaryChat ? "Turn off Temporary" : "Temporary Chat"}
            </span>
            <span className="sm:hidden">
              {isTemporaryChat ? "Turn off" : "Temp"}
            </span>
          </button>
        )}

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
            title={
              mode === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
            }
          >
            {mode === "dark" ? <LuSun size={16} /> : <LuMoon size={16} />}
          </button>
        )}

        {/* If user is a Guest, show Sign In and Sign Up buttons */}
        {!currentUser && (
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium text-(--text-main) bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) rounded-lg cursor-pointer transition-colors"
              onClick={() => onOpenUserModal("login")}
            >
              <LuLogIn size={13} />
              <span className="hidden sm:inline">Sign in</span>
              <span className="sm:hidden">Login</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold text-white bg-primary-theme hover:opacity-90 rounded-lg cursor-pointer transition-opacity shadow-xs"
              onClick={() => onOpenUserModal("register")}
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
