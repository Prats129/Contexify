import React from 'react';
import type { DocumentMetadata } from '../../types';

interface DocumentListProps {
  documents: DocumentMetadata[];
  onDeleteDocument: (documentId: string) => void;
}

export const DocumentList: React.FC<DocumentListProps> = ({
  documents,
  onDeleteDocument,
}) => {
  const getFileIcon = (fileType: string) => {
    if (fileType === '.pdf') return 'fa-solid fa-file-pdf';
    if (fileType === '.txt' || fileType === '.md') return 'fa-solid fa-file-lines';
    return 'fa-solid fa-file';
  };

  return (
    <div className="sidebar-section docs-section">
      <div className="section-header">
        <label className="section-label">
          <i className="fa-solid fa-folder-open"></i> Session Documents
        </label>
        <span className="doc-count-badge">{documents.length} files</span>
      </div>

      <div className="document-list">
        {documents.length === 0 ? (
          <div className="empty-docs-placeholder">
            <i className="fa-regular fa-file-lines"></i>
            <p>No documents in this session.</p>
            <span>Drop a PDF/TXT to start RAG QA</span>
          </div>
        ) : (
          documents.map((doc) => (
            <div key={doc.document_id} className="doc-card">
              <div className="doc-info">
                <i className={getFileIcon(doc.file_type)}></i>
                <div className="doc-details">
                  <span className="doc-name" title={doc.filename}>
                    {doc.filename}
                  </span>
                  <span className="doc-meta">
                    {doc.total_chunks} chunks • {(doc.file_size_bytes / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn-delete-doc"
                onClick={() => onDeleteDocument(doc.document_id)}
                title="Delete Document"
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
