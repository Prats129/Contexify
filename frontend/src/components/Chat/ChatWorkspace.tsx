import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LuCloudUpload } from 'react-icons/lu';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { SourcesPopover } from './SourcesPopover';
import type {
  ChatMode,
  Message,
  StreamingMessageState,
  DocumentMetadata,
  User,
  Citation,
} from '../../types';

interface ChatWorkspaceProps {
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  messages: Message[];
  streamingMessage: StreamingMessageState | null;
  onSelectPrompt: (prompt: string) => void;
  inputQuery: string;
  setInputQuery: (query: string) => void;
  onSendMessage: (e?: React.FormEvent) => void;
  onStopGeneration?: () => void;
  isSending: boolean;
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  uploadStatusText?: string;
  documents: DocumentMetadata[];
  onDeleteDocument: (documentId: string) => void;
  currentUser: User | null;
  onOpenUserModal: (tab?: 'login' | 'register') => void;
  onClearChat?: () => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  currentMode,
  onModeChange,
  messages,
  streamingMessage,
  onSelectPrompt,
  inputQuery,
  setInputQuery,
  onSendMessage,
  onStopGeneration,
  isSending,
  onFileUpload,
  isUploading,
  uploadStatusText,
  documents,
  onDeleteDocument,
  currentUser,
  onOpenUserModal,
  onClearChat,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [activeSources, setActiveSources] = useState<{
    messageId: string;
    citations: Citation[];
    queryTitle?: string;
  } | null>(null);
  const [isSourcesCollapsed, setIsSourcesCollapsed] = useState(false);
  const dragCounterRef = useRef(0);

  const handleToggleSources = useCallback(
    (msgId: string, citations: Citation[], queryTitle?: string) => {
      setActiveSources((prev) => {
        if (prev?.messageId === msgId) {
          if (isSourcesCollapsed) {
            setIsSourcesCollapsed(false);
            return prev;
          }
          return null;
        }
        setIsSourcesCollapsed(false);
        return { messageId: msgId, citations, queryTitle };
      });
    },
    [isSourcesCollapsed],
  );

  const handleHideSources = useCallback(() => {
    setActiveSources(null);
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setIsSourcesCollapsed((prev) => !prev);
  }, []);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      if (
        e.dataTransfer?.types &&
        Array.from(e.dataTransfer.types).some(
          (t) => t === 'Files' || t === 'application/x-moz-file'
        )
      ) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
          onFileUpload(file);
        }
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [onFileUpload]);

  return (
    <main
      className={`flex-1 flex flex-col bg-(--bg-app) text-(--text-main) relative overflow-hidden h-screen ${isDragging ? 'ring-2 border-primary-theme ring-inset' : ''
        }`}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-(--bg-app)/90 backdrop-blur-md z-50 flex items-center justify-center pointer-events-none animate-[dropFadeIn_0.15s_ease-out]">
          <div className="border-2 border-dashed border-primary-theme rounded-3xl bg-primary-light-theme shadow-2xl p-12 text-center flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-primary-light-theme flex items-center justify-center text-primary-theme text-3xl animate-bounce">
              <LuCloudUpload size={32} />
            </div>
            <h3 className="text-xl font-bold text-(--text-main)">Drop your files here</h3>
            <p className="text-xs text-(--text-muted)">PDF, TXT, MD, CSV, JSON or images to attach to this chat</p>
          </div>
        </div>
      )}

      <ChatHeader
        currentMode={currentMode}
        currentUser={currentUser}
        onOpenUserModal={onOpenUserModal}
        onClearChat={onClearChat}
        hasMessages={messages.length > 0 || !!streamingMessage}
      />

      {/* Main Workspace: Chat Column + Sources Card anchored to right */}
      <div
        className={`flex-1 flex overflow-hidden w-full px-2 sm:px-6 transition-all duration-150 ${activeSources ? 'justify-between' : 'justify-center'
          }`}
      >
        {/* Main Conversation Column: MessageList + ChatInput */}
        <div
          className={`flex-1 flex flex-col h-full min-w-0 ${activeSources
            ? 'max-w-4xl mx-auto lg:mr-auto lg:ml-4'
            : 'max-w-3xl mx-auto'
            }`}
        >
          <MessageList
            messages={messages}
            streamingMessage={streamingMessage}
            onSelectPrompt={onSelectPrompt}
            currentUser={currentUser}
            activeSourcesMessageId={activeSources?.messageId}
            onToggleSources={handleToggleSources}
          />

          <ChatInput
            inputQuery={inputQuery}
            setInputQuery={setInputQuery}
            onSubmit={onSendMessage}
            onStopGeneration={onStopGeneration}
            isSending={isSending}
            currentMode={currentMode}
            onModeChange={onModeChange}
            onFileUpload={onFileUpload}
            isUploading={isUploading}
            uploadStatusText={uploadStatusText}
            documents={documents}
            onDeleteDocument={onDeleteDocument}
          />
        </div>

        {/* Right side floating Perplexity Sources Card */}
        {activeSources && (
          <div className={`hidden lg:block shrink-0 sticky top-2 h-fit pt-4 pl-4 ${isSourcesCollapsed ? 'mr-2' : 'mr-8'} animate-[fadeIn_0.15s_ease-out]`}>
            <SourcesPopover
              isOpen={!!activeSources}
              onHide={handleHideSources}
              citations={activeSources.citations}
              queryTitle={activeSources.queryTitle}
              isCollapsed={isSourcesCollapsed}
              onToggleCollapse={handleToggleCollapse}
            />
          </div>
        )}
      </div>
    </main>
  );
};
