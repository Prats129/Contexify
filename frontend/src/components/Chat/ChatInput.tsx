import React, { useRef, useEffect, useState } from "react";
import {
  LuPlus,
  LuFileText,
  LuFileCode,
  LuFileImage,
  LuFile,
  LuGlobe,
  LuImage,
  LuSparkles,
  LuPalette,
  LuChevronDown,
  LuChevronUp,
  LuCheck,
  LuArrowUp,
  LuLoader,
  LuX,
  LuDatabase,
  LuSlidersHorizontal,
} from "react-icons/lu";
import type { ChatMode, DocumentMetadata, MediaAttachment } from "../../types";

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
  attachedMedia?: MediaAttachment[];
  onDeleteMedia?: (index: number) => void;
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
  attachedMedia = [],
  onDeleteMedia,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMultiline, setIsMultiline] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // When empty, instantly retract to sleek single-line pill
    if (!inputQuery.trim()) {
      setIsMultiline(false);
      textarea.style.height = "26px";
      return;
    }

    // If explicit newline exists, always multiline
    if (inputQuery.includes("\n")) {
      setIsMultiline(true);
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
      return;
    }

    if (isMultiline) {
      textarea.style.height = "auto";
      const sh = textarea.scrollHeight;
      if (sh > 34) {
        textarea.style.height = `${Math.min(sh, 220)}px`;
      } else {
        // Fits on one line, retract back to single-line pill if text fits
        if (inputQuery.length < 50) {
          setIsMultiline(false);
          textarea.style.height = "26px";
        } else {
          textarea.style.height = `${sh}px`;
        }
      }
    } else {
      textarea.style.height = "auto";
      const sh = textarea.scrollHeight;
      if (sh > 34) {
        setIsMultiline(true);
        textarea.style.height = `${Math.min(sh, 220)}px`;
      } else {
        textarea.style.height = "26px";
      }
    }
  }, [inputQuery, isMultiline]);

  // Global '/' keyboard shortcut to focus chat input like ChatGPT
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
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
        const isModalOpen = !!document.querySelector(
          '[role="dialog"], .fixed.inset-0.z-50',
        );
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

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
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
      if (event.key === "Escape") {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDropdownOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isSending) {
        // While response is streaming, do not submit another prompt concurrently
        return;
      }
      onSubmit(e);
    } else if (e.key === "Escape") {
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
      e.target.value = "";
    }
  };

  const handleSelectMode = (mode: ChatMode) => {
    onModeChange(mode);
    setIsDropdownOpen(false);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            onFileUpload(file);
          }
        }
      }
    }
  };

  const getModeDetails = (mode: ChatMode) => {
    switch (mode) {
      case "AUTO":
        return {
          title: "Auto",
          desc: "Smart AI (ChatGPT Style)",
          icon: <LuSparkles size={15} className="text-amber-500" />,
        };
      case "WEB_SEARCH":
        return {
          title: "Web Search",
          desc: "Live Internet Access",
          icon: <LuGlobe size={15} />,
        };
      case "DOCUMENT_RAG":
        return {
          title: "Document RAG",
          desc: "Grounded Context QA",
          icon: <LuFileText size={15} />,
        };
      case "MULTIMODAL":
        return {
          title: "Vision & OCR",
          desc: "Analyze Images & Docs",
          icon: <LuImage size={15} />,
        };
      case "IMAGE_GENERATION":
        return {
          title: "Image Gen",
          desc: "Google Imagen 3 Artwork",
          icon: <LuPalette size={15} className="text-pink-500" />,
        };
      default:
        return {
          title: "Auto",
          desc: "Smart AI (ChatGPT Style)",
          icon: <LuSparkles size={15} className="text-amber-500" />,
        };
    }
  };

  const currentModeDetails = getModeDetails(currentMode);

  const getFileIcon = (fileType: string) => {
    if (fileType === ".pdf")
      return <LuFileText size={13} className="text-red-500" />;
    if (fileType === ".txt" || fileType === ".md")
      return <LuFileCode size={13} className="text-primary-theme" />;
    if (
      fileType === ".png" ||
      fileType === ".jpg" ||
      fileType === ".jpeg" ||
      fileType === ".webp"
    )
      return <LuFileImage size={13} className="text-emerald-500" />;
    return <LuFile size={13} className="text-(--text-muted)" />;
  };

  const isExpanded =
    isMultiline ||
    documents.length > 0 ||
    attachedMedia.length > 0 ||
    isUploading;

  return (
    <div className="p-2 sm:p-4 max-w-4xl w-full mx-auto shrink-0 flex flex-col gap-1.5 sm:gap-2">
      <form onSubmit={onSubmit} className="w-full">
        <div
          className={`bg-(--bg-input) border border-(--border-subtle) hover:border-(--border-hover) shadow-lg transition-[border-radius] duration-150 ease-out grid ${
            isExpanded
              ? "rounded-3xl p-2.5 sm:p-3 pt-0 gap-y-2 grid-cols-[auto_1fr_auto]"
              : "rounded-full px-3 sm:px-3.5 py-1.5 gap-x-1.5 sm:gap-x-2 grid-cols-[auto_1fr_auto] items-center"
          }`}
        >
          {/* Uploading progress indicator or attached documents/media banner */}
          {(isUploading ||
            documents.length > 0 ||
            attachedMedia.length > 0) && (
            <div className="col-span-full row-start-1 flex flex-wrap items-center gap-1.5 pb-2 mb-1 mt-3 border-b border-(--border-subtle)/50 max-h-28 overflow-y-auto">
              {isUploading && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary-light-theme border border-primary-theme text-primary-theme rounded-full text-xs animate-pulse">
                  <LuLoader size={13} className="icon-spin" />
                  <span>{uploadStatusText || "Processing upload..."}</span>
                </div>
              )}

              {/* Uploaded Image Previews */}
              {attachedMedia.map((media, mIdx) => (
                <div
                  key={media.id || mIdx}
                  className="flex items-center gap-1.5 p-1 pr-2 bg-(--border-subtle) border border-(--border-subtle) text-(--text-main) rounded-full text-xs max-w-44 shadow-2xs"
                  title={media.file_name || "Attached Image"}
                >
                  <img
                    src={media.url}
                    alt=""
                    className="w-5 h-5 rounded-full object-cover shrink-0 border border-white/20"
                  />
                  <span className="truncate max-w-24 text-[11px] font-medium">
                    {media.file_name || "Image"}
                  </span>
                  {onDeleteMedia && (
                    <button
                      type="button"
                      className="hover:text-red-500 cursor-pointer ml-0.5 shrink-0"
                      onClick={() => onDeleteMedia(mIdx)}
                      title="Remove image"
                    >
                      <LuX size={12} />
                    </button>
                  )}
                </div>
              ))}

              {/* Uploaded Documents */}
              {documents.map((doc) => (
                <div
                  key={doc.document_id}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-(--border-subtle) border border-(--border-subtle) text-(--text-main) rounded-full text-xs max-w-40 sm:max-w-50"
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

          {/* Left: Plus Attach Button */}
          <div
            className={`relative flex items-center shrink-0 ${isExpanded ? "col-start-1 row-start-3" : "col-start-1 row-start-1"}`}
          >
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
              className="w-8 h-8 rounded-full bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-muted) hover:text-(--text-main) flex items-center justify-center cursor-pointer shrink-0 disabled:opacity-50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image or document"
              disabled={isUploading}
            >
              {isUploading ? (
                <LuLoader size={16} className="icon-spin" />
              ) : (
                <LuPlus size={18} />
              )}
            </button>
          </div>

          {/* Center/Top: Textarea (single-line pill initially, full-width at top when expanded) */}
          <textarea
            ref={textareaRef}
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => {
              if (typeof window !== "undefined" && window.innerWidth < 768) {
                setTimeout(() => {
                  textareaRef.current?.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth",
                  });
                }, 300);
              }
            }}
            placeholder={
              currentMode === "IMAGE_GENERATION"
                ? "Describe the image you want to generate..."
                : currentMode === "MULTIMODAL"
                  ? "Ask a question about your attached image or document..."
                  : currentMode === "DOCUMENT_RAG"
                    ? "Ask questions based on your uploaded document..."
                    : "Ask anything, attach files, or type 'generate image of...' "
            }
            rows={1}
            required={attachedMedia.length === 0}
            className={`bg-transparent border-0 outline-none resize-none text-[16px] sm:text-[15px] text-(--text-main) px-2 leading-normal ${
              isExpanded
                ? "col-span-full row-start-2 w-full max-h-52 overflow-y-auto py-1"
                : "col-start-2 row-start-1 w-full h-6.5 max-h-6.5 overflow-hidden py-0"
            }`}
          />

          {/* Right Actions: Engine Mode Selector + Send/Stop Button */}
          <div
            className={`flex items-center gap-1.5 sm:gap-2 shrink-0 ${
              isExpanded
                ? "col-start-3 row-start-3 justify-self-end"
                : "col-start-3 row-start-1"
            }`}
          >
            {/* Mode Dropdown Selector */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-full border cursor-pointer transition-colors ${
                  isDropdownOpen
                    ? "bg-primary-theme text-white border-primary-theme shadow-xs"
                    : "bg-(--border-subtle) hover:bg-(--border-hover) border-(--border-subtle) text-(--text-main)"
                }`}
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                title="Select AI Chat Engine"
              >
                {currentModeDetails.icon}
                <span className="hidden sm:inline">
                  {currentModeDetails.title}
                </span>
                {isDropdownOpen ? (
                  <LuChevronUp size={12} />
                ) : (
                  <LuChevronDown size={12} />
                )}
              </button>

              {/* Mode Selection Popover Menu */}
              {isDropdownOpen && (
                <div className="absolute right-0 bottom-full mb-2 w-56 sm:w-60 bg-(--bg-card) border border-(--border-subtle) rounded-xl shadow-xl p-1.5 flex flex-col gap-1 z-50 animate-fade-in backdrop-blur-md">
                  <div className="px-2 py-1 text-[11px] font-medium text-(--text-muted) border-b border-(--border-subtle) mb-1 flex items-center justify-between">
                    <span>AI Engine</span>
                    <LuSlidersHorizontal size={11} />
                  </div>

                  {/* AUTO Mode (Smart / Default) */}
                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs cursor-pointer w-full transition-colors ${
                      currentMode === "AUTO"
                        ? "bg-amber-500/10 text-amber-600 font-medium"
                        : "hover:bg-(--border-subtle) text-(--text-main)"
                    }`}
                    onClick={() => handleSelectMode("AUTO")}
                  >
                    <div className="flex items-center gap-2">
                      <LuSparkles size={16} className="text-amber-500" />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">Auto</span>
                          <span className="text-[9px] px-1 py-0.2 bg-amber-500/20 text-amber-600 rounded font-bold uppercase tracking-wider">
                            Smart
                          </span>
                        </div>
                        <span className="text-[10px] text-(--text-muted)">
                          ChatGPT-style dynamic AI
                        </span>
                      </div>
                    </div>
                    {currentMode === "AUTO" && (
                      <LuCheck size={14} className="text-amber-500" />
                    )}
                  </button>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs cursor-pointer w-full ${
                      currentMode === "WEB_SEARCH"
                        ? "bg-emerald-500/10 dark:text-emerald-400 font-medium"
                        : "hover:bg-(--border-subtle) text-(--text-main)"
                    }`}
                    onClick={() => handleSelectMode("WEB_SEARCH")}
                  >
                    <div className="flex items-center gap-2">
                      <LuGlobe size={16} className="text-emerald-500" />
                      <div className="flex flex-col">
                        <span className="font-semibold">Web Search</span>
                        <span className="text-[10px] text-(--text-muted)">
                          Live Internet Access
                        </span>
                      </div>
                    </div>
                    {currentMode === "WEB_SEARCH" && (
                      <LuCheck size={14} className="text-emerald-500" />
                    )}
                  </button>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs cursor-pointer w-full ${
                      currentMode === "DOCUMENT_RAG"
                        ? "bg-primary-light-theme text-primary-theme font-medium"
                        : "hover:bg-(--border-subtle) text-(--text-main)"
                    }`}
                    onClick={() => handleSelectMode("DOCUMENT_RAG")}
                  >
                    <div className="flex items-center gap-2">
                      <LuFileText size={16} className="text-primary-theme" />
                      <div className="flex flex-col">
                        <span className="font-semibold">Document RAG</span>
                        <span className="text-[10px] text-(--text-muted)">
                          Grounded Context QA
                        </span>
                      </div>
                    </div>
                    {currentMode === "DOCUMENT_RAG" && (
                      <LuCheck size={14} className="text-primary-theme" />
                    )}
                  </button>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs cursor-pointer w-full ${
                      currentMode === "MULTIMODAL"
                        ? "bg-purple-500/10 text-purple-600 font-medium"
                        : "hover:bg-(--border-subtle) text-(--text-main)"
                    }`}
                    onClick={() => handleSelectMode("MULTIMODAL")}
                  >
                    <div className="flex items-center gap-2">
                      <LuImage size={16} className="text-purple-500" />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">Vision & OCR</span>
                        </div>
                        <span className="text-[10px] text-(--text-muted)">
                          Analyze Images & Docs
                        </span>
                      </div>
                    </div>
                    {currentMode === "MULTIMODAL" && (
                      <LuCheck size={14} className="text-purple-500" />
                    )}
                  </button>

                  <button
                    type="button"
                    className={`flex items-center justify-between p-2 rounded-lg text-left text-xs cursor-pointer w-full ${
                      currentMode === "IMAGE_GENERATION"
                        ? "bg-pink-500/10 text-pink-600 font-medium"
                        : "hover:bg-(--border-subtle) text-(--text-main)"
                    }`}
                    onClick={() => handleSelectMode("IMAGE_GENERATION")}
                  >
                    <div className="flex items-center gap-2">
                      <LuPalette size={16} className="text-pink-500" />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">Image Gen</span>
                        </div>
                        <span className="text-[10px] text-(--text-muted)">
                          Google Imagen 3 Artwork
                        </span>
                      </div>
                    </div>
                    {currentMode === "IMAGE_GENERATION" && (
                      <LuCheck size={14} className="text-pink-500" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Right Action: Stop or Send */}
            {isSending ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="w-8 h-8 rounded-full bg-primary-theme hover:opacity-90 text-white flex items-center justify-center cursor-pointer shrink-0 transition-transform active:scale-95 shadow-md"
                title="Stop generating"
              >
                <div className="w-2.5 h-2.5 bg-white rounded-xs" />
              </button>
            ) : (
              <button
                type="submit"
                className="w-8 h-8 rounded-full bg-primary-theme hover:opacity-90 disabled:opacity-30 text-white flex items-center justify-center disabled:cursor-not-allowed shrink-0 disabled:shadow-none transition-all"
                disabled={!inputQuery.trim() && attachedMedia.length === 0}
                title="Send Question"
              >
                <LuArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </form>

      <div className="text-center text-[11px] text-(--text-muted) flex items-center justify-center gap-1.5">
        <LuDatabase size={11} />
        <span>
          Persistent Relational Storage • Real-time Stream with Citations
        </span>
      </div>
    </div>
  );
};
