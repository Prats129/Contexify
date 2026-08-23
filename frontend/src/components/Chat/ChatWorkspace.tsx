import React, { useState, useRef, useEffect } from 'react';
import { LuCloudUpload } from 'react-icons/lu';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import type {
  ChatMode,
  Message,
  StreamingMessageState,
  DocumentMetadata,
  User,
} from '../../types';

interface ChatWorkspaceProps {
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  activeSessionId: string | null;
  onNewSession: () => void;
  messages: Message[];
  streamingMessage: StreamingMessageState | null;
  onSelectPrompt: (prompt: string) => void;
  inputQuery: string;
  setInputQuery: (query: string) => void;
  onSendMessage: (e?: React.FormEvent) => void;
  isSending: boolean;
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  uploadStatusText?: string;
  documents: DocumentMetadata[];
  onDeleteDocument: (documentId: string) => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  currentUser: User | null;
  onOpenUserModal: (tab?: 'login' | 'register') => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  currentMode,
  onModeChange,
  activeSessionId,
  onNewSession,
  messages,
  streamingMessage,
  onSelectPrompt,
  inputQuery,
  setInputQuery,
  onSendMessage,
  isSending,
  onFileUpload,
  isUploading,
  uploadStatusText,
  documents,
  onDeleteDocument,
  isSidebarOpen,
  onToggleSidebar,
  currentUser,
  onOpenUserModal,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Global window listeners to reliably capture file drag & drop anywhere in the app
  // and prevent browser default behavior of opening files in a new tab
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
    <main className={`chat-workspace ${isDragging ? 'dragging-over' : ''}`}>
      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="workspace-drop-overlay">
          <div className="drop-overlay-box">
            <div className="drop-icon-wrapper">
              <LuCloudUpload />
            </div>
            <h3>Drop your files here</h3>
            <p>PDF, TXT, MD, CSV, JSON or images to add to this chat</p>
          </div>
        </div>
      )}

      <ChatHeader
        currentMode={currentMode}
        sessionId={activeSessionId}
        onNewSession={onNewSession}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={onToggleSidebar}
        currentUser={currentUser}
        onOpenUserModal={onOpenUserModal}
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
        onModeChange={onModeChange}
        onFileUpload={onFileUpload}
        isUploading={isUploading}
        uploadStatusText={uploadStatusText}
        documents={documents}
        onDeleteDocument={onDeleteDocument}
      />
    </main>
  );
};
