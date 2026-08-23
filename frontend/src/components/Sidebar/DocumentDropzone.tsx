import React, { useRef, useState } from 'react';

interface DocumentDropzoneProps {
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  uploadStatusText?: string;
}

export const DocumentDropzone: React.FC<DocumentDropzoneProps> = ({
  onFileUpload,
  isUploading,
  uploadStatusText,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  return (
    <div
      className={`upload-dropzone ${isDragOver ? 'dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        accept=".pdf,.txt,.md,.csv,.json,.log"
        hidden
        onChange={handleFileChange}
      />
      <div className="dropzone-content">
        <i className="fa-solid fa-cloud-arrow-up upload-icon"></i>
        <p className="drop-title">Upload Knowledge Content</p>
        <p className="drop-subtitle">PDF, TXT, MD up to 50MB</p>
        <button
          type="button"
          className="btn-browse"
          onClick={() => fileInputRef.current?.click()}
        >
          Browse File
        </button>
      </div>

      {isUploading && (
        <div className="upload-progress-overlay">
          <div className="spinner"></div>
          <span>{uploadStatusText || 'Vectorizing document...'}</span>
        </div>
      )}
    </div>
  );
};
