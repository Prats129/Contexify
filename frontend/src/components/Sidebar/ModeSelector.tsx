import React from 'react';
import type { ChatMode } from '../../types';

interface ModeSelectorProps {
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  currentMode,
  onModeChange,
}) => {
  return (
    <div className="sidebar-section">
      <label className="section-label">
        <i className="fa-solid fa-sliders"></i> Engine Mode
      </label>
      <div className="mode-selector">
        <button
          type="button"
          className={`mode-btn ${currentMode === 'WEB_SEARCH' ? 'active' : ''}`}
          onClick={() => onModeChange('WEB_SEARCH')}
        >
          <i className="fa-solid fa-globe"></i>
          <div className="mode-info">
            <span className="mode-title">Web Search</span>
            <span className="mode-desc">Live Internet Access</span>
          </div>
        </button>

        <button
          type="button"
          className={`mode-btn ${currentMode === 'DOCUMENT_RAG' ? 'active' : ''}`}
          onClick={() => onModeChange('DOCUMENT_RAG')}
        >
          <i className="fa-solid fa-file-contract"></i>
          <div className="mode-info">
            <span className="mode-title">Document RAG</span>
            <span className="mode-desc">Grounded Context QA</span>
          </div>
        </button>

        <button
          type="button"
          className="mode-btn disabled"
          title="Priority 3 - Multimodal Engine"
        >
          <i className="fa-solid fa-photo-film"></i>
          <div className="mode-info">
            <span className="mode-title">Multimodal</span>
            <span className="mode-desc">Vision & Audio (Coming)</span>
          </div>
        </button>
      </div>
    </div>
  );
};
