import React, { useState, useCallback } from "react";
import {
  LuFolderOpen,
  LuFileText,
  LuFileCode,
  LuFile,
  LuTrash2,
  LuChevronDown,
} from "react-icons/lu";
import type { DocumentMetadata } from "../../types";

interface DocumentListProps {
  isOpen?: boolean;
  documents: DocumentMetadata[];
  onDeleteDocument: (documentId: string) => void;
}

export const DocumentList: React.FC<DocumentListProps> = ({
  isOpen = true,
  documents,
  onDeleteDocument,
}) => {
  // --- Collapsible Section State (persisted in localStorage) ---
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("contexify_documents_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("contexify_documents_collapsed", String(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, []);

  const getFileIcon = (fileType: string) => {
    if (fileType === ".pdf")
      return <LuFileText size={15} className="text-red-500 shrink-0" />;
    if (fileType === ".txt" || fileType === ".md")
      return <LuFileCode size={15} className="text-primary-theme shrink-0" />;
    return <LuFile size={15} className="text-(--text-muted) shrink-0" />;
  };

  if (!isOpen && documents.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {isOpen && (
        <div className="flex items-center justify-between px-1 select-none">
          <button
            type="button"
            onClick={toggleCollapse}
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? "Expand session documents"
                : "Collapse session documents"
            }
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--text-muted) hover:text-(--text-main) transition-colors cursor-pointer group text-left"
          >
            <LuChevronDown
              size={13}
              className={`transition-transform duration-200 text-(--text-muted) group-hover:text-(--text-main) shrink-0 ${
                isCollapsed ? "-rotate-90" : "rotate-0"
              }`}
            />
            <LuFolderOpen size={13} className="shrink-0" />
            <span>Session Documents</span>
          </button>
          <span className="text-[10px] bg-(--border-subtle) px-2 py-0.5 rounded-full text-(--text-muted)">
            {documents.length}
          </span>
        </div>
      )}

      {isOpen ? (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out w-full ${
            isCollapsed
              ? "grid-rows-[0fr] opacity-0 pointer-events-none"
              : "grid-rows-[1fr] opacity-100"
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div className="flex flex-col gap-1.5 w-full max-h-40 overflow-y-auto pr-0.5 pt-0.5">
              {documents.length === 0 ? (
                <div className="text-center py-3 text-(--text-muted) text-xs">
                  <LuFileText size={16} className="mx-auto mb-1 opacity-50" />
                  <p>No documents attached.</p>
                  <span className="text-[10px] opacity-70">
                    Drop a PDF or TXT into chat
                  </span>
                </div>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.document_id}
                    className="group flex items-center justify-between p-2 rounded-lg border border-(--border-subtle) bg-transparent hover:bg-(--border-subtle) w-full"
                    title={doc.filename}
                  >
                    <div className="flex items-center gap-2 overflow-hidden min-w-0">
                      {getFileIcon(doc.file_type)}
                      <div className="flex flex-col min-w-0 overflow-hidden">
                        <span className="text-xs font-medium text-(--text-main) truncate">
                          {doc.filename}
                        </span>
                        <span className="text-[10px] text-(--text-muted)">
                          {doc.total_chunks} chunks •{" "}
                          {(doc.file_size_bytes / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 p-1.5 text-(--text-muted) hover:text-red-500 hover:bg-red-500/15 rounded cursor-pointer transition-opacity shrink-0"
                      onClick={() => onDeleteDocument(doc.document_id)}
                      title="Delete Document"
                      aria-label="Delete Document"
                    >
                      <LuTrash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Compact Sidebar Icon Mode */
        <div className="flex flex-col gap-1.5 w-full items-center">
          {documents.map((doc) => (
            <div
              key={doc.document_id}
              className="group flex items-center justify-center w-10 h-10 rounded-lg border border-(--border-subtle) bg-transparent hover:bg-(--border-subtle) p-0"
              title={doc.filename}
            >
              {getFileIcon(doc.file_type)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
