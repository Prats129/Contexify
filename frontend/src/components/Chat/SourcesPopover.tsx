import React, { useRef, useEffect } from 'react';
import {
  LuChevronDown,
  LuChevronRight,
  LuChevronsRight,
  LuGlobe,
  LuFileText,
  LuLandmark,
  LuX,
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

interface CitationItemProps {
  citation: Citation;
}

const CitationCard: React.FC<CitationItemProps> = ({ citation: c }) => {
  const { domain, url, displaySnippet } = extractDomainAndUrl(c);
  const isWeb = Boolean(url || domain || !c.document_id);

  return (
    <div className="p-2.5 rounded-xl hover:bg-(--border-subtle)/40 border border-(--border-subtle) bg-(--border-subtle)/20 flex flex-col gap-1.5 transition-all group">
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

          <span className="font-medium text-(--text-muted) truncate text-xs">
            {domain || c.filename || 'Source'}
          </span>
          {isWeb && <LuLandmark size={11} className="text-(--text-muted) opacity-60 shrink-0" />}
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
          className="text-xs font-bold text-(--text-main) group-hover:text-primary-theme group-hover:underline leading-snug wrap-break-word"
        >
          <span className="line-clamp-2">{c.filename || domain}</span>
        </a>
      ) : (
        <div className="text-xs font-bold text-(--text-main) line-clamp-2 leading-snug wrap-break-word">
          {c.filename}
        </div>
      )}

      {/* Subtitle / Snippet description */}
      {displaySnippet && (
        <p className="text-[11px] text-(--text-muted) leading-relaxed line-clamp-3">
          {displaySnippet}
        </p>
      )}
    </div>
  );
};

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
    <>
      {/* 1. Mobile & Tablet Bottom Sheet (< lg) */}
      <div className="lg:hidden">
        {/* Semi-transparent backdrop overlay */}
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs animate-[fadeIn_0.15s_ease-out]"
          onClick={onHide}
          aria-hidden="true"
        />

        {/* Slide-up Bottom Sheet Modal */}
        <div
          ref={popoverRef}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[82vh] rounded-t-3xl bg-(--bg-card) border-t border-(--border-hover) shadow-2xl flex flex-col pb-safe animate-[sheetIn_0.22s_cubic-bezier(0.16,1,0.3,1)]"
          role="dialog"
          aria-modal="true"
          aria-label="Sources and Citations"
        >
          {/* Pull Handle Indicator */}
          <div className="pt-3 pb-1 flex justify-center cursor-grab" onClick={onHide}>
            <div className="w-10 h-1 rounded-full bg-(--text-muted)/30" />
          </div>

          {/* Header */}
          <div className="px-5 py-3 border-b border-(--border-subtle) flex items-center justify-between">
            <div className="flex flex-col min-w-0 mr-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-(--text-main)">Sources & Citations</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary-light-theme text-primary-theme font-semibold">
                  {citations.length}
                </span>
              </div>
              {queryTitle && (
                <p className="text-[11px] text-(--text-muted) truncate font-normal mt-0.5">
                  Results for &ldquo;{queryTitle}&rdquo;
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={onHide}
              className="w-8 h-8 rounded-full bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-muted) hover:text-(--text-main) flex items-center justify-center cursor-pointer transition-colors shrink-0"
              title="Close sources"
              aria-label="Close sources"
            >
              <LuX size={16} />
            </button>
          </div>

          {/* Scrollable Sources List */}
          <div className="overflow-y-auto px-4 py-3 flex flex-col gap-2.5 max-h-[62vh]">
            {citations.map((c, idx) => (
              <CitationCard key={idx} citation={c} />
            ))}
          </div>
        </div>
      </div>

      {/* 2. Desktop Floating Right Panel (lg+) */}
      <div className="hidden lg:flex items-start gap-2">
        {/* Left Arrow Button (») completely hides the right-side space */}
        <button
          type="button"
          onClick={onHide}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle) cursor-pointer transition-colors shrink-0 mt-2"
          title="Hide sources panel"
          aria-label="Hide sources panel"
        >
          <LuChevronsRight size={18} />
        </button>

        {/* Collapsed State: Slim horizontal pill bar */}
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
          /* Expanded State: Full vertical card with sources list */
          <div
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
                  Results for &ldquo;{queryTitle}&rdquo;
                </p>
              )}
            </div>

            {/* Compact Scrollable Sources List */}
            <div className="max-h-80 overflow-y-auto p-3 flex flex-col gap-2.5">
              {citations.map((c, idx) => (
                <CitationCard key={idx} citation={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
