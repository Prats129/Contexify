import React from 'react';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import type { ChatMode, Message, StreamingMessageState } from '../../types';

interface ChatWorkspaceProps {
  currentMode: ChatMode;
  activeSessionId: string | null;
  onNewSession: () => void;
  messages: Message[];
  streamingMessage: StreamingMessageState | null;
  onSelectPrompt: (prompt: string) => void;
  inputQuery: string;
  setInputQuery: (query: string) => void;
  onSendMessage: (e?: React.FormEvent) => void;
  isSending: boolean;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  currentMode,
  activeSessionId,
  onNewSession,
  messages,
  streamingMessage,
  onSelectPrompt,
  inputQuery,
  setInputQuery,
  onSendMessage,
  isSending,
}) => {
  return (
    <main className="chat-workspace">
      <ChatHeader
        currentMode={currentMode}
        sessionId={activeSessionId}
        onNewSession={onNewSession}
      />

      <MessageList
        messages={messages}
        streamingMessage={streamingMessage}
        onSelectPrompt={onSelectPrompt}
      />

      <ChatInput
        inputQuery={inputQuery}
        setInputQuery={setInputQuery}
        onSubmit={onSendMessage}
        isSending={isSending}
        currentMode={currentMode}
      />
    </main>
  );
};
