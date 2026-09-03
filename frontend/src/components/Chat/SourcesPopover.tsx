import React, { useRef, useEffect } from 'react';
import {
  LuChevronDown,
  LuChevronRight,
  LuChevronsRight,
  LuGlobe,
  LuFileText,
  LuLandmark,
} from 'react-icons/lu';
import type { Citation } from '../../types';

interface SourcesPopoverProps {
  isOpen: boolean;
  onHide: () => void;
  citations: Citation[];
  queryTitle?: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

function extractDomainAndUrl(c: Citation): { domain: string; url: string; displaySnippet: string } {
  let url = '';
  let domain = '';
  let displaySnippet = c.snippet;

  const lines = c.snippet.split('\n');
  if (lines[0].startsWith('http://') || lines[0].startsWith('https://')) {
    url = lines[0].trim();
    displaySnippet = lines.slice(1).join(' ').trim();
  } else if (c.document_id && (c.document_id.startsWith('http://') || c.document_id.startsWith('https://'))) {
    url = c.document_id;
  }

  if (url) {
    try {
      const parsed = new URL(url);
      domain = parsed.hostname.replace(/^www\./, '');
    } catch {
      domain = 'web';
    }
  }

  return { domain, url, displaySnippet };
}

export const SourcesPopover: React.FC<SourcesPopoverProps> = ({
  isOpen,
  onHide,
  citations,
  queryTitle,
  isCollapsed,
  onToggleCollapse,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onHide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onHide]);

  if (!isOpen || !citations || citations.length === 0) return null;

  return (
    <div className="flex items-start gap-2">
      {/* 1. Left Arrow Button (») completely hides the right-side space */}
      <button
        type="button"
        onClick={onHide}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle) cursor-pointer transition-colors shrink-0 mt-2"
        title="Hide sources panel"
        aria-label="Hide sources panel"
      >
        <LuChevronsRight size={18} />
      </button>

      {/* 2. Collapsed State: Slim horizontal pill bar matching screenshot */}
      {isCollapsed ? (
        <div
          onClick={onToggleCollapse}
          className="w-72 sm:w-80 rounded-2xl bg-(--bg-card) border border-(--border-subtle) hover:border-(--border-hover) shadow-lg px-4 py-2.5 flex items-center justify-between cursor-pointer transition-all hover:scale-[1.01] select-none"
          title="Click to expand sources"
        >
          <span className="text-sm font-semibold text-(--text-muted) hover:text-(--text-main)">
            Sources
          </span>

          <div className="flex items-center gap-2">
            {/* Circular overlapping icons */}
            <div className="flex items-center -space-x-1.5">
              {citations.slice(0, 3).map((c, i) => {
                const { domain } = extractDomainAndUrl(c);
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

            <span className="text-xs font-semibold text-(--text-muted)">
              {citations.length}
            </span>

            <LuChevronRight size={16} className="text-(--text-muted)" />
          </div>
        </div>
      ) : (
        /* 3. Expanded State: Full vertical card with sources list */
        <div
          ref={popoverRef}
          className="w-80 sm:w-88 rounded-2xl bg-(--bg-card) border border-(--border-subtle) shadow-2xl overflow-hidden flex flex-col z-20 animate-[fadeIn_0.15s_ease-out]"
        >
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-(--border-subtle) flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-(--text-main)">Sources</span>
              <button
                type="button"
                onClick={onToggleCollapse}
                className="w-6 h-6 rounded-md flex items-center justify-center text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle) cursor-pointer transition-colors"
                title="Collapse sources card"
                aria-label="Collapse sources card"
              >
                <LuChevronDown size={16} />
              </button>
            </div>

            {queryTitle && (
              <p className="text-xs text-slate-400 truncate font-normal">
                Results for "{queryTitle}"
              </p>
            )}
          </div>

          {/* Compact Scrollable Sources List */}
          <div className="max-h-80 overflow-y-auto p-3 flex flex-col gap-3">
            {citations.map((c, idx) => {
              const { domain, url, displaySnippet } = extractDomainAndUrl(c);
              const isWeb = Boolean(url || domain || !c.document_id);

              return (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl hover:bg-(--border-subtle)/30 flex flex-col gap-1 transition-all group"
                >
                  {/* Domain & landmark badge row */}
                  <div className="flex items-center justify-between gap-1.5 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isWeb && domain ? (
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                          alt={domain}
                          className="w-4 h-4 rounded-full shrink-0 object-contain"
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : isWeb ? (
                        <LuGlobe size={14} className="text-emerald-500 shrink-0" />
                      ) : (
                        <LuFileText size={14} className="text-primary-theme shrink-0" />
                      )}

                      <span className="font-normal text-(--text-muted) truncate text-xs">
                        {domain || c.filename || 'Source'}
                      </span>
                      {isWeb && (
                        <LuLandmark size={11} className="text-(--text-muted) opacity-60 shrink-0" />
                      )}
                    </div>

                    {!isWeb && c.page_number && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-(--border-subtle) text-(--text-muted) shrink-0 font-medium">
                        p. {c.page_number}
                      </span>
                    )}
                  </div>

                  {/* Bold Title Link */}
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-(--text-main) group-hover:text-primary-theme group-hover:underline leading-snug"
                    >
                      <span className="line-clamp-2">{c.filename || domain}</span>
                    </a>
                  ) : (
                    <div className="text-xs font-bold text-(--text-main) line-clamp-2 leading-snug">
                      {c.filename}
                    </div>
                  )}

                  {/* Subtitle / Snippet description */}
                  {displaySnippet && (
                    <p className="text-[11px] text-(--text-muted) leading-relaxed line-clamp-2">
                      {displaySnippet}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};


