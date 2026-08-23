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
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      if (part === '\n') {
        return <br key={index} />;
      }
      return part;
    });
  };

  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <div className="message-avatar">
          <LuBrain />
        </div>
      )}

      <div className="message-content-wrapper">
        <div className="message-bubble">
          {isError ? (
            <span style={{ color: '#EF4444', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <LuTriangleAlert /> {content}
            </span>
          ) : isStreaming && !content ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Generating answer...
            </span>
          ) : (
            formatContent(content)
          )}
        </div>

        {!isUser && citations && citations.length > 0 && (
          <div className="citations-container">
            <CitationsBox citations={citations} />
          </div>
        )}
      </div>

      {isUser && (
        <div className="message-avatar">
          <LuUser />
        </div>
      )}
    </div>
  );
};
