import React, { useState } from 'react';
import { LuBrain, LuTriangleAlert, LuCopy, LuCheck, LuExternalLink } from 'react-icons/lu';
import type { Citation } from '../../types';

interface MessageItemProps {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | null;
  isStreaming?: boolean;
  isError?: boolean;
  userAvatarUrl?: string | null;
  userAvatarColor?: string;
  userDisplayName?: string;
  queryTitle?: string;
  isSourcesActive?: boolean;
  isHighlighted?: boolean;
  onToggleSources?: (citations: Citation[]) => void;
}

export const MessageItem: React.FC<MessageItemProps> = React.memo(({
  id,
  role,
  content,
  citations,
  isStreaming,
  isError,
  userAvatarUrl,
  userAvatarColor,
  userDisplayName,
  isSourcesActive,
  isHighlighted,
  onToggleSources,
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

      // Bullet points: - item or * item
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const bulletContent = trimmed.slice(2);
        return (
          <div key={lineIdx} className="flex items-start gap-2 my-1 pl-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-theme shrink-0 mt-2"></span>
            <div className="flex-1 min-w-0">{renderInline(bulletContent, lineIdx)}</div>
          </div>
        );
      }

      // Numbered points: 1. item
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        const [, num, itemContent] = numMatch;
        return (
          <div key={lineIdx} className="flex items-start gap-2 my-1 pl-1">
            <span className="text-xs font-bold text-primary-theme shrink-0 mt-0.5 min-w-[1.2rem]">
              {num}.
            </span>
            <div className="flex-1 min-w-0">{renderInline(itemContent, lineIdx)}</div>
          </div>
        );
      }

      // Empty line / paragraph break
      if (!trimmed) {
        return <div key={lineIdx} className="h-2" />;
      }

      // Regular paragraph line
      return (
        <div key={lineIdx} className="my-0.5">
          {renderInline(line, lineIdx)}
        </div>
      );
    });
  };

  return (
    <div
      id={id}
      className={`group flex items-start gap-2 w-full transition-all duration-300 scroll-mt-6 ${
        isUser ? 'justify-end' : 'justify-start'
      } ${
        isHighlighted
          ? 'scale-[1.01] -translate-y-0.5'
          : ''
      }`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary-theme flex items-center justify-center text-white text-sm shrink-0 mt-1">
          <LuBrain size={16} />
        </div>
      )}

      <div
        className={`flex flex-col gap-1 max-w-[85%] md:max-w-[75%] ${
          isUser ? 'items-end' : 'items-start mt-1'
        }`}
      >
        <div
          className={`px-4 py-2 rounded-2xl text-sm leading-relaxed transition-all duration-300 ${
            isUser
              ? `bg-primary-theme text-white rounded-br-none ${
                  isHighlighted ? 'ring-3 ring-primary-theme/50 shadow-lg' : ''
                }`
              : `bg-(--bg-card) border border-(--border-subtle) text-(--text-main) rounded-tl-none shadow-sm ${
                  isHighlighted ? 'ring-2 ring-primary-theme shadow-md' : ''
                }`
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

        {/* Action toolbar (ChatGPT & Perplexity style) */}
        {content && !isStreaming && (
          <div className="flex items-center justify-between w-full mt-1 px-1">
            {/* Left side actions: Copy button */}
            <div
              className={`flex items-center gap-1 transition-opacity duration-150 ${copied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
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

            {/* Right side: Perplexity-style Sources Pill Button */}
            {!isUser && citations && citations.length > 0 && onToggleSources && (
              <button
                type="button"
                onClick={() => onToggleSources(citations)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium cursor-pointer transition-all shadow-2xs hover:scale-[1.02] ${isSourcesActive
                  ? 'bg-primary-light-theme border-primary-theme text-primary-theme font-semibold'
                  : 'bg-(--border-subtle) hover:bg-(--border-hover) border-(--border-subtle) text-(--text-muted) hover:text-(--text-main)'
                  }`}
                title="Toggle sources on the right"
              >
                {/* Grouped overlapping icons */}
                <div className="flex items-center -space-x-1.5">
                  {citations.slice(0, 3).map((c, i) => {
                    const lines = c.snippet.split('\n');
                    let domain = '';
                    if (lines[0].startsWith('http')) {
                      try {
                        domain = new URL(lines[0]).hostname.replace(/^www\./, '');
                      } catch {
                        domain = '';
                      }
                    }
                    return (
                      <div
                        key={i}
                        className="w-4 h-4 rounded-full bg-(--bg-card) border border-(--border-subtle) flex items-center justify-center overflow-hidden shrink-0"
                      >
                        {domain ? (
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                            alt=""
                            className="w-3 h-3 object-contain"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary-theme" />
                        )}
                      </div>
                    );
                  })}
                </div>
                <span>
                  {citations.length} {citations.length === 1 ? 'source' : 'sources'}
                </span>
              </button>
            )}
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
});
