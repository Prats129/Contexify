import React, { useEffect, useRef } from 'react';
import { LuSparkles, LuListTodo, LuCpu, LuTarget } from 'react-icons/lu';
import { MessageItem } from './MessageItem';
import type { Message, StreamingMessageState } from '../../types';

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
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  const showWelcome = messages.length === 0 && !streamingMessage;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-5 max-w-4xl w-full mx-auto">
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
                  'Summarize the core topics covered in the uploaded document.'
                )
              }
            >
              <LuListTodo size={14} className="text-primary-theme" /> Summarize document
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 bg-(--border-subtle) hover:bg-(--border-hover) border border-(--border-subtle) text-(--text-main) rounded-xl text-xs cursor-pointer"
              onClick={() =>
                onSelectPrompt(
                  'What are the key technical concepts mentioned here?'
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
                  'List any critical guidelines or rules stated in the text.'
                )
              }
            >
              <LuTarget size={14} className="text-primary-theme" /> Rules & guidelines
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
  );
};
