import React from "react";
import { LuPlus, LuX, LuPaperclip, LuMessageCircle } from "react-icons/lu";
import { FiSidebar } from "react-icons/fi";
import { UserProfileCard } from "./UserProfileCard";
import { SessionHistory } from "./SessionHistory";
import type { User, ChatSession, SessionSortOrder } from "../../types";

interface SidebarProps {
  isOpen: boolean;
  onToggleSidebar: () => void;
  onCloseMobile?: () => void;
  currentUser: User | null;
  onOpenUserModal: () => void;
  onLogout: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (
    sessionId: string,
    newTitle: string,
  ) => Promise<void> | void;
  sortOrder?: SessionSortOrder;
  onSortChange?: (order: SessionSortOrder) => void;
  onTogglePinSession?: (sessionId: string) => void;
  totalSessions: number;
  hasMore: boolean;
  isLoadingInitial?: boolean;
  isLoadingMore?: boolean;
  isSearching?: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onLoadMore: () => void;
  onOpenAttachmentsModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggleSidebar,
  onCloseMobile,
  currentUser,
  onOpenUserModal,
  onLogout,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  sortOrder,
  onSortChange,
  onTogglePinSession,
  totalSessions,
  hasMore,
  isLoadingInitial,
  isLoadingMore,
  isSearching,
  searchQuery,
  onSearchChange,
  onLoadMore,
  onOpenAttachmentsModal,
}) => {
  return (
    <aside
      className={`h-full max-h-dvh bg-(--bg-sidebar) border-r border-(--border-subtle) flex flex-col gap-3 shrink-0 overflow-hidden transition-[transform,width] duration-200 ease-in-out
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-72 max-md:p-3.5 max-md:shadow-2xl
        ${isOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full max-md:pointer-events-none"}
        md:relative md:translate-x-0 md:pointer-events-auto md:shadow-none
        ${isOpen ? "md:w-72 md:p-3.5" : "md:w-15 md:p-2 md:items-center"}
      `}
    >
      {/* Brand & Toggle Sidebar Button */}
      <div
        className={`flex items-center pb-2.5 border-b border-(--border-subtle) w-full shrink-0 ${
          isOpen ? "justify-between gap-2" : "justify-center"
        }`}
      >
        {isOpen ? (
          <>
            <button
              type="button"
              onClick={onNewSession}
              className="flex items-center gap-2.5 overflow-hidden text-left p-1 -m-1 rounded-xl hover:bg-(--border-subtle) transition-all cursor-pointer group"
            >
              <div className="w-12 h-9 flex items-center justify-center shrink-0">
                <img
                  src="/logo.png"
                  alt="Contexify Logo"
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                />
              </div>
              <div className="flex flex-col min-w-0">
                <h1 className="text-sm font-bold text-(--text-main) truncate leading-tight group-hover:text-primary-theme transition-colors">
                  Contexify AI
                </h1>
                <span className="text-[11px] text-(--text-muted) truncate">
                  Enterprise RAG & Search
                </span>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              {/* Desktop toggle collapse */}
              <button
                type="button"
                className="hidden md:flex w-8 h-8 rounded-lg bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-muted) hover:text-(--text-main) border border-(--border-subtle) items-center justify-center cursor-pointer shrink-0"
                onClick={onToggleSidebar}
                title="Collapse sidebar"
              >
                <FiSidebar size={18} />
              </button>
              {/* Mobile close drawer button */}
              <button
                type="button"
                className="flex md:hidden w-8 h-8 rounded-lg bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-muted) hover:text-(--text-main) border border-(--border-subtle) items-center justify-center cursor-pointer shrink-0"
                onClick={onCloseMobile || onToggleSidebar}
                title="Close sidebar"
                aria-label="Close sidebar"
              >
                <LuX size={18} />
              </button>
            </div>
          </>
        ) : (
          /* Desktop Collapsed State: Shows Brand Icon normally, reveals Expand icon on hover */
          <button
            type="button"
            className="group relative w-9 h-9 rounded-lg hidden md:flex items-center justify-center cursor-pointer hover:bg-(--border-subtle) transition-colors"
            onClick={onToggleSidebar}
            title="Expand sidebar"
          >
            <div className="w-6.5 h-6.5 flex items-center justify-center shrink-0 group-hover:hidden">
              <img
                src="/logo.png"
                alt="Contexify Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="hidden group-hover:flex w-7 h-7 rounded-md items-center justify-center text-(--text-main) border border-(--border-subtle) bg-(--border-hover)">
              <FiSidebar size={15} />
            </div>
          </button>
        )}
      </div>

      {/* New Conversation Button (Logged-in users only) */}
      {currentUser && (
        <div
          className={`${isOpen ? "w-full" : "w-9"} flex justify-center shrink-0`}
        >
          <button
            type="button"
            className={`w-full flex items-center justify-center gap-2 rounded-lg cursor-pointer transition-all duration-200 ${
              isOpen
                ? "bg-primary-theme hover:opacity-90 text-white font-semibold py-2.5 px-3 text-xs shadow-xs"
                : "h-9 w-9 p-0 text-xs bg-primary-light-theme text-primary-theme border border-primary-theme/35 hover:bg-primary-theme hover:text-white hover:border-primary-theme hover:shadow-xs active:scale-95"
            }`}
            onClick={onNewSession}
            title="New Conversation"
          >
            <LuPlus size={isOpen ? 18 : 15} />
            {isOpen && <span>New Conversation</span>}
          </button>
        </div>
      )}

      {/* Attachments & Media Button (Logged-in users only) */}
      {currentUser && onOpenAttachmentsModal && (
        <div
          className={`${isOpen ? "w-full" : "w-9"} flex justify-center shrink-0`}
        >
          <button
            type="button"
            className={`w-full flex items-center justify-center gap-2 rounded-lg cursor-pointer transition-all duration-200 ${
              isOpen
                ? "dark:bg-white/6 hover:bg-black/[0.07] dark:hover:bg-white/10 text-(--text-main) border dark:border-white/9 font-medium py-2 px-3 text-xs"
                : "h-9 w-9 p-0 text-xs dark:bg-white/6 hover:bg-black/8 dark:hover:bg-white/12 text-(--text-muted) hover:text-(--text-main) border border-black/6 hover:border-black/12 dark:hover:border-white/16 active:scale-95"
            }`}
            onClick={onOpenAttachmentsModal}
            title="Attachments & Media Library"
          >
            <LuPaperclip size={isOpen ? 15 : 14} />
            {isOpen && <span>Media & Files</span>}
          </button>
        </div>
      )}

      {/* View Conversations Button (Only in collapsed mode for logged-in users) */}
      {!isOpen && currentUser && (
        <div className="w-9 flex justify-center shrink-0">
          <button
            type="button"
            className="w-9 h-9 rounded-lg flex items-center justify-center dark:bg-white/6 hover:bg-black/8 dark:hover:bg-white/12 text-(--text-muted) hover:text-(--text-main) border border-black/6 hover:border-black/12 dark:hover:border-white/16 cursor-pointer transition-all duration-200 active:scale-95"
            onClick={onToggleSidebar}
            title={`View conversations (${totalSessions})`}
          >
            <LuMessageCircle size={15} />
          </button>
        </div>
      )}

      {/* Conversation History (Only shown when sidebar is open) */}
      {isOpen && (
        <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden">
          <SessionHistory
            isOpen={isOpen}
            currentUser={currentUser}
            sessions={sessions}
            activeSessionId={activeSessionId}
            totalSessions={totalSessions}
            hasMore={hasMore}
            isLoadingInitial={isLoadingInitial}
            isLoadingMore={isLoadingMore}
            isSearching={isSearching}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            sortOrder={sortOrder}
            onSortChange={onSortChange}
            onTogglePinSession={onTogglePinSession}
            onLoadMore={onLoadMore}
            onSelectSession={onSelectSession}
            onDeleteSession={onDeleteSession}
            onRenameSession={onRenameSession}
            onOpenUserModal={onOpenUserModal}
          />
        </div>
      )}

      {/* Bottom Section: Logged in User Profile Card */}
      {currentUser && (
        <div className="mt-auto pt-2 w-full shrink-0">
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
