import React, { useState } from 'react';
import { LuBrain, LuUser, LuTriangleAlert, LuCopy, LuCheck } from 'react-icons/lu';
import { CitationsBox } from './CitationsBox';
import type { Citation } from '../../types';

interface MessageItemProps {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  isStreaming?: boolean;
  isError?: boolean;
  userAvatarUrl?: string | null;
  userAvatarColor?: string;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  role,
  content,
  citations,
  isStreaming,
  isError,
  userAvatarUrl,
  userAvatarColor,
}) => {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
      const textarea = document.createElement('textarea');
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
      className={`group flex items-start gap-2 w-full animate-[fadeIn_0.15s_ease-out] ${isUser ? 'justify-end' : 'justify-start'
        }`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary-theme flex items-center justify-center text-white text-sm shrink-0 mt-1">
          <LuBrain size={16} />
        </div>
      )}

      <div
        className={`flex flex-col gap-1 max-w-[85%] md:max-w-[75%] ${isUser ? 'items-end' : 'items-start mt-1'
          }`}
      >
        <div
          className={`px-4 py-1 rounded-2xl text-sm leading-relaxed ${isUser
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

        {/* Action toolbar on hover (ChatGPT style) */}
        {content && !isStreaming && (
          <div
            className={`flex items-center gap-1 mt-0.5 transition-opacity duration-150 ${copied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
          >
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle) px-1.5 py-0.5 rounded cursor-pointer transition-colors"
              title={copied ? 'Copied to clipboard' : 'Copy message'}
            >
              {copied ? (
                <>
                  <LuCheck size={12} className="text-emerald-500" />
                  <span className="text-emerald-500 text-[10px] font-medium">Copied</span>
                </>
              ) : (
                <LuCopy size={12} />
              )}
            </button>
          </div>
        )}

        {!isUser && citations && citations.length > 0 && (
          <div className="w-full mt-1">
            <CitationsBox citations={citations} />
          </div>
        )}
      </div>

      {isUser && (
        userAvatarUrl ? (
          <img
            src={userAvatarUrl}
            alt="User"
            className="w-8 h-8 rounded-full object-cover shrink-0 mt-1 border border-(--border-subtle)"
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm shrink-0 mt-1"
            style={{ backgroundColor: userAvatarColor || 'var(--color-primary)' }}
          >
            <LuUser size={16} />
          </div>
        )
      )}
    </div>
  );
};
