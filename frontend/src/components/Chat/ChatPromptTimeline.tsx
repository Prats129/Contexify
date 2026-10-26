import React, { useState, useRef, useEffect, useCallback } from "react";
import { LuChevronUp, LuChevronDown } from "react-icons/lu";

export interface PromptItem {
  id: string;
  content: string;
  index: number;
}

interface ChatPromptTimelineProps {
  prompts: PromptItem[];
  activePromptId: string | null;
  onNavigateToPrompt: (promptId: string) => void;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

export const ChatPromptTimeline: React.FC<ChatPromptTimelineProps> = ({
  prompts,
  activePromptId,
  onNavigateToPrompt,
  onNavigatePrev,
  onNavigateNext,
  hasPrev,
  hasNext,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const popoverListRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Dismiss on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (
        timelineRef.current &&
        !timelineRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [isOpen]);

  // Clear hover timer
  const cancelHide = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    cancelHide();
    setIsOpen(true);
  }, [cancelHide]);

  const handleMouseLeave = useCallback(() => {
    cancelHide();
    hideTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 280);
  }, [cancelHide]);

  // Keep active item scrolled into view inside the popover list
  useEffect(() => {
    if (isOpen && activeItemRef.current && popoverListRef.current) {
      activeItemRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [isOpen, activePromptId]);

  // If there's less than 2 prompts, don't show the timeline
  if (!prompts || prompts.length < 2) {
    return null;
  }

  return (
    <div
      ref={timelineRef}
      className="fixed right-2 md:right-3.5 top-1/2 -translate-y-1/2 z-30 select-none flex items-center transition-all duration-200"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Floating Flyout Popover Menu (ChatGPT Style) */}
      {isOpen && (
        <div className="absolute right-7 top-1/2 -translate-y-1/2 w-72 sm:w-84 max-w-[calc(100vw-3rem)] p-2 rounded-2xl bg-(--bg-card) text-(--text-main) backdrop-blur-md border border-(--border-hover) shadow-lg dark:shadow-[0_12px_40px_rgba(0,0,0,0.55)] transition-all duration-200 animate-in fade-in zoom-in-95 flex flex-col gap-1 z-40">
          {/* Header Navigation Controls (Scroll Up / Down) */}
          <div className="flex items-center justify-between px-2 py-1 border-b border-(--border-subtle) text-[11px] font-medium text-(--text-muted)">
            <span>Prompts ({prompts.length})</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigatePrev();
                }}
                disabled={!hasPrev}
                className={`p-1 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) ${
                  hasPrev
                    ? "hover:bg-(--border-subtle) hover:text-(--text-main) text-(--text-muted)"
                    : "opacity-30 cursor-not-allowed"
                }`}
                title="Previous prompt"
                aria-label="Previous prompt"
              >
                <LuChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateNext();
                }}
                disabled={!hasNext}
                className={`p-1 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) ${
                  hasNext
                    ? "hover:bg-(--border-subtle) hover:text-(--text-main) text-(--text-muted)"
                    : "opacity-30 cursor-not-allowed"
                }`}
                title="Next prompt"
                aria-label="Next prompt"
              >
                <LuChevronDown size={14} />
              </button>
            </div>
          </div>

          {/* Prompts List */}
          <div
            ref={popoverListRef}
            className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1 custom-scrollbar py-1"
          >
            {prompts.map((prompt) => {
              const isActive = prompt.id === activePromptId;
              return (
                <button
                  key={prompt.id}
                  ref={isActive ? activeItemRef : undefined}
                  type="button"
                  onClick={() => {
                    onNavigateToPrompt(prompt.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs sm:text-[13px] leading-snug transition-all flex items-center gap-2 group cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary) ${
                    isActive
                      ? "bg-primary-light-theme text-(--text-main) font-medium shadow-xs"
                      : "text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle)"
                  }`}
                  title={prompt.content}
                  aria-current={isActive ? "location" : undefined}
                >
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full transition-all ${
                      isActive
                        ? "bg-primary-theme scale-125"
                        : "bg-(--text-muted)"
                    }`}
                  />
                  <span className="truncate flex-1">
                    {prompt.content.trim() || `Prompt #${prompt.index + 1}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Vertical Tick Lines Rail (ChatGPT Look & Feel) */}
      <div
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex flex-col items-end gap-1.5 py-3 px-1.5 rounded-full cursor-pointer bg-(--bg-card) hover:bg-(--bg-input) backdrop-blur-xs border border-(--border-subtle) hover:border-(--border-hover) transition-all duration-200 shadow-sm group"
        role="navigation"
        aria-label="Chat prompt timeline"
      >
        {prompts.map((prompt) => {
          const isActive = prompt.id === activePromptId;
          return (
            <button
              key={prompt.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateToPrompt(prompt.id);
              }}
              className="group/tick flex w-6 h-2 items-center justify-end cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
              title={`Jump to: ${prompt.content.substring(0, 50)}...`}
              aria-label={`Jump to prompt ${prompt.index + 1}`}
              aria-current={isActive ? "location" : undefined}
            >
              <div
                className={`transition-all duration-200 rounded-full ${
                  isActive
                    ? "w-6 h-1 bg-(--text-main)"
                    : "w-3 h-0.5 bg-(--text-muted) group-hover/tick:w-4 group-hover/tick:bg-(--text-main)"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
