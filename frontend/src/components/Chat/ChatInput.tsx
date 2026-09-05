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
  onStopGeneration?: () => void;
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
  onStopGeneration,
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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        150
      )}px`;
    }
  }, [inputQuery]);

  // Global '/' keyboard shortcut to focus chat input like ChatGPT
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeElement = document.activeElement;
        const isEditable =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          (activeElement as HTMLElement)?.isContentEditable;

        // If user is already typing in an input/textarea or editable field, allow default '/' behavior
        if (isEditable) {
          return;
        }

        // If a modal dialog is open, do not intercept
        const isModalOpen = !!document.querySelector('[role="dialog"], .fixed.inset-0.z-50');
        if (isModalOpen) {
          return;
        }

        // Prevent typing '/' into the input so the user can immediately type their actual message
        e.preventDefault();
        if (textareaRef.current) {
          textareaRef.current.focus();
          const length = textareaRef.current.value.length;
          textareaRef.current.setSelectionRange(length, length);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

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
      if (isSending) {
        // While response is streaming, do not submit another prompt concurrently
        return;
      }
      onSubmit(e);
    } else if (e.key === 'Escape') {
      if (isSending && onStopGeneration) {
        onStopGeneration();
      } else {
        textareaRef.current?.blur();
      }
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
      case 'WEB_SEARCH':
        return {
          title: 'Web Search',
          desc: 'Live Internet Access',
          icon: <LuGlobe size={15} />,
        };
      case 'DOCUMENT_RAG':
        return {
          title: 'Document RAG',
          desc: 'Grounded Context QA',
          icon: <LuFileText size={15} />,
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


  const getFileIcon = (fileType: string) => {
    if (fileType === '.pdf') return <LuFileText size={13} className="text-red-500" />;
    if (fileType === '.txt' || fileType === '.md') return <LuFileCode size={13} className="text-primary-theme" />;
    if (
      fileType === '.png' ||
      fileType === '.jpg' ||
      fileType === '.jpeg' ||
      fileType === '.webp'
    )
      return <LuFileImage size={13} className="text-emerald-500" />;
    return <LuFile size={13} className="text-(--text-muted)" />;
  };

  return (
    <div className="p-4 max-w-4xl w-full mx-auto shrink-0 flex flex-col gap-2">
      {/* Uploading progress indicator or attached documents banner */}
      {(isUploading || documents.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-2">
          {isUploading && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary-light-theme border border-primary-theme text-primary-theme rounded-full text-xs animate-pulse">
              <LuLoader size={13} className="icon-spin" />
              <span>{uploadStatusText || 'Vectorizing document...'}</span>
            </div>
          )}

          {documents.map((doc) => (
            <div
              key={doc.document_id}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-(--border-subtle) border border-(--border-subtle) text-(--text-main) rounded-full text-xs max-w-50"
              title={`${doc.filename} (${(doc.file_size_bytes / 1024).toFixed(1)} KB)`}
            >
              {getFileIcon(doc.file_type)}
              <span className="truncate">{doc.filename}</span>
              {onDeleteDocument && (
                <button
                  type="button"
                  className="hover:text-red-500 cursor-pointer ml-0.5"
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
        <div className="flex items-center gap-2 bg-(--bg-input) border border-(--border-subtle) focus-within:border-primary-theme rounded-2xl p-2 shadow-lg">
          {/* Left Controls: Plus Attach Button & Mode Dropdown */}
          <div className="relative flex items-center gap-1.5" ref={dropdownRef}>
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
              className="w-8 h-8 rounded-full bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-muted) hover:text-(--text-main) flex items-center justify-center cursor-pointer shrink-0 disabled:opacity-50"
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
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border cursor-pointer ${isDropdownOpen
                  ? 'bg-primary-light-theme text-primary-theme border-primary-theme'
                  : 'bg-(--border-subtle) text-(--text-muted) hover:text-(--text-main) border-(--border-subtle) hover:border-(--border-hover)'
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
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-(--bg-card) border border-(--border-hover) rounded-xl shadow-2xl z-50 p-1.5 flex flex-col gap-1 backdrop-blur-xl">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-(--text-muted) uppercase tracking-wider border-b border-(--border-subtle) mb-0.5">
                    <LuSlidersHorizontal size={12} /> Engine Mode
                  </div>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs cursor-pointer w-full ${currentMode === 'WEB_SEARCH'
                      ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 font-medium'
                      : 'hover:bg-(--border-subtle) text-(--text-main)'
                      }`}
                    onClick={() => handleSelectMode('WEB_SEARCH')}
                  >
                    <div className="flex items-center gap-2">
                      <LuGlobe size={16} className="text-emerald-500 dark:text-emerald-400" />
                      <div className="flex flex-col">
                        <span className="font-semibold">Web Search</span>
                        <span className="text-[10px] text-(--text-muted)">Live Internet Access</span>
                      </div>
                    </div>
                    {currentMode === 'WEB_SEARCH' && <LuCheck size={14} className="text-emerald-500 dark:text-emerald-400" />}
                  </button>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs cursor-pointer w-full ${currentMode === 'DOCUMENT_RAG'
                      ? 'bg-primary-light-theme text-primary-theme font-medium'
                      : 'hover:bg-(--border-subtle) text-(--text-main)'
                      }`}
                    onClick={() => handleSelectMode('DOCUMENT_RAG')}
                  >
                    <div className="flex items-center gap-2">
                      <LuFileText size={16} className="text-primary-theme" />
                      <div className="flex flex-col">
                        <span className="font-semibold">Document RAG</span>
                        <span className="text-[10px] text-(--text-muted)">Grounded Context QA</span>
                      </div>
                    </div>
                    {currentMode === 'DOCUMENT_RAG' && <LuCheck size={14} className="text-primary-theme" />}
                  </button>

                  <button
                    type="button"
                    disabled
                    className="flex items-center justify-between p-2 rounded-lg text-left text-xs opacity-40 cursor-not-allowed w-full select-none"
                    title="Multimodal Engine is coming soon"
                  >
                    <div className="flex items-center gap-2">
                      <LuImage size={16} className="text-purple-400" />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">Multimodal</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-(--border-subtle) text-(--text-muted) uppercase font-medium">Soon</span>
                        </div>
                        <span className="text-[10px] text-(--text-muted)">Vision & Audio (Coming)</span>
                      </div>
                    </div>
                  </button>
                </div>
              )}

            </div>
          </div>

          {/* Textarea: user can write at any time even while response is generating */}
          <textarea
            ref={textareaRef}
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={'Ask anything'}
            rows={1}
            required
            className="flex-1 bg-transparent border-0 outline-none resize-none text-sm px-2 py-1 max-h-36 overflow-y-auto"
          />

          {/* Action Button: Stop/Pause square while generating, Send button when idle */}
          {isSending ? (
            <button
              type="button"
              onClick={onStopGeneration}
              className="w-8 h-8 rounded-full bg-primary-theme hover:opacity-90 text-white flex items-center justify-center cursor-pointer shrink-0 transition-transform active:scale-95 shadow-md"
              title="Stop generating"
            >
              <div className="w-2.5 h-2.5 bg-white rounded-[2px]" />
            </button>
          ) : (
            <button
              type="submit"
              className="w-8 h-8 rounded-full bg-primary-theme hover:opacity-90 disabled:opacity-30 text-white flex items-center justify-center disabled:cursor-not-allowed shrink-0 disabled:shadow-none transition-all"
              disabled={!inputQuery.trim()}
              title="Send Question"
            >
              <LuSend size={15} />
            </button>
          )}
        </div>
      </form>

      <div className="text-center text-[11px] text-(--text-muted) flex items-center justify-center gap-1.5">
        <LuDatabase size={11} />
        <span>Persistent Relational Storage • Real-time Stream with Citations</span>
      </div>
    </div>
  );
};
