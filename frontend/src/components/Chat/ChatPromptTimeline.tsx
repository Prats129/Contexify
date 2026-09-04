import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LuChevronUp, LuChevronDown } from 'react-icons/lu';

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
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const popoverListRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

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
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [isOpen, activePromptId]);

  // If there's less than 2 prompts, don't show the timeline
  if (!prompts || prompts.length < 2) {
    return null;
  }

  return (
    <div
      className="fixed right-2 md:right-3.5 top-1/2 -translate-y-1/2 z-30 select-none flex items-center transition-all duration-200"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Floating Flyout Popover Menu (ChatGPT Style) */}
      {isOpen && (
        <div
          className="absolute right-7 top-1/2 -translate-y-1/2 w-72 sm:w-84 max-w-[calc(100vw-3rem)] p-2 rounded-2xl dark:bg-[#202123]/95 bg-white/95 backdrop-blur-md border border-white/10 dark:border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.45)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.55)] text-white dark:text-white transition-all duration-200 animate-in fade-in zoom-in-95 flex flex-col gap-1 z-40"
        >
          {/* Header Navigation Controls (Scroll Up / Down) */}
          <div className="flex items-center justify-between px-2 py-1 border-b border-white/10 dark:border-white/10 text-[11px] font-medium dark:text-neutral-400 text-neutral-500">
            <span>
              Prompts ({prompts.length})
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigatePrev();
                }}
                disabled={!hasPrev}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${hasPrev
                  ? 'hover:bg-white/15 dark:hover:bg-white/15 hover:bg-black/5 text-white dark:text-white'
                  : 'opacity-30 cursor-not-allowed'
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
                className={`p-1 rounded-lg transition-colors cursor-pointer ${hasNext
                  ? 'hover:bg-white/15 dark:hover:bg-white/15 hover:bg-black/5 text-white dark:text-white'
                  : 'opacity-30 cursor-not-allowed'
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
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs sm:text-[13px] leading-snug transition-all flex items-center gap-2 group cursor-pointer ${isActive
                    ? 'dark:bg-white/20 bg-black/10 dark:text-white text-neutral-900 font-medium shadow-xs'
                    : 'dark:text-neutral-300 text-neutral-600 hover:text-white dark:hover:text-white hover:text-neutral-900 hover:bg-white/10 dark:hover:bg-white/10 hover:bg-black/5'
                    }`}
                  title={prompt.content}
                >
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full transition-all ${isActive
                      ? 'bg-primary-theme scale-125'
                      : 'bg-neutral-500/40 group-hover:bg-neutral-400'
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
        className="flex flex-col items-end gap-1.5 py-3 px-1.5 rounded-full cursor-pointer bg-neutral-900/20 dark:bg-neutral-900/30 hover:bg-neutral-900/60 dark:hover:bg-neutral-900/70 hover:bg-neutral-300/70 backdrop-blur-xs border dark:border-white/5 border-black/5 transition-all duration-200 shadow-sm group"
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
              className="group/tick flex items-center justify-end py-0.5 cursor-pointer focus:outline-none"
              title={`Jump to: ${prompt.content.substring(0, 50)}...`}
              aria-label={`Jump to prompt ${prompt.index + 1}`}
            >
              <div
                className={`transition-all duration-200 rounded-full ${isActive
                  ? 'w-5 h-[2.5px] bg-white dark:bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)] dark:shadow-[0_0_6px_rgba(255,255,255,0.6)]'
                  : 'w-3.5 h-0.5 dark:bg-neutral-500/40 bg-neutral-600/40 group-hover/tick:w-4.5 group-hover/tick:bg-neutral-200 dark:group-hover/tick:bg-neutral-200 group-hover/tick:bg-neutral-800'
                  }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
