import React from 'react';
import { LuQuote, LuGlobe, LuExternalLink, LuFileText } from 'react-icons/lu';
import type { Citation } from '../../types';

interface CitationsBoxProps {
  citations?: Citation[] | null;
}

export const CitationsBox: React.FC<CitationsBoxProps> = ({ citations }) => {
  if (!citations || citations.length === 0) return null;

  const isWebCitation = (c: Citation) => {
    return (
      c.snippet.startsWith('http://') ||
      c.snippet.startsWith('https://') ||
      !c.document_id ||
      c.document_id === ''
    );
  };

  const isWebMode = citations.some(isWebCitation);

  return (
    <div className="flex flex-col gap-2 p-3 bg-(--bg-card) border border-(--border-subtle) rounded-xl shadow-xs">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-(--text-muted)">
        {isWebMode ? <LuGlobe size={13} className="text-emerald-500" /> : <LuQuote size={13} className="text-primary-theme" />}
        <span>{isWebMode ? `Web Sources (${citations.length})` : `Retrieved Document Citations (${citations.length})`}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {citations.map((c, idx) => {
          const web = isWebCitation(c);
          let targetUrl = '';
          let displaySnippet = c.snippet;

          if (web) {
            const lines = c.snippet.split('\n');
            if (lines[0].startsWith('http://') || lines[0].startsWith('https://')) {
              targetUrl = lines[0];
              displaySnippet = lines.slice(1).join(' ').trim();
            }
          }

          return (
            <div
              key={idx}
              className="p-2.5 bg-(--bg-app) border border-(--border-subtle) hover:border-primary-theme/50 rounded-lg text-xs flex flex-col gap-1 transition-colors"
            >
              <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-(--text-main)">
                <div className="flex items-center gap-1 min-w-0 truncate">
                  {web ? (
                    <LuGlobe size={12} className="text-emerald-500 shrink-0" />
                  ) : (
                    <LuFileText size={12} className="text-primary-theme shrink-0" />
                  )}
                  {targetUrl ? (
                    <a
                      href={targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-theme hover:underline truncate font-semibold flex items-center gap-0.5"
                    >
                      <span>{c.filename}</span>
                      <LuExternalLink size={10} className="shrink-0 opacity-70" />
                    </a>
                  ) : (
                    <span className="truncate font-semibold">{c.filename}</span>
                  )}
                </div>

                {!web && c.page_number && (
                  <span className="text-[10px] text-(--text-muted) shrink-0">
                    p. {c.page_number}
                  </span>
                )}
              </div>

              {displaySnippet && (
                <div className="text-(--text-muted) text-[11px] leading-relaxed line-clamp-2">
                  {displaySnippet}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

