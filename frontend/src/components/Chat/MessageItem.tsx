import React, { useState } from "react";
import {
  LuTriangleAlert,
  LuCopy,
  LuCheck,
  LuExternalLink,
  LuDownload,
  LuMaximize2,
  LuSparkles,
  LuX,
} from "react-icons/lu";
import type { Citation, MediaAttachment } from "../../types";

interface MessageItemProps {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[] | null;
  attachments?: MediaAttachment[] | null;
  isStreaming?: boolean;
  isError?: boolean;
  userAvatarUrl?: string | null;
  userAvatarColor?: string;
  userDisplayName?: string;
  queryTitle?: string;
  isSourcesActive?: boolean;
  isHighlighted?: boolean;
  onToggleSources?: (citations: Citation[]) => void;
  onUseAsReference?: (media: MediaAttachment) => void;
}

export const MessageItem: React.FC<MessageItemProps> = React.memo(
  ({
    id,
    role,
    content,
    citations,
    attachments,
    isStreaming,
    isError,
    isSourcesActive,
    isHighlighted,
    onToggleSources,
    onUseAsReference,
  }) => {
    const isUser = role === "user";
    const [copied, setCopied] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    const handleCopy = async () => {
      if (!content) return;
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback if clipboard API is restricted
        const textarea = document.createElement("textarea");
        textarea.value = content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    const renderInline = (line: string, lineKey: string | number) => {
      // Regex matching markdown link [text](url), raw URLs, bold **text**, and inline code `code`
      const inlineRegex =
        /(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<)]+|\*\*[^*]+\*\*|`[^`]+`)/g;
      const segments = line.split(inlineRegex);

      return segments.map((seg, idx) => {
        const key = `${lineKey}-${idx}`;
        if (!seg) return null;

        // 1. Markdown link: [Title](https://...)
        const mdLinkMatch = seg.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (mdLinkMatch) {
          const [, title, url] = mdLinkMatch;
          return (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${
                isUser
                  ? "text-white underline decoration-white/70 hover:decoration-white font-medium"
                  : "text-primary-theme hover:underline font-medium"
              } inline-flex items-center gap-0.5 underline-offset-2 break-all`}
            >
              <span>{title}</span>
              <LuExternalLink
                size={10}
                className={`inline ml-0.5 ${
                  isUser ? "text-white/80" : "opacity-70"
                } shrink-0`}
              />
            </a>
          );
        }

        // 2. Raw URL: https://...
        if (/^https?:\/\/[^\s]+$/.test(seg)) {
          return (
            <a
              key={key}
              href={seg}
              target="_blank"
              rel="noopener noreferrer"
              className={`${
                isUser
                  ? "text-white underline decoration-white/70 hover:decoration-white font-medium"
                  : "text-primary-theme hover:underline font-medium"
              } inline-flex items-center gap-0.5 underline-offset-2 break-all`}
            >
              <span>{seg}</span>
              <LuExternalLink
                size={10}
                className={`inline ml-0.5 ${
                  isUser ? "text-white/80" : "opacity-70"
                } shrink-0`}
              />
            </a>
          );
        }

        // 3. Bold: **text**
        if (seg.startsWith("**") && seg.endsWith("**") && seg.length >= 4) {
          return (
            <strong
              key={key}
              className={`font-semibold ${isUser ? "text-white" : "text-(--text-main)"}`}
            >
              {seg.slice(2, -2)}
            </strong>
          );
        }

        // 4. Inline code: `code`
        if (seg.startsWith("`") && seg.endsWith("`") && seg.length >= 2) {
          return (
            <code
              key={key}
              className={`px-1.5 py-0.5 rounded font-mono text-xs font-medium ${
                isUser
                  ? "bg-white/20 text-white"
                  : "bg-black/5 text-primary-theme border border-(--border-subtle)"
              }`}
            >
              {seg.slice(1, -1)}
            </code>
          );
        }

        return <React.Fragment key={key}>{seg}</React.Fragment>;
      });
    };

    const formatContent = (text: string) => {
      if (!text || !text.trim()) return null;
      const lines = text.split("\n");

      return lines.map((line, lineIdx) => {
        const trimmed = line.trim();

        // Heading 3: ### Title
        if (line.startsWith("### ")) {
          return (
            <h4
              key={lineIdx}
              className={`text-sm font-bold ${
                isUser ? "text-white" : "text-(--text-main)"
              } mt-2.5 mb-1 flex items-center gap-1.5`}
            >
              {renderInline(line.slice(4), lineIdx)}
            </h4>
          );
        }

        // Heading 2: ## Title
        if (line.startsWith("## ")) {
          return (
            <h3
              key={lineIdx}
              className={`text-base font-bold ${
                isUser ? "text-white" : "text-(--text-main)"
              } mt-3 mb-1.5`}
            >
              {renderInline(line.slice(3), lineIdx)}
            </h3>
          );
        }

        // Heading 1: # Title
        if (line.startsWith("# ")) {
          return (
            <h2
              key={lineIdx}
              className={`text-lg font-bold ${
                isUser ? "text-white" : "text-(--text-main)"
              } mt-3.5 mb-2`}
            >
              {renderInline(line.slice(2), lineIdx)}
            </h2>
          );
        }

        // Bullet points: - item or * item
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const bulletContent = trimmed.slice(2);
          return (
            <div key={lineIdx} className="flex items-start gap-2 my-1 pl-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isUser ? "bg-white" : "bg-primary-theme"
                } shrink-0 mt-2`}
              ></span>
              <div className="flex-1 min-w-0">
                {renderInline(bulletContent, lineIdx)}
              </div>
            </div>
          );
        }

        // Numbered points: 1. item
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          const [, num, itemContent] = numMatch;
          return (
            <div key={lineIdx} className="flex items-start gap-2 my-1 pl-1">
              <span
                className={`text-xs font-bold ${
                  isUser ? "text-white" : "text-primary-theme"
                } shrink-0 mt-0.5 min-w-[1.2rem]`}
              >
                {num}.
              </span>
              <div className="flex-1 min-w-0">
                {renderInline(itemContent, lineIdx)}
              </div>
            </div>
          );
        }

        // Empty line / paragraph break
        if (!trimmed) {
          return <div key={lineIdx} className="h-2" />;
        }

        // Regular paragraph line
        return (
          <div key={lineIdx} className="my-0.5">
            {renderInline(line, lineIdx)}
          </div>
        );
      });
    };

    return (
      <div
        id={id}
        className={`group flex items-start gap-2 w-full transition-all duration-300 scroll-mt-6 ${
          isUser ? "justify-end" : "justify-start"
        } ${isHighlighted ? "scale-[1.01] -translate-y-0.5" : ""}`}
      >
        <div
          className={`flex flex-col gap-1 max-w-[92%] sm:max-w-[85%] md:max-w-[80%] ${
            isUser ? "items-end" : "items-start"
          }`}
        >
          {/* Attached Media (Images / Documents) */}
          {attachments && attachments.length > 0 && (
            <div
              className={`flex flex-wrap gap-2 mb-1.5 ${
                isUser ? "justify-end" : "justify-start"
              }`}
            >
              {attachments.map((att, attIdx) => {
                if (att.file_type === "image" || att.url) {
                  return (
                    <div
                      key={att.id || attIdx}
                      className="group/img relative rounded-xl overflow-hidden border border-(--border-subtle) bg-(--bg-card) shadow-sm max-w-xs sm:max-w-sm"
                    >
                      <img
                        src={att.url}
                        alt={att.file_name || att.prompt || "Attached media"}
                        className="w-full max-h-72 sm:max-h-80 object-cover cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
                        onClick={() => setSelectedImage(att.url)}
                        loading="lazy"
                      />

                      {/* Overlay action bar */}
                      <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/65 backdrop-blur-xs p-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setSelectedImage(att.url)}
                          className="p-1 text-white/90 hover:text-white hover:bg-white/20 rounded cursor-pointer transition-colors"
                          title="View Fullscreen"
                        >
                          <LuMaximize2 size={13} />
                        </button>
                        <a
                          href={att.url}
                          download={att.file_name || "contexify_image.png"}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 text-white/90 hover:text-white hover:bg-white/20 rounded cursor-pointer transition-colors"
                          title="Download Image"
                        >
                          <LuDownload size={13} />
                        </a>
                        {!isUser && onUseAsReference && (
                          <button
                            type="button"
                            onClick={() => onUseAsReference(att)}
                            className="p-1 text-white/90 hover:text-white hover:bg-white/20 rounded cursor-pointer transition-colors"
                            title="Use as Reference for new variation"
                          >
                            <LuSparkles size={13} />
                          </button>
                        )}
                      </div>

                      {att.prompt && (
                        <div className="p-2 text-[11px] text-(--text-muted) border-t border-(--border-subtle) bg-(--bg-input)/80 truncate max-w-xs">
                          {att.prompt}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}

          <div
            className={`px-3.5 sm:px-4 py-2.5 rounded-2xl text-sm leading-relaxed transition-all duration-300 wrap-break-word ${
              isUser
                ? `bg-primary-theme text-white ${
                    isHighlighted
                      ? "ring-3 ring-primary-theme/50 shadow-lg"
                      : ""
                  }`
                : `bg-(--bg-card) border border-(--border-subtle) text-(--text-main) shadow-xs ${
                    isHighlighted ? "ring-2 ring-primary-theme shadow-md" : ""
                  }`
            }`}
          >
            {isError ? (
              <span className="text-red-500 flex items-center gap-1.5">
                <LuTriangleAlert size={16} /> {content}
              </span>
            ) : isStreaming && !content?.trim() ? (
              <span className="flex items-center gap-2 text-(--text-muted) text-xs py-0.5">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-theme animate-bounce [animation-delay:-0.32s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-theme animate-bounce [animation-delay:-0.16s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-theme animate-bounce" />
                </span>
                <span>Thinking...</span>
              </span>
            ) : (
              <>
                {formatContent(content)}
                {isStreaming && (
                  <span className="inline-block w-1.5 h-4 ml-1 bg-primary-theme animate-pulse align-middle rounded-xs" />
                )}
              </>
            )}
          </div>

          {/* Action toolbar (ChatGPT & Perplexity style) */}
          {content && !isStreaming && (
            <div
              className={`flex items-center ${
                isUser ? "justify-end" : "justify-between"
              } w-full mt-1 px-1`}
            >
              {/* Actions: Copy button */}
              <div
                className={`flex items-center gap-1 transition-opacity duration-150 ${
                  copied
                    ? "opacity-100"
                    : "opacity-80 sm:opacity-0 sm:group-hover:opacity-100"
                }`}
              >
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-[11px] text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle) px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                  title={copied ? "Copied to clipboard" : "Copy message"}
                >
                  {copied ? (
                    <>
                      <LuCheck size={12} className="text-emerald-500" />
                      <span className="text-emerald-500 text-[10px] font-medium">
                        Copied
                      </span>
                    </>
                  ) : (
                    <LuCopy size={12} />
                  )}
                </button>
              </div>

              {/* Right side: Perplexity-style Sources Pill Button */}
              {!isUser &&
                citations &&
                citations.length > 0 &&
                onToggleSources && (
                  <button
                    type="button"
                    onClick={() => onToggleSources(citations)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium cursor-pointer transition-all shadow-2xs hover:scale-[1.02] ${
                      isSourcesActive
                        ? "bg-primary-light-theme border-primary-theme text-primary-theme font-semibold"
                        : "bg-(--border-subtle) hover:bg-(--border-hover) border-(--border-subtle) text-(--text-muted) hover:text-(--text-main)"
                    }`}
                    title="Toggle sources on the right"
                  >
                    {/* Grouped overlapping icons */}
                    <div className="flex items-center -space-x-1.5">
                      {citations.slice(0, 3).map((c, i) => {
                        const lines = c.snippet.split("\n");
                        let domain = "";
                        if (lines[0].startsWith("http")) {
                          try {
                            domain = new URL(lines[0]).hostname.replace(
                              /^www\./,
                              "",
                            );
                          } catch {
                            domain = "";
                          }
                        }
                        return (
                          <div
                            key={i}
                            className="w-4 h-4 rounded-full bg-(--bg-card) border border-(--border-subtle) flex items-center justify-center overflow-hidden shrink-0"
                          >
                            {domain ? (
                              <img
                                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                alt=""
                                className="w-3 h-3 object-contain"
                                onError={(e) => {
                                  (
                                    e.currentTarget as HTMLElement
                                  ).style.display = "none";
                                }}
                              />
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-primary-theme" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <span>
                      {citations.length}{" "}
                      {citations.length === 1 ? "source" : "sources"}
                    </span>
                  </button>
                )}
            </div>
          )}
        </div>

        {/* Lightbox Preview Modal */}
        {selectedImage && (
          <div
            role="dialog"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
            onClick={() => setSelectedImage(null)}
          >
            <div
              className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="absolute -top-10 right-0 text-white/80 hover:text-white p-1 rounded-full cursor-pointer transition-colors"
                onClick={() => setSelectedImage(null)}
                title="Close"
              >
                <LuX size={24} />
              </button>
              <img
                src={selectedImage}
                alt="Enlarged view"
                className="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl border border-white/10"
              />
              <div className="flex items-center gap-3 mt-3">
                <a
                  href={selectedImage}
                  download="contexify_image.png"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary-theme text-white text-xs font-medium rounded-full shadow-lg hover:opacity-90 transition-opacity"
                >
                  <LuDownload size={14} /> Download High-Res
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
