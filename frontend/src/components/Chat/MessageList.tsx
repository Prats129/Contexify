import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  LuSparkles,
  LuListTodo,
  LuCpu,
  LuTarget,
  LuArrowDown,
} from "react-icons/lu";
import { MessageItem } from "./MessageItem";
import { ChatPromptTimeline } from "./ChatPromptTimeline";
import type { Message, StreamingMessageState, User, Citation } from "../../types";

interface MessageListProps {
  messages: Message[];
  streamingMessage: StreamingMessageState | null;
  onSelectPrompt: (prompt: string) => void;
  currentUser?: User | null;
  activeSourcesMessageId?: string;
  onToggleSources?: (msgId: string, citations: Citation[], queryTitle?: string) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingMessage,
  onSelectPrompt,
  currentUser,
  activeSourcesMessageId,
  onToggleSources,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMsgCountRef = useRef(messages.length);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
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
        className="flex-1 overflow-y-auto px-2 py-4 md:py-6 w-full flex flex-col gap-5"
      >
        {showWelcome && (
          <div className="my-auto flex flex-col items-center text-center p-8 border border-(--border-subtle) bg-(--bg-card) rounded-3xl max-w-2xl mx-auto shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-primary-light-theme border border-primary-theme flex items-center justify-center text-primary-theme text-2xl mb-4">
              <LuSparkles size={24} />
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-(--text-main) mb-2">
              Welcome to Enterprise Knowledge AI
            </h2>
            <p className="text-xs md:text-sm text-(--text-muted) leading-relaxed mb-6 max-w-lg">
              Upload documents to ask grounded questions with verifiable source
              citations, or switch to Live Web Search mode.
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
                <LuCpu size={14} className="text-primary-theme" /> Key concepts
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
        )}

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
              userDisplayName={currentUser?.display_name || currentUser?.username}
              queryTitle={precedingUserQuery}
              isSourcesActive={isThisSourceActive}
              onToggleSources={
                onToggleSources
                  ? (cits) => onToggleSources(msg.id, cits, precedingUserQuery)
                  : undefined
              }
            />
          );
        })}

        {streamingMessage && (
          <MessageItem
            role={streamingMessage.role}
            content={streamingMessage.content}
            citations={streamingMessage.citations}
            isStreaming={streamingMessage.isStreaming}
            isError={streamingMessage.isError}
            userAvatarUrl={currentUser?.avatar_url}
            userAvatarColor={currentUser?.avatar_color}
            userDisplayName={currentUser?.display_name || currentUser?.username}
            queryTitle={messages[messages.length - 1]?.content || ""}
            isSourcesActive={activeSourcesMessageId === "streaming"}
            onToggleSources={
              onToggleSources
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

      {/* ChatGPT-Style User Prompt Timeline Navigator */}
      <ChatPromptTimeline
        prompts={userPrompts}
        activePromptId={activePromptId}
        onNavigateToPrompt={scrollToPrompt}
        onNavigatePrev={handleNavigatePrev}
        onNavigateNext={handleNavigateNext}
        hasPrev={activeIndex > 0 || (activeIndex === -1 && userPrompts.length > 0)}
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
