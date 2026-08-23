import React from 'react';
import { LuBrain, LuUser, LuTriangleAlert } from 'react-icons/lu';
import { CitationsBox } from './CitationsBox';
import type { Citation } from '../../types';

interface MessageItemProps {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  isStreaming?: boolean;
  isError?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  role,
  content,
  citations,
  isStreaming,
  isError,
}) => {
  const isUser = role === 'user';

  const formatContent = (text: string) => {
    if (!text) return '';
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\n)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={index} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={index}
            className="px-1.5 py-0.5 bg-(--border-subtle) border border-(--border-subtle) rounded font-mono text-xs text-primary-theme"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part === '\n') {
        return <br key={index} />;
      }
      return part;
    });
  };

  return (
    <div
      className={`flex items-start gap-3 w-full animate-[fadeIn_0.15s_ease-out] ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary-theme flex items-center justify-center text-white text-sm shrink-0 mt-1">
          <LuBrain size={16} />
        </div>
      )}

      <div
        className={`flex flex-col gap-2 max-w-[85%] md:max-w-[75%] ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        <div
          className={`p-4 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-primary-theme text-white rounded-br-none'
              : 'bg-(--bg-card) border border-(--border-subtle) text-(--text-main) rounded-tl-none shadow-sm'
          }`}
        >
          {isError ? (
            <span className="text-red-500 flex items-center gap-1.5">
              <LuTriangleAlert size={16} /> {content}
            </span>
          ) : isStreaming && !content ? (
            <span className="flex items-center gap-2 text-(--text-muted)">
              <span className="w-2 h-2 rounded-full bg-primary-theme animate-ping"></span>
              Generating answer...
            </span>
          ) : (
            formatContent(content)
          )}
        </div>

        {!isUser && citations && citations.length > 0 && (
          <div className="w-full mt-1">
            <CitationsBox citations={citations} />
          </div>
        )}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-full bg-primary-theme flex items-center justify-center text-white text-sm shrink-0 mt-1">
          <LuUser size={16} />
        </div>
      )}
    </div>
  );
};
