import { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';
import type { ChatSession, ChatMode } from '../types';

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

  // Refs for race-condition prevention and debouncing
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef<number>(0);
  const prevUserIdRef = useRef<string | null>(null);
  const hadSearchRef = useRef<boolean>(false);

  // --- Initial Load / Reload of First Page ---
  const fetchInitialPage = useCallback(
    async (targetUserId: string, searchFilter?: string) => {
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
          signal: controller.signal,
        });

        if (currentRequestId === searchRequestIdRef.current) {
          setSessions(result.sessions || []);
          setTotal(result.total ?? result.sessions?.length ?? 0);
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
    [pageSize]
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
        fetchInitialPage(userId, trimmed);
      }, SEARCH_DEBOUNCE_MS);
    } else if (hadSearchRef.current) {
      // Search was cleared - reload main recent list immediately
      hadSearchRef.current = false;
      fetchInitialPage(userId);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, userId, fetchInitialPage]);

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
      });

      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        const uniqueNew = (result.sessions || []).filter((s) => !existingIds.has(s.id));
        return [...prev, ...uniqueNew];
      });

      setTotal(result.total);
      setHasMore(Boolean(result.has_more));
    } catch (err) {
      console.error('Failed to load more sessions:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [userId, isLoadingMore, hasMore, isLoadingInitial, sessions.length, searchQuery, pageSize]);

  // --- Public Reload Method ---
  const reload = useCallback(async () => {
    if (userId) {
      await fetchInitialPage(userId, searchQuery.trim() || undefined);
    }
  }, [userId, searchQuery, fetchInitialPage]);

  // --- In-Memory Mutators for Optimistic UI ---
  const prependSession = useCallback((newSession: ChatSession) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== newSession.id);
      return [newSession, ...filtered];
    });
    setTotal((prev) => prev + 1);
  }, []);

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

  const ensureSessionInList = useCallback((session: ChatSession) => {
    setSessions((prev) => {
      if (prev.some((s) => s.id === session.id)) {
        return prev;
      }
      return [session, ...prev];
    });
  }, []);

  return {
    sessions,
    total,
    hasMore,
    isLoadingInitial,
    isLoadingMore,
    isSearching,
    searchQuery,
    setSearchQuery,
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
