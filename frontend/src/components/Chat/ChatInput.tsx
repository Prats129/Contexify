import React, { useRef, useEffect } from 'react';
import type { ChatMode } from '../../types';

interface ChatInputProps {
  inputQuery: string;
  setInputQuery: (query: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  isSending: boolean;
  currentMode: ChatMode;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  inputQuery,
  setInputQuery,
  onSubmit,
  isSending,
  currentMode,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        150
      )}px`;
    }
  }, [inputQuery]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  const placeholderText =
    currentMode === 'DOCUMENT_RAG'
      ? 'Ask any question based on your uploaded document content...'
      : 'Ask a question to search the internet in real-time...';

  return (
    <div className="chat-input-container">
      <form onSubmit={onSubmit} className="input-form">
        <div className="textarea-wrapper">
          <textarea
            ref={textareaRef}
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholderText}
            rows={1}
            required
            disabled={isSending}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={isSending || !inputQuery.trim()}
            title="Send Question"
          >
            {isSending ? (
              <i className="fa-solid fa-spinner fa-spin"></i>
            ) : (
              <i className="fa-solid fa-paper-plane"></i>
            )}
          </button>
        </div>
      </form>
      <div className="input-footer">
        <span>
          <i className="fa-solid fa-database"></i> Persistent Relational Storage
          • Real-time Stream with Citations
        </span>
      </div>
    </div>
  );
};
