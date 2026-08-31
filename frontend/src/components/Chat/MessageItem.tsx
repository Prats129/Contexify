import React, { useState } from 'react';
import { LuBrain, LuTriangleAlert, LuCopy, LuCheck, LuExternalLink } from 'react-icons/lu';
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
  userDisplayName?: string;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  role,
  content,
  citations,
  isStreaming,
  isError,
  userAvatarUrl,
  userAvatarColor,
  userDisplayName,
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

  const renderInline = (line: string, lineKey: string | number) => {
    // Regex matching markdown link [text](url), raw URLs, bold **text**, and inline code `code`
    const inlineRegex = /(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<)]+|\*\*[^*]+\*\*|`[^`]+`)/g;
    const segments = line.split(inlineRegex);

    return segments.map((seg, idx) => {
      const key = `${lineKey}-${idx}`;
      if (!seg) return null;

      // 1. Markdown link: [Title](https://...)
      const mdLinkMatch = seg.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (mdLinkMatch) {
        const [, title, url] = mdLinkMatch;
        return (
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-theme hover:underline inline-flex items-center gap-0.5 font-medium underline-offset-2 break-all"
          >
            <span>{title}</span>
            <LuExternalLink size={10} className="inline ml-0.5 opacity-70 shrink-0" />
          </a>
        );
      }

      // 2. Raw URL: https://...
      if (/^https?:\/\/[^\s]+$/.test(seg)) {
        return (
          <a
            key={key}
            href={seg}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-theme hover:underline inline-flex items-center gap-0.5 font-medium underline-offset-2 break-all"
          >
            <span>{seg}</span>
            <LuExternalLink size={10} className="inline ml-0.5 opacity-70 shrink-0" />
          </a>
        );
      }

      // 3. Bold: **text**
      if (seg.startsWith('**') && seg.endsWith('**') && seg.length >= 4) {
        return (
          <strong key={key} className="font-semibold text-(--text-main)">
            {seg.slice(2, -2)}
          </strong>
        );
      }

      // 4. Inline code: `code`
      if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
        return (
          <code
            key={key}
            className="px-1.5 py-0.5 bg-(--border-subtle) border border-(--border-subtle) rounded font-mono text-xs text-primary-theme font-medium"
          >
            {seg.slice(1, -1)}
          </code>
        );
      }

      return <React.Fragment key={key}>{seg}</React.Fragment>;
    });
  };

  const formatContent = (text: string) => {
    if (!text) return '';
    const lines = text.split('\n');

    return lines.map((line, lineIdx) => {
      const trimmed = line.trim();

      // Heading 3: ### Title
      if (line.startsWith('### ')) {
        return (
          <h4 key={lineIdx} className="text-sm font-bold text-(--text-main) mt-2.5 mb-1 flex items-center gap-1.5">
            {renderInline(line.slice(4), lineIdx)}
          </h4>
        );
      }

      // Heading 2: ## Title
      if (line.startsWith('## ')) {
        return (
          <h3 key={lineIdx} className="text-base font-bold text-(--text-main) mt-3 mb-1.5">
            {renderInline(line.slice(3), lineIdx)}
          </h3>
        );
      }

      // Heading 1: # Title
      if (line.startsWith('# ')) {
        return (
          <h2 key={lineIdx} className="text-lg font-bold text-(--text-main) mt-3.5 mb-2">
            {renderInline(line.slice(2), lineIdx)}
          </h2>
        );
      }

      // Bullet List item: - text or * text
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <div key={lineIdx} className="flex items-start gap-2 my-1 pl-2">
            <span className="text-primary-theme text-xs mt-1 shrink-0">•</span>
            <span className="flex-1 leading-relaxed">{renderInline(line.slice(2), lineIdx)}</span>
          </div>
        );
      }

      // Numbered List item: 1. text, 2. text
      const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        return (
          <div key={lineIdx} className="flex items-start gap-2 my-1 pl-2">
            <span className="font-semibold text-primary-theme text-xs mt-0.5 shrink-0">{numMatch[1]}.</span>
            <span className="flex-1 leading-relaxed">{renderInline(numMatch[2], lineIdx)}</span>
          </div>
        );
      }

      // Empty line -> paragraph spacing
      if (trimmed === '') {
        return <div key={lineIdx} className="h-2" />;
      }

      // Regular line
      return (
        <div key={lineIdx} className="leading-relaxed">
          {renderInline(line, lineIdx)}
        </div>
      );
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
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-xs shrink-0 mt-1"
            style={{ backgroundColor: userAvatarColor || 'var(--color-primary)' }}
          >
            {userDisplayName ? userDisplayName.charAt(0).toUpperCase() : 'U'}
          </div>
        )
      )}
    </div>
  );
};
