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
        <div className="my-auto flex flex-col items-center text-center p-8 border border-white/10 bg-gradient-to-b from-blue-900/10 to-transparent rounded-3xl max-w-2xl mx-auto shadow-xl shadow-black/20">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 text-2xl shadow-lg shadow-blue-500/20 mb-4">
            <LuSparkles size={24} />
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-100 mb-2">
            Welcome to Enterprise Knowledge AI
          </h2>
          <p className="text-xs md:text-sm text-gray-400 leading-relaxed mb-6 max-w-lg">
            Upload documents to ask grounded questions with verifiable source
            citations, or switch to Live Web Search mode.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-300 hover:text-white rounded-xl text-xs transition-all cursor-pointer"
              onClick={() =>
                onSelectPrompt(
                  'Summarize the core topics covered in the uploaded document.'
                )
              }
            >
              <LuListTodo size={14} className="text-blue-400" /> Summarize document
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-300 hover:text-white rounded-xl text-xs transition-all cursor-pointer"
              onClick={() =>
                onSelectPrompt(
                  'What are the key technical concepts mentioned here?'
                )
              }
            >
              <LuCpu size={14} className="text-purple-400" /> Key concepts
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-300 hover:text-white rounded-xl text-xs transition-all cursor-pointer"
              onClick={() =>
                onSelectPrompt(
                  'List any critical guidelines or rules stated in the text.'
                )
              }
            >
              <LuTarget size={14} className="text-emerald-400" /> Rules & guidelines
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
