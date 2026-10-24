import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  LuSparkles,
  LuListTodo,
  LuCpu,
  LuTarget,
  LuArrowDown,
  LuGhost,
  LuLoaderCircle,
} from "react-icons/lu";
import { MessageItem } from "./MessageItem";
import { ChatPromptTimeline } from "./ChatPromptTimeline";
import type {
  Message,
  StreamingMessageState,
  User,
  Citation,
  MediaAttachment,
} from "../../types";

interface MessageListProps {
  historyLatestRevision?: number;
  hasOlderHistory?: boolean;
  hasNewerHistory?: boolean;
  historyNavigationDisabled?: boolean;
  historyLoadingDirection?: "older" | "newer" | "latest" | "target" | null;
  onHistoryPage?: (
    direction: "older" | "newer" | "latest" | "target",
    targetId?: string,
  ) => Promise<boolean>;
  messages: Message[];
  streamingMessage: StreamingMessageState | null;
  onSelectPrompt: (prompt: string) => void;
  currentUser?: User | null;
  activeSourcesMessageId?: string;
  onToggleSources?: (
    msgId: string,
    citations: Citation[],
    queryTitle?: string,
  ) => void;
  activeSources?: boolean;
  isTemporaryChat?: boolean;
  onToggleTemporaryChat?: () => void;
  onUseAsReference?: (media: MediaAttachment) => void;
  onReply?: (msg: {
    id?: string;
    role: "user" | "assistant";
    content: string;
  }) => void;
  highlightedMessageId?: string | null;
  onJumpToMessage?: (messageId: string) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  historyLatestRevision = 0,
  hasOlderHistory = false,
  hasNewerHistory = false,
  historyNavigationDisabled = false,
  historyLoadingDirection = null,
  onHistoryPage,
  messages,
  streamingMessage,
  onSelectPrompt,
  currentUser,
  activeSourcesMessageId,
  onToggleSources,
  activeSources,
  isTemporaryChat = false,
  onToggleTemporaryChat,
  onUseAsReference,
  onReply,
  highlightedMessageId: externalHighlightedId,
  onJumpToMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const positionedRef = useRef(false);
  const lastLatestRevisionRef = useRef(historyLatestRevision);
  const userScrolledRef = useRef(false);
  const loadingRef = useRef(false);
  const anchorRef = useRef<{ id: string; top: number } | null>(null);
  const latestRequestedRef = useRef(false);
  const previousMessagesRef = useRef(messages);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [internalHighlightedId, setInternalHighlightedId] = useState<
    string | null
  >(null);
  const activeHighlightedId =
    externalHighlightedId !== undefined
      ? externalHighlightedId
      : internalHighlightedId;
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract all user prompt items for the timeline navigation
  const userPrompts = useMemo(() => {
    return messages
      .filter((m) => m.role === "user")
      .map((m, idx) => ({
        id: m.id,
        content: m.content,
        index: idx,
      }));
  }, [messages]);

  // Determine active prompt based on scroll position
  const updateActivePrompt = useCallback(() => {
    const container = containerRef.current;
    if (!container || userPrompts.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const triggerPoint = containerRect.top + 160;

    let currentActiveId = userPrompts[0]?.id || null;

    for (const prompt of userPrompts) {
      const el = document.getElementById(`msg-${prompt.id}`);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= triggerPoint) {
          currentActiveId = prompt.id;
        } else {
          break;
        }
      }
    }

    setActivePromptId(currentActiveId);
  }, [userPrompts]);

  const loadEdge = useCallback(
    async (direction: "older" | "newer") => {
      const container = containerRef.current;
      if (
        !container ||
        loadingRef.current ||
        historyNavigationDisabled ||
        !onHistoryPage
      )
        return;
      const bounds = container.getBoundingClientRect();
      const visible = [
        ...container.querySelectorAll<HTMLElement>('[id^="msg-"]'),
      ].find((element) => element.getBoundingClientRect().bottom > bounds.top);
      anchorRef.current = visible
        ? {
            id: visible.id.slice(4),
            top: visible.getBoundingClientRect().top - bounds.top,
          }
        : null;
      loadingRef.current = true;
      try {
        if (!(await onHistoryPage(direction))) anchorRef.current = null;
      } finally {
        loadingRef.current = false;
      }
    },
    [historyNavigationDisabled, onHistoryPage],
  );

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 80;
    if (userScrolledRef.current || hasNewerHistory)
      isAtBottomRef.current = atBottom && !hasNewerHistory;
    setShowScrollButton(
      hasNewerHistory || (!atBottom && el.scrollHeight > el.clientHeight + 100),
    );
    updateActivePrompt();
    if (loadingRef.current && anchorRef.current) {
      const visible = [
        ...el.querySelectorAll<HTMLElement>('[id^="msg-"]'),
      ].find(
        (element) =>
          element.getBoundingClientRect().bottom >
          el.getBoundingClientRect().top,
      );
      if (visible)
        anchorRef.current = {
          id: visible.id.slice(4),
          top:
            visible.getBoundingClientRect().top -
            el.getBoundingClientRect().top,
        };
    }
    if (
      !positionedRef.current ||
      !userScrolledRef.current ||
      loadingRef.current
    )
      return;
    if (el.scrollTop < 120 && hasOlderHistory) void loadEdge("older");
    else if (distance < 120 && hasNewerHistory) void loadEdge("newer");
  }, [hasOlderHistory, hasNewerHistory, loadEdge, updateActivePrompt]);

  const scrollToBottom = useCallback(
    async (smooth = true) => {
      if (loadingRef.current || historyNavigationDisabled) return;
      const wasAtBottom = isAtBottomRef.current;
      const hadUserScrolled = userScrolledRef.current;
      // Keep following late layout changes until the reader scrolls manually.
      userScrolledRef.current = false;
      isAtBottomRef.current = true;
      if (hasNewerHistory && onHistoryPage) {
        latestRequestedRef.current = true;
        userScrolledRef.current = false;
        if (!(await onHistoryPage("latest"))) {
          latestRequestedRef.current = false;
          isAtBottomRef.current = wasAtBottom;
          userScrolledRef.current = hadUserScrolled;
          return;
        }
      }
      scrollEndRef.current?.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
      });
      isAtBottomRef.current = true;
      setShowScrollButton(false);
    },
    [hasNewerHistory, historyNavigationDisabled, onHistoryPage],
  );

  // Jump to specific message with smooth scroll and momentary highlight glow
  const scrollToTargetMessage = useCallback(
    (targetId: string) => {
      if (onJumpToMessage) {
        userScrolledRef.current = false;
        isAtBottomRef.current = false;
        onJumpToMessage(targetId);
        return;
      }
      if (!targetId) return;
      const cleanId = targetId.startsWith("msg-")
        ? targetId.slice(4)
        : targetId;
      const el =
        document.getElementById(`msg-${cleanId}`) ||
        document.getElementById(cleanId);
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        if (highlightTimerRef.current) {
          clearTimeout(highlightTimerRef.current);
        }
        setInternalHighlightedId(cleanId);
        highlightTimerRef.current = setTimeout(() => {
          setInternalHighlightedId(null);
        }, 1800);
      }
    },
    [onJumpToMessage],
  );

  const scrollToPrompt = useCallback(
    (promptId: string) => {
      scrollToTargetMessage(promptId);
      setActivePromptId(promptId);
    },
    [scrollToTargetMessage],
  );

  const activeIndex = useMemo(() => {
    return userPrompts.findIndex((p) => p.id === activePromptId);
  }, [userPrompts, activePromptId]);

  const handleNavigatePrev = useCallback(() => {
    if (activeIndex > 0) {
      scrollToPrompt(userPrompts[activeIndex - 1].id);
    } else if (activeIndex === -1 && userPrompts.length > 0) {
      scrollToPrompt(userPrompts[0].id);
    }
  }, [activeIndex, userPrompts, scrollToPrompt]);

  const handleNavigateNext = useCallback(() => {
    if (activeIndex < userPrompts.length - 1 && activeIndex >= 0) {
      scrollToPrompt(userPrompts[activeIndex + 1].id);
    } else if (activeIndex === -1 && userPrompts.length > 1) {
      scrollToPrompt(userPrompts[1].id);
    }
  }, [activeIndex, userPrompts, scrollToPrompt]);

  // Clean up highlight timer on unmount
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // Commit viewport changes before paint so prepends do not look like new answers.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;
    if (lastLatestRevisionRef.current !== historyLatestRevision) {
      anchorRef.current = null;
      isAtBottomRef.current = true;
      userScrolledRef.current = false;
      lastLatestRevisionRef.current = historyLatestRevision;
    }
    const previous = previousMessagesRef.current;
    const last = messages[messages.length - 1];
    const userSent =
      last?.role === "user" &&
      previous.length > 0 &&
      !previous.some((message) => message.id === last.id) &&
      messages.some(
        (message) => message.id === previous[previous.length - 1].id,
      );
    previousMessagesRef.current = messages;
    const anchor = anchorRef.current;
    if (anchor) {
      const element = document.getElementById(`msg-${anchor.id}`);
      if (element && container.contains(element)) {
        container.scrollTop +=
          element.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          anchor.top;
      }
      anchorRef.current = null;
      isAtBottomRef.current = false;
    } else if (
      !positionedRef.current ||
      latestRequestedRef.current ||
      isAtBottomRef.current ||
      userSent
    ) {
      scrollEndRef.current?.scrollIntoView({ behavior: "auto" });
      isAtBottomRef.current = !hasNewerHistory;
      latestRequestedRef.current = false;
    }
    positionedRef.current = true;
    updateActivePrompt();
  }, [
    messages,
    streamingMessage,
    hasNewerHistory,
    historyLatestRevision,
    updateActivePrompt,
  ]);

  // Images and rich content can change height after the initial render.
  useEffect(() => {
    if (!contentRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current && !loadingRef.current)
        scrollEndRef.current?.scrollIntoView({ behavior: "auto" });
    });
    observer.observe(contentRef.current);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const showWelcome = messages.length === 0 && !streamingMessage;

  return (
    <div className="relative flex-1 overflow-hidden flex flex-col w-full">
      {historyLoadingDirection && (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none absolute ${historyLoadingDirection === "newer" || historyLoadingDirection === "latest" ? "bottom-12" : "top-2"} left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full border border-(--border-subtle) bg-(--bg-card) px-3 py-2 text-xs text-(--text-muted)`}
        >
          <LuLoaderCircle
            className="animate-spin"
            size={14}
            aria-hidden="true"
          />
          Loading messages...
        </div>
      )}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={() => {
          userScrolledRef.current = true;
          handleScroll();
        }}
        onTouchMove={() => {
          userScrolledRef.current = true;
        }}
        onKeyDown={(event) => {
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
            ].includes(event.key)
          ) {
            userScrolledRef.current = true;
            handleScroll();
          }
        }}
        tabIndex={0}
        className="flex-1 overflow-y-auto px-2 sm:px-6 py-4 md:py-6 w-full flex flex-col items-center"
      >
        <div
          ref={contentRef}
          className={`w-full flex flex-col gap-5 ${
            activeSources ? "max-w-4xl lg:mr-auto lg:ml-4" : "max-w-3xl"
          }`}
        >
          {/* ChatGPT-style Dedicated Temporary Chat Screen */}
          {isTemporaryChat && showWelcome ? (
            <div className="my-auto flex flex-col items-center text-center p-8 sm:p-10 border border-amber-500/30 bg-amber-500/5 rounded-3xl max-w-xl mx-auto shadow-xl animate-in fade-in zoom-in-95">
              <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-600 text-3xl mb-4 shadow-xs">
                <LuGhost size={32} className="animate-pulse" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-(--text-main) mb-2">
                Temporary Chat
              </h2>
              <p className="text-xs sm:text-sm text-(--text-muted) leading-relaxed mb-5 max-w-md">
                This chat won&apos;t appear in history, use or create memories,
                or be used to train our models. All conversation messages and
                document embeddings are permanently deleted after 3 days.
              </p>

              {onToggleTemporaryChat && (
                <button
                  type="button"
                  onClick={onToggleTemporaryChat}
                  className="px-4 py-2 rounded-full text-xs font-semibold bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-main) border border-(--border-subtle) cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-xs mb-6"
                >
                  Turn off Temporary Chat
                </button>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 bg-(--bg-card) hover:bg-(--border-subtle) border border-amber-500/25 text-(--text-main) rounded-xl text-xs cursor-pointer transition-colors shadow-2xs"
                  onClick={() =>
                    onSelectPrompt(
                      "Explain how zero-trust architecture works in modern cloud networks.",
                    )
                  }
                >
                  <LuSparkles size={13} className="text-amber-600" />
                  Quick research
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 bg-(--bg-card) hover:bg-(--border-subtle) border border-amber-500/25 text-(--text-main) rounded-xl text-xs cursor-pointer transition-colors shadow-2xs"
                  onClick={() =>
                    onSelectPrompt(
                      "Review this sensitive text and highlight potential security risks.",
                    )
                  }
                >
                  <LuSparkles size={13} className="text-amber-600" />
                  Confidential review
                </button>
              </div>
            </div>
          ) : showWelcome ? (
            <div className="my-auto flex flex-col items-center text-center p-8 border border-(--border-subtle) bg-(--bg-card) rounded-3xl max-w-2xl mx-auto shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-primary-light-theme border border-primary-theme flex items-center justify-center text-primary-theme text-2xl mb-4">
                <LuSparkles size={24} />
              </div>
              <h2 className="text-xl md:text-2xl font-bold text-(--text-main) mb-2">
                Welcome to Enterprise Knowledge AI
              </h2>
              <p className="text-xs md:text-sm text-(--text-muted) leading-relaxed mb-6 max-w-lg">
                Upload documents to ask grounded questions with verifiable
                source citations, or switch to Live Web Search mode.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) text-(--text-main) rounded-xl text-xs cursor-pointer"
                  onClick={() =>
                    onSelectPrompt(
                      "Summarize the core topics covered in the uploaded document.",
                    )
                  }
                >
                  <LuListTodo size={14} className="text-primary-theme" />{" "}
                  Summarize document
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) text-(--text-main) rounded-xl text-xs cursor-pointer"
                  onClick={() =>
                    onSelectPrompt(
                      "What are the key technical concepts mentioned here?",
                    )
                  }
                >
                  <LuCpu size={14} className="text-primary-theme" /> Key
                  concepts
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) text-(--text-main) rounded-xl text-xs cursor-pointer"
                  onClick={() =>
                    onSelectPrompt(
                      "List any critical guidelines or rules stated in the text.",
                    )
                  }
                >
                  <LuTarget size={14} className="text-primary-theme" /> Rules &
                  guidelines
                </button>
              </div>
            </div>
          ) : null}

          {messages.map((msg, idx) => {
            let precedingUserQuery = "";
            for (let i = idx - 1; i >= 0; i--) {
              if (messages[i].role === "user") {
                precedingUserQuery = messages[i].content;
                break;
              }
            }

            const isThisSourceActive = activeSourcesMessageId === msg.id;

            return (
              <MessageItem
                key={msg.id}
                id={`msg-${msg.id}`}
                role={msg.role}
                content={msg.content}
                reply_to={msg.reply_to}
                citations={msg.citations}
                attachments={msg.attachments}
                isHighlighted={activeHighlightedId === msg.id}
                userAvatarUrl={currentUser?.avatar_url}
                userAvatarColor={currentUser?.avatar_color}
                userDisplayName={
                  currentUser?.display_name || currentUser?.username
                }
                queryTitle={precedingUserQuery}
                isSourcesActive={isThisSourceActive}
                onToggleSources={
                  onToggleSources && msg.citations && msg.citations.length > 0
                    ? () =>
                        onToggleSources(
                          msg.id,
                          msg.citations!,
                          precedingUserQuery,
                        )
                    : undefined
                }
                onUseAsReference={onUseAsReference}
                onReply={
                  onReply
                    ? () =>
                        onReply({
                          id: msg.id,
                          role: msg.role,
                          content: msg.content,
                        })
                    : undefined
                }
                onJumpToMessage={scrollToTargetMessage}
              />
            );
          })}

          {streamingMessage && (
            <MessageItem
              role="assistant"
              isStreaming={true}
              content={streamingMessage.content}
              citations={streamingMessage.citations}
              attachments={streamingMessage.attachments}
              isHighlighted={false}
              queryTitle={messages[messages.length - 1]?.content || ""}
              isSourcesActive={activeSourcesMessageId === "streaming"}
              onToggleSources={
                onToggleSources &&
                streamingMessage.citations &&
                streamingMessage.citations.length > 0
                  ? (cits) =>
                      onToggleSources(
                        "streaming",
                        cits,
                        messages[messages.length - 1]?.content || "",
                      )
                  : undefined
              }
              onUseAsReference={onUseAsReference}
            />
          )}

          <div ref={scrollEndRef} />
        </div>
      </div>

      {/* ChatGPT-Style User Prompt Timeline Navigator */}
      <ChatPromptTimeline
        prompts={userPrompts}
        activePromptId={activePromptId}
        onNavigateToPrompt={scrollToPrompt}
        onNavigatePrev={handleNavigatePrev}
        onNavigateNext={handleNavigateNext}
        hasPrev={
          activeIndex > 0 || (activeIndex === -1 && userPrompts.length > 0)
        }
        hasNext={activeIndex < userPrompts.length - 1}
      />

      {/* Scroll to Latest Button */}
      {showScrollButton && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-8 h-8 rounded-full bg-primary-theme text-white shadow-lg flex items-center justify-center cursor-pointer hover:opacity-90 active:opacity-100"
          title="Scroll to latest message"
          aria-label="Scroll to latest message"
        >
          <LuArrowDown size={15} />
        </button>
      )}
    </div>
  );
};
