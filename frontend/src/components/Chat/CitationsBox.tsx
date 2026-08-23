import React from 'react';
import { LuQuote } from 'react-icons/lu';
import type { Citation } from '../../types';

interface CitationsBoxProps {
  citations?: Citation[] | null;
}

export const CitationsBox: React.FC<CitationsBoxProps> = ({ citations }) => {
  if (!citations || citations.length === 0) return null;

  return (
    <div className="citations-box">
      <div className="citations-header">
        <LuQuote /> Retrieved Context Citations ({citations.length})
      </div>
      {citations.map((c, idx) => (
        <div key={idx} className="citation-item">
          <div className="citation-meta">
            📄 {c.filename} {c.page_number ? `(Page ${c.page_number})` : ''} • Match:{' '}
            {(c.similarity_score * 100).toFixed(0)}%
          </div>
          <div className="citation-snippet">"{c.snippet}"</div>
        </div>
      ))}
    </div>
  );
};
