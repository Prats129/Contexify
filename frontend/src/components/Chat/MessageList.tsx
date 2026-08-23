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
    <div className="chat-history">
      {showWelcome && (
        <div className="welcome-banner">
          <div className="welcome-icon">
            <LuSparkles />
          </div>
          <h2>Welcome to Enterprise Knowledge AI</h2>
          <p>
            Upload documents to ask grounded questions with verifiable source
            citations, or switch to Live Web Search mode. All chat history and
            documents are permanently saved to your account.
          </p>

          <div className="quick-prompts">
            <button
              type="button"
              className="prompt-chip"
              onClick={() =>
                onSelectPrompt(
                  'Summarize the core topics covered in the uploaded document.'
                )
              }
            >
              <LuListTodo /> Summarize document
            </button>
            <button
              type="button"
              className="prompt-chip"
              onClick={() =>
                onSelectPrompt(
                  'What are the key technical concepts mentioned here?'
                )
              }
            >
              <LuCpu /> Key concepts
            </button>
            <button
              type="button"
              className="prompt-chip"
              onClick={() =>
                onSelectPrompt(
                  'List any critical guidelines or rules stated in the text.'
                )
              }
            >
              <LuTarget /> Extract rules & guidelines
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
