import React, { useRef, useEffect, useState } from 'react';
import {
  LuPlus,
  LuFileText,
  LuFileCode,
  LuFileImage,
  LuFile,
  LuGlobe,
  LuImage,
  LuChevronDown,
  LuChevronUp,
  LuCheck,
  LuSend,
  LuLoader,
  LuX,
  LuDatabase,
  LuSlidersHorizontal,
} from 'react-icons/lu';
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
          icon: <LuFileText size={15} />,
        };
      case 'WEB_SEARCH':
        return {
          title: 'Web Search',
          desc: 'Live Internet Access',
          icon: <LuGlobe size={15} />,
        };
      case 'MULTIMODAL':
        return {
          title: 'Multimodal',
          desc: 'Vision & Audio (Coming)',
          icon: <LuImage size={15} />,
        };
      default:
        return {
          title: 'Document RAG',
          desc: 'Grounded Context QA',
          icon: <LuFileText size={15} />,
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
    if (fileType === '.pdf') return <LuFileText size={13} className="text-red-400" />;
    if (fileType === '.txt' || fileType === '.md') return <LuFileCode size={13} className="text-blue-400" />;
    if (
      fileType === '.png' ||
      fileType === '.jpg' ||
      fileType === '.jpeg' ||
      fileType === '.webp'
    )
      return <LuFileImage size={13} className="text-emerald-400" />;
    return <LuFile size={13} className="text-gray-400" />;
  };

  return (
    <div className="p-4 max-w-4xl w-full mx-auto shrink-0 flex flex-col gap-2">
      {/* Uploading progress indicator or attached documents banner */}
      {(isUploading || documents.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-2">
          {isUploading && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/15 border border-blue-500/30 text-blue-400 rounded-full text-xs animate-pulse">
              <LuLoader size={13} className="icon-spin" />
              <span>{uploadStatusText || 'Vectorizing document...'}</span>
            </div>
          )}

          {documents.map((doc) => (
            <div
              key={doc.document_id}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 border border-white/10 text-gray-300 rounded-full text-xs max-w-[200px]"
              title={`${doc.filename} (${(doc.file_size_bytes / 1024).toFixed(1)} KB)`}
            >
              {getFileIcon(doc.file_type)}
              <span className="truncate">{doc.filename}</span>
              {onDeleteDocument && (
                <button
                  type="button"
                  className="hover:text-red-400 transition-colors cursor-pointer ml-0.5"
                  onClick={() => onDeleteDocument(doc.document_id)}
                  title="Remove document"
                >
                  <LuX size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="w-full">
        <div className="flex items-center gap-2 bg-gray-900/90 border border-white/10 focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/30 rounded-2xl p-2 shadow-lg shadow-black/40 transition-all">
          {/* Left Controls: Plus Attach Button & Mode Dropdown */}
          <div className="relative flex items-center gap-1.5" ref={dropdownRef}>
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
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              title="Add document or image"
              disabled={isUploading || isSending}
            >
              {isUploading ? <LuLoader size={16} className="icon-spin" /> : <LuPlus size={18} />}
            </button>

            {/* Mode Dropdown Selector */}
            <div className="relative">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-all cursor-pointer ${isDropdownOpen
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/50'
                  : 'bg-white/5 text-gray-300 hover:text-white border-white/10 hover:border-white/20'
                  }`}
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                title="Select Engine Mode"
                disabled={isSending}
              >
                {currentModeDetails.icon}
                <span className="hidden sm:inline-block">{currentModeDetails.title}</span>
                {isDropdownOpen ? <LuChevronUp size={13} /> : <LuChevronDown size={13} />}
              </button>

              {/* Dropdown Popup Menu */}
              {isDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-gray-900 border border-blue-500/30 rounded-xl shadow-2xl shadow-black/80 z-50 p-1.5 flex flex-col gap-1 backdrop-blur-xl">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider border-b border-white/10 mb-0.5">
                    <LuSlidersHorizontal size={12} /> Engine Mode
                  </div>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors cursor-pointer w-full ${currentMode === 'DOCUMENT_RAG'
                      ? 'bg-blue-500/15 text-blue-300'
                      : 'hover:bg-white/5 text-gray-300'
                      }`}
                    onClick={() => handleSelectMode('DOCUMENT_RAG')}
                  >
                    <div className="flex items-center gap-2">
                      <LuFileText size={16} className="text-blue-400" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-200">Document RAG</span>
                        <span className="text-[10px] text-gray-500">Grounded Context QA</span>
                      </div>
                    </div>
                    {currentMode === 'DOCUMENT_RAG' && <LuCheck size={14} className="text-blue-400" />}
                  </button>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors cursor-pointer w-full ${currentMode === 'WEB_SEARCH'
                      ? 'bg-blue-500/15 text-blue-300'
                      : 'hover:bg-white/5 text-gray-300'
                      }`}
                    onClick={() => handleSelectMode('WEB_SEARCH')}
                  >
                    <div className="flex items-center gap-2">
                      <LuGlobe size={16} className="text-emerald-400" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-200">Web Search</span>
                        <span className="text-[10px] text-gray-500">Live Internet Access</span>
                      </div>
                    </div>
                    {currentMode === 'WEB_SEARCH' && <LuCheck size={14} className="text-emerald-400" />}
                  </button>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs opacity-50 cursor-not-allowed w-full`}
                    onClick={() => handleSelectMode('MULTIMODAL')}
                    title="Vision & Audio (Coming)"
                  >
                    <div className="flex items-center gap-2">
                      <LuImage size={16} className="text-purple-400" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-200">Multimodal</span>
                        <span className="text-[10px] text-gray-500">Vision & Audio (Coming)</span>
                      </div>
                    </div>
                    {currentMode === 'MULTIMODAL' && <LuCheck size={14} />}
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
            className="flex-1 bg-transparent border-0 outline-none resize-none text-sm text-gray-100 placeholder-gray-500 px-2 py-1 max-h-36 overflow-y-auto"
          />

          {/* Send Button */}
          <button
            type="submit"
            className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white disabled:text-gray-600 flex items-center justify-center transition-all cursor-pointer disabled:cursor-not-allowed shrink-0 shadow-sm shadow-blue-500/30 disabled:shadow-none"
            disabled={isSending || !inputQuery.trim()}
            title="Send Question"
          >
            {isSending ? <LuLoader size={16} className="icon-spin" /> : <LuSend size={15} />}
          </button>
        </div>
      </form>

      <div className="text-center text-[11px] text-gray-500 flex items-center justify-center gap-1.5">
        <LuDatabase size={11} />
        <span>Persistent Relational Storage • Real-time Stream with Citations</span>
      </div>
    </div>
  );
};
