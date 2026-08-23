import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  LuSparkles,
  LuListTodo,
  LuCpu,
  LuTarget,
  LuArrowDown,
} from "react-icons/lu";
import { MessageItem } from "./MessageItem";
import type { Message, StreamingMessageState } from "../../types";

interface MessageListProps {
  messages: Message[];
  streamingMessage: StreamingMessageState | null;
  onSelectPrompt: (prompt: string) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingMessage,
  onSelectPrompt,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMsgCountRef = useRef(messages.length);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Check scroll position
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
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    scrollEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
    });
    isAtBottomRef.current = true;
    setShowScrollButton(false);
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
  }, [messages, streamingMessage, scrollToBottom]);

  const showWelcome = messages.length === 0 && !streamingMessage;

  return (
    <div className="relative flex-1 overflow-hidden flex flex-col w-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-5 max-w-4xl w-full mx-auto"
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

        {messages.map((msg) => (
          <MessageItem
            key={msg.id}
            role={msg.role}
            content={msg.content}
            citations={msg.citations}
          />
        ))}

        {streamingMessage && (
          <MessageItem
            role={streamingMessage.role}
            content={streamingMessage.content}
            citations={streamingMessage.citations}
            isStreaming={streamingMessage.isStreaming}
            isError={streamingMessage.isError}
          />
        )}

        <div ref={scrollEndRef} />
      </div>

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
