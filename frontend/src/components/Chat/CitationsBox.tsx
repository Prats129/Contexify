import React from 'react';
import { LuQuote } from 'react-icons/lu';
import type { Citation } from '../../types';

interface CitationsBoxProps {
  citations?: Citation[] | null;
}

export const CitationsBox: React.FC<CitationsBoxProps> = ({ citations }) => {
  if (!citations || citations.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 p-3 bg-blue-950/30 border border-blue-500/20 rounded-xl">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-400">
        <LuQuote size={13} />
        <span>Retrieved Context Citations ({citations.length})</span>
      </div>
      <div className="flex flex-col gap-2">
        {citations.map((c, idx) => (
          <div
            key={idx}
            className="p-2.5 bg-black/40 border border-white/5 rounded-lg text-xs flex flex-col gap-1"
          >
            <div className="text-[11px] font-mono text-gray-400">
              📄 {c.filename} {c.page_number ? `(Page ${c.page_number})` : ''} • Match:{' '}
              <span className="text-emerald-400 font-semibold">
                {(c.similarity_score * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-gray-300 italic text-[11px] leading-relaxed">
              "{c.snippet}"
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
