import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  LuMessageSquare,
  LuCloudUpload,
  LuGlobe,
  LuFileText,
  LuTrash2,
  LuPencil,
  LuCheck,
  LuX,
  LuSearch,
  LuSearchX,
  LuLoader,
  LuChevronDown,
} from "react-icons/lu";
import { FaGoogle } from "react-icons/fa";
import type { ChatSession, User } from "../../types";

interface SessionHistoryProps {
  isOpen?: boolean;
  currentUser: User | null;
  sessions: ChatSession[];
  activeSessionId: string | null;
  totalSessions: number;
  hasMore: boolean;
  isLoadingInitial?: boolean;
  isLoadingMore?: boolean;
  isSearching?: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onLoadMore: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (
    sessionId: string,
    newTitle: string,
  ) => Promise<void> | void;
  onOpenUserModal: () => void;
}

interface ContextMenuPosition {
  x: number;
  y: number;
  session: ChatSession;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  isOpen = true,
  currentUser,
  sessions,
  activeSessionId,
  totalSessions,
  hasMore,
  isLoadingInitial = false,
  isLoadingMore = false,
  isSearching = false,
  searchQuery,
  onSearchChange,
  onLoadMore,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onOpenUserModal,
}) => {
  const isGuest = !currentUser;

  // --- Collapsible Section State (persisted in localStorage) ---
  const [isSectionCollapsed, setIsSectionCollapsed] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem("contexify_chat_history_collapsed") === "true"
      );
    } catch {
      return false;
    }
  });

  const toggleSection = useCallback(() => {
    setIsSectionCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("contexify_chat_history_collapsed", String(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, []);

  // --- Collapsible Search Bar State ---
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(() =>
    Boolean(searchQuery && searchQuery.trim()),
  );

  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchToggleBtnRef = useRef<HTMLButtonElement | null>(null);

  // Keep search bar open if there's an active query
  useEffect(() => {
    if (searchQuery && searchQuery.trim()) {
      setIsSearchOpen(true);
    }
  }, [searchQuery]);

  // Click outside to collapse search bar if empty
  useEffect(() => {
    if (!isSearchOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      const clickedInsideContainer =
        searchContainerRef.current?.contains(target);
      const clickedToggleBtn = searchToggleBtnRef.current?.contains(target);

      if (!clickedInsideContainer && !clickedToggleBtn) {
        // If there is no search query, collapse the search bar
        if (!searchQuery || !searchQuery.trim()) {
          setIsSearchOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isSearchOpen, searchQuery]);

  const handleToggleSearch = () => {
    if (isSearchOpen) {
      if (searchQuery) {
        onSearchChange("");
      }
      setIsSearchOpen(false);
    } else {
      if (isSectionCollapsed) {
        setIsSectionCollapsed(false);
        try {
          localStorage.setItem("contexify_chat_history_collapsed", "false");
        } catch {}
      }
      setIsSearchOpen(true);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  };

  // --- Robust Inline Rename State ---
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isSavingId, setIsSavingId] = useState<string | null>(null);
  const isCancelingRef = useRef(false);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // --- Right-Click Context Menu State ---
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(
    null,
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  // Close context menu on click outside or escape
  useEffect(() => {
    if (!contextMenu) return;

    const handleDismissContextMenu = (e: MouseEvent | TouchEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };

    const handleScrollOrResize = () => setContextMenu(null);

    document.addEventListener("mousedown", handleDismissContextMenu);
    document.addEventListener("touchstart", handleDismissContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handleDismissContextMenu);
      document.removeEventListener("touchstart", handleDismissContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [contextMenu]);

  // Sentinel ref for infinite scroll IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Auto-focus and select input text when entering rename mode
  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  // Infinite scroll observer setup
  useEffect(() => {
    if (!hasMore || isLoadingMore || isLoadingInitial) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting) {
          onLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "80px",
        threshold: 0.05,
      },
    );

    const currentSentinel = sentinelRef.current;
    if (currentSentinel) {
      observer.observe(currentSentinel);
    }

    return () => {
      if (currentSentinel) {
        observer.unobserve(currentSentinel);
      }
      observer.disconnect();
    };
  }, [hasMore, isLoadingMore, isLoadingInitial, onLoadMore]);

  // Fallback onScroll handler for nested scroll boundaries
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (
      scrollHeight - scrollTop - clientHeight < 60 &&
      hasMore &&
      !isLoadingMore &&
      !isLoadingInitial
    ) {
      onLoadMore();
    }
  };

  const handleStartRename = (s: ChatSession, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    isCancelingRef.current = false;
    setContextMenu(null);
    setEditingSessionId(s.id);
    setEditTitle(s.title);
  };

  const handleCancelRename = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    isCancelingRef.current = true;
    setEditingSessionId(null);
    setEditTitle("");
  };

  const handleSaveRename = async (sessionId: string) => {
    if (isCancelingRef.current) {
      isCancelingRef.current = false;
      return;
    }
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setEditingSessionId(null);
      return;
    }
    const current = sessions.find((s) => s.id === sessionId);
    if (!current) {
      setEditingSessionId(null);
      return;
    }
    if (current.title === trimmed) {
      // Nothing changed, exit edit mode smoothly
      setEditingSessionId(null);
      return;
    }
    if (onRenameSession) {
      try {
        setIsSavingId(sessionId);
        await onRenameSession(sessionId, trimmed);
      } catch (err) {
        console.error("Failed to rename session:", err);
      } finally {
        setIsSavingId(null);
        setEditingSessionId(null);
      }
    } else {
      setEditingSessionId(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, session: ChatSession) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 100);
    setContextMenu({ x, y, session });
  };

  return (
    <div className="flex flex-col gap-1.5 w-full flex-1 min-h-0 overflow-hidden">
      {isOpen && (
        <div className="flex items-center justify-between px-1 select-none shrink-0">
          {/* Collapsible Section Header Trigger */}
          <button
            type="button"
            onClick={toggleSection}
            aria-expanded={!isSectionCollapsed}
            aria-label={
              isSectionCollapsed
                ? "Expand chat history"
                : "Collapse chat history"
            }
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--text-muted) hover:text-(--text-main) transition-colors cursor-pointer group text-left"
          >
            <LuChevronDown
              size={13}
              className={`transition-transform duration-200 text-(--text-muted) group-hover:text-(--text-main) shrink-0 ${
                isSectionCollapsed ? "-rotate-90" : "rotate-0"
              }`}
            />
            <LuMessageSquare size={13} className="shrink-0" />
            <span>Chat History</span>
          </button>

          {/* Action: Search icon toggle button (Replaces conversation count) */}
          {!isGuest && (
            <div className="flex items-center gap-1">
              <button
                ref={searchToggleBtnRef}
                type="button"
                onClick={handleToggleSearch}
                aria-label={isSearchOpen ? "Close search" : "Search chats"}
                aria-expanded={isSearchOpen}
                title={isSearchOpen ? "Close search" : "Search chats"}
                className={`p-1 rounded-md text-(--text-muted) hover:text-(--text-main) transition-colors cursor-pointer ${
                  isSearchOpen || searchQuery
                    ? "bg-primary-light-theme text-primary-theme"
                    : "hover:bg-(--border-subtle)"
                }`}
              >
                <LuSearch size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Server Search Bar */}
      {isOpen && !isGuest && (
        <div
          ref={searchContainerRef}
          className={`shrink-0 grid transition-[grid-template-rows,opacity,margin] duration-200 ease-in-out ${
            isSearchOpen
              ? "grid-rows-[1fr] opacity-100 mt-0.5 mb-1"
              : "grid-rows-[0fr] opacity-0 m-0 pointer-events-none"
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div className="relative flex items-center w-full px-0.5 pt-0.5 pb-1">
              <LuSearch
                size={13}
                className="absolute left-3 text-(--text-muted) pointer-events-none"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    if (searchQuery) {
                      onSearchChange("");
                    } else {
                      setIsSearchOpen(false);
                    }
                  }
                }}
                placeholder="Search chats directly..."
                aria-label="Search chats directly"
                className="w-full bg-(--bg-main) border border-(--border-subtle) focus:border-primary-theme rounded-lg pl-7 pr-8 py-1.5 text-xs text-(--text-main) focus:outline-none focus:ring-1 focus:ring-primary-theme transition-all shadow-2xs"
              />
              <div className="absolute right-2.5 flex items-center">
                {isSearching ? (
                  <LuLoader
                    size={13}
                    className="icon-spin text-primary-theme"
                    title="Searching..."
                  />
                ) : searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSearchChange("");
                      searchInputRef.current?.focus();
                    }}
                    className="p-0.5 text-(--text-muted) hover:text-(--text-main) rounded cursor-pointer transition-colors"
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <LuX size={12} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Collapsible History Body */}
      {isOpen ? (
        <div
          className={`flex-1 min-h-0 w-full flex flex-col overflow-hidden transition-opacity duration-200 ${
            isSectionCollapsed
              ? "hidden opacity-0 pointer-events-none"
              : "opacity-100"
          }`}
        >
          <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden">
            <div
              onScroll={handleScroll}
              className="flex flex-col gap-1.5 w-full flex-1 min-h-0 overflow-y-auto pr-0.5"
            >
              {isGuest ? (
                <div className="p-3 border border-(--border-subtle) bg-(--border-subtle)/50 rounded-xl text-center flex flex-col items-center gap-1.5">
                  <LuCloudUpload size={20} className="text-primary-theme" />
                  <p className="text-xs font-semibold text-(--text-main)">
                    Browsing as Guest
                  </p>
                  <span className="text-[11px] text-(--text-muted) leading-tight">
                    Sign in to save and sync chat history.
                  </span>
                  <button
                    type="button"
                    className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-2 bg-primary-theme hover:opacity-90 text-white rounded-lg text-xs font-medium cursor-pointer"
                    onClick={onOpenUserModal}
                  >
                    <FaGoogle size={12} /> Sign In
                  </button>
                </div>
              ) : isLoadingInitial && sessions.length === 0 ? (
                /* Initial loading skeletons */
                <div className="flex flex-col gap-1.5 w-full py-1">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="h-11 rounded-lg bg-(--border-subtle)/40 animate-pulse w-full"
                    />
                  ))}
                </div>
              ) : sessions.length === 0 && !searchQuery ? (
                <div className="text-center py-4 text-(--text-muted) text-xs">
                  <LuMessageSquare
                    size={18}
                    className="mx-auto mb-1 opacity-50"
                  />
                  <p>No conversations yet.</p>
                </div>
              ) : sessions.length === 0 && searchQuery ? (
                /* Search results empty state */
                <div className="text-center py-4 px-2 text-(--text-muted) text-xs flex flex-col items-center gap-1.5 bg-(--border-subtle)/30 rounded-xl border border-dashed border-(--border-subtle)">
                  <LuSearchX
                    size={18}
                    className="opacity-50 text-(--text-muted)"
                  />
                  <p className="font-semibold text-(--text-main)">
                    No chats found
                  </p>
                  <span className="text-[11px] text-(--text-muted) leading-tight">
                    No chats match &ldquo;{searchQuery}&rdquo;
                  </span>
                  <button
                    type="button"
                    onClick={() => onSearchChange("")}
                    className="mt-1 text-[11px] text-primary-theme hover:underline font-medium cursor-pointer"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <>
                  {sessions.map((s) => {
                    const isActive = s.id === activeSessionId;
                    const isWeb = s.mode === "WEB_SEARCH";
                    const isEditing = editingSessionId === s.id;

                    if (isEditing) {
                      return (
                        <div
                          key={s.id}
                          className="flex items-center p-1.5 rounded-lg border-2 border-primary-theme bg-(--bg-card) shadow-md w-full animate-[fadeIn_0.15s_ease-out]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleSaveRename(s.id);
                            }}
                            className="flex items-center gap-1.5 w-full min-w-0"
                          >
                            <div className="shrink-0 text-primary-theme pl-1">
                              {isWeb ? (
                                <LuGlobe size={13} />
                              ) : (
                                <LuFileText size={13} />
                              )}
                            </div>
                            <input
                              ref={editInputRef}
                              type="text"
                              value={editTitle}
                              maxLength={100}
                              disabled={isSavingId === s.id}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.stopPropagation();
                                  handleCancelRename(e);
                                }
                              }}
                              onBlur={() => {
                                if (
                                  editingSessionId === s.id &&
                                  !isCancelingRef.current
                                ) {
                                  handleSaveRename(s.id);
                                }
                              }}
                              className="flex-1 min-w-0 bg-transparent border-0 px-1 py-0.5 text-xs font-semibold text-(--text-main) focus:outline-none focus:ring-0"
                              placeholder="Enter chat title..."
                              aria-label="Rename conversation"
                            />
                            <button
                              type="submit"
                              onMouseDown={(e) => e.preventDefault()}
                              disabled={
                                !editTitle.trim() || isSavingId === s.id
                              }
                              className="p-1 text-emerald-600 hover:text-emerald-500 hover:bg-emerald-500/15 disabled:opacity-30 rounded-md cursor-pointer transition-colors shrink-0"
                              title="Save title (Enter)"
                              aria-label="Save title"
                            >
                              {isSavingId === s.id ? (
                                <LuLoader size={13} className="icon-spin" />
                              ) : (
                                <LuCheck size={13} />
                              )}
                            </button>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleCancelRename(e);
                              }}
                              disabled={isSavingId === s.id}
                              className="p-1 text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle) rounded-md cursor-pointer transition-colors shrink-0"
                              title="Cancel (Esc)"
                              aria-label="Cancel editing"
                            >
                              <LuX size={13} />
                            </button>
                          </form>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={s.id}
                        tabIndex={0}
                        className={`group relative flex items-center justify-between p-2 rounded-lg border cursor-pointer w-full transition-all select-none ${
                          isActive
                            ? "bg-primary-light-theme border-primary-theme text-primary-theme font-semibold shadow-2xs"
                            : "bg-transparent hover:bg-(--border-subtle) border-(--border-subtle) text-(--text-main)"
                        }`}
                        onClick={() => onSelectSession(s.id)}
                        onDoubleClick={(e) => handleStartRename(s, e)}
                        onContextMenu={(e) => handleContextMenu(e, s)}
                        onKeyDown={(e) => {
                          if (e.key === "F2") {
                            handleStartRename(s, e);
                          }
                        }}
                        title={`${s.title} (${isWeb ? "Web Search" : "Document RAG"}) - Double-click or click pencil to rename`}
                      >
                        <div className="flex flex-col min-w-0 overflow-hidden mr-1 flex-1">
                          <span className="text-xs truncate font-medium">
                            {s.title}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] text-(--text-muted)">
                            <span className="bg-(--border-subtle) px-1.5 py-0.5 rounded text-[9px] flex items-center gap-1 font-normal">
                              {isWeb ? (
                                <LuGlobe size={10} />
                              ) : (
                                <LuFileText size={10} />
                              )}
                              {isWeb ? "Web" : "RAG"}
                            </span>
                            <span className="font-normal">
                              {s.message_count || 0} msgs
                            </span>
                          </div>
                        </div>

                        {/* Actions: Always visible on active session, visible on hover for others */}
                        <div
                          className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
                            isActive
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <button
                            type="button"
                            className="p-1.5 text-(--text-muted) hover:text-primary-theme hover:bg-primary-light-theme rounded-md cursor-pointer transition-colors"
                            onClick={(e) => handleStartRename(s, e)}
                            title="Rename Chat (or double-click)"
                            aria-label="Rename Chat"
                          >
                            <LuPencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="p-1.5 text-(--text-muted) hover:text-red-500 hover:bg-red-500/15 rounded-md cursor-pointer transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSession(s.id);
                            }}
                            title="Delete Conversation"
                            aria-label="Delete Conversation"
                          >
                            <LuTrash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Infinite Scroll Sentinel element */}
                  <div
                    ref={sentinelRef}
                    className="h-1 w-full shrink-0 pointer-events-none"
                  />

                  {/* Bottom Loading Indicator for Infinite Scroll */}
                  {isLoadingMore && (
                    <div className="flex items-center justify-center py-2.5 gap-2 text-xs text-(--text-muted)">
                      <LuLoader
                        size={13}
                        className="icon-spin text-primary-theme"
                      />
                      <span className="text-[11px]">Loading more chats...</span>
                    </div>
                  )}

                  {/* End of list note when user has scrolled through many chats */}
                  {!hasMore && sessions.length >= 12 && !searchQuery && (
                    <div className="text-center py-2 text-[10px] text-(--text-muted) opacity-50">
                      All {totalSessions} chats loaded
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Compact Sidebar Icon Mode */
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full flex flex-col gap-2 items-center py-1">
          {isGuest ? (
            <div
              className="flex justify-center py-2 text-(--text-muted)"
              title="Guest Mode - Sign in to save history"
            >
              <LuCloudUpload size={18} />
            </div>
          ) : (
            sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const isWeb = s.mode === "WEB_SEARCH";
              return (
                <div
                  key={s.id}
                  className={`group flex items-center justify-center w-10 h-10 rounded-lg border cursor-pointer p-0 ${
                    isActive
                      ? "bg-primary-light-theme border-primary-theme text-primary-theme font-semibold"
                      : "bg-transparent hover:bg-(--border-subtle) border-(--border-subtle) text-(--text-main)"
                  }`}
                  onClick={() => onSelectSession(s.id)}
                  onContextMenu={(e) => handleContextMenu(e, s)}
                  title={`${s.title} (${isWeb ? "Web Search" : "Document RAG"})`}
                >
                  {isWeb ? (
                    <LuGlobe size={16} />
                  ) : (
                    <LuMessageSquare size={16} />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Right-click Floating Context Menu */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="fixed z-9999 bg-(--bg-card) border border-(--border-hover) shadow-2xl rounded-xl p-1 w-44 flex flex-col gap-0.5 text-xs animate-[popoverIn_0.12s_ease-out] backdrop-blur-md"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-(--text-main) hover:bg-primary-light-theme hover:text-primary-theme transition-colors cursor-pointer text-left w-full font-medium"
              onClick={(e) => handleStartRename(contextMenu.session, e)}
            >
              <LuPencil size={13} />
              <span>Rename</span>
            </button>
            <div className="h-px bg-(--border-subtle) my-0.5" />
            <button
              type="button"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-red-500 hover:bg-red-500/15 transition-colors cursor-pointer text-left w-full font-medium"
              onClick={(e) => {
                e.stopPropagation();
                const sessId = contextMenu.session.id;
                setContextMenu(null);
                onDeleteSession(sessId);
              }}
            >
              <LuTrash2 size={13} />
              <span>Delete</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
};
