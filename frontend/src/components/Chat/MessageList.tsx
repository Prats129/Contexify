import React, {
  useEffect,
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
} from "react-icons/lu";
import { MessageItem } from "./MessageItem";
import { ChatPromptTimeline } from "./ChatPromptTimeline";
import type {
  Message,
  StreamingMessageState,
  User,
  Citation,
} from "../../types";

interface MessageListProps {
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
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingMessage,
  onSelectPrompt,
  currentUser,
  activeSourcesMessageId,
  onToggleSources,
  activeSources,
  isTemporaryChat = false,
  onToggleTemporaryChat,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMsgCountRef = useRef(messages.length);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // Check scroll position & update active prompt
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const offsetFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Considered at bottom if within 80px
    const atBottom = offsetFromBottom < 80;
    isAtBottomRef.current = atBottom;

    // Show button if user has scrolled up and content is tall enough
    const canScroll = el.scrollHeight > el.clientHeight + 100;
    setShowScrollButton(!atBottom && canScroll);

    updateActivePrompt();
  }, [updateActivePrompt]);

  const scrollToBottom = useCallback((smooth = true) => {
    scrollEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
    });
    isAtBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  // Jump to specific user prompt with smooth scroll and momentary highlight glow
  const scrollToPrompt = useCallback((promptId: string) => {
    const el = document.getElementById(`msg-${promptId}`);
    if (el) {
      el.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setActivePromptId(promptId);

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      setHighlightedMessageId(promptId);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 1600);
    }
  }, []);

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

  // Handle auto-scrolling on messages or stream update
  useEffect(() => {
    const isNewMessageAdded = messages.length > prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;

    if (isNewMessageAdded) {
      // Always scroll down on brand new messages (user sent or final assistant message)
      scrollToBottom(true);
    } else if (streamingMessage) {
      // ONLY scroll during active streaming if user was already at the bottom
      if (isAtBottomRef.current) {
        scrollToBottom(false);
      }
    }
    updateActivePrompt();
  }, [messages, streamingMessage, scrollToBottom, updateActivePrompt]);

  const showWelcome = messages.length === 0 && !streamingMessage;

  return (
    <div className="relative flex-1 overflow-hidden flex flex-col w-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 sm:px-6 py-4 md:py-6 w-full flex flex-col items-center"
      >
        <div
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
                citations={msg.citations}
                isHighlighted={highlightedMessageId === msg.id}
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
              />
            );
          })}

          {streamingMessage && (
            <MessageItem
              role="assistant"
              isStreaming={true}
              content={streamingMessage.content}
              citations={streamingMessage.citations}
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
