import React, { useState, useEffect, useCallback } from "react";
import {
  LuX,
  LuSearch,
  LuSparkles,
  LuUpload,
  LuFileText,
  LuFileCode,
  LuFile,
  LuImage,
  LuDownload,
  LuTrash2,
  LuPaperclip,
  LuMaximize2,
  LuCopy,
  LuCheck,
  LuRefreshCw,
  LuLayers,
  LuPlus,
} from "react-icons/lu";
import { apiService } from "../../services/api";
import type {
  AssetItem,
  MediaAttachment,
  DocumentMetadata,
  User,
} from "../../types";

interface AttachmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  activeSessionId: string | null;
  activeSessionTitle?: string;
  onAttachMedia?: (media: MediaAttachment) => void;
  onAttachDocument?: (doc: DocumentMetadata) => void;
  onAssetDeleted?: (assetId: string) => void;
}

export const AttachmentsModal: React.FC<AttachmentsModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  activeSessionId,
  activeSessionTitle,
  onAttachMedia,
  onAttachDocument,
  onAssetDeleted,
}) => {
  const [scope, setScope] = useState<"session" | "all">(() =>
    activeSessionId ? "session" : "all",
  );
  const [activeTab, setActiveTab] = useState<
    "all" | "upload" | "generated" | "document"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionSuccessText, setActionSuccessText] = useState<string | null>(
    null,
  );

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 280);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Adjust default scope when modal opens or activeSessionId changes
  useEffect(() => {
    if (isOpen) {
      if (activeSessionId) {
        setScope("session");
      } else {
        setScope("all");
      }
    }
  }, [isOpen, activeSessionId]);

  // Fetch assets with current filters
  const loadAssets = useCallback(
    async (isPageAppend = false) => {
      if (!isOpen) return;

      const currentOffset = isPageAppend ? offset : 0;
      if (isPageAppend) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        let originParam: "upload" | "generated" | "all" = "all";
        let fileTypeParam: "image" | "document" | "all" = "all";

        if (activeTab === "upload") {
          originParam = "upload";
        } else if (activeTab === "generated") {
          originParam = "generated";
          fileTypeParam = "image";
        } else if (activeTab === "document") {
          fileTypeParam = "document";
        }

        const res = await apiService.getAssets({
          userId: currentUser?.id,
          sessionId:
            scope === "session" && activeSessionId
              ? activeSessionId
              : undefined,
          origin: originParam,
          fileType: fileTypeParam,
          search: debouncedSearch || undefined,
          limit: 30,
          offset: currentOffset,
        });

        if (isPageAppend) {
          setAssets((prev) => [...prev, ...res.items]);
        } else {
          setAssets(res.items);
        }
        setTotal(res.total);
        setHasMore(res.has_more);
        setOffset(currentOffset + res.items.length);
      } catch (err) {
        console.error("Failed to load attachments:", err);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [
      isOpen,
      scope,
      activeSessionId,
      currentUser?.id,
      activeTab,
      debouncedSearch,
      offset,
    ],
  );

  // Reload when modal opens or primary filters change
  useEffect(() => {
    if (isOpen) {
      loadAssets(false);
    }
  }, [isOpen, scope, activeTab, debouncedSearch]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewAsset) {
          setPreviewAsset(null);
        } else if (isOpen) {
          onClose();
        }
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, previewAsset, onClose]);

  const handleCopyPrompt = async (
    prompt: string,
    id: string,
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
    }
  };

  const handleAttachToCurrentChat = (
    asset: AssetItem,
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    if (asset.file_type === "image" && onAttachMedia) {
      const mediaAttachment: MediaAttachment = {
        id: asset.id,
        url: asset.url,
        file_type: "image",
        file_name: asset.name,
        mime_type: asset.mime_type || "image/png",
        file_size_bytes: asset.size_bytes,
        media_type: asset.origin,
        prompt: asset.prompt,
      };
      onAttachMedia(mediaAttachment);
      showActionToast(`Attached "${asset.name}" to prompt`);
    } else if (asset.file_type === "document" && onAttachDocument) {
      const docMeta: DocumentMetadata = {
        document_id: asset.id,
        filename: asset.name,
        file_type: asset.mime_type || ".pdf",
        file_size_bytes: asset.size_bytes,
        total_chunks: 0,
        storage_url: asset.url,
        uploaded_at: asset.created_at,
      };
      onAttachDocument(docMeta);
      showActionToast(`Attached document "${asset.name}" to prompt`);
    }
  };

  const showActionToast = (msg: string) => {
    setActionSuccessText(msg);
    setTimeout(() => setActionSuccessText(null), 2500);
  };

  const handleDeleteAsset = async (asset: AssetItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (
      !window.confirm(
        `Are you sure you want to delete "${asset.name}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await apiService.deleteAsset(asset.id);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      setTotal((prev) => Math.max(0, prev - 1));
      if (previewAsset?.id === asset.id) {
        setPreviewAsset(null);
      }
      if (onAssetDeleted) {
        onAssetDeleted(asset.id);
      }
      showActionToast(`Deleted "${asset.name}"`);
    } catch (err) {
      console.error("Failed to delete asset:", err);
      alert("Failed to delete attachment. Please try again.");
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return "0 KB";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatRelativeTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);

      if (diffSecs < 60) return "Just now";
      if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
      if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
      if (diffSecs < 604800) return `${Math.floor(diffSecs / 86400)}d ago`;
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  const getDocIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <LuFileText className="text-red-500" size={28} />;
    if (
      ["txt", "md", "csv", "json", "log", "py", "js", "ts"].includes(ext || "")
    ) {
      return <LuFileCode className="text-primary-theme" size={28} />;
    }
    return <LuFile className="text-(--text-muted)" size={28} />;
  };

  if (!isOpen || !currentUser) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/75 backdrop-blur-md animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[88dvh] max-h-220 bg-(--bg-app) text-(--text-main) border border-(--border-subtle) rounded-2xl shadow-2xl flex flex-col overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-(--border-subtle) flex items-center justify-between gap-3 shrink-0 bg-(--bg-app)/90">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary-light-theme text-primary-theme border border-primary-theme flex items-center justify-center shrink-0">
              <LuPaperclip size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold truncate">
                  Attachments & Media
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-(--border-subtle) text-(--text-muted)">
                  {total}
                </span>
              </div>
              <p className="text-xs text-(--text-muted) truncate">
                Manage user uploads and AI generated media across your workspace
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => loadAssets(false)}
              disabled={isLoading}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle) border border-(--border-subtle) cursor-pointer transition-colors"
              title="Refresh"
            >
              <LuRefreshCw
                size={15}
                className={isLoading ? "animate-spin" : ""}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--text-main) hover:bg-(--border-subtle) border border-(--border-subtle) cursor-pointer transition-colors"
              title="Close (Esc)"
            >
              <LuX size={18} />
            </button>
          </div>
        </div>

        {/* Toolbar: Scope Selector + Tab Filters + Search */}
        <div className="px-4 sm:px-6 py-3 border-b border-(--border-subtle) flex flex-wrap items-center justify-between gap-3 bg-(--bg-sidebar)/50 shrink-0">
          {/* Left: Scope Selector + Filter Tabs */}
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {/* Scope Pill Toggle */}
            {activeSessionId && (
              <div className="flex items-center p-0.5 bg-(--border-subtle) rounded-lg border border-(--border-subtle) text-xs">
                <button
                  type="button"
                  onClick={() => setScope("session")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    scope === "session"
                      ? "bg-(--bg-app) text-(--text-main) shadow-xs font-semibold"
                      : "text-(--text-muted) hover:text-(--text-main)"
                  }`}
                  title={
                    activeSessionTitle
                      ? `Only files attached or generated in "${activeSessionTitle}"`
                      : "Only files attached or generated in this conversation"
                  }
                >
                  This Chat
                </button>
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    scope === "all"
                      ? "bg-(--bg-app) text-(--text-main) shadow-xs font-semibold"
                      : "text-(--text-muted) hover:text-(--text-main)"
                  }`}
                  title="All media and files in your library"
                >
                  All Chats
                </button>
              </div>
            )}

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto py-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-colors border ${
                  activeTab === "all"
                    ? "bg-primary-theme text-white border-primary-theme shadow-xs"
                    : "bg-(--border-subtle) hover:bg-(--border-hover) border-(--border-subtle) text-(--text-muted) hover:text-(--text-main)"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("upload")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-colors border ${
                  activeTab === "upload"
                    ? "bg-primary-theme text-white border-primary-theme shadow-xs"
                    : "bg-(--border-subtle) hover:bg-(--border-hover) border-(--border-subtle) text-(--text-muted) hover:text-(--text-main)"
                }`}
              >
                <LuUpload size={13} />
                <span>Uploaded</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("generated")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-colors border ${
                  activeTab === "generated"
                    ? "bg-primary-theme text-white border-primary-theme shadow-xs"
                    : "bg-(--border-subtle) hover:bg-(--border-hover) border-(--border-subtle) text-(--text-muted) hover:text-(--text-main)"
                }`}
              >
                <LuSparkles size={13} className="text-amber-500" />
                <span>AI Generated</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("document")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-colors border ${
                  activeTab === "document"
                    ? "bg-primary-theme text-white border-primary-theme shadow-xs"
                    : "bg-(--border-subtle) hover:bg-(--border-hover) border-(--border-subtle) text-(--text-muted) hover:text-(--text-main)"
                }`}
              >
                <LuFileText size={13} />
                <span>Documents</span>
              </button>
            </div>
          </div>

          {/* Right: Search Input */}
          <div className="relative w-full sm:w-64">
            <LuSearch
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search filename or prompt..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-(--border-subtle) border border-(--border-subtle) rounded-lg text-(--text-main) focus:outline-none focus:border-primary-theme transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-(--text-muted) hover:text-(--text-main) cursor-pointer"
              >
                <LuX size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Action Toast Notification */}
        {actionSuccessText && (
          <div className="absolute top-18 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold shadow-lg flex items-center gap-1.5 animate-[fadeIn_0.15s_ease-out]">
            <LuCheck size={14} />
            <span>{actionSuccessText}</span>
          </div>
        )}

        {/* Content Body: Media & Files Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isLoading && assets.length === 0 ? (
            <div className="h-full min-h-75 flex flex-col items-center justify-center gap-3 text-(--text-muted)">
              <LuRefreshCw
                size={28}
                className="animate-spin text-primary-theme"
              />
              <p className="text-xs">Loading media assets...</p>
            </div>
          ) : assets.length === 0 ? (
            <div className="h-full min-h-85 flex flex-col items-center justify-center gap-3 text-center p-6 text-(--text-muted)">
              <div className="w-16 h-16 rounded-2xl bg-(--border-subtle) border border-(--border-subtle) flex items-center justify-center text-(--text-muted) mb-1">
                {activeTab === "generated" ? (
                  <LuSparkles size={28} className="text-amber-500" />
                ) : activeTab === "document" ? (
                  <LuFileText size={28} />
                ) : (
                  <LuLayers size={28} />
                )}
              </div>
              <h3 className="text-sm font-bold text-(--text-main)">
                {debouncedSearch
                  ? "No matching attachments found"
                  : activeTab === "generated"
                    ? "No AI generated images yet"
                    : activeTab === "document"
                      ? "No documents in this view"
                      : "No attachments yet"}
              </h3>
              <p className="text-xs max-w-sm">
                {debouncedSearch
                  ? "Try searching with a different keyword or prompt phrase."
                  : activeTab === "generated"
                    ? "Generate images in Image Studio mode to collect and inspect them here."
                    : "Attach files or images in your conversation to access them anytime."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
              {assets.map((asset) => {
                const isImage = asset.file_type === "image";
                const isGenerated = asset.origin === "generated";

                return (
                  <div
                    key={asset.id}
                    className="group relative bg-(--border-subtle)/30 hover:bg-(--border-subtle) border border-(--border-subtle) hover:border-primary-theme/50 rounded-xl overflow-hidden flex flex-col transition-all shadow-xs hover:shadow-md cursor-pointer"
                    onClick={() => setPreviewAsset(asset)}
                  >
                    {/* Media Thumbnail Container */}
                    <div className="w-full aspect-square relative bg-black/10 flex items-center justify-center overflow-hidden">
                      {isImage ? (
                        <img
                          src={asset.url}
                          alt={asset.name}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-1.5 p-4 text-center">
                          {getDocIcon(asset.name)}
                          <span className="text-[10px] uppercase font-bold tracking-wider text-(--text-muted)">
                            {asset.name.split(".").pop()}
                          </span>
                        </div>
                      )}

                      {/* Origin Badge */}
                      <div className="absolute top-2 left-2 z-10">
                        {isGenerated ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/90 text-black shadow-xs backdrop-blur-xs">
                            <LuSparkles size={10} />
                            <span>AI Gen</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-black/60 text-white/90 shadow-xs backdrop-blur-xs">
                            {isImage ? (
                              <LuImage size={10} />
                            ) : (
                              <LuFileText size={10} />
                            )}
                            <span>{isImage ? "Photo" : "Doc"}</span>
                          </span>
                        )}
                      </div>

                      {/* Hover Action Overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2.5 z-20">
                        {/* Top-Right Quick Actions */}
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewAsset(asset);
                            }}
                            className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer transition-colors"
                            title="Inspect / Preview"
                          >
                            <LuMaximize2 size={13} />
                          </button>
                          <a
                            href={asset.url}
                            download={asset.name}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer transition-colors"
                            title="Download"
                          >
                            <LuDownload size={13} />
                          </a>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteAsset(asset, e)}
                            className="w-7 h-7 rounded-lg bg-red-500/30 hover:bg-red-500 text-white flex items-center justify-center cursor-pointer transition-colors"
                            title="Delete"
                          >
                            <LuTrash2 size={13} />
                          </button>
                        </div>

                        {/* Bottom: Attach to Chat Button */}
                        <button
                          type="button"
                          onClick={(e) => handleAttachToCurrentChat(asset, e)}
                          className="w-full py-1.5 px-2 bg-primary-theme hover:opacity-90 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md transition-opacity cursor-pointer"
                          title="Attach this file into current prompt"
                        >
                          <LuPlus size={14} />
                          <span>Attach to Chat</span>
                        </button>
                      </div>
                    </div>

                    {/* Metadata Footer */}
                    <div className="p-2.5 flex flex-col gap-1 min-w-0">
                      <h4
                        className="text-xs font-semibold text-(--text-main) truncate"
                        title={asset.name}
                      >
                        {asset.name}
                      </h4>

                      <div className="flex items-center justify-between text-[11px] text-(--text-muted)">
                        <span>{formatFileSize(asset.size_bytes)}</span>
                        <span>{formatRelativeTime(asset.created_at)}</span>
                      </div>

                      {asset.session_title && (
                        <div
                          className="text-[10px] text-(--text-muted) truncate opacity-80"
                          title={asset.session_title}
                        >
                          💬 {asset.session_title}
                        </div>
                      )}

                      {/* Prompt Excerpt for Generated Images */}
                      {isGenerated && asset.prompt && (
                        <div className="mt-1 pt-1 border-t border-(--border-subtle)/60 flex items-center justify-between gap-1 text-[10px] text-amber-500/90">
                          <span className="truncate italic">
                            "{asset.prompt}"
                          </span>
                          <button
                            type="button"
                            onClick={(e) =>
                              handleCopyPrompt(asset.prompt || "", asset.id, e)
                            }
                            className="shrink-0 hover:text-white transition-colors"
                            title="Copy Prompt"
                          >
                            {copiedId === asset.id ? (
                              <LuCheck size={11} />
                            ) : (
                              <LuCopy size={11} />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Load More Pagination */}
          {hasMore && (
            <div className="mt-6 flex justify-center pb-2">
              <button
                type="button"
                onClick={() => loadAssets(true)}
                disabled={isLoadingMore}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-(--border-subtle) hover:bg-(--border-hover) text-(--text-main) border border-(--border-subtle) flex items-center gap-2 cursor-pointer transition-colors shadow-xs"
              >
                {isLoadingMore ? (
                  <LuRefreshCw size={14} className="animate-spin" />
                ) : null}
                <span>
                  {isLoadingMore ? "Loading more..." : "Load More Attachments"}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Lightbox / Fullscreen Preview Modal */}
        {previewAsset && (
          <div
            className="fixed inset-0 z-60 bg-black/85 backdrop-blur-md flex flex-col animate-[fadeIn_0.15s_ease-out]"
            onClick={() => setPreviewAsset(null)}
          >
            {/* Lightbox Topbar */}
            <div
              className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-white/10 shrink-0 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs sm:text-sm font-semibold truncate max-w-sm sm:max-w-md">
                  {previewAsset.name}
                </span>
                <span className="text-xs text-white/60">
                  {formatFileSize(previewAsset.size_bytes)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAttachToCurrentChat(previewAsset)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-theme hover:opacity-90 text-white flex items-center gap-1.5 cursor-pointer transition-opacity shadow-xs"
                >
                  <LuPlus size={14} />
                  <span>Attach to Chat</span>
                </button>
                <a
                  href={previewAsset.url}
                  download={previewAsset.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 text-white flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <LuDownload size={14} />
                  <span className="hidden sm:inline">Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => handleDeleteAsset(previewAsset)}
                  className="w-8 h-8 rounded-lg bg-red-500/20 hover:bg-red-500 text-white flex items-center justify-center cursor-pointer transition-colors"
                  title="Delete"
                >
                  <LuTrash2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewAsset(null)}
                  className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors"
                  title="Close preview (Esc)"
                >
                  <LuX size={18} />
                </button>
              </div>
            </div>

            {/* Lightbox Center Content */}
            <div
              className="flex-1 overflow-auto flex items-center justify-center p-4"
              onClick={() => setPreviewAsset(null)}
            >
              {previewAsset.file_type === "image" ? (
                <img
                  src={previewAsset.url}
                  alt={previewAsset.name}
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-[75vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
                />
              ) : (
                <div
                  className="bg-(--bg-app) text-(--text-main) p-8 rounded-2xl max-w-lg w-full flex flex-col items-center gap-4 text-center border border-(--border-subtle)"
                  onClick={(e) => e.stopPropagation()}
                >
                  {getDocIcon(previewAsset.name)}
                  <h3 className="text-base font-bold">{previewAsset.name}</h3>
                  <p className="text-xs text-(--text-muted)">
                    Document file • {formatFileSize(previewAsset.size_bytes)}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <a
                      href={previewAsset.url}
                      download={previewAsset.name}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-primary-theme text-white text-xs font-semibold rounded-lg flex items-center gap-2"
                    >
                      <LuDownload size={14} />
                      <span>Download Document</span>
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Lightbox Bottom Details Bar (For Prompt & Metadata) */}
            {previewAsset.origin === "generated" && previewAsset.prompt && (
              <div
                className="p-4 border-t border-white/10 bg-black/60 shrink-0 text-white text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-2 max-w-2xl min-w-0">
                  <LuSparkles
                    size={16}
                    className="text-amber-400 shrink-0 mt-0.5"
                  />
                  <p className="italic text-white/90">
                    "{previewAsset.prompt}"
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) =>
                    handleCopyPrompt(
                      previewAsset.prompt || "",
                      previewAsset.id,
                      e,
                    )
                  }
                  className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-medium flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
                >
                  {copiedId === previewAsset.id ? (
                    <LuCheck size={14} />
                  ) : (
                    <LuCopy size={14} />
                  )}
                  <span>
                    {copiedId === previewAsset.id
                      ? "Copied Prompt"
                      : "Copy Prompt"}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
