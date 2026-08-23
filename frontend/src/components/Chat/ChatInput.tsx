import React, { useRef, useEffect, useState } from 'react';
import type { ChatMode, DocumentMetadata } from '../../types';

interface ChatInputProps {
  inputQuery: string;
  setInputQuery: (query: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  isSending: boolean;
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  uploadStatusText?: string;
  documents?: DocumentMetadata[];
  onDeleteDocument?: (documentId: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  inputQuery,
  setInputQuery,
  onSubmit,
  isSending,
  currentMode,
  onModeChange,
  onFileUpload,
  isUploading,
  uploadStatusText,
  documents = [],
  onDeleteDocument,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        150
      )}px`;
    }
  }, [inputQuery]);

  // Close dropdown on outside click or escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach((file) => onFileUpload(file));
      e.target.value = '';
    }
  };

  const handleSelectMode = (mode: ChatMode) => {
    onModeChange(mode);
    setIsDropdownOpen(false);
  };

  const getModeDetails = (mode: ChatMode) => {
    switch (mode) {
      case 'DOCUMENT_RAG':
        return {
          title: 'Document RAG',
          desc: 'Grounded Context QA',
          icon: 'fa-solid fa-file-contract',
        };
      case 'WEB_SEARCH':
        return {
          title: 'Web Search',
          desc: 'Live Internet Access',
          icon: 'fa-solid fa-globe',
        };
      case 'MULTIMODAL':
        return {
          title: 'Multimodal',
          desc: 'Vision & Audio (Coming)',
          icon: 'fa-solid fa-photo-film',
        };
      default:
        return {
          title: 'Document RAG',
          desc: 'Grounded Context QA',
          icon: 'fa-solid fa-file-contract',
        };
    }
  };

  const currentModeDetails = getModeDetails(currentMode);

  const placeholderText =
    currentMode === 'DOCUMENT_RAG'
      ? 'Ask any question based on your uploaded document content...'
      : currentMode === 'WEB_SEARCH'
      ? 'Ask a question to search the internet in real-time...'
      : 'Ask a question with multimodal vision & audio...';

  const getFileIcon = (fileType: string) => {
    if (fileType === '.pdf') return 'fa-solid fa-file-pdf';
    if (fileType === '.txt' || fileType === '.md')
      return 'fa-solid fa-file-lines';
    if (
      fileType === '.png' ||
      fileType === '.jpg' ||
      fileType === '.jpeg' ||
      fileType === '.webp'
    )
      return 'fa-solid fa-file-image';
    return 'fa-solid fa-file';
  };

  return (
    <div className="chat-input-container">
      {/* Uploading progress indicator or attached documents banner */}
      {(isUploading || documents.length > 0) && (
        <div className="input-attachments-bar">
          {isUploading && (
            <div className="input-upload-pill">
              <i className="fa-solid fa-spinner fa-spin"></i>
              <span>{uploadStatusText || 'Vectorizing document...'}</span>
            </div>
          )}

          {documents.map((doc) => (
            <div
              key={doc.document_id}
              className="input-attached-pill"
              title={`${doc.filename} (${(doc.file_size_bytes / 1024).toFixed(1)} KB)`}
            >
              <i className={getFileIcon(doc.file_type)}></i>
              <span className="pill-name">{doc.filename}</span>
              {onDeleteDocument && (
                <button
                  type="button"
                  className="pill-remove-btn"
                  onClick={() => onDeleteDocument(doc.document_id)}
                  title="Remove document"
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="input-form">
        <div className="textarea-wrapper">
          {/* Left Controls: Plus Attach Button & Mode Dropdown */}
          <div className="input-left-controls" ref={dropdownRef}>
            {/* ChatGPT style + Button */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.txt,.md,.csv,.json,.log,.png,.jpg,.jpeg,.webp"
              multiple
              hidden
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="btn-chat-attach"
              onClick={() => fileInputRef.current?.click()}
              title="Add document or image"
              disabled={isUploading || isSending}
            >
              {isUploading ? (
                <i className="fa-solid fa-spinner fa-spin"></i>
              ) : (
                <i className="fa-solid fa-plus"></i>
              )}
            </button>

            {/* Mode Dropdown Selector */}
            <div className="mode-dropdown-container">
              <button
                type="button"
                className={`btn-mode-dropdown-trigger ${isDropdownOpen ? 'active' : ''}`}
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                title="Select Engine Mode"
                disabled={isSending}
              >
                <i className={currentModeDetails.icon}></i>
                <span className="mode-dropdown-label">
                  {currentModeDetails.title}
                </span>
                <i
                  className={`fa-solid fa-chevron-${
                    isDropdownOpen ? 'up' : 'down'
                  } mode-chevron`}
                ></i>
              </button>

              {/* Dropdown Popup Menu */}
              {isDropdownOpen && (
                <div className="mode-dropdown-menu">
                  <div className="mode-dropdown-header">
                    <i className="fa-solid fa-sliders"></i> Engine Mode
                  </div>

                  <button
                    type="button"
                    className={`mode-dropdown-item ${
                      currentMode === 'DOCUMENT_RAG' ? 'selected' : ''
                    }`}
                    onClick={() => handleSelectMode('DOCUMENT_RAG')}
                  >
                    <div className="item-icon-wrapper">
                      <i className="fa-solid fa-file-contract"></i>
                    </div>
                    <div className="item-info">
                      <span className="item-title">Document RAG</span>
                      <span className="item-desc">Grounded Context QA</span>
                    </div>
                    {currentMode === 'DOCUMENT_RAG' && (
                      <i className="fa-solid fa-check item-check"></i>
                    )}
                  </button>

                  <button
                    type="button"
                    className={`mode-dropdown-item ${
                      currentMode === 'WEB_SEARCH' ? 'selected' : ''
                    }`}
                    onClick={() => handleSelectMode('WEB_SEARCH')}
                  >
                    <div className="item-icon-wrapper">
                      <i className="fa-solid fa-globe"></i>
                    </div>
                    <div className="item-info">
                      <span className="item-title">Web Search</span>
                      <span className="item-desc">Live Internet Access</span>
                    </div>
                    {currentMode === 'WEB_SEARCH' && (
                      <i className="fa-solid fa-check item-check"></i>
                    )}
                  </button>

                  <button
                    type="button"
                    className={`mode-dropdown-item disabled ${
                      currentMode === 'MULTIMODAL' ? 'selected' : ''
                    }`}
                    onClick={() => handleSelectMode('MULTIMODAL')}
                    title="Vision & Audio (Coming)"
                  >
                    <div className="item-icon-wrapper">
                      <i className="fa-solid fa-photo-film"></i>
                    </div>
                    <div className="item-info">
                      <span className="item-title">Multimodal</span>
                      <span className="item-desc">Vision & Audio (Coming)</span>
                    </div>
                    {currentMode === 'MULTIMODAL' && (
                      <i className="fa-solid fa-check item-check"></i>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholderText}
            rows={1}
            required
            disabled={isSending}
          />

          {/* Send Button */}
          <button
            type="submit"
            className="send-btn"
            disabled={isSending || !inputQuery.trim()}
            title="Send Question"
          >
            {isSending ? (
              <i className="fa-solid fa-spinner fa-spin"></i>
            ) : (
              <i className="fa-solid fa-paper-plane"></i>
            )}
          </button>
        </div>
      </form>
      <div className="input-footer">
        <span>
          <i className="fa-solid fa-database"></i> Persistent Relational Storage
          • Real-time Stream with Citations
        </span>
      </div>
    </div>
  );
};
