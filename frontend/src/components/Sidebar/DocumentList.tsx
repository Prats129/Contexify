import React from 'react';
import { LuFolderOpen, LuFileText, LuFileCode, LuFile, LuTrash2 } from 'react-icons/lu';
import type { DocumentMetadata } from '../../types';

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
  const getFileIcon = (fileType: string) => {
    if (fileType === '.pdf') return <LuFileText size={15} className="text-red-500 shrink-0" />;
    if (fileType === '.txt' || fileType === '.md')
      return <LuFileCode size={15} className="text-primary-theme shrink-0" />;
    return <LuFile size={15} className="text-(--text-muted) shrink-0" />;
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      {isOpen && (
        <div className="flex items-center justify-between px-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-(--text-muted) flex items-center gap-1.5">
            <LuFolderOpen size={13} /> Session Documents
          </label>
          <span className="text-[10px] bg-(--border-subtle) px-2 py-0.5 rounded-full text-(--text-muted)">
            {documents.length} files
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto w-full">
        {documents.length === 0 ? (
          isOpen ? (
            <div className="text-center py-3 text-(--text-muted) text-xs">
              <LuFileText size={16} className="mx-auto mb-1 opacity-50" />
              <p>No documents attached.</p>
              <span className="text-[10px] opacity-70">Drop a PDF or TXT into chat</span>
            </div>
          ) : null
        ) : (
          documents.map((doc) => (
            <div
              key={doc.document_id}
              className={`group flex items-center justify-between p-2 rounded-lg border border-(--border-subtle) bg-transparent hover:bg-(--border-subtle) ${
                isOpen ? 'w-full' : 'w-10 h-10 justify-center mx-auto p-0'
              }`}
              title={doc.filename}
            >
              <div className="flex items-center gap-2 overflow-hidden min-w-0">
                {getFileIcon(doc.file_type)}
                {isOpen && (
                  <div className="flex flex-col min-w-0 overflow-hidden">
                    <span className="text-xs font-medium text-(--text-main) truncate">
                      {doc.filename}
                    </span>
                    <span className="text-[10px] text-(--text-muted)">
                      {doc.total_chunks} chunks • {(doc.file_size_bytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                )}
              </div>

              {isOpen && (
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 p-1 text-(--text-muted) hover:text-red-500 hover:bg-red-500/15 rounded cursor-pointer"
                  onClick={() => onDeleteDocument(doc.document_id)}
                  title="Delete Document"
                >
                  <LuTrash2 size={13} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
