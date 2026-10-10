import { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';
import type { ChatSession, ChatMode, SessionSortOrder } from '../types';

interface UseChatSessionsOptions {
  userId: string | null;
  activeSessionId?: string | null;
  pageSize?: number;
}

export interface UseChatSessionsReturn {
  sessions: ChatSession[];
  total: number;
  hasMore: boolean;
  isLoadingInitial: boolean;
  isLoadingMore: boolean;
  isSearching: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortOrder: SessionSortOrder;
  setSortOrder: (order: SessionSortOrder) => void;
  togglePinSession: (sessionId: string) => Promise<void>;
  loadMore: () => Promise<void>;
  reload: () => Promise<void>;
  prependSession: (session: ChatSession) => void;
  updateSessionTitle: (sessionId: string, newTitle: string) => void;
  updateSessionMode: (sessionId: string, mode: ChatMode) => void;
  removeSession: (sessionId: string) => void;
  ensureSessionInList: (session: ChatSession) => void;
  setSessionsDirect: React.Dispatch<React.SetStateAction<ChatSession[]>>;
}

const DEFAULT_PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;

export const sortSessionsList = (
  list: ChatSession[],
  order: SessionSortOrder
): ChatSession[] => {
  return [...list].sort((a, b) => {
    // 1. Pinned conversations always appear first at the top
    const aPinned = Boolean(a.is_pinned);
    const bPinned = Boolean(b.is_pinned);
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }
    // 2. Sort by creation timestamp
    const aTime = new Date(a.created_at).getTime() || 0;
    const bTime = new Date(b.created_at).getTime() || 0;
    if (order === 'first_created') {
      return aTime - bTime;
    }
    return bTime - aTime;
  });
};

export function useChatSessions({
  userId,
  pageSize = DEFAULT_PAGE_SIZE,
}: UseChatSessionsOptions): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Persistent Sort Order State (last_created vs first_created)
  const [sortOrder, setSortOrderState] = useState<SessionSortOrder>(() => {
    try {
      const saved = localStorage.getItem('contexify_session_sort');
      return saved === 'first_created' ? 'first_created' : 'last_created';
    } catch {
      return 'last_created';
    }
  });

  const setSortOrder = useCallback((order: SessionSortOrder) => {
    setSortOrderState(order);
    try {
      localStorage.setItem('contexify_session_sort', order);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Refs for race-condition prevention and debouncing
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef<number>(0);
  const prevUserIdRef = useRef<string | null>(null);
  const hadSearchRef = useRef<boolean>(false);

  // --- Initial Load / Reload of First Page ---
  const fetchInitialPage = useCallback(
    async (targetUserId: string, searchFilter?: string, currentSort: SessionSortOrder = sortOrder) => {
      if (!targetUserId || targetUserId.startsWith('guest')) {
        setSessions([]);
        setTotal(0);
        setHasMore(false);
        return;
      }

      // Abort any ongoing search request
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      searchAbortControllerRef.current = controller;
      const currentRequestId = ++searchRequestIdRef.current;

      const isSearchQuery = Boolean(searchFilter && searchFilter.trim());
      if (isSearchQuery) {
        setIsSearching(true);
      } else {
        setIsLoadingInitial(true);
      }

      try {
        const result = await apiService.listSessions(targetUserId, {
          limit: pageSize,
          offset: 0,
          search: isSearchQuery ? searchFilter!.trim() : undefined,
          sort_by: currentSort,
          signal: controller.signal,
        });

        if (currentRequestId === searchRequestIdRef.current) {
          const raw = result.sessions || [];
          setSessions(sortSessionsList(raw, currentSort));
          setTotal(result.total ?? raw.length);
          setHasMore(Boolean(result.has_more));
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch initial session page:', err);
      } finally {
        if (currentRequestId === searchRequestIdRef.current) {
          setIsLoadingInitial(false);
          setIsSearching(false);
        }
      }
    },
    [pageSize, sortOrder]
  );

  // --- User Change Effect ---
  useEffect(() => {
    if (userId !== prevUserIdRef.current) {
      prevUserIdRef.current = userId;
      setSearchQuery('');
      hadSearchRef.current = false;
      if (userId && !userId.startsWith('guest')) {
        fetchInitialPage(userId);
      } else {
        setSessions([]);
        setTotal(0);
        setHasMore(false);
      }
    }
  }, [userId, fetchInitialPage]);

  // --- Re-fetch on Sort Order Change ---
  useEffect(() => {
    if (userId && !userId.startsWith('guest')) {
      fetchInitialPage(userId, searchQuery.trim() || undefined, sortOrder);
    }
  }, [sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Debounced Search Effect ---
  useEffect(() => {
    if (!userId || userId.startsWith('guest')) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = searchQuery.trim();

    if (trimmed) {
      hadSearchRef.current = true;
      setIsSearching(true);
      searchTimeoutRef.current = setTimeout(() => {
        fetchInitialPage(userId, trimmed, sortOrder);
      }, SEARCH_DEBOUNCE_MS);
    } else if (hadSearchRef.current) {
      // Search was cleared - reload main list immediately
      hadSearchRef.current = false;
      fetchInitialPage(userId, undefined, sortOrder);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, userId, sortOrder, fetchInitialPage]);

  // --- Load Next Page (Infinite Scroll) ---
  const loadMore = useCallback(async () => {
    if (!userId || userId.startsWith('guest') || isLoadingMore || !hasMore || isLoadingInitial) {
      return;
    }

    setIsLoadingMore(true);
    const currentOffset = sessions.length;
    const currentSearch = searchQuery.trim() || undefined;

    try {
      const result = await apiService.listSessions(userId, {
        limit: pageSize,
        offset: currentOffset,
        search: currentSearch,
        sort_by: sortOrder,
      });

      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        const uniqueNew = (result.sessions || []).filter((s) => !existingIds.has(s.id));
        return sortSessionsList([...prev, ...uniqueNew], sortOrder);
      });

      setTotal(result.total);
      setHasMore(Boolean(result.has_more));
    } catch (err) {
      console.error('Failed to load more sessions:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [userId, isLoadingMore, hasMore, isLoadingInitial, sessions.length, searchQuery, pageSize, sortOrder]);

  // --- Public Reload Method ---
  const reload = useCallback(async () => {
    if (userId) {
      await fetchInitialPage(userId, searchQuery.trim() || undefined, sortOrder);
    }
  }, [userId, searchQuery, sortOrder, fetchInitialPage]);

  // --- Pin / Unpin Session Handler ---
  const togglePinSession = useCallback(
    async (sessionId: string) => {
      const target = sessions.find((s) => s.id === sessionId);
      if (!target) return;
      const nextPinned = !target.is_pinned;

      // Optimistic update
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                is_pinned: nextPinned,
                pinned_at: nextPinned ? new Date().toISOString() : null,
              }
            : s
        );
        return sortSessionsList(updated, sortOrder);
      });

      try {
        await apiService.togglePinSession(sessionId, nextPinned);
      } catch (err) {
        console.error('Failed to toggle pin session:', err);
        // Rollback
        setSessions((prev) => {
          const rolledBack = prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  is_pinned: target.is_pinned,
                  pinned_at: target.pinned_at,
                }
              : s
          );
          return sortSessionsList(rolledBack, sortOrder);
        });
      }
    },
    [sessions, sortOrder]
  );

  // --- In-Memory Mutators for Optimistic UI ---
  const prependSession = useCallback(
    (newSession: ChatSession) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== newSession.id);
        return sortSessionsList([newSession, ...filtered], sortOrder);
      });
      setTotal((prev) => prev + 1);
    },
    [sortOrder]
  );

  const updateSessionTitle = useCallback((sessionId: string, newTitle: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
    );
  }, []);

  const updateSessionMode = useCallback((sessionId: string, mode: ChatMode) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, mode } : s))
    );
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setTotal((prev) => Math.max(0, prev - 1));
  }, []);

  const ensureSessionInList = useCallback(
    (session: ChatSession) => {
      setSessions((prev) => {
        if (prev.some((s) => s.id === session.id)) {
          return prev;
        }
        return sortSessionsList([session, ...prev], sortOrder);
      });
    },
    [sortOrder]
  );

  return {
    sessions,
    total,
    hasMore,
    isLoadingInitial,
    isLoadingMore,
    isSearching,
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    togglePinSession,
    loadMore,
    reload,
    prependSession,
    updateSessionTitle,
    updateSessionMode,
    removeSession,
    ensureSessionInList,
    setSessionsDirect: setSessions,
  };
}
